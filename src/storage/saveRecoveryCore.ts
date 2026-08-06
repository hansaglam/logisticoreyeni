import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  beginSaveRecoveryRestoreJournal,
  completeSaveRecoveryRestoreJournal,
  getInterruptedSaveRecoveryRestore,
  hasSaveRecoveryRestoreReceipt,
} from './saveRecoveryJournal';
import {
  closeSaveRecoveryQuarantine,
  getSaveRecoveryQuarantine,
  isSaveRecoveryFatal,
  markSaveRecoveryFatal,
  markUserChoseNewGameInRecovery,
  recordSaveRecoveryQuarantine,
  SAVE_ACTIVE_SLOT_KEY,
  SAVE_QUARANTINE_RAW_KEY,
  SAVE_RESTORE_STAGING_KEY,
  type SaveRecoveryChecksumStatus,
  type SaveRecoveryQuarantine,
  type SaveRecoveryReason,
  type SaveRecoveryStage,
  writeQuarantineRawBackup,
} from './saveRecoveryQuarantine';
import {
  atomicWriteSaveJson,
  migrateSavePayload,
  payloadToStoreState,
  SAVE_BACKUP_INVALID_KEY,
  SAVE_BACKUP_MIGRATED_KEY,
  SAVE_GAME_VERSION,
  SAVE_STORAGE_KEY,
  sealSavePayloadIntegrity,
  type SaveGamePayload,
} from './saveGame';
import type { StoreGameState } from '../types/game';
import { verifyRawSaveChecksum } from '../utils/saveIntegrity';

const FORBIDDEN_EXPORT_KEY_PATTERN =
  /(?:^|_)(token|apikey|api_key|password|credential|secret|refresh_token|access_token)(?:$|_)/i;

export interface SaveRecoveryProbeResult {
  required: boolean;
  fatal: boolean;
  quarantine: SaveRecoveryQuarantine | null;
  message?: string;
}

export interface RawSaveDiagnosis {
  ok: boolean;
  reason?: SaveRecoveryReason;
  stage?: SaveRecoveryStage;
  saveVersion: number | null;
  checksumStatus: SaveRecoveryChecksumStatus;
  payload?: SaveGamePayload;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function extractSaveVersionFromRaw(parsed: unknown): number | null {
  if (!isRecord(parsed)) return null;
  if (typeof parsed.version === 'number') return parsed.version;
  if (isRecord(parsed.meta) && typeof parsed.meta.saveVersion === 'number') {
    return parsed.meta.saveVersion;
  }
  return null;
}

export async function diagnoseRawSaveString(rawString: string): Promise<RawSaveDiagnosis> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawString);
  } catch {
    return {
      ok: false,
      reason: 'json-parse-failed',
      stage: 'parse',
      saveVersion: null,
      checksumStatus: 'not-checked',
    };
  }

  const saveVersion = extractSaveVersionFromRaw(parsed);
  if (saveVersion != null && saveVersion > SAVE_GAME_VERSION) {
    return {
      ok: false,
      reason: 'unsupported-save-version',
      stage: 'migrate',
      saveVersion,
      checksumStatus: 'not-checked',
    };
  }

  const rawChecksumStatus = await verifyRawSaveChecksum(parsed);
  if (rawChecksumStatus === 'mismatch') {
    return {
      ok: false,
      reason: 'checksum-mismatch',
      stage: 'checksum',
      saveVersion,
      checksumStatus: rawChecksumStatus,
    };
  }

  const migrated = migrateSavePayload(parsed);
  if (!migrated) {
    return {
      ok: false,
      reason:
        saveVersion != null && saveVersion > SAVE_GAME_VERSION
          ? 'unsupported-save-version'
          : 'migration-failed',
      stage: 'migrate',
      saveVersion,
      checksumStatus: 'not-checked',
    };
  }

  await sealSavePayloadIntegrity(migrated);

  return {
    ok: true,
    saveVersion: migrated.version,
    checksumStatus: rawChecksumStatus === 'missing' ? 'missing' : 'valid',
    payload: migrated,
  };
}

export async function verifyLocalSaveIntegrity(
  payload: SaveGamePayload,
): Promise<SaveRecoveryChecksumStatus> {
  return verifyRawSaveChecksum(payload);
}

async function readRawCandidateKeys(): Promise<string[]> {
  const quarantine = await getSaveRecoveryQuarantine();
  const keys = [
    quarantine?.rawBackupKey,
    SAVE_QUARANTINE_RAW_KEY,
    SAVE_BACKUP_MIGRATED_KEY,
    SAVE_BACKUP_INVALID_KEY,
    SAVE_STORAGE_KEY,
  ].filter((key): key is string => typeof key === 'string' && key.length > 0);
  return [...new Set(keys)];
}

async function readRawFromKey(key: string): Promise<string | null> {
  return AsyncStorage.getItem(key);
}

export async function isCloudSyncBlockedBySaveRecovery(): Promise<boolean> {
  if (await isSaveRecoveryFatal()) {
    return true;
  }
  const quarantine = await getSaveRecoveryQuarantine();
  if (!quarantine || quarantine.resolved === true) {
    return false;
  }
  return !quarantine.userChoseNewGame;
}

export async function probeSaveRecoveryOnColdStart(): Promise<SaveRecoveryProbeResult> {
  const interrupted = await getInterruptedSaveRecoveryRestore();
  if (interrupted) {
    return {
      required: true,
      fatal: await isSaveRecoveryFatal(),
      quarantine: await getSaveRecoveryQuarantine(),
      message: 'Önceki kurtarma işlemi yarım kaldı. Devam etmeden kayıt seç.',
    };
  }

  if (await isSaveRecoveryFatal()) {
    return {
      required: true,
      fatal: true,
      quarantine: await getSaveRecoveryQuarantine(),
      message: 'Yedek yazılamadı. Ana kayıt korunuyor; kurtarma gerekli.',
    };
  }

  const existing = await getSaveRecoveryQuarantine();

  if (existing?.userChoseNewGame && existing.resolved !== true) {
    const activeRaw = await AsyncStorage.getItem(SAVE_ACTIVE_SLOT_KEY);
    if (!activeRaw) {
      return { required: true, fatal: false, quarantine: existing, message: 'Yeni oyun kaydı bulunamadı.' };
    }
    const diagnosis = await diagnoseRawSaveString(activeRaw);
    if (!diagnosis.ok) {
      return { required: true, fatal: false, quarantine: existing, message: 'Yeni oyun kaydı doğrulanamadı.' };
    }
    return { required: false, fatal: false, quarantine: null };
  }

  if (existing && existing.resolved !== true) {
    return { required: true, fatal: false, quarantine: existing };
  }

  const mainRaw = await AsyncStorage.getItem(SAVE_STORAGE_KEY);
  if (!mainRaw || mainRaw.length === 0) {
    return { required: false, fatal: false, quarantine: null };
  }

  const diagnosis = await diagnoseRawSaveString(mainRaw);
  if (diagnosis.ok) {
    return { required: false, fatal: false, quarantine: null };
  }

  let nextQuarantine = existing;
  if (!nextQuarantine) {
    const backupOk = await writeQuarantineRawBackup(mainRaw);
    if (!backupOk) {
      await markSaveRecoveryFatal();
    }
    nextQuarantine = await recordSaveRecoveryQuarantine({
      reason: diagnosis.reason ?? 'migration-failed',
      originalKey: SAVE_STORAGE_KEY,
      saveVersion: diagnosis.saveVersion,
      checksumStatus: diagnosis.checksumStatus,
      stage: diagnosis.stage ?? 'parse',
      backupWriteSucceeded: backupOk,
    });
  }

  return {
    required: true,
    fatal: await isSaveRecoveryFatal(),
    quarantine: nextQuarantine,
    message: 'Yerel kayıt bozuk veya desteklenmiyor.',
  };
}

function buildRestoreId(source: string, ownerUid: string): string {
  return `${source}:${ownerUid}:${Date.now()}`;
}

export function validateOwnerUidForRestore(
  payload: SaveGamePayload,
  authUid?: string | null,
): boolean {
  if (!authUid) return true;
  if (!payload.ownerUid) return true;
  return payload.ownerUid === authUid;
}

export async function commitValidatedPayloadToMainSlot(
  payload: SaveGamePayload,
  ownerUid = payload.ownerUid ?? 'anonymous',
): Promise<boolean> {
  const restoreId = buildRestoreId('local-restore', ownerUid);

  if (await hasSaveRecoveryRestoreReceipt(restoreId)) {
    return true;
  }

  await beginSaveRecoveryRestoreJournal({
    restoreId,
    ownerUid,
    source: 'local-backup',
    startedAt: Date.now(),
  });

  try {
    const sealed = await sealSavePayloadIntegrity(payload);
    const json = JSON.stringify(sealed);
    await AsyncStorage.setItem(SAVE_RESTORE_STAGING_KEY, json);
    await atomicWriteSaveJson(SAVE_STORAGE_KEY, json);
    await AsyncStorage.removeItem(SAVE_ACTIVE_SLOT_KEY);
    await AsyncStorage.removeItem(SAVE_RESTORE_STAGING_KEY);
    await closeSaveRecoveryQuarantine();
    await completeSaveRecoveryRestoreJournal({
      restoreId,
      ownerUid,
      source: 'local-backup',
      startedAt: Date.now(),
    });
    return true;
  } catch (error) {
    console.warn('[saveRecoveryCore] commitValidatedPayloadToMainSlot failed:', error);
    await AsyncStorage.removeItem(SAVE_RESTORE_STAGING_KEY);
    return false;
  }
}

export async function restoreFromLocalBackup(
  authUid?: string | null,
): Promise<{ ok: true; state: StoreGameState } | { ok: false; error: string }> {
  const candidateKeys = await readRawCandidateKeys();
  let lastError = 'Yerel yedek bulunamadı.';

  for (const key of candidateKeys) {
    const raw = await readRawFromKey(key);
    if (!raw) continue;

    const diagnosis = await diagnoseRawSaveString(raw);
    if (!diagnosis.ok || !diagnosis.payload) {
      lastError = 'Yerel yedek doğrulanamadı.';
      continue;
    }

    if (!validateOwnerUidForRestore(diagnosis.payload, authUid)) {
      return { ok: false, error: 'Bu kayıt seçili hesaba ait değil.' };
    }

    const committed = await commitValidatedPayloadToMainSlot(
      diagnosis.payload,
      diagnosis.payload.ownerUid ?? authUid ?? 'anonymous',
    );
    if (!committed) {
      lastError = 'Kayıt atomik olarak uygulanamadı.';
      continue;
    }

    return { ok: true, state: payloadToStoreState(diagnosis.payload) };
  }

  return { ok: false, error: lastError };
}

function scanExportPayloadForSecrets(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const stack: unknown[] = [parsed];
  while (stack.length > 0) {
    const current = stack.pop();
    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }
    if (!isRecord(current)) continue;
    for (const [key, value] of Object.entries(current)) {
      if (FORBIDDEN_EXPORT_KEY_PATTERN.test(key)) {
        return `Export reddedildi: hassas alan (${key})`;
      }
      if (value && typeof value === 'object') {
        stack.push(value);
      }
    }
  }
  return null;
}

export async function readRawSaveForExport(): Promise<string | null> {
  for (const key of await readRawCandidateKeys()) {
    const raw = await readRawFromKey(key);
    if (raw) return raw;
  }
  return null;
}

export async function confirmStartNewGameAfterRecoveryCore(
  createFreshPayload: () => Promise<SaveGamePayload>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const quarantine = await getSaveRecoveryQuarantine();
  if (!quarantine) {
    return { ok: false, error: 'Kurtarma durumu bulunamadı.' };
  }

  const mainRaw = await AsyncStorage.getItem(SAVE_STORAGE_KEY);
  if (mainRaw) {
    const backupOk = await writeQuarantineRawBackup(mainRaw);
    if (!backupOk) {
      return {
        ok: false,
        error: 'Yedek yazılamadı. Mevcut bozuk kayıt korunuyor; yeni oyun başlatılamadı.',
      };
    }
  }

  await markUserChoseNewGameInRecovery();
  const freshPayload = await createFreshPayload();

  try {
    const sealed = await sealSavePayloadIntegrity(freshPayload);
    await atomicWriteSaveJson(SAVE_ACTIVE_SLOT_KEY, JSON.stringify(sealed));
    return { ok: true };
  } catch (error) {
    console.warn('[saveRecoveryCore] confirmStartNewGameAfterRecovery failed:', error);
    return { ok: false, error: 'Yeni oyun kaydı yazılamadı; ana slot değiştirilmedi.' };
  }
}

export function buildRecoverySummary(quarantine: SaveRecoveryQuarantine | null): string {
  if (!quarantine) {
    return 'Oyun kaydında eksik veya uyumsuz veri bulundu. Verilerinizi geri getirmek için aşağıdaki seçeneklerden birini deneyin.';
  }
  switch (quarantine.reason) {
    case 'json-parse-failed':
      return 'Kayıt dosyası okunamadı. Verilerinizi geri getirmek için aşağıdaki seçeneklerden birini deneyin.';
    case 'unsupported-save-version':
      return 'Kayıt, uygulamanın desteklemediği daha yeni bir sürümle oluşturulmuş. Bulut kaydını veya yedeği deneyin.';
    case 'checksum-mismatch':
      return 'Kayıt doğrulanamadı. Verilerinizi geri getirmek için aşağıdaki seçeneklerden birini deneyin.';
    case 'migration-failed':
      return 'Kayıt güncel biçime dönüştürülemedi. Yerel yedeği veya bulut kaydını deneyin.';
    default:
      return 'Kayıt doğrulanamadı. Verilerinizi geri getirmek için aşağıdaki seçeneklerden birini deneyin.';
  }
}

export async function assertExportPayloadSafe(raw: string): Promise<boolean> {
  return scanExportPayloadForSecrets(raw) == null;
}

export function getExportSecretScanError(raw: string): string | null {
  return scanExportPayloadForSecrets(raw);
}

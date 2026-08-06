import AsyncStorage from '@react-native-async-storage/async-storage';

/** Must match saveGame.ts SAVE_BACKUP_INVALID_KEY for legacy backup status. */
const SAVE_BACKUP_INVALID_KEY = 'logisticore_save_backup_invalid';

export const SAVE_QUARANTINE_RAW_KEY = 'logisticore_save_quarantine_raw_v1';
export const SAVE_RECOVERY_QUARANTINE_META_KEY = '@logisticore/save-recovery/quarantine-v1';
export const SAVE_RECOVERY_FATAL_KEY = '@logisticore/save-recovery/fatal-v1';
export const SAVE_ACTIVE_SLOT_KEY = 'logisticore_save_active_v1';
export const SAVE_RESTORE_STAGING_KEY = 'logisticore_save_restore_staging_v1';

export type SaveRecoveryReason =
  | 'json-parse-failed'
  | 'unsupported-save-version'
  | 'migration-failed'
  | 'checksum-mismatch'
  | 'schema-validation-failed'
  | 'incomplete-write';

export type SaveRecoveryStage = 'parse' | 'migrate' | 'checksum' | 'schema' | 'ownerUid';

export type SaveRecoveryChecksumStatus = 'missing' | 'valid' | 'mismatch' | 'not-checked';

export interface SaveRecoveryQuarantine {
  reason: SaveRecoveryReason;
  detectedAt: number;
  originalKey: string;
  rawBackupKey: string;
  saveVersion: number | null;
  appVersion: string;
  checksumStatus: SaveRecoveryChecksumStatus;
  stage: SaveRecoveryStage;
  recoveryAttempts: number;
  backupWriteSucceeded: boolean;
  resolved?: boolean;
  userChoseNewGame?: boolean;
}

import { APP_VERSION } from '../config/appVersion';

function resolveAppVersion(): string {
  return APP_VERSION;
}

export async function getSaveRecoveryQuarantine(): Promise<SaveRecoveryQuarantine | null> {
  try {
    const raw = await AsyncStorage.getItem(SAVE_RECOVERY_QUARANTINE_META_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SaveRecoveryQuarantine;
    return parsed?.reason ? parsed : null;
  } catch {
    return null;
  }
}

export async function isSaveRecoveryFatal(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(SAVE_RECOVERY_FATAL_KEY);
    return raw === '1';
  } catch {
    return false;
  }
}

export async function markSaveRecoveryFatal(): Promise<void> {
  await AsyncStorage.setItem(SAVE_RECOVERY_FATAL_KEY, '1');
}

export async function clearSaveRecoveryFatal(): Promise<void> {
  await AsyncStorage.removeItem(SAVE_RECOVERY_FATAL_KEY);
}

export async function writeQuarantineRawBackup(rawString: string): Promise<boolean> {
  try {
    await AsyncStorage.setItem(SAVE_QUARANTINE_RAW_KEY, rawString);
    await AsyncStorage.setItem(SAVE_BACKUP_INVALID_KEY, rawString);
    return true;
  } catch (error) {
    console.warn('[saveRecoveryQuarantine] writeQuarantineRawBackup failed:', error);
    return false;
  }
}

export async function recordSaveRecoveryQuarantine(input: {
  reason: SaveRecoveryReason;
  originalKey: string;
  saveVersion: number | null;
  checksumStatus: SaveRecoveryChecksumStatus;
  stage: SaveRecoveryStage;
  backupWriteSucceeded: boolean;
}): Promise<SaveRecoveryQuarantine> {
  const existing = await getSaveRecoveryQuarantine();
  const entry: SaveRecoveryQuarantine = {
    reason: input.reason,
    detectedAt: existing?.detectedAt ?? Date.now(),
    originalKey: input.originalKey,
    rawBackupKey: SAVE_QUARANTINE_RAW_KEY,
    saveVersion: input.saveVersion,
    appVersion: resolveAppVersion(),
    checksumStatus: input.checksumStatus,
    stage: input.stage,
    recoveryAttempts: (existing?.recoveryAttempts ?? 0) + 1,
    backupWriteSucceeded: input.backupWriteSucceeded,
    resolved: false,
    userChoseNewGame: existing?.userChoseNewGame,
  };
  await AsyncStorage.setItem(SAVE_RECOVERY_QUARANTINE_META_KEY, JSON.stringify(entry));
  return entry;
}

export async function markUserChoseNewGameInRecovery(): Promise<void> {
  const existing = await getSaveRecoveryQuarantine();
  if (!existing) return;
  await AsyncStorage.setItem(
    SAVE_RECOVERY_QUARANTINE_META_KEY,
    JSON.stringify({ ...existing, userChoseNewGame: true }),
  );
}

export async function closeSaveRecoveryQuarantine(): Promise<void> {
  await AsyncStorage.multiRemove([
    SAVE_RECOVERY_QUARANTINE_META_KEY,
    SAVE_RECOVERY_FATAL_KEY,
    SAVE_QUARANTINE_RAW_KEY,
    SAVE_BACKUP_INVALID_KEY,
    SAVE_RESTORE_STAGING_KEY,
  ]);
}

export async function isSaveRecoveryPending(): Promise<boolean> {
  if (await isSaveRecoveryFatal()) return true;
  const quarantine = await getSaveRecoveryQuarantine();
  return quarantine != null && quarantine.resolved !== true;
}

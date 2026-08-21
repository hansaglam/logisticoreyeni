import { Share } from 'react-native';

import { getCurrentUserId } from './authService';
import { loadGameFromCloudDetailed } from './cloudSaveService';
import {
  beginSaveRecoveryRestoreJournal,
  completeSaveRecoveryRestoreJournal,
  hasSaveRecoveryRestoreReceipt,
} from '../storage/saveRecoveryJournal';
import {
  assertExportPayloadSafe,
  attemptAutomaticLocalSaveRecovery,
  buildRecoverySummary,
  commitValidatedPayloadToMainSlot,
  confirmStartNewGameAfterRecoveryCore,
  diagnoseRawSaveString,
  extractSaveVersionFromRaw,
  isCloudSyncBlockedBySaveRecovery,
  probeSaveRecoveryOnColdStart as probeSaveRecoveryOnColdStartUncached,
  readRawSaveForExport,
  restoreFromLocalBackup as restoreFromLocalBackupCore,
  validateOwnerUidForRestore,
  verifyLocalSaveIntegrity,
  getExportSecretScanError,
  type RawSaveDiagnosis,
  type SaveRecoveryProbeResult,
} from '../storage/saveRecoveryCore';
import { clearColdStartSaveSession } from '../storage/coldStartSaveSession';
import { logSaveBootstrap } from '../storage/saveBootstrap';
import type { SaveRecoveryQuarantine } from '../storage/saveRecoveryQuarantine';
import {
  payloadToStoreState,
  SAVE_GAME_VERSION,
  serializeGameState,
  type SaveGamePayload,
} from '../storage/saveGame';
import { createInitialGameState } from '../store/gameStore';
import type { StoreGameState } from '../types/game';
import { executeAtomicCloudSaveRestore, validateCloudSaveRestorePayload } from '../utils/cloudSaveConflict';

export type { RawSaveDiagnosis, SaveRecoveryProbeResult };
export {
  assertExportPayloadSafe,
  attemptAutomaticLocalSaveRecovery,
  buildRecoverySummary,
  diagnoseRawSaveString,
  extractSaveVersionFromRaw,
  isCloudSyncBlockedBySaveRecovery,
  verifyLocalSaveIntegrity,
};

const CLOUD_RECOVERY_TIMEOUT_MS = 12_000;

let coldStartProbePromise: Promise<SaveRecoveryProbeResult> | null = null;
let coldStartProbeResult: SaveRecoveryProbeResult | null = null;

/** Recovery UI / new game sonrası bir sonraki probe taze çalışsın. */
export function invalidateSaveRecoveryColdStartProbe(): void {
  coldStartProbePromise = null;
  coldStartProbeResult = null;
  clearColdStartSaveSession();
}

export async function probeSaveRecoveryOnColdStart(): Promise<SaveRecoveryProbeResult> {
  if (coldStartProbeResult) {
    return coldStartProbeResult;
  }
  if (coldStartProbePromise) {
    return coldStartProbePromise;
  }
  coldStartProbePromise = probeSaveRecoveryOnColdStartUncached().then((probe) => {
    coldStartProbeResult = probe;
    return probe;
  });
  return coldStartProbePromise;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(null);
      });
  });
}

/** Local auto-recovery first, then optional cloud restore before showing recovery UI. */
export async function probeSaveRecoveryWithCloudAttempt(options?: {
  force?: boolean;
}): Promise<SaveRecoveryProbeResult> {
  if (!options?.force && coldStartProbeResult) {
    return coldStartProbeResult;
  }
  if (!options?.force && coldStartProbePromise) {
    return coldStartProbePromise;
  }

  coldStartProbePromise = (async () => {
    const probe = await probeSaveRecoveryOnColdStart();
    if (!probe.required) {
      coldStartProbeResult = probe;
      return probe;
    }

    const uid = getCurrentUserId();
    if (!uid) {
      coldStartProbeResult = probe;
      return probe;
    }

    const startedAt = Date.now();
    logSaveBootstrap({
      stage: 'reading-cloud',
      source: 'cloud',
      success: false,
      recoverable: true,
      authUidPresent: true,
    });

    const cloudResult = await withTimeout(restoreFromCloudSave(), CLOUD_RECOVERY_TIMEOUT_MS);
    if (cloudResult?.ok) {
      logSaveBootstrap({
        stage: 'ready',
        source: 'cloud',
        success: true,
        durationMs: Date.now() - startedAt,
        authUidPresent: true,
        payloadPresent: true,
      });
      const resolved: SaveRecoveryProbeResult = {
        required: false,
        fatal: false,
        quarantine: null,
        recoveredSource: 'cloud',
        lastStage: 'ready',
        diagnosticId: probe.diagnosticId,
      };
      coldStartProbeResult = resolved;
      return resolved;
    }

    logSaveBootstrap({
      stage: 'recovery-required',
      source: 'cloud',
      success: false,
      errorCode: 'cloud-unavailable',
      recoverable: false,
      durationMs: Date.now() - startedAt,
      authUidPresent: true,
    });

    const failed: SaveRecoveryProbeResult = {
      ...probe,
      failureCode: probe.failureCode ?? 'cloud-unavailable',
    };
    coldStartProbeResult = failed;
    return failed;
  })();

  try {
    return await coldStartProbePromise;
  } finally {
    coldStartProbePromise = null;
  }
}

function buildRestoreId(source: string, ownerUid: string): string {
  return `${source}:${ownerUid}:${Date.now()}`;
}

export async function restoreFromLocalBackup(): Promise<
  { ok: true; state: StoreGameState } | { ok: false; error: string }
> {
  return restoreFromLocalBackupCore(getCurrentUserId());
}

export async function restoreFromCloudSave(): Promise<
  { ok: true; state: StoreGameState } | { ok: false; error: string }
> {
  const uid = getCurrentUserId();
  if (!uid) {
    return { ok: false, error: 'Bulut kaydı için oturum gerekli.' };
  }

  try {
    const restored = await executeAtomicCloudSaveRestore({
      selectedAccountUid: uid,
      readMetadata: async () => {
        const result = await loadGameFromCloudDetailed(uid);
        if (!result.ok) throw new Error(result.reason);
        return result.payload;
      },
      readPayload: async () => {
        const result = await loadGameFromCloudDetailed(uid);
        if (!result.ok) throw new Error(result.reason);
        return result.payload;
      },
      validate: (payload) => {
        if (payload.ownerUid !== uid) return 'owner-mismatch';
        return validateCloudSaveRestorePayload(payload, SAVE_GAME_VERSION);
      },
      migrate: (payload) => {
        const safePayload = {
          ...payload.gameState,
          cachedGlobalEconomySnapshotTrusted: false,
        };
        return payloadToStoreState(safePayload);
      },
      reconcileMarketplace: async (state) => state,
      persistLocal: async (state) => {
        const payload = serializeGameState(state, { ownerUid: uid });
        payload.ownerUid = uid;
        const { sealSavePayloadIntegrity } = await import('../storage/saveGame');
        const sealed = await sealSavePayloadIntegrity(payload);
        return commitValidatedPayloadToMainSlot(sealed, uid);
      },
      commitState: () => {},
      getOwnerUid: (payload) => payload.ownerUid,
      getRestoreId: (payload) => payload.syncId ?? buildRestoreId('cloud', uid),
      isRestoreApplied: hasSaveRecoveryRestoreReceipt,
      beginRestore: (restoreId, ownerUid) =>
        beginSaveRecoveryRestoreJournal({
          restoreId,
          ownerUid,
          source: 'cloud',
          startedAt: Date.now(),
        }),
      completeRestore: (restoreId, ownerUid) =>
        completeSaveRecoveryRestoreJournal({
          restoreId,
          ownerUid,
          source: 'cloud',
          startedAt: Date.now(),
        }),
    });

    return { ok: true, state: restored };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Bulut kaydı geri yüklenemedi.';
    return { ok: false, error: message };
  }
}

export async function exportRawSaveForUser(): Promise<{ ok: true } | { ok: false; error: string }> {
  const raw = await readRawSaveForExport();
  if (!raw) {
    return { ok: false, error: 'Dışa aktarılacak ham kayıt bulunamadı.' };
  }

  const secretIssue = getExportSecretScanError(raw);
  if (secretIssue) {
    return { ok: false, error: secretIssue };
  }

  try {
    const preview = raw.length > 4000 ? `${raw.slice(0, 4000)}\n…` : raw;
    await Share.share({
      title: 'LogistiCore Kayıt Dışa Aktarma',
      message: preview,
    });
    return { ok: true };
  } catch (error) {
    console.warn('[saveRecovery] exportRawSaveForUser failed:', error);
    return { ok: false, error: 'Dışa aktarma başarısız oldu; kayıt silinmedi.' };
  }
}

export async function confirmStartNewGameAfterRecovery(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  return confirmStartNewGameAfterRecoveryCore(async () => {
    const ownerUid = getCurrentUserId() ?? undefined;
    const freshPayload = serializeGameState(createInitialGameState(), { ownerUid });
    if (ownerUid) {
      freshPayload.ownerUid = ownerUid;
    }
    return freshPayload;
  });
}

export async function readExportPreviewMetadata(): Promise<{
  hasRaw: boolean;
  ownerUid?: string;
  saveVersion?: number | null;
}> {
  const raw = await readRawSaveForExport();
  if (!raw) return { hasRaw: false };
  try {
    const parsed = JSON.parse(raw) as SaveGamePayload;
    return {
      hasRaw: true,
      ownerUid: typeof parsed.ownerUid === 'string' ? parsed.ownerUid : undefined,
      saveVersion: extractSaveVersionFromRaw(parsed),
    };
  } catch {
    return { hasRaw: true, saveVersion: null };
  }
}

export type { SaveRecoveryQuarantine };

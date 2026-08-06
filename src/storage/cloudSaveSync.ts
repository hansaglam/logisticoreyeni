/**
 * Local save → Firestore cloud save köprüsü.
 *
 * Local save ana kaynak; cloud sync async ve hata toleranslı çalışır.
 * Bu fazda cloud'dan otomatik restore yapılmaz.
 */

import { AppState, type AppStateStatus } from 'react-native';

import { getAccountStatus, getCurrentUserId, initAnonymousAuth } from '../services/authService';
import {
  assertLocalSaveOwnerMatchesAuth,
  isCloudSyncBlockedByAccountSwitch,
  resolveInterruptedAccountSwitchOnStartup,
} from '../services/accountSwitchService';
import {
  getCloudSaveDocumentPath,
  getCloudSaveMeta,
  saveGameToCloud,
  updateUserProfileSummary,
  type CloudSaveMeta,
  type CloudSavePayload,
} from '../services/cloudSaveService';
import { submitCurrentLeaderboardScore } from '../services/leaderboardService';
import { isFirebaseEnabled } from '../services/firebase';
import { SAVE_GAME_VERSION, serializeGameState, analyzeSavePayloadSize, type SaveGamePayload } from '../storage/saveGame';
import type { StoreGameState } from '../types/game';
import {
  buildCloudSaveSummary,
  buildCloudSaveSummaryFromPayload,
  type CloudSaveSummary,
} from '../utils/cloudSaveSummary';
import { debugConfig } from '../config/debug';
import {
  estimateCloudSaveDocumentBytes,
  MAX_SAVE_SIZE_BYTES,
} from '../utils/cloudSaveSize';
import {
  classifyCloudSaveError,
  createLinkFlowDiagnosticId,
  logCloudSaveAfterLink,
} from '../utils/accountLinkFlowLog';
import { reconcileLocalSaveOwnershipAfterAccountLink } from '../utils/cloudSaveOwnership';
import { compareLocalAndCloudSave } from '../utils/cloudSaveComparison';
import {
  clearPendingCloudRestore,
  getInterruptedCloudRestore,
} from './cloudRestoreJournal';

export type CloudSyncReason =
  | 'app_start'
  | 'autosave'
  | 'manual'
  | 'delivery_complete'
  | 'contract_start'
  | 'trade'
  | 'purchase'
  | 'mission_claim'
  | 'account_delete'
  | 'account_link'
  | 'account-link-apple'
  | 'account-link-google'
  | 'retry'
  | 'foreground'
  | 'network_reconnect';

export type CloudSaveDisplayStatus = 'disabled' | 'pending' | 'syncing' | 'success' | 'failed';

export interface CloudRestoreCandidate {
  hasCandidate: boolean;
  cloudSummary?: CloudSaveSummary;
  localSummary?: CloudSaveSummary;
  cloudUpdatedAt?: number;
  localUpdatedAt?: number;
}

export interface CloudSaveStatusState {
  status: CloudSaveDisplayStatus;
  statusLabel: string;
  uid: string | null;
  uidShort: string | null;
  lastSyncAt: number | null;
  lastError: string | null;
  lastErrorCode: string | null;
  nextRetryAt: number | null;
  firebaseEnabled: boolean;
  restoreCandidate: CloudRestoreCandidate | null;
  cloudProtected: boolean;
}

const MIN_SYNC_INTERVAL_MS = 30_000;
const RETRY_BASE_MS = 2_000;
const RETRY_MAX_MS = 60_000;
const RETRY_MAX_ATTEMPTS = 8;

const FORCE_SYNC_REASONS = new Set<CloudSyncReason>([
  'app_start',
  'manual',
  'mission_claim',
  'delivery_complete',
  'purchase',
  'account_delete',
  'account_link',
  'account-link-apple',
  'account-link-google',
  'retry',
  'foreground',
  'network_reconnect',
]);

const STATUS_LABELS: Record<CloudSaveDisplayStatus, string> = {
  disabled: 'Kapalı',
  pending: 'Bekliyor',
  syncing: 'Senkronize ediliyor',
  success: 'Bağlı',
  failed: 'Bağlantı yok',
};

let lastCloudSyncAt = 0;
let cloudSaveStatus: CloudSaveDisplayStatus = 'disabled';
let lastCloudSyncError: string | null = null;
let lastCloudSyncErrorCode: string | null = null;
let nextRetryAt: number | null = null;
let retryAttempt = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let syncInFlight: Promise<boolean> | null = null;
let lastSaveTooLargeAt = 0;
let lastSaveTooLargeEnvelopeBytes = 0;
let restoreCandidate: CloudRestoreCandidate | null = null;
let backendInitPromise: Promise<void> | null = null;
let cloudSyncInitialized = false;
let isAccountDeletionInProgress = false;
let appStateSubscriptionAttached = false;
let pendingRetryStateGetter: (() => StoreGameState) | null = null;

export function beginAccountDeletion(): void {
  isAccountDeletionInProgress = true;
  clearCloudSaveRetry();
  if (__DEV__) {
    console.log('[cloud-save] account deletion in progress — sync paused');
  }
}

export function endAccountDeletion(): void {
  isAccountDeletionInProgress = false;
  if (__DEV__) {
    console.log('[cloud-save] account deletion finished — sync resumed');
  }
}

export function isAccountDeletionActive(): boolean {
  return isAccountDeletionInProgress;
}

type CloudSaveStatusListener = () => void;
const statusListeners = new Set<CloudSaveStatusListener>();

function notifyStatusListeners(): void {
  for (const listener of statusListeners) {
    listener();
  }
}

function setCloudSaveStatus(
  status: CloudSaveDisplayStatus,
  error: string | null = null,
  errorCode: string | null = null,
): void {
  cloudSaveStatus = status;
  lastCloudSyncError = error;
  lastCloudSyncErrorCode = errorCode;
  if (status === 'success') {
    nextRetryAt = null;
    retryAttempt = 0;
  }
  notifyStatusListeners();
}

function clearCloudSaveRetry(): void {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  nextRetryAt = null;
}

function scheduleCloudSaveRetry(getState: () => StoreGameState, diagnosticId?: string): void {
  if (lastCloudSyncErrorCode) {
    const classified = classifyCloudSaveError(lastCloudSyncErrorCode);
    if (classified.permanent) {
      nextRetryAt = null;
      notifyStatusListeners();
      return;
    }
  }

  if (retryAttempt >= RETRY_MAX_ATTEMPTS) {
    nextRetryAt = null;
    notifyStatusListeners();
    return;
  }

  pendingRetryStateGetter = getState;
  const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** retryAttempt);
  retryAttempt += 1;
  nextRetryAt = Date.now() + delay;
  notifyStatusListeners();

  if (retryTimer) {
    clearTimeout(retryTimer);
  }
  retryTimer = setTimeout(() => {
    retryTimer = null;
    const stateGetter = pendingRetryStateGetter;
    if (!stateGetter) return;
    void syncLocalSaveToCloud('retry', {
      force: true,
      state: stateGetter(),
      diagnosticId,
    });
  }, delay);

  logCloudSaveAfterLink({
    stage: 'retry-scheduled',
    retryScheduled: true,
    firebaseErrorCode: lastCloudSyncErrorCode,
    diagnosticId: diagnosticId ?? createLinkFlowDiagnosticId('cloud'),
  });
}

function ensureAppStateRetryHook(): void {
  if (appStateSubscriptionAttached) return;
  appStateSubscriptionAttached = true;
  AppState.addEventListener('change', (next: AppStateStatus) => {
    if (next !== 'active') return;
    if (cloudSaveStatus !== 'failed') return;
    if (!pendingRetryStateGetter) return;
    if (lastCloudSyncErrorCode) {
      const classified = classifyCloudSaveError(lastCloudSyncErrorCode);
      if (classified.permanent) return;
    }
    void syncLocalSaveToCloud('foreground', {
      force: true,
      state: pendingRetryStateGetter(),
    });
  });
}

function formatUidShort(uid: string | null): string | null {
  if (!uid || uid.length < 8) {
    return uid;
  }
  return `${uid.slice(0, 4)}...${uid.slice(-3)}`;
}

function formatSyncTime(timestamp: number | null): string {
  if (!timestamp) {
    return 'Henüz senkronize edilmedi';
  }
  return new Date(timestamp).toLocaleString('tr-TR');
}

export function subscribeCloudSaveStatus(listener: CloudSaveStatusListener): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

export function getCloudSaveStatus(): CloudSaveStatusState {
  const uid = getCurrentUserId();
  return {
    status: cloudSaveStatus,
    statusLabel: STATUS_LABELS[cloudSaveStatus],
    uid,
    uidShort: formatUidShort(uid),
    lastSyncAt: lastCloudSyncAt > 0 ? lastCloudSyncAt : null,
    lastError: lastCloudSyncError,
    lastErrorCode: lastCloudSyncErrorCode,
    nextRetryAt,
    firebaseEnabled: isFirebaseEnabled(),
    restoreCandidate,
    cloudProtected:
      cloudSaveStatus === 'success' && lastCloudSyncAt > 0,
  };
}

/** @deprecated Use getCloudSaveStatus */
export function getCloudSaveDisplayStatus(): CloudSaveDisplayStatus {
  return cloudSaveStatus;
}

/** @deprecated Use getCloudSaveStatus */
export function getCloudSaveStatusLabel(status: CloudSaveDisplayStatus = cloudSaveStatus): string {
  return STATUS_LABELS[status];
}

/** @deprecated Use getCloudSaveStatus */
export function getCloudSaveDebugInfo() {
  const state = getCloudSaveStatus();
  return {
    status: state.status,
    statusLabel: state.statusLabel,
    uid: state.uid,
    lastSyncAt: state.lastSyncAt,
    lastError: state.lastError,
    firebaseEnabled: state.firebaseEnabled,
  };
}

export function detectCloudRestoreCandidate(
  localSave: SaveGamePayload | null,
  cloudMeta: CloudSaveMeta | null,
): CloudRestoreCandidate {
  if (!localSave || !cloudMeta) {
    return { hasCandidate: false };
  }

  const localUpdatedAt = localSave.meta.savedAt ?? 0;
  const cloudUpdatedAt = cloudMeta.deviceUpdatedAt ?? 0;

  const comparison = compareLocalAndCloudSave(
    buildCloudSaveSummaryFromPayload(localSave),
    cloudMeta.summary,
  );
  if (comparison.decision !== 'cloud-newer') {
    return { hasCandidate: false };
  }

  return {
    hasCandidate: true,
    cloudSummary: cloudMeta.summary,
    localSummary: buildCloudSaveSummaryFromPayload(localSave),
    cloudUpdatedAt,
    localUpdatedAt,
  };
}

export function setCloudRestoreCandidateForConflict(
  state: StoreGameState,
  cloud: CloudSavePayload,
): void {
  const localPayload = serializeGameState(state);
  restoreCandidate = {
    hasCandidate: true,
    localSummary: buildCloudSaveSummaryFromPayload(localPayload),
    cloudSummary: cloud.summary,
    localUpdatedAt: localPayload.meta.savedAt ?? 0,
    cloudUpdatedAt: cloud.deviceUpdatedAt,
  };
  notifyStatusListeners();
}

export function mapAutoSaveReasonToCloudSync(
  reason: string | null | undefined,
): CloudSyncReason {
  switch (reason) {
    case 'delivery_completed':
      return 'delivery_complete';
    case 'delivery_started':
      return 'contract_start';
    case 'purchase':
      return 'purchase';
    case 'manual':
    case 'background':
      return reason === 'manual' ? 'manual' : 'autosave';
    case 'warehouse':
      return 'trade';
    default:
      return 'autosave';
  }
}

export async function syncLocalSaveToCloud(
  reason: CloudSyncReason,
  options?: {
    force?: boolean;
    state?: StoreGameState;
    diagnosticId?: string;
    previousUid?: string | null;
    localOwnerUid?: string | null;
    ownerUid?: string;
  },
): Promise<boolean> {
  if (syncInFlight) {
    return syncInFlight;
  }

  const run = (async (): Promise<boolean> => {
    const diagnosticId = options?.diagnosticId ?? createLinkFlowDiagnosticId('cloud');
    const isAccountLinkTrigger =
      reason === 'account_link' ||
      reason === 'account-link-apple' ||
      reason === 'account-link-google';

    const logAfterLink = (payload: Parameters<typeof logCloudSaveAfterLink>[0]) => {
      if (isAccountLinkTrigger || reason === 'retry' || reason === 'manual') {
        logCloudSaveAfterLink(payload);
      }
    };

    if (isAccountDeletionInProgress) {
      if (__DEV__) {
        console.log('[cloud-save] sync skipped — account deletion in progress');
      }
      return false;
    }

    if (await isCloudSyncBlockedByAccountSwitch()) {
      if (__DEV__) {
        console.warn('[cloud-save] sync blocked — account switch in progress or recovery');
      }
      setCloudSaveStatus('pending');
      return false;
    }

    const { isCloudSyncBlockedBySaveRecovery } = await import('../services/saveRecoveryService');
    if (await isCloudSyncBlockedBySaveRecovery()) {
      if (__DEV__) {
        console.warn('[cloud-save] sync blocked — save recovery required');
      }
      setCloudSaveStatus('pending');
      return false;
    }

    if (!isFirebaseEnabled()) {
      setCloudSaveStatus('disabled');
      return false;
    }

    ensureAppStateRetryHook();

    const account = getAccountStatus();
    const uid = getCurrentUserId();
    if (!uid) {
      setCloudSaveStatus('disabled');
      logAfterLink({
        stage: 'auth-gate',
        trigger: reason,
        authReady: account.isReady,
        authUidPresent: false,
        authUserAnonymous: account.isAnonymous,
        diagnosticId,
      });
      return false;
    }

    const force = options?.force ?? FORCE_SYNC_REASONS.has(reason);
    const now = Date.now();

    if (!force && lastCloudSyncAt > 0 && now - lastCloudSyncAt < MIN_SYNC_INTERVAL_MS) {
      if (
        cloudSaveStatus !== 'failed' &&
        cloudSaveStatus !== 'pending' &&
        cloudSaveStatus !== 'syncing'
      ) {
        setCloudSaveStatus('pending');
      }
      return false;
    }

    if (!options?.state) {
      console.warn('[cloud-save] syncLocalSaveToCloud skipped: missing game state');
      return false;
    }

    const ownership = reconcileLocalSaveOwnershipAfterAccountLink({
      previousUid: options.previousUid ?? uid,
      currentUid: uid,
      localOwnerUid: options.localOwnerUid ?? uid,
      providerId:
        reason === 'account-link-apple' || account.provider === 'apple'
          ? 'apple.com'
          : 'google.com',
    });

    if (ownership.result === 'conflict' || ownership.result === 'rejected') {
      const code = ownership.result === 'conflict' ? 'owner-mismatch' : 'owner-mismatch';
      setCloudSaveStatus('failed', code, code);
      logAfterLink({
        stage: 'write-failed',
        trigger: reason,
        authUidPresent: true,
        authUserAnonymous: account.isAnonymous,
        localOwnerUidPresent: Boolean(options.localOwnerUid),
        ownerMatchesAuth: false,
        documentPath: getCloudSaveDocumentPath(uid),
        firebaseErrorCode: code,
        diagnosticId,
      });
      return false;
    }

    const payload = serializeGameState(options.state, {
      ownerUid: options.ownerUid ?? options.localOwnerUid ?? ownership.resolvedOwnerUid,
    });
    if (options.ownerUid) {
      payload.ownerUid = options.ownerUid;
    }

    const ownerGuard = assertLocalSaveOwnerMatchesAuth(payload.ownerUid, uid);
    if (!ownerGuard.ok) {
      console.warn('[cloud-save] sync blocked — owner invariant', {
        reason: ownerGuard.reason,
        localOwnerUid: payload.ownerUid,
        authUid: uid,
      });
      setCloudSaveStatus('failed', ownerGuard.reason, ownerGuard.reason);
      logAfterLink({
        stage: 'write-failed',
        trigger: reason,
        authUidPresent: true,
        authUserAnonymous: account.isAnonymous,
        localOwnerUidPresent: Boolean(payload.ownerUid),
        ownerMatchesAuth: false,
        documentPath: getCloudSaveDocumentPath(uid),
        firebaseErrorCode: ownerGuard.reason,
        diagnosticId,
      });
      return false;
    }

    const envelopeBytes = estimateCloudSaveDocumentBytes(payload);
    const documentPath = getCloudSaveDocumentPath(uid);

    logAfterLink({
      stage: 'payload-prepare',
      trigger: reason,
      authReady: account.isReady,
      authUidPresent: true,
      authUserAnonymous: account.isAnonymous,
      providerIds: account.provider === 'guest' ? [] : [account.provider],
      localOwnerUidPresent: Boolean(options.localOwnerUid ?? uid),
      ownerMatchesAuth: ownership.resolvedOwnerUid === uid,
      documentPath,
      payloadPrepared: true,
      diagnosticId,
    });

    if (lastCloudSyncError === 'save-too-large' && envelopeBytes > MAX_SAVE_SIZE_BYTES) {
      if (__DEV__) {
        console.log('[cloud-save] sync skipped — payload still exceeds cloud limit', envelopeBytes);
      }
      setCloudSaveStatus('failed', 'save-too-large', 'save-too-large');
      return false;
    }

    if (__DEV__ && debugConfig.cloudSaveSizeLogsEnabled) {
      const sizeReport = analyzeSavePayloadSize(payload);
      console.log('[cloud-save-size]', {
        totalBytes: sizeReport.totalBytes,
        totalKb: sizeReport.totalKb,
        envelopeBytes,
        topLevelKeys: sizeReport.topLevelKeys,
      });
    }

    try {
      setCloudSaveStatus('syncing');
      logAfterLink({
        stage: 'write-start',
        trigger: reason,
        authUidPresent: true,
        writeStarted: true,
        documentPath,
        diagnosticId,
      });
      if (__DEV__) {
        console.log('[cloud-save] sync started', reason);
      }

      const result = await saveGameToCloud(uid, payload, {
        diagnosticId,
        trigger: reason,
      });

      if (!result.ok) {
        const classified = classifyCloudSaveError(result.errorCode ?? result.error);
        if (classified.code === 'save-too-large') {
          lastSaveTooLargeAt = Date.now();
          lastSaveTooLargeEnvelopeBytes = envelopeBytes;
        }
        console.warn('[cloud-save] sync failed', {
          error: result.error ?? '',
          errorCode: classified.code,
          documentPath: result.documentPath ?? documentPath,
        });
        setCloudSaveStatus('failed', result.error ?? classified.code, classified.code);
        logAfterLink({
          stage: 'write-failed',
          trigger: reason,
          writeStarted: true,
          writeSucceeded: false,
          readBackSucceeded: result.readBackVerified === true,
          documentPath: result.documentPath ?? documentPath,
          firebaseErrorCode: classified.code,
          diagnosticId,
        });
        if (!classified.permanent) {
          scheduleCloudSaveRetry(() => options.state as StoreGameState, diagnosticId);
        }
        return false;
      }

      if (result.readBackVerified === false) {
        setCloudSaveStatus('failed', 'read-back-failed', 'read-back-failed');
        logAfterLink({
          stage: 'read-back-failed',
          trigger: reason,
          writeSucceeded: true,
          readBackSucceeded: false,
          documentPath,
          firebaseErrorCode: 'read-back-failed',
          diagnosticId,
        });
        scheduleCloudSaveRetry(() => options.state as StoreGameState, diagnosticId);
        return false;
      }

      lastSaveTooLargeAt = 0;
      lastSaveTooLargeEnvelopeBytes = 0;
      lastCloudSyncAt = result.verifiedUpdatedAt ?? Date.now();
      clearCloudSaveRetry();
      setCloudSaveStatus('success');
      void syncLeaderboardFromGameState(options.state);
      logAfterLink({
        stage: 'cloud-ready',
        trigger: reason,
        writeSucceeded: true,
        readBackSucceeded: true,
        documentPath,
        diagnosticId,
      });
      if (__DEV__) {
        console.log('[cloud-save] sync success');
      }
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Cloud sync failed';
      const classified = classifyCloudSaveError(message);
      console.warn('[cloud-save] sync failed', message);
      setCloudSaveStatus('failed', message, classified.code);
      logAfterLink({
        stage: 'write-failed',
        trigger: reason,
        writeSucceeded: false,
        firebaseErrorCode: classified.code,
        documentPath,
        diagnosticId,
      });
      if (!classified.permanent) {
        scheduleCloudSaveRetry(() => options.state as StoreGameState, diagnosticId);
      }
      return false;
    }
  })();

  syncInFlight = run;
  try {
    return await run;
  } finally {
    if (syncInFlight === run) {
      syncInFlight = null;
    }
  }
}

export async function checkCloudSaveMeta(state: StoreGameState): Promise<CloudRestoreCandidate> {
  if (!isFirebaseEnabled()) {
    restoreCandidate = null;
    notifyStatusListeners();
    return { hasCandidate: false };
  }

  const uid = getCurrentUserId();
  if (!uid) {
    restoreCandidate = null;
    notifyStatusListeners();
    return { hasCandidate: false };
  }

  const localPayload = serializeGameState(state);
  const cloudMeta = await getCloudSaveMeta(uid);
  restoreCandidate = detectCloudRestoreCandidate(localPayload, cloudMeta);
  notifyStatusListeners();
  return restoreCandidate;
}

export async function initCloudSaveSync(getState: () => StoreGameState): Promise<void> {
  if (backendInitPromise) {
    return backendInitPromise;
  }

  backendInitPromise = (async () => {
    if (!isFirebaseEnabled()) {
      setCloudSaveStatus('disabled');
      return;
    }

    const user = await initAnonymousAuth();
    if (!user) {
      setCloudSaveStatus('disabled');
      return;
    }

    const interruptedRestore = await getInterruptedCloudRestore();
    if (interruptedRestore) {
      // Uygulama yeniden açıldığında memory state zaten temizdir. Local kayıt
      // tekrar okunur ve cloud karşılaştırması aşağıda güvenli retry kararı verir.
      await clearPendingCloudRestore();
      if (__DEV__) {
        console.warn('[cloud-save] interrupted restore recovered', {
          sameOwner: interruptedRestore.ownerUid === user.uid,
        });
      }
    }

    const interruptedSwitch = await resolveInterruptedAccountSwitchOnStartup();
    if (interruptedSwitch === 'recovery-required') {
      setCloudSaveStatus('failed', 'account-switch-recovery-required', 'account-switch-recovery-required');
      if (__DEV__) {
        console.warn('[cloud-save] account switch recovery required — sync blocked');
      }
      return;
    }
    if (interruptedSwitch === 'rolled-back') {
      if (__DEV__) {
        console.warn('[cloud-save] interrupted account switch rolled back');
      }
    }

    if (__DEV__) {
      console.log('[cloud-save] enabled');
    }
    cloudSyncInitialized = true;

    const state = getState();
    await updateUserProfileSummary(user.uid, state);

    const localPayload = serializeGameState(state);
    const cloudMeta = await getCloudSaveMeta(user.uid);
    restoreCandidate = detectCloudRestoreCandidate(localPayload, cloudMeta);

    if (restoreCandidate.hasCandidate && __DEV__) {
      console.log('[cloud-save] cloud newer, restore prompt needed later');
    }

    notifyStatusListeners();
    if (restoreCandidate.hasCandidate) {
      // Kullanıcı conflict seçimi yapmadan cloud kaydın üzerine local state yazılmaz.
      setCloudSaveStatus('pending');
      return;
    }
    await syncLocalSaveToCloud('app_start', { force: true, state });
  })();

  return backendInitPromise;
}

/** @deprecated Use initCloudSaveSync */
export async function initializeCloudBackend(getState: () => StoreGameState): Promise<void> {
  return initCloudSaveSync(getState);
}

export function resetCloudSaveSyncState(): void {
  clearCloudSaveRetry();
  lastCloudSyncAt = 0;
  lastCloudSyncError = null;
  lastCloudSyncErrorCode = null;
  lastSaveTooLargeAt = 0;
  lastSaveTooLargeEnvelopeBytes = 0;
  restoreCandidate = null;
  cloudSaveStatus = isFirebaseEnabled() ? 'pending' : 'disabled';
  backendInitPromise = null;
  cloudSyncInitialized = false;
  isAccountDeletionInProgress = false;
  retryAttempt = 0;
  pendingRetryStateGetter = null;
  notifyStatusListeners();
}

export function getLocalSaveVersion(): number {
  return SAVE_GAME_VERSION;
}

export function isCloudSyncInitialized(): boolean {
  return cloudSyncInitialized;
}

export function getCloudSaveStatusSubtitle(status: CloudSaveStatusState): string {
  if (status.status === 'success' && status.lastSyncAt) {
    return `Son kayıt başarılı · ${formatSyncTime(status.lastSyncAt)}`;
  }
  if (status.status === 'failed') {
    return 'Bulut kaydı şu anda yapılamadı. Oyun yerel kayıtla devam ediyor.';
  }
  if (status.status === 'syncing') {
    return 'Kayıt buluta aktarılıyor...';
  }
  if (status.status === 'disabled') {
    if (!status.firebaseEnabled) {
      return 'Firebase yapılandırması bulunamadı. .env dosyasındaki EXPO_PUBLIC_FIREBASE_* değerlerini kontrol et.';
    }
    if (!status.uid) {
      return 'Bulut oturumu başlatılamadı. Auth hatası — uygulamayı yeniden yüklemeyi dene.';
    }
    return 'Bulut kaydı şu anda kapalı.';
  }
  return 'Senkronizasyon bekleniyor.';
}

export function buildCloudSaveSummaryForState(state: StoreGameState): CloudSaveSummary {
  const payload = serializeGameState(state);
  return buildCloudSaveSummary(state, payload.meta.savedAt);
}

async function syncLeaderboardFromGameState(_state: StoreGameState): Promise<void> {
  if (!getCurrentUserId()) {
    return;
  }

  const result = await submitCurrentLeaderboardScore({ force: false });
  if (!result.ok && typeof __DEV__ !== 'undefined' && __DEV__) {
    console.warn('[leaderboard] trusted submit failed', {
      errorCode: result.errorCode,
      error: result.error,
    });
  }
}

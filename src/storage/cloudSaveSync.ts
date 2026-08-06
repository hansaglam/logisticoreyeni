/**
 * Local save → Firestore cloud save köprüsü.
 *
 * Local save ana kaynak; cloud sync async ve hata toleranslı çalışır.
 * Bu fazda cloud'dan otomatik restore yapılmaz.
 */

import { getCurrentUserId, initAnonymousAuth } from '../services/authService';
import {
  assertLocalSaveOwnerMatchesAuth,
  isCloudSyncBlockedByAccountSwitch,
  resolveInterruptedAccountSwitchOnStartup,
} from '../services/accountSwitchService';
import {
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
  | 'account_link';

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
  firebaseEnabled: boolean;
  restoreCandidate: CloudRestoreCandidate | null;
}

const MIN_SYNC_INTERVAL_MS = 30_000;
const FORCE_SYNC_REASONS = new Set<CloudSyncReason>([
  'app_start',
  'manual',
  'mission_claim',
  'delivery_complete',
  'purchase',
  'account_delete',
  'account_link',
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
let lastSaveTooLargeAt = 0;
let lastSaveTooLargeEnvelopeBytes = 0;
let restoreCandidate: CloudRestoreCandidate | null = null;
let backendInitPromise: Promise<void> | null = null;
let cloudSyncInitialized = false;
let isAccountDeletionInProgress = false;

export function beginAccountDeletion(): void {
  isAccountDeletionInProgress = true;
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

function setCloudSaveStatus(status: CloudSaveDisplayStatus, error: string | null = null): void {
  cloudSaveStatus = status;
  lastCloudSyncError = error;
  notifyStatusListeners();
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
    firebaseEnabled: isFirebaseEnabled(),
    restoreCandidate,
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
    ownerUid?: string;
  },
): Promise<boolean> {
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

  const uid = getCurrentUserId();
  if (!uid) {
    setCloudSaveStatus('disabled');
    return false;
  }

  const force = options?.force ?? FORCE_SYNC_REASONS.has(reason);
  const now = Date.now();

  if (!force && lastCloudSyncAt > 0 && now - lastCloudSyncAt < MIN_SYNC_INTERVAL_MS) {
    if (cloudSaveStatus !== 'failed' && cloudSaveStatus !== 'pending' && cloudSaveStatus !== 'syncing') {
      setCloudSaveStatus('pending');
    }
    return false;
  }

  if (!options?.state) {
    console.warn('[cloud-save] syncLocalSaveToCloud skipped: missing game state');
    return false;
  }

  const payload = serializeGameState(options.state, {
    ownerUid: options.ownerUid,
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
    setCloudSaveStatus('failed', ownerGuard.reason);
    return false;
  }

  const envelopeBytes = estimateCloudSaveDocumentBytes(payload);

  if (lastCloudSyncError === 'save-too-large' && envelopeBytes > MAX_SAVE_SIZE_BYTES) {
    if (__DEV__) {
      console.log('[cloud-save] sync skipped — payload still exceeds cloud limit', envelopeBytes);
    }
    setCloudSaveStatus('failed', 'save-too-large');
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
    if (__DEV__) {
      console.log('[cloud-save] sync started', reason);
    }
    const result = await saveGameToCloud(uid, payload);

    if (!result.ok) {
      if (result.error === 'save-too-large') {
        lastSaveTooLargeAt = Date.now();
        lastSaveTooLargeEnvelopeBytes = envelopeBytes;
      }
      console.warn('[cloud-save] sync failed', result.error ?? '');
      setCloudSaveStatus('failed', result.error ?? 'Cloud sync failed');
      return false;
    }

    lastSaveTooLargeAt = 0;
    lastSaveTooLargeEnvelopeBytes = 0;
    lastCloudSyncAt = Date.now();
    setCloudSaveStatus('success');
    void syncLeaderboardFromGameState(options.state);
    if (__DEV__) {
      console.log('[cloud-save] sync success');
    }
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Cloud sync failed';
    console.warn('[cloud-save] sync failed', message);
    setCloudSaveStatus('failed', message);
    return false;
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
      setCloudSaveStatus('failed', 'account-switch-recovery-required');
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
  lastCloudSyncAt = 0;
  lastCloudSyncError = null;
  lastSaveTooLargeAt = 0;
  lastSaveTooLargeEnvelopeBytes = 0;
  restoreCandidate = null;
  cloudSaveStatus = isFirebaseEnabled() ? 'pending' : 'disabled';
  backendInitPromise = null;
  cloudSyncInitialized = false;
  isAccountDeletionInProgress = false;
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

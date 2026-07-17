/**
 * Local save → Firestore cloud save köprüsü.
 *
 * Local save ana kaynak; cloud sync async ve hata toleranslı çalışır.
 * Bu fazda cloud'dan otomatik restore yapılmaz.
 */

import { getCurrentUserId, initAnonymousAuth } from '../services/authService';
import {
  getCloudSaveMeta,
  saveGameToCloud,
  updateUserProfileSummary,
  type CloudSaveMeta,
} from '../services/cloudSaveService';
import { isFirebaseEnabled } from '../services/firebase';
import { SAVE_GAME_VERSION, serializeGameState, type SaveGamePayload } from '../storage/saveGame';
import type { StoreGameState } from '../types/game';
import {
  buildCloudSaveSummary,
  buildCloudSaveSummaryFromPayload,
  type CloudSaveSummary,
} from '../utils/cloudSaveSummary';

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

  if (cloudUpdatedAt <= localUpdatedAt) {
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
  },
): Promise<boolean> {
  if (isAccountDeletionInProgress) {
    if (__DEV__) {
      console.log('[cloud-save] sync skipped — account deletion in progress');
    }
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
    if (cloudSaveStatus !== 'failed') {
      setCloudSaveStatus('pending');
    }
    return false;
  }

  if (!options?.state) {
    console.warn('[cloud-save] syncLocalSaveToCloud skipped: missing game state');
    return false;
  }

  try {
    setCloudSaveStatus('syncing');
    if (__DEV__) {
      console.log('[cloud-save] sync started', reason);
    }
    const payload = serializeGameState(options.state);
    const result = await saveGameToCloud(uid, payload);

    if (!result.ok) {
      console.warn('[cloud-save] sync failed', result.error ?? '');
      setCloudSaveStatus('failed', result.error ?? 'Cloud sync failed');
      return false;
    }

    lastCloudSyncAt = Date.now();
    setCloudSaveStatus('success');
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

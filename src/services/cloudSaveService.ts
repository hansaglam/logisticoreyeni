/**
 * Firestore cloud save — kullanıcı profili, kayıt ve sync meta.
 *
 * Paths:
 *   users/{uid}
 *   users/{uid}/saves/current
 *   users/{uid}/meta/status
 *
 * Güvenlik kuralları: FIRESTORE_RULES.md
 */

import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { APP_VERSION } from '../config/appVersion';
import {
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  writeBatch,
  type Timestamp,
} from 'firebase/firestore';

import type { SaveGamePayload } from '../storage/saveGame';
import type { StoreGameState } from '../types/game';
import {
  buildCloudSaveSummary,
  buildCloudSaveSummaryFromPayload,
  type CloudSaveSummary,
} from '../utils/cloudSaveSummary';
import {
  CLOUD_SAVE_SIZE_WARN_RATIO,
  estimateCloudSaveDocumentBytes,
  MAX_SAVE_SIZE_BYTES,
} from '../utils/cloudSaveSize';
import { findUnexpectedUndefinedPaths, sanitizeForFirestore } from '../utils/sanitizeForFirestore';
import { sha256 } from '../utils/authNonce';
import { canonicalJsonStringify } from '../utils/canonicalJson';
import { getWeeklySeasonDocId } from '../utils/leaderboardSeason';
import {
  getFirebaseAuthSafe,
  getFirestoreSafe,
  isFirebaseEnabled,
  resetFirebaseFirestoreCache,
} from './firebase';

function devCloudLog(message: string, ...args: unknown[]): void {
  if (__DEV__) {
    console.log(message, ...args);
  }
}

let lastUndefinedWarnAt = 0;
let lastUndefinedWarnKey = '';

function warnUnexpectedUndefinedPaths(paths: string[]): void {
  if (paths.length === 0) {
    return;
  }

  const debugEnabled = __DEV__ && process.env.EXPO_PUBLIC_DEBUG_CLOUD_SAVE === '1';
  if (!debugEnabled) {
    return;
  }

  const warnKey = paths.slice(0, 5).join('|');
  const now = Date.now();
  if (warnKey === lastUndefinedWarnKey && now - lastUndefinedWarnAt < 60_000) {
    return;
  }

  lastUndefinedWarnKey = warnKey;
  lastUndefinedWarnAt = now;
  console.warn('[cloud-save] unexpected undefined paths before sanitize', paths.slice(0, 20));
}

export type { CloudSaveSummary };

const CURRENT_SAVE_DOC_ID = 'current';
const META_STATUS_DOC_ID = 'status';

export { MAX_SAVE_SIZE_BYTES, CLOUD_SAVE_SIZE_WARN_RATIO, estimateCloudSaveDocumentBytes } from '../utils/cloudSaveSize';

export function resetCloudFirestoreCache(): void {
  resetFirebaseFirestoreCache();
}

export interface CloudSavePayload {
  ownerUid: string;
  authProvider: string;
  schemaVersion: number;
  version: number;
  saveVersion: number;
  updatedAt: number;
  deviceUpdatedAt: number;
  gameState: SaveGamePayload;
  summary: CloudSaveSummary;
  payloadChecksum?: string;
  syncId?: string;
}

export interface CloudSaveMeta {
  ownerUid: string;
  authProvider: string;
  schemaVersion: number;
  version: number;
  saveVersion: number;
  updatedAt: number;
  deviceUpdatedAt: number;
  summary: CloudSaveSummary;
  payloadChecksum?: string;
  syncId?: string;
}

export interface CloudSaveOperationResult {
  ok: boolean;
  error?: string;
  errorCode?: string;
  documentPath?: string;
  readBackVerified?: boolean;
  verifiedUpdatedAt?: number | null;
}

export function getCloudSaveDocumentPath(uid: string): string {
  return `users/${uid}/saves/${CURRENT_SAVE_DOC_ID}`;
}

export async function verifyCloudSaveReadBack(
  uid: string,
  expectedOwnerUid: string,
): Promise<{ ok: boolean; errorCode?: string; updatedAt?: number }> {
  try {
    const payload = await loadGameFromCloud(uid);
    if (!payload) {
      return { ok: false, errorCode: 'read-back-failed' };
    }

    const db = getFirestoreSafe();
    if (!db) {
      return { ok: false, errorCode: 'firestore-unavailable' };
    }

    const snapshot = await getDoc(doc(db, 'users', uid, 'saves', CURRENT_SAVE_DOC_ID));
    if (!snapshot.exists()) {
      return { ok: false, errorCode: 'read-back-failed' };
    }

    const data = snapshot.data() as Record<string, unknown>;
    const ownerUid =
      typeof data.ownerUid === 'string' && data.ownerUid.trim().length > 0
        ? data.ownerUid.trim()
        : null;

    // Legacy docs without ownerUid: path ownership is still auth.uid; accept if path matches.
    if (ownerUid && ownerUid !== expectedOwnerUid) {
      return { ok: false, errorCode: 'owner-mismatch' };
    }

    const updatedAt = timestampToMillis(data.updatedAt) || payload.updatedAt || 0;
    if (!updatedAt && !payload.deviceUpdatedAt) {
      return { ok: false, errorCode: 'read-back-failed' };
    }

    return { ok: true, updatedAt: updatedAt || payload.deviceUpdatedAt || Date.now() };
  } catch (error) {
    const info = getFirestoreErrorInfo(error);
    return { ok: false, errorCode: info.code ?? 'read-back-failed' };
  }
}

export type CloudSaveLoadFailureReason =
  | 'cloud-save-not-found'
  | 'cloud-save-corrupted'
  | 'owner-mismatch'
  | 'network-error'
  | 'permission-denied'
  | 'unknown';

export type CloudSaveLoadResult =
  | { ok: true; payload: CloudSavePayload }
  | { ok: false; reason: CloudSaveLoadFailureReason; errorCode?: string };

function getAppVersion(): string {
  return Constants.expoConfig?.version ?? APP_VERSION;
}

function getPlatform(): 'ios' | 'android' | 'web' {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  return 'web';
}

function timestampToMillis(value: unknown): number {
  if (
    value &&
    typeof value === 'object' &&
    'toMillis' in value &&
    typeof (value as Timestamp).toMillis === 'function'
  ) {
    return (value as Timestamp).toMillis();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return 0;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function getFirestoreErrorInfo(error: unknown): { code: string | null; message: string } {
  if (error && typeof error === 'object') {
    const code =
      'code' in error && typeof (error as { code?: unknown }).code === 'string'
        ? (error as { code: string }).code
        : null;
    const message =
      'message' in error && typeof (error as { message?: unknown }).message === 'string'
        ? (error as { message: string }).message
        : error instanceof Error
          ? error.message
          : 'Cloud save failed';
    return { code, message };
  }

  return {
    code: null,
    message: error instanceof Error ? error.message : 'Cloud save failed',
  };
}

async function parseCloudSaveDocument(
  data: Record<string, unknown>,
  expectedOwnerUid: string,
): Promise<CloudSavePayload | null> {
  const gameState = data.gameState;
  if (!gameState || typeof gameState !== 'object') {
    return null;
  }

  const summaryRaw = data.summary;
  const summary =
    summaryRaw && typeof summaryRaw === 'object'
      ? {
          companyName:
            typeof (summaryRaw as CloudSaveSummary).companyName === 'string'
              ? (summaryRaw as CloudSaveSummary).companyName
              : 'LogistiCore Lojistik',
          money: Number((summaryRaw as CloudSaveSummary).money) || 0,
          level: Number((summaryRaw as CloudSaveSummary).level) || 1,
          xp: Number((summaryRaw as CloudSaveSummary).xp) || 0,
          companyScore: Number((summaryRaw as CloudSaveSummary).companyScore) || 0,
          completedDeliveries: Number((summaryRaw as CloudSaveSummary).completedDeliveries) || 0,
          trucksCount: Number((summaryRaw as CloudSaveSummary).trucksCount) || 0,
          warehousesCount: Number((summaryRaw as CloudSaveSummary).warehousesCount) || 0,
          lastGameTime: Number((summaryRaw as CloudSaveSummary).lastGameTime) || 0,
          lastLocalSaveAt:
            Number((summaryRaw as CloudSaveSummary).lastLocalSaveAt) ||
            Number(data.deviceUpdatedAt) ||
            0,
          driversCount: Number((summaryRaw as CloudSaveSummary).driversCount) || 0,
          trailersCount: Number((summaryRaw as CloudSaveSummary).trailersCount) || 0,
          activeJobsCount: Number((summaryRaw as CloudSaveSummary).activeJobsCount) || 0,
          progressionScore: Number((summaryRaw as CloudSaveSummary).progressionScore) || 0,
          saveVersion: Number((summaryRaw as CloudSaveSummary).saveVersion) || 1,
        }
      : buildCloudSaveSummaryFromPayload(gameState as SaveGamePayload);

  const deviceUpdatedAt =
    typeof data.deviceUpdatedAt === 'number'
      ? data.deviceUpdatedAt
      : timestampToMillis(data.deviceUpdatedAt);

  const ownerUid =
    typeof data.ownerUid === 'string' && data.ownerUid.length > 0
      ? data.ownerUid
      : expectedOwnerUid;
  if (ownerUid !== expectedOwnerUid) return null;
  const checksum = typeof data.payloadChecksum === 'string' ? data.payloadChecksum : undefined;
  if (checksum) {
    const calculated = await sha256(canonicalJsonStringify(gameState));
    if (!calculated.ok || calculated.hash !== checksum) return null;
  }

  return {
    ownerUid,
    authProvider:
      typeof data.authProvider === 'string' ? data.authProvider : 'legacy',
    schemaVersion: typeof data.schemaVersion === 'number' ? data.schemaVersion : 1,
    version: typeof data.version === 'number' ? data.version : 1,
    saveVersion:
      typeof data.saveVersion === 'number'
        ? data.saveVersion
        : Number(data.saveVersion) || 1,
    updatedAt: timestampToMillis(data.updatedAt) || deviceUpdatedAt,
    deviceUpdatedAt,
    gameState: gameState as SaveGamePayload,
    summary,
    payloadChecksum: checksum,
    syncId: typeof data.syncId === 'string' ? data.syncId : undefined,
  };
}

async function updateCloudSyncMeta(
  uid: string,
  status: 'success' | 'failed' | 'disabled',
  error?: { code?: string | null; message?: string | null },
): Promise<boolean> {
  const db = getFirestoreSafe();
  if (!db || !uid) {
    return false;
  }

  const statusRef = doc(db, 'users', uid, 'meta', META_STATUS_DOC_ID);
  const statusData = sanitizeForFirestore({
    cloudSaveEnabled: status !== 'disabled',
    lastAttemptAt: serverTimestamp(),
    lastDeviceAttemptAt: Date.now(),
    lastSyncStatus: status,
    lastErrorCode: error?.code ?? null,
    lastErrorMessage: error?.message ?? null,
  });

  try {
    devCloudLog('[cloud-save] write meta/status started');
    await setDoc(statusRef, asRecord(statusData), { merge: true });
    devCloudLog('[cloud-save] write meta/status success');
    return true;
  } catch (metaError) {
    const info = getFirestoreErrorInfo(metaError);
    console.warn('[cloud-save] updateCloudSyncMeta failed', {
      code: info.code,
      message: info.message,
    });
    return false;
  }
}

/**
 * Hesap bağlama sonrası users/{uid} provider alanını günceller.
 * summary / oyun alanlarına dokunmaz.
 */
export async function markUserProviderLinked(
  uid: string,
  provider: 'google' | 'apple',
  extras?: {
    displayName?: string | null;
    email?: string | null;
  },
): Promise<CloudSaveOperationResult> {
  if (!uid || !isFirebaseEnabled()) {
    return { ok: false, error: 'firebase-disabled' };
  }

  const db = getFirestoreSafe();
  if (!db) {
    return { ok: false, error: 'firestore-unavailable' };
  }

  try {
    const userRef = doc(db, 'users', uid);
    const existing = await getDoc(userRef);
    const existingData = existing.exists() ? existing.data() : null;
    const existingDisplayName =
      existingData && typeof existingData.displayName === 'string'
        ? existingData.displayName.trim()
        : '';
    const existingEmail =
      existingData && typeof existingData.email === 'string' ? existingData.email.trim() : '';

    const nextDisplayName =
      typeof extras?.displayName === 'string' && extras.displayName.trim().length > 0
        ? extras.displayName.trim()
        : null;
    const nextEmail =
      typeof extras?.email === 'string' && extras.email.trim().length > 0
        ? extras.email.trim()
        : null;

    const profileData = sanitizeForFirestore({
      uid,
      ownerUid: uid,
      provider,
      isAnonymous: false,
      linkedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      appVersion: getAppVersion(),
      platform: getPlatform(),
      // Null ile overwrite yok — yalnızca geçerli değer veya mevcut kayıt
      ...(nextDisplayName || existingDisplayName
        ? { displayName: nextDisplayName ?? existingDisplayName }
        : {}),
      ...(nextEmail || existingEmail ? { email: nextEmail ?? existingEmail } : {}),
    });
    await setDoc(userRef, asRecord(profileData), { merge: true });
    devCloudLog('[cloud-save] user provider linked', provider);
    return { ok: true };
  } catch (error) {
    const info = getFirestoreErrorInfo(error);
    console.warn('[cloud-save] markUserProviderLinked failed:', info.message);
    return { ok: false, error: info.message };
  }
}

export async function updateUserProfileSummary(uid: string, state: StoreGameState): Promise<void> {
  if (!uid || !isFirebaseEnabled()) {
    return;
  }

  const db = getFirestoreSafe();
  if (!db) {
    return;
  }

  const summary = buildCloudSaveSummary(state);

  try {
    const userRef = doc(db, 'users', uid);
    const existing = await getDoc(userRef);
    const existingProvider =
      existing.exists() && typeof existing.data()?.provider === 'string'
        ? (existing.data()?.provider as string)
        : null;

    // Bağlı provider'ı anonymous ile ezme
    const provider =
      existingProvider === 'google' || existingProvider === 'apple'
        ? existingProvider
        : 'anonymous';

    const profileData = sanitizeForFirestore({
      uid,
      provider,
      isAnonymous: provider === 'anonymous',
      appVersion: getAppVersion(),
      platform: getPlatform(),
      updatedAt: serverTimestamp(),
      lastLoginAt: serverTimestamp(),
      companyName: summary.companyName,
      level: summary.level,
      companyScore: summary.companyScore,
      money: summary.money,
      isDeleted: false,
      ...(existing.exists() ? {} : { createdAt: serverTimestamp() }),
    });

    await setDoc(userRef, asRecord(profileData), { merge: true });
  } catch (error) {
    console.warn('[cloud-save] updateUserProfileSummary failed:', error);
  }
}

export async function saveGameToCloud(
  uid: string,
  savePayload: SaveGamePayload,
  options?: {
    diagnosticId?: string;
    trigger?: string;
    skipReadBack?: boolean;
  },
): Promise<CloudSaveOperationResult> {
  const documentPath = getCloudSaveDocumentPath(uid);

  if (!uid || !isFirebaseEnabled()) {
    return { ok: false, error: 'firebase-disabled', errorCode: 'firebase-disabled', documentPath };
  }

  const db = getFirestoreSafe();
  if (!db) {
    return {
      ok: false,
      error: 'firestore-unavailable',
      errorCode: 'firestore-unavailable',
      documentPath,
    };
  }
  const authUser = getFirebaseAuthSafe()?.currentUser;
  if (!authUser || authUser.uid !== uid) {
    return { ok: false, error: 'owner-mismatch', errorCode: 'owner-mismatch' };
  }

  const unexpectedUndefinedPaths = findUnexpectedUndefinedPaths(savePayload);
  warnUnexpectedUndefinedPaths(unexpectedUndefinedPaths);

  const summary = buildCloudSaveSummaryFromPayload(savePayload);
  const sanitizedGameState = sanitizeForFirestore(savePayload);
  const sanitizedSummary = sanitizeForFirestore(summary);
  const deviceUpdatedAt = savePayload.meta?.savedAt ?? Date.now();
  const checksumResult = await sha256(canonicalJsonStringify(sanitizedGameState));
  if (!checksumResult.ok) {
    return { ok: false, error: 'payload-checksum-failed' };
  }
  const syncId = `${uid}:${savePayload.meta?.saveVersion ?? savePayload.version}:${deviceUpdatedAt}`;

  let estimatedSize = 0;
  try {
    estimatedSize = estimateCloudSaveDocumentBytes(savePayload);
  } catch {
    estimatedSize = MAX_SAVE_SIZE_BYTES + 1;
  }

  devCloudLog('[cloud-save] estimated save size', estimatedSize);
  if (__DEV__ && estimatedSize >= MAX_SAVE_SIZE_BYTES * CLOUD_SAVE_SIZE_WARN_RATIO) {
    console.warn('[cloud-save] payload approaching size limit', {
      estimatedSize,
      limitBytes: MAX_SAVE_SIZE_BYTES,
      ratio: Math.round((estimatedSize / MAX_SAVE_SIZE_BYTES) * 100),
    });
  }
  if (estimatedSize > MAX_SAVE_SIZE_BYTES) {
    await updateCloudSyncMeta(uid, 'failed', {
      code: 'save-too-large',
      message: `estimated size ${estimatedSize}`,
    });
    return {
      ok: false,
      error: 'save-too-large',
      errorCode: 'save-too-large',
      documentPath,
    };
  }

  const userRef = doc(db, 'users', uid);
  const saveRef = doc(db, 'users', uid, 'saves', CURRENT_SAVE_DOC_ID);
  const statusRef = doc(db, 'users', uid, 'meta', META_STATUS_DOC_ID);

  try {
    const existing = await getDoc(userRef);
    const existingProvider =
      existing.exists() && typeof existing.data()?.provider === 'string'
        ? (existing.data()?.provider as string)
        : null;
    const provider =
      existingProvider === 'google' || existingProvider === 'apple'
        ? existingProvider
        : 'anonymous';

    const profileData = sanitizeForFirestore({
      uid,
      ownerUid: uid,
      provider,
      isAnonymous: provider === 'anonymous',
      appVersion: getAppVersion(),
      platform: getPlatform(),
      updatedAt: serverTimestamp(),
      lastLoginAt: serverTimestamp(),
      companyName: summary.companyName,
      level: summary.level,
      companyScore: summary.companyScore,
      money: summary.money,
      isDeleted: false,
      ...(existing.exists() ? {} : { createdAt: serverTimestamp() }),
    });

    const saveVersion = savePayload.meta?.saveVersion ?? savePayload.version ?? 1;
    const cloudSaveData = sanitizeForFirestore({
      ownerUid: uid,
      authProvider: provider,
      schemaVersion: 1,
      version: savePayload.version ?? 1,
      saveVersion,
      ownerUid: uid,
      updatedAt: serverTimestamp(),
      deviceUpdatedAt,
      gameState: sanitizedGameState,
      summary: sanitizedSummary,
      payloadChecksum: checksumResult.hash,
      syncId,
    });

    const statusData = sanitizeForFirestore({
      cloudSaveEnabled: true,
      ownerUid: uid,
      lastAttemptAt: serverTimestamp(),
      lastDeviceAttemptAt: Date.now(),
      lastSyncStatus: 'success',
      lastErrorCode: null,
      lastErrorMessage: null,
    });

    const batch = writeBatch(db);
    batch.set(userRef, asRecord(profileData), { merge: true });
    batch.set(saveRef, asRecord(cloudSaveData), { merge: true });
    batch.set(statusRef, asRecord(statusData), { merge: true });

    devCloudLog('[cloud-save] atomic write started', documentPath);
    await batch.commit();
    devCloudLog('[cloud-save] atomic write success', documentPath);

    if (options?.skipReadBack) {
      return { ok: true, documentPath, readBackVerified: false };
    }

    const readBack = await verifyCloudSaveReadBack(uid, uid);
    if (!readBack.ok) {
      await updateCloudSyncMeta(uid, 'failed', {
        code: readBack.errorCode ?? 'read-back-failed',
        message: 'post-write read-back failed',
      });
      return {
        ok: false,
        error: readBack.errorCode ?? 'read-back-failed',
        errorCode: readBack.errorCode ?? 'read-back-failed',
        documentPath,
        readBackVerified: false,
      };
    }

    return {
      ok: true,
      documentPath,
      readBackVerified: true,
      verifiedUpdatedAt: readBack.updatedAt ?? Date.now(),
    };
  } catch (error) {
    const info = getFirestoreErrorInfo(error);
    console.warn('[cloud-save] saveGameToCloud failed:', {
      code: info.code,
      message: info.message,
      documentPath,
      trigger: options?.trigger ?? null,
      diagnosticId: options?.diagnosticId ?? null,
    });
    await updateCloudSyncMeta(uid, 'failed', {
      code: info.code,
      message: info.message,
    });
    return {
      ok: false,
      error: info.message,
      errorCode: info.code ?? 'unknown',
      documentPath,
    };
  }
}

export async function loadGameFromCloudDetailed(uid: string): Promise<CloudSaveLoadResult> {
  if (!uid || !isFirebaseEnabled()) {
    return { ok: false, reason: 'network-error' };
  }

  const db = getFirestoreSafe();
  if (!db) {
    return { ok: false, reason: 'network-error' };
  }
  const authUid = getFirebaseAuthSafe()?.currentUser?.uid;
  if (!authUid || authUid !== uid) {
    return { ok: false, reason: 'owner-mismatch' };
  }

  try {
    const snapshot = await getDoc(doc(db, 'users', uid, 'saves', CURRENT_SAVE_DOC_ID));
    if (!snapshot.exists()) {
      return { ok: false, reason: 'cloud-save-not-found' };
    }

    const data = snapshot.data();
    if (!data || typeof data !== 'object') {
      return { ok: false, reason: 'cloud-save-corrupted' };
    }

    if (typeof data.ownerUid === 'string' && data.ownerUid !== uid) {
      return { ok: false, reason: 'owner-mismatch' };
    }
    const payload = await parseCloudSaveDocument(data as Record<string, unknown>, uid);
    return payload
      ? { ok: true, payload }
      : { ok: false, reason: 'cloud-save-corrupted' };
  } catch (error) {
    console.warn('[cloud-save] loadGameFromCloud failed:', error);
    const info = getFirestoreErrorInfo(error);
    if (info.code === 'permission-denied' || info.code === 'firestore/permission-denied') {
      return { ok: false, reason: 'permission-denied', errorCode: info.code ?? undefined };
    }
    if (
      info.code === 'unavailable' ||
      info.code === 'firestore/unavailable' ||
      info.code === 'deadline-exceeded' ||
      info.code === 'firestore/deadline-exceeded'
    ) {
      return { ok: false, reason: 'network-error', errorCode: info.code ?? undefined };
    }
    return { ok: false, reason: 'unknown', errorCode: info.code ?? undefined };
  }
}

export async function loadGameFromCloud(uid: string): Promise<CloudSavePayload | null> {
  const result = await loadGameFromCloudDetailed(uid);
  return result.ok ? result.payload : null;
}

export async function getCloudSaveMeta(uid: string): Promise<CloudSaveMeta | null> {
  const payload = await loadGameFromCloud(uid);
  if (!payload) {
    return null;
  }

  return {
    ownerUid: payload.ownerUid,
    authProvider: payload.authProvider,
    schemaVersion: payload.schemaVersion,
    version: payload.version,
    saveVersion: payload.saveVersion,
    updatedAt: payload.updatedAt,
    deviceUpdatedAt: payload.deviceUpdatedAt,
    summary: payload.summary,
    payloadChecksum: payload.payloadChecksum,
    syncId: payload.syncId,
  };
}

async function deleteActiveLeaderboardEntry(uid: string): Promise<void> {
  // Client writes/deletes are denied by rules. Account deletion callable
  // (prepareVehicleMarketplaceAccountDeletion) removes all season entries via Admin SDK.
  if (__DEV__) {
    devCloudLog('[cloud-save] leaderboard entry cleanup deferred to trusted callable', {
      uid,
      seasonKey: getWeeklySeasonDocId(),
    });
  }
}

export async function deleteUserCloudData(uid: string): Promise<CloudSaveOperationResult> {
  if (!uid || !isFirebaseEnabled()) {
    return { ok: true };
  }

  const db = getFirestoreSafe();
  if (!db) {
    return { ok: false, error: 'firestore-unavailable', errorCode: 'firestore-unavailable' };
  }

  const saveRef = doc(db, 'users', uid, 'saves', CURRENT_SAVE_DOC_ID);
  const metaRef = doc(db, 'users', uid, 'meta', META_STATUS_DOC_ID);
  const userRef = doc(db, 'users', uid);

  // TODO: Gelecekte users/{uid} altına yeni subcollection eklenirse burada silinmeli.

  try {
    devCloudLog('[cloud-save] deleteUserCloudData started', uid);
    const { prepareVehicleMarketplaceAccountDeletion } = await import(
      './vehicleMarketplaceService'
    );
    const marketplacePrepared =
      await prepareVehicleMarketplaceAccountDeletion();
    if (!marketplacePrepared) {
      return {
        ok: false,
        error: 'marketplace-account-cleanup-failed',
        errorCode: 'cloud-delete-failed',
      };
    }
    await deleteActiveLeaderboardEntry(uid);
    const batch = writeBatch(db);
    batch.delete(saveRef);
    batch.delete(metaRef);
    batch.delete(userRef);
    await batch.commit();
    devCloudLog('[cloud-save] deleteUserCloudData success');
    return { ok: true };
  } catch (error) {
    const info = getFirestoreErrorInfo(error);
    console.warn('[cloud-save] deleteUserCloudData failed:', info);

    if (info.code === 'permission-denied') {
      return {
        ok: false,
        error: info.message,
        errorCode: 'permission-denied',
      };
    }

    if (info.code === 'unavailable' || info.code === 'deadline-exceeded') {
      return {
        ok: false,
        error: info.message,
        errorCode: 'network-error',
      };
    }

    // Doküman yoksa batch genelde başarılı olur; kısmi hata için tek tek dene.
    try {
      await deleteDoc(saveRef);
    } catch {
      // missing doc — ignore
    }
    try {
      await deleteDoc(metaRef);
    } catch {
      // missing doc — ignore
    }
    try {
      await deleteDoc(userRef);
      devCloudLog('[cloud-save] deleteUserCloudData partial success');
      return { ok: true };
    } catch (fallbackError) {
      const fallbackInfo = getFirestoreErrorInfo(fallbackError);
      console.warn('[cloud-save] deleteUserCloudData fallback failed:', fallbackInfo);
      return {
        ok: false,
        error: fallbackInfo.message,
        errorCode: fallbackInfo.code ?? 'cloud-delete-failed',
      };
    }
  }
}

/**
 * Simplified account login + cloud restore orchestration.
 *
 * Auth completes first (Firebase existing UID). Save decisions use authenticatedUid only.
 * Conflict modal only when meaningful local + valid cloud + different saves.
 */

import type { AuthCredential } from 'firebase/auth';

import {
  loadGameFromCloudDetailed,
  markUserProviderLinked,
  type CloudSaveLoadFailureReason,
} from './cloudSaveService';
import { getFirebaseAuthSafe } from './firebase';
import {
  beginAccountSaveConflictSession,
  clearAccountSaveConflictSession,
  completeAccountSaveConflictSession,
  logAccountConflictResolve,
} from './accountSaveConflictSession';
import { setCloudSaveAccountConflictPending } from './cloudSaveConflictState';
import {
  setAccountAuthPhase,
  setAccountSaveFlowPhase,
} from './accountSaveFlowState';
import {
  CloudSaveConflictError,
  executeAtomicCloudSaveRestore,
  isRetryableCloudSaveConflictReason,
  validateCloudSaveRestorePayload,
  type CloudSaveConflictReason,
} from '../utils/cloudSaveConflict';
import { classifyLocalSave } from '../utils/localSaveMeaning';
import { areLocalAndCloudSavesDifferent } from '../utils/saveConflictDetection';
import { buildCloudSaveSummary } from '../utils/cloudSaveSummary';
import { SAVE_GAME_VERSION } from '../storage/saveGame';
import {
  beginCloudRestoreJournal,
  completeCloudRestoreJournal,
  hasCloudRestoreReceipt,
} from '../storage/cloudRestoreJournal';
import { isLocalSaveSafeForAccountTransition } from '../utils/accountTransition';
import type { AccountLinkResult, AccountSwitchResult } from './authService';

export type ProviderAccountSaveOutcome =
  | { type: 'completed'; message?: string }
  | {
      type: 'conflict';
      provider: 'google' | 'apple';
      authenticatedUid: string;
      /** Hedef hesapta bulut kaydı yok; cihazda anlamlı ilerleme var. */
      cloudSaveMissing?: boolean;
    }
  | {
      type: 'cloud_load_failed';
      provider: 'google' | 'apple';
      authenticatedUid: string;
      reason: CloudSaveConflictReason;
      retryable: boolean;
    }
  | {
      type: 'cloud_corrupt';
      provider: 'google' | 'apple';
      authenticatedUid: string;
      reason: CloudSaveConflictReason;
    };

function mapCloudLoadFailure(
  reason: CloudSaveLoadFailureReason,
): CloudSaveConflictReason {
  switch (reason) {
    case 'metadata-missing':
      return 'metadata-missing';
    case 'body-missing':
      return 'body-missing';
    case 'checksum-invalid':
      return 'checksum-invalid';
    case 'deserialize-failed':
      return 'deserialize-failed';
    case 'unsupported-save-version':
      return 'unsupported-save-version';
    case 'owner-mismatch':
      return 'owner-mismatch';
    case 'cloud-save-not-found':
      return 'cloud-save-not-found';
    case 'network-error':
    case 'network-failed':
      return 'network-failed';
    case 'permission-denied':
      return 'permission-denied';
    case 'cloud-save-corrupted':
      return 'cloud-save-invalid';
    default:
      return 'cloud-save-fetch-failed';
  }
}

function isCorruptCloudReason(reason: CloudSaveLoadFailureReason): boolean {
  return (
    reason === 'checksum-invalid' ||
    reason === 'cloud-save-corrupted' ||
    reason === 'deserialize-failed' ||
    reason === 'unsupported-save-version' ||
    reason === 'owner-mismatch'
  );
}

async function signInWithProviderCredential(
  credential: AuthCredential,
  provider: 'google' | 'apple',
): Promise<string> {
  const { signInWithCredential } = await import('firebase/auth');
  const auth = getFirebaseAuthSafe();
  if (!auth) {
    throw new CloudSaveConflictError('network-failed');
  }

  const current = auth.currentUser;
  if (current && !current.isAnonymous && current.providerData.some((e) => e.providerId === credential.providerId)) {
    return current.uid;
  }

  try {
    const result = await signInWithCredential(auth, credential);
    return result.user.uid;
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'string'
        ? (error as { code: string }).code
        : null;
    if (code === 'auth/network-request-failed') {
      throw new CloudSaveConflictError('network-failed');
    }
    if (provider === 'google') {
      const { createGoogleFirebaseCredential } = await import('./googleAuthService');
      const fresh = await createGoogleFirebaseCredential({ forceInteractivePicker: false });
      if (fresh.ok) {
        const retry = await signInWithCredential(auth, fresh.credential);
        return retry.user.uid;
      }
    }
    if (provider === 'apple') {
      const { signInWithAppleAccount } = await import('./appleAuthService');
      const fresh = await signInWithAppleAccount();
      if (fresh.ok) {
        const retry = await signInWithCredential(auth, fresh.credential);
        return retry.user.uid;
      }
    }
    throw error;
  }
}

async function restoreCloudSaveForUid(
  authenticatedUid: string,
  provider: 'google' | 'apple',
): Promise<void> {
  const auth = getFirebaseAuthSafe();
  if (!auth?.currentUser || auth.currentUser.uid !== authenticatedUid) {
    throw new CloudSaveConflictError('auth-user-mismatch');
  }

  const { useGameStore } = await import('../store/gameStore');
  const { payloadToStoreState, saveGameState } = await import('../storage/saveGame');

  setAccountSaveFlowPhase('restoring');
  logAccountConflictResolve({
    stage: 'cloud-meta-fetch',
    provider,
    selectedSource: 'cloud',
    authUidPresent: true,
  });

  await executeAtomicCloudSaveRestore({
    selectedAccountUid: authenticatedUid,
    expectedAccountUid: authenticatedUid,
    readMetadata: async () => {
      const result = await loadGameFromCloudDetailed(authenticatedUid);
      if (!result.ok) {
        throw new CloudSaveConflictError(mapCloudLoadFailure(result.reason));
      }
      return result.payload;
    },
    readPayload: async () => {
      const result = await loadGameFromCloudDetailed(authenticatedUid);
      if (!result.ok) {
        throw new CloudSaveConflictError(mapCloudLoadFailure(result.reason));
      }
      if (auth.currentUser?.uid !== authenticatedUid) {
        throw new CloudSaveConflictError('auth-user-mismatch');
      }
      return result.payload;
    },
    validate: (payload) => {
      if (auth.currentUser?.uid !== authenticatedUid) {
        return 'auth-user-mismatch';
      }
      if (
        typeof payload.ownerUid === 'string' &&
        payload.ownerUid.length > 0 &&
        payload.ownerUid !== authenticatedUid
      ) {
        return 'owner-mismatch';
      }
      return validateCloudSaveRestorePayload(payload, SAVE_GAME_VERSION);
    },
    migrate: (payload) => {
      const safePayload = {
        ...payload.gameState,
        cachedGlobalEconomySnapshotTrusted: false,
      };
      try {
        return payloadToStoreState(safePayload);
      } catch {
        throw new CloudSaveConflictError('migration-failed');
      }
    },
    reconcileMarketplace: async (pendingCloudRestore) => {
      const [{ getMyVehicleListings }, { reconcileFleetWithVehicleMarketplace }] =
        await Promise.all([
          import('./vehicleMarketplaceService'),
          import('../domain/vehicleMarketplaceReconciliation'),
        ]);
      const marketplace = await getMyVehicleListings();
      if (!marketplace.ok || !marketplace.reconciliation) {
        throw new CloudSaveConflictError('marketplace-reconciliation-failed');
      }
      const reconciled = reconcileFleetWithVehicleMarketplace(
        pendingCloudRestore.player.trucks,
        marketplace.reconciliation,
      );
      return {
        ...pendingCloudRestore,
        player: {
          ...pendingCloudRestore.player,
          trucks: reconciled.trucks,
          money: reconciled.authoritativeCash ?? pendingCloudRestore.player.money,
        },
        vehicleMarketplace: reconciled.cache,
      };
    },
    persistLocal: (pendingCloudRestore) =>
      saveGameState(pendingCloudRestore, { ownerUid: authenticatedUid }),
    commitState: (pendingCloudRestore) => {
      useGameStore.setState(pendingCloudRestore);
    },
    getOwnerUid: (payload) =>
      typeof payload.ownerUid === 'string' && payload.ownerUid.length > 0
        ? payload.ownerUid
        : undefined,
    getRestoreId: (payload) =>
      `${authenticatedUid}:${payload.saveVersion}:${payload.updatedAt}:${payload.payloadChecksum ?? 'legacy'}`,
    isRestoreApplied: hasCloudRestoreReceipt,
    beginRestore: (restoreId, ownerUid) =>
      beginCloudRestoreJournal({ restoreId, ownerUid, startedAt: Date.now() }),
    completeRestore: (restoreId, ownerUid) =>
      completeCloudRestoreJournal({ restoreId, ownerUid, startedAt: Date.now() }),
    validateState: isLocalSaveSafeForAccountTransition,
  });

  void useGameStore.getState().refreshMarketSnapshot();
  await markUserProviderLinked(authenticatedUid, provider);
  setCloudSaveAccountConflictPending(false);
  clearAccountSaveConflictSession();

  try {
    const { invalidateSaveRecoveryColdStartProbe } = await import('./saveRecoveryService');
    invalidateSaveRecoveryColdStartProbe();
  } catch {
    // best-effort
  }

  try {
    const { initCloudSaveSync } = await import('../storage/cloudSaveSync');
    await initCloudSaveSync(() => useGameStore.getState());
  } catch {
    // best-effort
  }

  setAccountSaveFlowPhase('ready');
  logAccountConflictResolve({ stage: 'success', provider, selectedSource: 'cloud', authUidPresent: true });
}

async function uploadLocalSaveForUid(
  authenticatedUid: string,
  provider: 'google' | 'apple',
): Promise<void> {
  const auth = getFirebaseAuthSafe();
  if (!auth?.currentUser || auth.currentUser.uid !== authenticatedUid) {
    throw new CloudSaveConflictError('auth-user-mismatch');
  }

  const { useGameStore } = await import('../store/gameStore');
  const { saveGameState } = await import('../storage/saveGame');
  const localState = useGameStore.getState();

  if (!isLocalSaveSafeForAccountTransition(localState)) {
    throw new CloudSaveConflictError('local-save-invalid');
  }

  setAccountSaveFlowPhase('uploading');
  const saved = await saveGameState(localState, { ownerUid: authenticatedUid });
  if (!saved) {
    throw new CloudSaveConflictError('local-save-invalid');
  }

  const { syncLocalSaveToCloud } = await import('../storage/cloudSaveSync');
  const uploaded = await syncLocalSaveToCloud('account_link', {
    force: true,
    bypassAccountConflictLock: true,
    state: useGameStore.getState(),
    ownerUid: authenticatedUid,
  });
  if (!uploaded) {
    throw new CloudSaveConflictError('cloud-upload-failed');
  }

  const { ensureAuthoritativeFleetReady } = await import('./serverStateMigrationService');
  await ensureAuthoritativeFleetReady();

  const verify = await loadGameFromCloudDetailed(authenticatedUid);
  if (!verify.ok) {
    throw new CloudSaveConflictError(
      verify.reason === 'network-error' || verify.reason === 'unknown'
        ? 'cloud-upload-failed'
        : mapCloudLoadFailure(verify.reason),
    );
  }

  await markUserProviderLinked(authenticatedUid, provider);
  setCloudSaveAccountConflictPending(false);
  clearAccountSaveConflictSession();
  setAccountSaveFlowPhase('ready');
  logAccountConflictResolve({ stage: 'success', provider, selectedSource: 'local', authUidPresent: true });
}

async function bindStarterSaveToUid(
  authenticatedUid: string,
  provider: 'google' | 'apple',
): Promise<void> {
  const { useGameStore } = await import('../store/gameStore');
  const { saveGameState } = await import('../storage/saveGame');
  const state = useGameStore.getState();
  await saveGameState(state, { ownerUid: authenticatedUid });
  await markUserProviderLinked(authenticatedUid, provider);

  const { syncLocalSaveToCloud } = await import('../storage/cloudSaveSync');
  await syncLocalSaveToCloud('account_link', {
    force: true,
    bypassAccountConflictLock: true,
    state: useGameStore.getState(),
    ownerUid: authenticatedUid,
  });

  const { ensureAuthoritativeFleetReady } = await import('./serverStateMigrationService');
  await ensureAuthoritativeFleetReady();

  setCloudSaveAccountConflictPending(false);
  setAccountSaveFlowPhase('ready');
}

export async function runPostSignInSaveFlow(
  provider: 'google' | 'apple',
  authenticatedUid: string,
): Promise<ProviderAccountSaveOutcome> {
  const auth = getFirebaseAuthSafe();
  if (!auth?.currentUser || auth.currentUser.uid !== authenticatedUid) {
    return {
      type: 'cloud_load_failed',
      provider,
      authenticatedUid,
      reason: 'auth-user-mismatch',
      retryable: false,
    };
  }

  setAccountSaveFlowPhase('checking');
  const { useGameStore } = await import('../store/gameStore');
  const { loadGameStateDetailed } = await import('../storage/saveGame');
  const gameState = useGameStore.getState();
  const localDetailed = await loadGameStateDetailed();
  const localMeaning = classifyLocalSave(gameState, {
    ownerUid: localDetailed.payload?.ownerUid ?? null,
    hasPersistedSave: Boolean(localDetailed.payload),
  });

  const cloud = await loadGameFromCloudDetailed(authenticatedUid);

  if (!cloud.ok) {
    if (cloud.reason === 'cloud-save-not-found') {
      if (localMeaning.meaningful) {
        setAccountSaveFlowPhase('conflict');
        beginAccountSaveConflictSession({ provider, authenticatedUid });
        return {
          type: 'conflict',
          provider,
          authenticatedUid,
          cloudSaveMissing: true,
        };
      }
      await bindStarterSaveToUid(authenticatedUid, provider);
      return { type: 'completed', message: 'Hesabınla yeni oyun başlatıldı.' };
    }

    if (isCorruptCloudReason(cloud.reason)) {
      setAccountSaveFlowPhase('error');
      return {
        type: 'cloud_corrupt',
        provider,
        authenticatedUid,
        reason: mapCloudLoadFailure(cloud.reason),
      };
    }

    setAccountSaveFlowPhase('error');
    return {
      type: 'cloud_load_failed',
      provider,
      authenticatedUid,
      reason: mapCloudLoadFailure(cloud.reason),
      retryable: isRetryableCloudSaveConflictReason(mapCloudLoadFailure(cloud.reason)),
    };
  }

  const { setCloudRestoreCandidateForConflict } = await import('../storage/cloudSaveSync');
  setCloudRestoreCandidateForConflict(gameState, cloud.payload);

  if (!localMeaning.meaningful) {
    await restoreCloudSaveForUid(authenticatedUid, provider);
    return { type: 'completed', message: 'Bulut kaydın yüklendi.' };
  }

  const localSummary = buildCloudSaveSummary(gameState, localDetailed.payload?.meta.savedAt);
  const cloudSummary = cloud.payload.summary;
  if (!areLocalAndCloudSavesDifferent(localSummary, cloudSummary)) {
    await restoreCloudSaveForUid(authenticatedUid, provider);
    return { type: 'completed', message: 'Bulut kaydın yüklendi.' };
  }

  setAccountSaveFlowPhase('conflict');
  beginAccountSaveConflictSession({ provider, authenticatedUid });
  return { type: 'conflict', provider, authenticatedUid };
}

export async function completeExistingProviderAccountLogin(
  credential: AuthCredential,
  provider: 'google' | 'apple',
): Promise<AccountLinkResult> {
  setAccountAuthPhase('authenticating');
  try {
    const authenticatedUid = await signInWithProviderCredential(credential, provider);
    const auth = getFirebaseAuthSafe();
    const user = auth?.currentUser;
    if (user) {
      const { commitAuthenticatedSession } = await import('./authService');
      commitAuthenticatedSession(user);
    }
    setAccountAuthPhase('authenticated');

    const outcome = await runPostSignInSaveFlow(provider, authenticatedUid);
    return mapSaveOutcomeToLinkResult(outcome, provider);
  } catch (error) {
    setAccountAuthPhase('error');
    const reason =
      error instanceof CloudSaveConflictError
        ? error.reason
        : 'unknown';
    return {
      ok: false,
      error: reason,
      errorKind: 'general',
      provider,
      saveOutcome: {
        type: 'cloud_load_failed',
        provider,
        authenticatedUid: getFirebaseAuthSafe()?.currentUser?.uid ?? '',
        reason,
        retryable: isRetryableCloudSaveConflictReason(reason),
      },
    };
  }
}

export async function retryPostSignInSaveFlow(
  provider: 'google' | 'apple',
): Promise<ProviderAccountSaveOutcome> {
  const auth = getFirebaseAuthSafe();
  const uid = auth?.currentUser?.uid;
  if (!uid || auth.currentUser.isAnonymous) {
    return {
      type: 'cloud_load_failed',
      provider,
      authenticatedUid: uid ?? '',
      reason: 'auth-user-mismatch',
      retryable: false,
    };
  }
  return runPostSignInSaveFlow(provider, uid);
}

function mapSaveOutcomeToLinkResult(
  outcome: ProviderAccountSaveOutcome,
  provider: 'google' | 'apple',
): AccountLinkResult {
  switch (outcome.type) {
    case 'completed':
      return { ok: true, provider, saveOutcome: outcome };
    case 'conflict':
      return { ok: false, error: 'save-conflict', provider, saveOutcome: outcome };
    case 'cloud_load_failed':
      return { ok: false, error: outcome.reason, provider, saveOutcome: outcome };
    case 'cloud_corrupt':
      return { ok: false, error: outcome.reason, provider, saveOutcome: outcome };
    default:
      return { ok: false, error: 'unknown', provider };
  }
}

export async function resolveSaveConflict(input: {
  authenticatedUid: string;
  choice: 'cloud' | 'local' | 'fresh';
  provider: 'google' | 'apple';
}): Promise<AccountSwitchResult> {
  const { authenticatedUid, choice, provider } = input;
  const auth = getFirebaseAuthSafe();
  if (!auth?.currentUser || auth.currentUser.uid !== authenticatedUid) {
    return { ok: false, error: 'auth-user-mismatch' };
  }

  try {
    if (choice === 'cloud') {
      await restoreCloudSaveForUid(authenticatedUid, provider);
    } else if (choice === 'fresh') {
      const { useGameStore } = await import('../store/gameStore');
      await useGameStore.getState().clearSave();
      await bindStarterSaveToUid(authenticatedUid, provider);
    } else {
      await uploadLocalSaveForUid(authenticatedUid, provider);
    }
    completeAccountSaveConflictSession();
    return { ok: true, selectedAccountUid: authenticatedUid };
  } catch (error) {
    const reason =
      error instanceof CloudSaveConflictError
        ? error.reason
        : 'unknown';
    logAccountConflictResolve({
      stage: 'error',
      provider,
      selectedSource: choice,
      errorCode: reason,
      retryable: isRetryableCloudSaveConflictReason(reason),
    });
    return { ok: false, error: reason, selectedAccountUid: authenticatedUid };
  }
}

export async function runPostSignInSaveFlowForAccountSwitch(
  provider: 'google' | 'apple',
  authenticatedUid: string,
): Promise<ProviderAccountSaveOutcome> {
  return runPostSignInSaveFlow(provider, authenticatedUid);
}

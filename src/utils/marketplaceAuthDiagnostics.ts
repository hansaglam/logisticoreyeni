/**
 * Temporary Marketplace auth probe. DEV-only. Do not use for authorization.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  getAccountStatus,
  getAuthLifecycleState,
  isAuthSessionReady,
} from '../services/authService';
import { getFirebaseAuthSafe } from '../services/firebase';
import { fetchUsernameProfile } from '../services/usernameService';
import { getSaveBootstrapAuthUid } from '../storage/saveAuthContext';
import { SAVE_STORAGE_KEY } from '../storage/saveGame';

function linkedFromFirebaseUser(): boolean {
  const user = getFirebaseAuthSafe()?.currentUser ?? null;
  return Boolean(user && !user.isAnonymous);
}

function collectSyncAuthSnapshot(extra?: Record<string, unknown>): Record<string, unknown> {
  const firebaseUser = getFirebaseAuthSafe()?.currentUser ?? null;
  const account = getAccountStatus();
  const authSessionReady = isAuthSessionReady();
  const linkedByCurrentUser = linkedFromFirebaseUser();
  const linkedByAccountStatus =
    account.isReady && !account.isAnonymous && account.provider !== 'guest';
  const marketplaceAccessResult = !authSessionReady
    ? 'AUTH_LOADING'
    : !firebaseUser || firebaseUser.isAnonymous
      ? 'GUEST'
      : 'AUTHENTICATED';

  return {
    firebaseCurrentUserUid: firebaseUser?.uid ?? null,
    firebaseIsAnonymous: firebaseUser?.isAnonymous ?? null,
    providerData: (firebaseUser?.providerData ?? []).map((entry) => ({
      providerId: entry.providerId,
      uid: entry.uid,
    })),
    providerIds: (firebaseUser?.providerData ?? []).map((entry) => entry.providerId),
    appAuthUid: account.uid,
    appAuthStatus: {
      isReady: account.isReady,
      isAnonymous: account.isAnonymous,
      provider: account.provider,
      lifecycle: getAuthLifecycleState(),
      authSessionReady,
    },
    bootstrapAuthUid: getSaveBootstrapAuthUid(),
    marketplaceAccessResult,
    linkedByCurrentUser,
    linkedByAccountStatus,
    screenGateWouldBlock: !linkedByCurrentUser,
    ...extra,
  };
}

async function peekLocalSaveOwnerUid(): Promise<string | null> {
  try {
    const json = await AsyncStorage.getItem(SAVE_STORAGE_KEY);
    if (!json) return null;
    const parsed = JSON.parse(json) as { ownerUid?: unknown };
    return typeof parsed.ownerUid === 'string' ? parsed.ownerUid : null;
  } catch {
    return null;
  }
}

export async function logMarketplaceAuthProbe(
  source: string,
  extra?: Record<string, unknown>,
): Promise<void> {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return;

  const syncSnapshot = collectSyncAuthSnapshot(extra);
  console.info('[MARKETPLACE_AUTH]', { source, ...syncSnapshot });

  const firebaseUid = syncSnapshot.firebaseCurrentUserUid as string | null;
  const ownerUid = await peekLocalSaveOwnerUid();

  let profileExists: boolean | null = null;
  let username: string | null = null;
  let usernameSetupCompleted: boolean | null = null;
  let profileFetchReason: string | null = null;
  try {
    const profile = await fetchUsernameProfile();
    if (profile.ok) {
      profileExists = true;
      username = profile.profile.username;
      usernameSetupCompleted = profile.profile.usernameSetupCompleted;
    } else {
      profileExists = false;
      profileFetchReason = profile.reason;
    }
  } catch (error) {
    profileExists = false;
    profileFetchReason =
      error instanceof Error ? error.message : 'profile-fetch-threw';
  }

  console.info('[MARKETPLACE_AUTH]', {
    source: `${source}:enriched`,
    firebaseCurrentUserUid: firebaseUid,
    ownerUid,
    bootstrapAuthUid: syncSnapshot.bootstrapAuthUid,
    uidMismatch: {
      firebaseVsAccount: firebaseUid !== (syncSnapshot.appAuthUid as string | null),
      firebaseVsOwnerUid: ownerUid != null && firebaseUid !== ownerUid,
      firebaseVsBootstrap:
        syncSnapshot.bootstrapAuthUid != null &&
        firebaseUid !== syncSnapshot.bootstrapAuthUid,
    },
    profileExists,
    username,
    usernameSetupCompleted,
    profileFetchReason,
    marketplaceAccessResult: syncSnapshot.marketplaceAccessResult,
  });
}

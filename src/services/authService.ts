/**
 * Firebase Anonymous Auth + Google/Apple hesap bağlama.
 *
 * Auth hatası oyunu kilitlemez; local save ana kaynak olarak kalır.
 * Anonymous → linkWithCredential ile aynı UID korunur.
 *
 * App açılışında AsyncStorage'dan auth restore beklenir;
 * restore tamamlanmadan signInAnonymously çağrılmaz.
 *
 * V1: credential-already-in-use durumunda otomatik sign-in / merge yok.
 *
 * TODO (Faz 2 — hesap bağlama sonrası restore):
 * Google/Apple ile link sonrası o hesaba ait cloud save kontrol edilecek,
 * local ile karşılaştırılacak ve kullanıcıya sorulacak:
 *   “Bu cihazdaki kayıt” / “Buluttaki kayıt”
 * Bu fazda otomatik restore yapılmaz.
 *
 * App Store: iOS’ta Google veya başka 3. taraf login sunulursa
 * Apple ile Giriş de sunulmalıdır (Guideline 4.8).
 *
 * NOT: Native Google Sign-In Expo Go'da çalışmayabilir (development build gerekir).
 */

import {
  linkWithCredential,
  onAuthStateChanged,
  signInAnonymously,
  signInWithCredential,
  signOut,
  deleteUser,
  updateProfile,
  type Auth,
  type AuthCredential,
  type User,
} from 'firebase/auth';
import { Platform } from 'react-native';

import { loadGameFromCloud, markUserProviderLinked } from './cloudSaveService';
import {
  getFirebaseAppSafe,
  getFirebaseAuthSafe,
  getFirebaseInitDiagnostics,
  getMissingFirebaseConfigKeys,
  isFirebaseEnabled,
  resetFirebaseAuthCache,
} from './firebase';
import {
  captureFirebaseRuntimeConfigSnapshot,
  createFirebaseRuntimeMismatchFailure,
} from '../utils/firebaseRuntimeConfig';
import {
  EXPECTED_FIREBASE_PROJECT_ID,
  FIREBASE_RUNTIME_CONFIG_MISMATCH,
} from '../config/firebaseRuntimeContract';
import { clearGoogleSignInSession, createGoogleFirebaseCredential } from './googleAuthService';
import {
  getAppleAuthDiagnosticCode,
  isAppleExistingAccountConflictCode,
  isAppleProviderAlreadyLinkedCode,
  logAppleAuthFlow,
  normalizeAppleAuthFailure,
  resolveAppleLinkPlan,
  type AppleAuthFailure,
} from '../utils/appleAuthDiagnostics';
import {
  AUTH_INSTANCE_UNAVAILABLE,
  AUTH_NOT_READY,
  MIXED_FIREBASE_SDK_CREDENTIAL,
  createAuthReadinessLogPayload,
  isModularFirebaseAuthCredential,
  resolveAuthReadiness,
  type AuthReadinessSnapshot,
} from '../utils/authReadiness';
import {
  createLinkFlowDiagnosticId,
  logAppleLinkFlow,
  logCloudSaveAfterLink,
} from '../utils/accountLinkFlowLog';
import { reconcileLocalSaveOwnershipAfterAccountLink } from '../utils/cloudSaveOwnership';
import type { AccountLinkResolution } from '../utils/accountConnectionState';
import { devLog, devWarn } from '../utils/devLog';
import type { AccountLinkErrorKind } from '../utils/accountLinkErrors';

type AppleLinkProfile = {
  fullName: string | null;
  email: string | null;
};

export type AccountProvider = 'guest' | 'google' | 'apple' | 'unknown';

export type AccountStatus = {
  isAnonymous: boolean;
  provider: AccountProvider;
  uid: string | null;
  isReady: boolean;
};

export const DEFAULT_ACCOUNT_STATUS: AccountStatus = {
  isAnonymous: true,
  provider: 'guest',
  uid: null,
  isReady: false,
};

export interface AccountLinkResult {
  ok: boolean;
  error?: string;
  errorKind?: AccountLinkErrorKind;
  provider?: 'google' | 'apple';
  pendingCredential?: AuthCredential;
  appleFailure?: AppleAuthFailure;
  diagnosticCode?: string;
  cloudSyncOk?: boolean;
  uidPreserved?: boolean;
  resolution?: AccountLinkResolution;
  diagnosticId?: string;
}

export type AccountSwitchResult =
  | { ok: true }
  | {
      ok: false;
      error: string;
      revertedToGuest?: boolean;
      appleFailure?: AppleAuthFailure;
      diagnosticCode?: string;
    };

type AuthStateCallback = (user: User | null) => void;

const AUTH_RESTORE_TIMEOUT_MS = 8_000;

let initPromise: Promise<User | null> | null = null;
let initialAuthStatePromise: Promise<User | null> | null = null;
let authSessionReady = false;
let lastAnonymousAuthError: unknown = null;

function resolveAccountProvider(user: User): AccountProvider {
  if (user.isAnonymous) {
    return 'guest';
  }

  const providerIds = (user.providerData ?? []).map((entry) => entry.providerId);
  if (providerIds.some((id) => id === 'google.com' || id.includes('google'))) {
    return 'google';
  }
  if (providerIds.some((id) => id === 'apple.com' || id.includes('apple'))) {
    return 'apple';
  }

  return 'unknown';
}

function logRestoredUser(user: User): void {
  const provider = resolveAccountProvider(user);
  devLog('[auth] restored user', user.uid, {
    isAnonymous: user.isAnonymous,
    provider,
  });
  if (!user.isAnonymous && provider !== 'guest' && provider !== 'unknown') {
    devLog('[auth] provider', provider);
  }
}

function mapLinkErrorKind(error: unknown): AccountLinkErrorKind {
  if (!error || typeof error !== 'object') {
    return 'general';
  }

  const code =
    'code' in error && typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code
      : null;
  const message =
    'message' in error && typeof (error as { message?: unknown }).message === 'string'
      ? (error as { message: string }).message
      : error instanceof Error
        ? error.message
        : '';

  if (
    code === 'auth/credential-already-in-use' ||
    code === 'auth/email-already-in-use' ||
    message.includes('credential-already-in-use') ||
    message.includes('email-already-in-use')
  ) {
    return 'credential-already-in-use';
  }

  if (
    code === 'auth/account-exists-with-different-credential' ||
    message.includes('account-exists-with-different-credential')
  ) {
    return 'account-exists-with-different-credential';
  }

  if (code === 'auth/provider-already-linked' || message.includes('provider-already-linked')) {
    return 'provider-already-linked';
  }

  if (code === 'auth/operation-not-allowed' || message.includes('operation-not-allowed')) {
    return 'provider-not-enabled';
  }

  if (code === 'auth/cancelled-popup-request' || code === 'auth/popup-closed-by-user') {
    return 'cancelled';
  }

  return 'general';
}

function getAuthErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') {
    return null;
  }
  return 'code' in error && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : null;
}

function isAppleCredentialReuseError(error: unknown): boolean {
  const code = getAuthErrorCode(error);
  return (
    code === 'auth/invalid-credential' ||
    code === 'auth/user-token-expired' ||
    code === 'auth/invalid-custom-token'
  );
}

async function signInWithProviderCredential(
  credential: AuthCredential,
  provider: 'google' | 'apple',
): Promise<User> {
  const auth = getFirebaseAuthSafe();
  if (!auth) {
    const error = new Error(AUTH_INSTANCE_UNAVAILABLE) as Error & { code: string };
    error.code = AUTH_INSTANCE_UNAVAILABLE;
    throw error;
  }

  try {
    const result = await signInWithCredential(auth, credential);
    return result.user;
  } catch (error) {
    if (provider !== 'apple' || !isAppleCredentialReuseError(error)) {
      throw error;
    }

    if (__DEV__) {
      devWarn('[auth] Apple pending credential invalid — requesting fresh sign-in');
    }

    const { signInWithAppleAccount } = await import('./appleAuthService');
    const freshResult = await signInWithAppleAccount();
    if (!freshResult.ok) {
      throw new Error(freshResult.error);
    }

    const retryResult = await signInWithCredential(auth, freshResult.credential);
    return retryResult.user;
  }
}

function mapLinkError(error: unknown): string {
  const kind = mapLinkErrorKind(error);
  if (kind === 'credential-already-in-use') {
    return 'credential-already-in-use';
  }
  if (kind === 'account-exists-with-different-credential') {
    return 'account-exists-with-different-credential';
  }
  if (kind === 'provider-already-linked') {
    return 'provider-already-linked';
  }
  if (kind === 'provider-not-enabled') {
    return 'provider-not-enabled';
  }
  if (kind === 'cancelled') {
    return 'cancelled';
  }

  if (!error || typeof error !== 'object') {
    return error instanceof Error ? error.message : 'link-failed';
  }

  const code =
    'code' in error && typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code
      : null;
  const message =
    'message' in error && typeof (error as { message?: unknown }).message === 'string'
      ? (error as { message: string }).message
      : error instanceof Error
        ? error.message
        : 'link-failed';

  if (code === 'auth/network-request-failed') {
    return 'auth/network-request-failed';
  }
  if (code === 'auth/internal-error') {
    return 'auth/internal-error';
  }

  return code ?? message;
}

/**
 * Firebase Auth'un AsyncStorage'dan ilk state'ini bekler.
 * onAuthStateChanged ilk callback persistence restore sonrası gelir.
 */
export function waitForInitialAuthState(): Promise<User | null> {
  if (initialAuthStatePromise) {
    return initialAuthStatePromise;
  }

  initialAuthStatePromise = new Promise((resolve) => {
    const auth = getFirebaseAuthSafe();
    if (!auth) {
      resolve(null);
      return;
    }

    let settled = false;

    const finish = (user: User | null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      unsubscribe();
      resolve(user);
    };

    const timeoutId = setTimeout(() => {
      console.warn('[auth] initial auth state timeout — using currentUser if any');
      finish(auth.currentUser);
    }, AUTH_RESTORE_TIMEOUT_MS);

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      finish(user ?? null);
    });
  });

  return initialAuthStatePromise;
}

export function isAuthSessionReady(): boolean {
  return authSessionReady;
}

async function ensureAuthenticatedUser(): Promise<User | null> {
  return initAnonymousAuth();
}

function captureAuthReadinessSnapshot(): AuthReadinessSnapshot {
  const app = getFirebaseAppSafe();
  const auth = getFirebaseAuthSafe();
  const user = auth?.currentUser ?? null;
  return {
    hasFirebaseApp: Boolean(app),
    hasAuthInstance: Boolean(auth),
    hasCurrentUser: Boolean(user),
    currentUserAnonymous: user ? Boolean(user.isAnonymous) : null,
    providerIds: (user?.providerData ?? []).map((entry) => entry.providerId),
    authAppName: auth?.app.name ?? null,
    authProjectId: auth?.app.options.projectId ?? null,
  };
}

function failureFromReadinessDecision(
  decision: ReturnType<typeof resolveAuthReadiness>,
  snapshot: AuthReadinessSnapshot,
): AppleAuthFailure {
  if (decision.stage === 'config-validation') {
    return createFirebaseRuntimeMismatchFailure();
  }
  return {
    stage: 'auth-readiness',
    code: decision.code,
    message: decision.message ?? undefined,
    firebaseCode: decision.firebaseCode ?? undefined,
    recoverable: decision.code !== AUTH_INSTANCE_UNAVAILABLE,
    projectId: snapshot.authProjectId,
  };
}

export type FirebaseAuthReadyResult =
  | { ok: true; auth: Auth; user: User; snapshot: AuthReadinessSnapshot }
  | { ok: false; failure: AppleAuthFailure; snapshot: AuthReadinessSnapshot };

export async function ensureFirebaseAuthReady(): Promise<FirebaseAuthReadyResult> {
  const runtime = captureFirebaseRuntimeConfigSnapshot();
  const init = getFirebaseInitDiagnostics();
  const preSnapshot = captureAuthReadinessSnapshot();
  console.warn('[auth-readiness]', createAuthReadinessLogPayload(preSnapshot));

  const preDecision = resolveAuthReadiness({
    firebaseEnabled: isFirebaseEnabled(),
    hasFirebaseApp: preSnapshot.hasFirebaseApp,
    hasAuthInstance: preSnapshot.hasAuthInstance,
    hasCurrentUser: preSnapshot.hasCurrentUser,
    currentUserAnonymous: preSnapshot.currentUserAnonymous,
    authStateResolved: authSessionReady,
    anonymousBootstrapCompleted: authSessionReady,
    projectMatches: runtime.projectMatches,
    bundleMatches: runtime.bundleMatches,
    appInitError: init.appInitError,
    authInitError: init.authInitError,
    anonymousAuthError: lastAnonymousAuthError,
    missingConfigKeys: getMissingFirebaseConfigKeys(),
  });

  if (
    preDecision.stage === 'config-validation' ||
    preDecision.code === 'FIREBASE_CONFIG_MISSING' ||
    preDecision.code === AUTH_INSTANCE_UNAVAILABLE ||
    preDecision.firebaseCode
  ) {
    if (!preDecision.ready && preDecision.code !== AUTH_NOT_READY) {
      const failure = failureFromReadinessDecision(preDecision, preSnapshot);
      logAppleAuthFlow({
        stage: failure.stage,
        result: 'failure',
        code: failure.code,
        firebaseCode: failure.firebaseCode ?? null,
        message: failure.message ?? null,
        firebaseProjectId: preSnapshot.authProjectId,
      });
      return { ok: false, failure, snapshot: preSnapshot };
    }
  }

  const user = await initAnonymousAuth();
  const snapshot = captureAuthReadinessSnapshot();
  console.warn('[auth-readiness]', createAuthReadinessLogPayload(snapshot));

  const decision = resolveAuthReadiness({
    firebaseEnabled: isFirebaseEnabled(),
    hasFirebaseApp: snapshot.hasFirebaseApp,
    hasAuthInstance: snapshot.hasAuthInstance,
    hasCurrentUser: Boolean(user) || snapshot.hasCurrentUser,
    currentUserAnonymous: user ? Boolean(user.isAnonymous) : snapshot.currentUserAnonymous,
    authStateResolved: true,
    anonymousBootstrapCompleted: true,
    projectMatches: runtime.projectMatches,
    bundleMatches: runtime.bundleMatches,
    appInitError: getFirebaseInitDiagnostics().appInitError,
    authInitError: getFirebaseInitDiagnostics().authInitError,
    anonymousAuthError: lastAnonymousAuthError,
    missingConfigKeys: getMissingFirebaseConfigKeys(),
  });

  if (!decision.ready || !user) {
    const auth = getFirebaseAuthSafe();
    const failure = failureFromReadinessDecision(decision, {
      ...snapshot,
      hasCurrentUser: Boolean(user),
      currentUserAnonymous: user ? Boolean(user.isAnonymous) : snapshot.currentUserAnonymous,
    });
    logAppleAuthFlow({
      stage: failure.stage,
      result: 'failure',
      code: failure.code,
      firebaseCode: failure.firebaseCode ?? null,
      message: failure.message ?? null,
      firebaseProjectId: auth?.app.options.projectId ?? snapshot.authProjectId,
    });
    return { ok: false, failure, snapshot };
  }

  const auth = getFirebaseAuthSafe();
  if (!auth) {
    const failure: AppleAuthFailure = {
      stage: 'auth-readiness',
      code: AUTH_INSTANCE_UNAVAILABLE,
      recoverable: false,
      projectId: snapshot.authProjectId,
    };
    return { ok: false, failure, snapshot };
  }

  return { ok: true, auth, user, snapshot };
}

async function applyCredentialToCurrentUser(
  credential: AuthCredential,
  provider?: 'google' | 'apple',
): Promise<
  | { ok: true; user: User }
  | {
      ok: false;
      error: string;
      errorKind?: AccountLinkErrorKind;
      pendingCredential?: AuthCredential;
      appleFailure?: AppleAuthFailure;
    }
> {
  if (!isModularFirebaseAuthCredential(credential)) {
    const appleFailure: AppleAuthFailure | undefined =
      provider === 'apple'
        ? {
            stage: 'anonymous-link-failure',
            code: MIXED_FIREBASE_SDK_CREDENTIAL,
            recoverable: false,
          }
        : undefined;
    return {
      ok: false,
      error: MIXED_FIREBASE_SDK_CREDENTIAL,
      errorKind: 'general',
      appleFailure,
    };
  }

  const auth = getFirebaseAuthSafe();
  if (!auth) {
    const appleFailure: AppleAuthFailure | undefined =
      provider === 'apple'
        ? {
            stage: 'auth-readiness',
            code: AUTH_INSTANCE_UNAVAILABLE,
            recoverable: false,
          }
        : undefined;
    return {
      ok: false,
      error: AUTH_INSTANCE_UNAVAILABLE,
      errorKind: 'general',
      appleFailure,
    };
  }

  const authProjectId = auth.app.options.projectId ?? null;
  if (provider === 'apple' && authProjectId !== EXPECTED_FIREBASE_PROJECT_ID) {
    const failure = createFirebaseRuntimeMismatchFailure();
    logAppleAuthFlow({
      stage: 'config-validation',
      result: 'failure',
      code: FIREBASE_RUNTIME_CONFIG_MISMATCH,
      firebaseProjectId: authProjectId,
    });
    return {
      ok: false,
      error: FIREBASE_RUNTIME_CONFIG_MISMATCH,
      errorKind: 'general',
      appleFailure: failure,
    };
  }

  const currentUser = await ensureAuthenticatedUser();
  if (!currentUser) {
    const preserved = lastAnonymousAuthError;
    const appleFailure: AppleAuthFailure | undefined =
      provider === 'apple'
        ? preserved
          ? normalizeAppleAuthFailure(preserved, 'auth-readiness')
          : {
              stage: 'auth-readiness',
              code: AUTH_NOT_READY,
              recoverable: true,
            }
        : undefined;
    return {
      ok: false,
      error: appleFailure?.firebaseCode || appleFailure?.code || AUTH_NOT_READY,
      errorKind: 'general',
      appleFailure,
    };
  }

  const providerIds = (currentUser.providerData ?? []).map((entry) => entry.providerId);
  if (provider === 'apple') {
    const plan = resolveAppleLinkPlan({
      isAnonymous: Boolean(currentUser.isAnonymous),
      providerIds,
    });
    if (plan === 'already-linked-success') {
      return { ok: true, user: currentUser };
    }
  } else if (!currentUser.isAnonymous) {
    const providerId = provider === 'google' ? 'google.com' : credential.providerId;
    const alreadyHasProvider = providerIds.some(
      (id) => id === providerId || (provider === 'google' && id.includes('google')),
    );
    if (alreadyHasProvider) {
      return { ok: true, user: currentUser };
    }
  }

  if (provider === 'apple') {
    logAppleAuthFlow({
      stage: 'anonymous-link-start',
      result: 'info',
      isAnonymous: Boolean(currentUser.isAnonymous),
      providerIds,
      firebaseProjectId: getFirebaseAppSafe()?.options.projectId ?? null,
    });
  }

  try {
    const result = await linkWithCredential(currentUser, credential);
    if (provider === 'apple') {
      logAppleAuthFlow({
        stage: 'anonymous-link-success',
        result: 'success',
        isAnonymous: false,
        providerIds: (result.user.providerData ?? []).map((entry) => entry.providerId),
        firebaseProjectId: getFirebaseAppSafe()?.options.projectId ?? null,
      });
    }
    return { ok: true, user: result.user };
  } catch (error) {
    const errorKind = mapLinkErrorKind(error);
    const mapped = mapLinkError(error);
    const firebaseCode = getAuthErrorCode(error);

    if (errorKind === 'provider-already-linked' || isAppleProviderAlreadyLinkedCode(firebaseCode)) {
      if (provider === 'apple') {
        logAppleAuthFlow({
          stage: 'anonymous-link-success',
          result: 'success',
          code: 'auth/provider-already-linked',
          firebaseCode: 'auth/provider-already-linked',
          isAnonymous: Boolean(currentUser.isAnonymous),
          providerIds,
          firebaseProjectId: getFirebaseAppSafe()?.options.projectId ?? null,
        });
      }
      return { ok: true, user: currentUser };
    }

    const isConflict =
      errorKind === 'credential-already-in-use' ||
      errorKind === 'account-exists-with-different-credential' ||
      isAppleExistingAccountConflictCode(firebaseCode) ||
      isAppleExistingAccountConflictCode(mapped);

    const appleFailure =
      provider === 'apple'
        ? normalizeAppleAuthFailure(error, isConflict ? 'cloud-conflict' : 'anonymous-link-failure', {
            firebaseCode,
          })
        : undefined;

    if (provider === 'apple') {
      logAppleAuthFlow({
        stage: isConflict ? 'cloud-conflict' : 'anonymous-link-failure',
        result: 'failure',
        name: appleFailure?.name ?? null,
        code: appleFailure?.code ?? mapped,
        message: appleFailure?.message ?? null,
        nativeCode: appleFailure?.nativeCode ?? null,
        firebaseCode: appleFailure?.firebaseCode ?? firebaseCode,
        domain: appleFailure?.domain ?? null,
        normalizedCode: appleFailure ? getAppleAuthDiagnosticCode(appleFailure) : mapped,
        isAnonymous: Boolean(currentUser.isAnonymous),
        providerIds,
        firebaseProjectId: getFirebaseAppSafe()?.options.projectId ?? null,
      });
    }

    if (isConflict) {
      return {
        ok: false,
        error: mapped,
        errorKind:
          errorKind === 'account-exists-with-different-credential'
            ? 'account-exists-with-different-credential'
            : 'credential-already-in-use',
        // Apple credential tek kullanımlık olabilir; failed link sonrası cache'leme.
        pendingCredential: provider === 'apple' ? undefined : credential,
        appleFailure,
      };
    }

    return { ok: false, error: mapped, errorKind, appleFailure };
  }
}

async function restoreGuestAnonymousSession(): Promise<void> {
  const auth = getFirebaseAuthSafe();
  if (auth) {
    try {
      await signOut(auth);
    } catch (error) {
      if (__DEV__) {
        console.warn('[auth] signOut during guest restore failed', error);
      }
    }
  }

  initPromise = null;
  initialAuthStatePromise = null;
  authSessionReady = false;
  resetFirebaseAuthCache();
  await initAnonymousAuth();
}

async function applyAppleFirstLoginProfile(
  user: User,
  profile: AppleLinkProfile | undefined,
): Promise<void> {
  const nextName =
    typeof profile?.fullName === 'string' && profile.fullName.trim().length > 0
      ? profile.fullName.trim()
      : null;
  const nextEmail =
    typeof profile?.email === 'string' && profile.email.trim().length > 0
      ? profile.email.trim()
      : null;

  // Sonraki girişlerde null gelen name mevcut displayName'i ezmez
  if (nextName && !user.displayName?.trim()) {
    try {
      await updateProfile(user, { displayName: nextName });
    } catch (error) {
      console.warn('[auth] Apple displayName update failed', error);
    }
  }

  try {
    await markUserProviderLinked(user.uid, 'apple', {
      displayName: nextName ?? user.displayName ?? null,
      email: nextEmail ?? user.email ?? null,
    });
  } catch (error) {
    console.warn('[auth] Apple profile meta update failed', error);
  }
}

async function waitForCanonicalAuthState(input: {
  uid: string;
  anonymous: boolean;
  providerId: 'apple.com' | 'google.com';
  timeoutMs?: number;
}): Promise<{ ok: boolean; user: User | null }> {
  const timeoutMs = input.timeoutMs ?? 4_000;
  const auth = getFirebaseAuthSafe();
  if (!auth) {
    return { ok: false, user: null };
  }

  const matches = (user: User | null): boolean => {
    if (!user) return false;
    if (user.uid !== input.uid) return false;
    if (Boolean(user.isAnonymous) !== input.anonymous) return false;
    const ids = (user.providerData ?? []).map((entry) => entry.providerId);
    if (!input.anonymous && !ids.some((id) => id === input.providerId || id.includes(input.providerId.split('.')[0]))) {
      // Provider list may lag briefly after link; accept non-anonymous same uid.
      return !user.isAnonymous;
    }
    return true;
  };

  if (matches(auth.currentUser)) {
    return { ok: true, user: auth.currentUser };
  }

  return await new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean, user: User | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsub();
      resolve({ ok, user });
    };

    const unsub = onAuthStateChanged(auth, (user) => {
      if (matches(user)) {
        finish(true, user);
      }
    });

    const timer = setTimeout(() => {
      const fallback = auth.currentUser;
      finish(matches(fallback), fallback);
    }, timeoutMs);
  });
}

async function finalizeAccountLink(
  provider: 'google' | 'apple',
  user: User,
  appleProfile?: AppleLinkProfile,
  options?: {
    previousUid?: string | null;
    previousAnonymous?: boolean;
    diagnosticId?: string;
  },
): Promise<{ cloudSyncOk: boolean; diagnosticId: string }> {
  const diagnosticId = options?.diagnosticId ?? createLinkFlowDiagnosticId(provider);
  const providerId = provider === 'apple' ? 'apple.com' : 'google.com';
  const previousUid = options?.previousUid ?? null;
  const uidPreserved = Boolean(previousUid && previousUid === user.uid);

  devLog('[auth] account linked with', provider, user.uid);

  logAppleLinkFlow({
    stage: 'firebase-link-success',
    previousUidPresent: Boolean(previousUid),
    resultingUidPresent: true,
    uidPreserved,
    previousUserAnonymous: options?.previousAnonymous ?? null,
    resultingUserAnonymous: Boolean(user.isAnonymous),
    providerIds: (user.providerData ?? []).map((entry) => entry.providerId),
    appleProviderLinked:
      provider === 'apple' &&
      (user.providerData ?? []).some((entry) => entry.providerId === 'apple.com'),
    diagnosticId,
  });

  try {
    await user.getIdToken(true);
    logAppleLinkFlow({
      stage: 'token-refresh',
      resultingUidPresent: true,
      resultingUserAnonymous: Boolean(user.isAnonymous),
      providerIds: (user.providerData ?? []).map((entry) => entry.providerId),
      diagnosticId,
    });
  } catch (error) {
    console.warn('[auth] force token refresh after link failed', error);
  }

  const waited = await waitForCanonicalAuthState({
    uid: user.uid,
    anonymous: false,
    providerId,
  });
  const canonicalUser = waited.user ?? user;

  const ownership = reconcileLocalSaveOwnershipAfterAccountLink({
    previousUid,
    currentUid: canonicalUser.uid,
    localOwnerUid: previousUid,
    providerId,
  });
  logAppleLinkFlow({
    stage: 'owner-reconcile',
    previousUidPresent: Boolean(previousUid),
    resultingUidPresent: true,
    uidPreserved,
    diagnosticId,
  });

  if (ownership.result === 'conflict') {
    logCloudSaveAfterLink({
      stage: 'write-failed',
      trigger: provider === 'apple' ? 'account-link-apple' : 'account-link-google',
      ownerMatchesAuth: false,
      firebaseErrorCode: 'owner-mismatch',
      diagnosticId,
    });
    return { cloudSyncOk: false, diagnosticId };
  }

  if (provider === 'apple') {
    logAppleLinkFlow({ stage: 'profile-write', diagnosticId });
    await applyAppleFirstLoginProfile(canonicalUser, appleProfile);
  } else {
    try {
      await markUserProviderLinked(canonicalUser.uid, provider);
    } catch (error) {
      console.warn('[auth] markUserProviderLinked failed', error);
    }
  }

  try {
    const [{ syncLocalSaveToCloud }, { useGameStore }] = await Promise.all([
      import('../storage/cloudSaveSync'),
      import('../store/gameStore'),
    ]);
    const state = useGameStore.getState();
    logCloudSaveAfterLink({
      stage: 'trigger',
      trigger: provider === 'apple' ? 'account-link-apple' : 'account-link-google',
      authReady: true,
      authUidPresent: true,
      authUserAnonymous: Boolean(canonicalUser.isAnonymous),
      providerIds: (canonicalUser.providerData ?? []).map((entry) => entry.providerId),
      localOwnerUidPresent: Boolean(previousUid),
      ownerMatchesAuth: ownership.resolvedOwnerUid === canonicalUser.uid,
      diagnosticId,
    });
    const synced = await syncLocalSaveToCloud(
      provider === 'apple' ? 'account-link-apple' : 'account-link-google',
      {
        force: true,
        state,
        diagnosticId,
        previousUid,
        localOwnerUid: previousUid,
      },
    );
    if (!synced) {
      console.warn('[auth] cloud sync after account_link failed (link still ok)');
    }
    return { cloudSyncOk: synced, diagnosticId };
  } catch (error) {
    console.warn('[auth] cloud sync after account_link failed', error);
    return { cloudSyncOk: false, diagnosticId };
  }
}

export function getAccountStatus(): AccountStatus {
  try {
    const auth = getFirebaseAuthSafe();

    if (!authSessionReady) {
      const earlyUser = auth?.currentUser;
      if (!earlyUser) {
        return { ...DEFAULT_ACCOUNT_STATUS, isReady: false };
      }
      return {
        isAnonymous: Boolean(earlyUser.isAnonymous),
        provider: resolveAccountProvider(earlyUser),
        uid: earlyUser.uid ?? null,
        isReady: true,
      };
    }

    if (!auth) {
      return { ...DEFAULT_ACCOUNT_STATUS, isReady: true };
    }

    const user = auth.currentUser;
    if (!user) {
      return {
        isAnonymous: true,
        provider: 'guest',
        uid: null,
        isReady: true,
      };
    }

    return {
      isAnonymous: Boolean(user.isAnonymous),
      provider: resolveAccountProvider(user),
      uid: user.uid ?? null,
      isReady: true,
    };
  } catch (error) {
    console.warn('[auth] getAccountStatus failed', error);
    return { ...DEFAULT_ACCOUNT_STATUS, isReady: authSessionReady };
  }
}

export function getCurrentUserId(): string | null {
  try {
    const auth = getFirebaseAuthSafe();
    return auth?.currentUser?.uid ?? null;
  } catch {
    return null;
  }
}

export function subscribeAuthState(callback: AuthStateCallback): () => void {
  try {
    const auth = getFirebaseAuthSafe();
    if (!auth) {
      callback(null);
      return () => {};
    }

    return onAuthStateChanged(auth, (user) => {
      callback(user ?? null);
    });
  } catch (error) {
    console.warn('[auth] subscribeAuthState failed', error);
    callback(null);
    return () => {};
  }
}

export function resetAuthService(): void {
  initPromise = null;
  initialAuthStatePromise = null;
  authSessionReady = false;
  lastAnonymousAuthError = null;
  resetFirebaseAuthCache();
}

/**
 * Auth oturumunu başlatır: önce persistence restore, yoksa anonymous sign-in.
 */
export async function initAnonymousAuth(): Promise<User | null> {
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    const auth = getFirebaseAuthSafe();
    if (!auth) {
      console.warn('[auth] unavailable, using local save only');
      authSessionReady = true;
      initPromise = null;
      return null;
    }

    const restoredUser = await waitForInitialAuthState();

    if (restoredUser) {
      lastAnonymousAuthError = null;
      logRestoredUser(restoredUser);
      authSessionReady = true;
      return restoredUser;
    }

    try {
      devLog('[auth] no restored user, signing in anonymously');
      const credential = await signInAnonymously(auth);
      lastAnonymousAuthError = null;
      devLog('[auth] anonymous user ready', credential.user.uid);
      authSessionReady = true;
      return credential.user;
    } catch (error) {
      lastAnonymousAuthError = error;
      console.warn('[auth] anonymous sign-in failed', {
        code:
          error && typeof error === 'object' && 'code' in error
            ? (error as { code?: unknown }).code
            : null,
        name: error instanceof Error ? error.name : null,
      });
      authSessionReady = true;
      initPromise = null;
      return null;
    }
  })();

  return initPromise;
}

/**
 * Anonymous hesabı Google’a bağlar; mümkünse mevcut uid korunur.
 * credential-already-in-use: otomatik sign-in / local overwrite yapılmaz.
 */
export async function linkAnonymousAccountWithGoogle(): Promise<AccountLinkResult> {
  void Platform.OS;

  try {
    const googleResult = await createGoogleFirebaseCredential();
    if (!googleResult.ok) {
      return { ok: false, error: googleResult.error };
    }

    const uidBefore = getCurrentUserId();
    const linkResult = await applyCredentialToCurrentUser(googleResult.credential, 'google');
    if (!linkResult.ok) {
      return {
        ok: false,
        error: linkResult.error,
        errorKind: linkResult.errorKind,
        pendingCredential: linkResult.pendingCredential,
      };
    }

    const uidAfter = linkResult.user.uid;
    if (uidBefore && uidAfter !== uidBefore) {
      devWarn('[auth] UID changed during Google link', { uidBefore, uidAfter });
    } else {
      devLog('[auth] Google account linked, UID preserved', uidAfter);
    }

    const googleFinalize = await finalizeAccountLink('google', linkResult.user, undefined, {
      previousUid: uidBefore,
      previousAnonymous: true,
    });
    return {
      ok: true,
      provider: 'google',
      uidPreserved: Boolean(uidBefore && uidBefore === linkResult.user.uid),
      cloudSyncOk: googleFinalize.cloudSyncOk,
      resolution: 'uid-preserved-link',
      diagnosticId: googleFinalize.diagnosticId,
    };
  } catch (error) {
    const mapped = mapLinkError(error);
    console.warn('[auth] linkAnonymousAccountWithGoogle failed', mapped);
    return { ok: false, error: mapped, errorKind: mapLinkErrorKind(error) };
  }
}

/**
 * Anonymous hesabı Apple’a bağlar; mümkünse mevcut uid korunur.
 * iOS’ta Google veya başka 3. taraf login sunulursa Apple da sunulmalıdır.
 */
export async function linkAnonymousAccountWithApple(): Promise<AccountLinkResult> {
  if (Platform.OS !== 'ios') {
    return { ok: false, error: 'apple-not-supported' };
  }

  try {
    const ready = await ensureFirebaseAuthReady();
    if (!ready.ok) {
      return {
        ok: false,
        error: ready.failure.code,
        errorKind: 'general',
        provider: 'apple',
        appleFailure: ready.failure,
        diagnosticCode: getAppleAuthDiagnosticCode(ready.failure),
      };
    }

    const { linkWithAppleAccount } = await import('./appleAuthService');
    const appleResult = await linkWithAppleAccount();
    if (!appleResult.ok) {
      return {
        ok: false,
        error: appleResult.error,
        errorKind: appleResult.error === 'cancelled' ? 'cancelled' : 'general',
        provider: 'apple',
        appleFailure: appleResult.failure,
        diagnosticCode: getAppleAuthDiagnosticCode(appleResult.failure),
      };
    }

    const uidBefore = getCurrentUserId();
    const previousUser = getFirebaseAuthSafe()?.currentUser ?? null;
    const previousAnonymous = previousUser ? Boolean(previousUser.isAnonymous) : null;
    const diagnosticId = createLinkFlowDiagnosticId('apple');

    logAppleLinkFlow({
      stage: 'firebase-link-start',
      previousUidPresent: Boolean(uidBefore),
      previousUserAnonymous: previousAnonymous,
      hasIdentityToken: true,
      hasRawNonce: true,
      diagnosticId,
    });

    const linkResult = await applyCredentialToCurrentUser(appleResult.credential, 'apple');
    if (!linkResult.ok) {
      const appleFailure =
        linkResult.appleFailure ??
        normalizeAppleAuthFailure(
          { code: linkResult.error, message: linkResult.error },
          isAppleExistingAccountConflictCode(linkResult.error)
            ? 'cloud-conflict'
            : 'anonymous-link-failure',
          {
            code: linkResult.error,
            firebaseCode: linkResult.error?.startsWith('auth/') ? linkResult.error : null,
          },
        );
      logAppleLinkFlow({
        stage: 'link-failed',
        previousUidPresent: Boolean(uidBefore),
        firebaseErrorCode: appleFailure.firebaseCode ?? linkResult.error,
        nativeErrorCode: appleFailure.nativeCode ?? null,
        diagnosticId,
      });
      return {
        ok: false,
        error: linkResult.error,
        errorKind: linkResult.errorKind,
        pendingCredential: linkResult.pendingCredential,
        provider: 'apple',
        appleFailure,
        diagnosticCode: getAppleAuthDiagnosticCode(appleFailure),
        resolution:
          linkResult.errorKind === 'credential-already-in-use' ||
          linkResult.errorKind === 'account-exists-with-different-credential'
            ? 'existing-apple-account'
            : 'failed',
        diagnosticId,
      };
    }

    const uidAfter = linkResult.user.uid;
    const uidPreserved = Boolean(uidBefore && uidAfter === uidBefore);
    if (uidBefore && uidAfter !== uidBefore) {
      devWarn('[auth] UID changed during Apple link', { uidBefore, uidAfter });
    } else {
      devLog('[auth] Apple account linked, UID preserved', uidAfter);
    }

    let cloudSyncOk = false;
    try {
      const finalize = await finalizeAccountLink('apple', linkResult.user, appleResult.profile, {
        previousUid: uidBefore,
        previousAnonymous: previousAnonymous ?? true,
        diagnosticId,
      });
      cloudSyncOk = finalize.cloudSyncOk;
      logAppleAuthFlow({
        stage: 'profile-update',
        result: 'success',
        isAnonymous: false,
        providerIds: (linkResult.user.providerData ?? []).map((entry) => entry.providerId),
        firebaseProjectId: getFirebaseAppSafe()?.options.projectId ?? null,
      });
    } catch (error) {
      const failure = normalizeAppleAuthFailure(error, 'profile-update');
      logAppleAuthFlow({
        stage: 'profile-update',
        result: 'failure',
        name: failure.name ?? null,
        code: failure.code,
        message: failure.message ?? null,
        normalizedCode: getAppleAuthDiagnosticCode(failure),
        firebaseCode: failure.firebaseCode ?? null,
        isAnonymous: false,
        providerIds: (linkResult.user.providerData ?? []).map((entry) => entry.providerId),
        firebaseProjectId: getFirebaseAppSafe()?.options.projectId ?? null,
      });
      console.warn('[auth] Apple profile finalize failed after successful auth', error);
    }

    return {
      ok: true,
      provider: 'apple',
      cloudSyncOk,
      uidPreserved,
      resolution: 'uid-preserved-link',
      diagnosticId,
    };
  } catch (error) {
    const mapped = mapLinkError(error);
    const appleFailure = normalizeAppleAuthFailure(error, 'anonymous-link-failure', {
      firebaseCode: getAuthErrorCode(error),
    });
    console.warn('[auth] linkAnonymousAccountWithApple failed', {
      code: appleFailure.code,
      firebaseCode: appleFailure.firebaseCode ?? null,
      nativeCode: appleFailure.nativeCode ?? null,
      stage: appleFailure.stage,
    });
    return {
      ok: false,
      error: mapped,
      errorKind: mapLinkErrorKind(error),
      provider: 'apple',
      appleFailure,
      diagnosticCode: getAppleAuthDiagnosticCode(appleFailure),
    };
  }
}

/**
 * Misafir kaydı birleştirmeden mevcut Google/Apple hesabına geçiş.
 * Onay sonrası çağrılır; bulut kaydı yoksa misafir oturumuna geri döner.
 */
export async function switchToLinkedProviderAccount(
  credential: AuthCredential | null,
  provider: 'google' | 'apple',
): Promise<AccountSwitchResult> {
  const ready = await ensureFirebaseAuthReady();
  if (!ready.ok) {
    return {
      ok: false,
      error: ready.failure.code,
      appleFailure: ready.failure,
      diagnosticCode: getAppleAuthDiagnosticCode(ready.failure),
    };
  }

  let signedIn = false;

  try {
    let activeCredential = credential;

    if (provider === 'apple') {
      logAppleAuthFlow({
        stage: 'existing-account-signin-start',
        result: 'info',
        firebaseProjectId: getFirebaseAppSafe()?.options.projectId ?? null,
      });
      const { signInWithAppleAccount } = await import('./appleAuthService');
      const freshResult = await signInWithAppleAccount();
      if (!freshResult.ok) {
        return {
          ok: false,
          error: freshResult.error,
          revertedToGuest: false,
          appleFailure: freshResult.failure,
          diagnosticCode: getAppleAuthDiagnosticCode(freshResult.failure),
        };
      }
      activeCredential = freshResult.credential;
    }

    if (!activeCredential) {
      return { ok: false, error: 'missing-credential', revertedToGuest: false };
    }

    const user = await signInWithProviderCredential(activeCredential, provider);
    signedIn = true;
    if (provider === 'apple') {
      logAppleAuthFlow({
        stage: 'existing-account-signin-success',
        result: 'success',
        isAnonymous: false,
        providerIds: (user.providerData ?? []).map((entry) => entry.providerId),
        firebaseProjectId: getFirebaseAppSafe()?.options.projectId ?? null,
      });
    }
    initPromise = Promise.resolve(user);
    authSessionReady = true;

    if (__DEV__) {
      devLog('[auth] switched to linked account', user.uid, provider);
    }

    const cloudPayload = await loadGameFromCloud(user.uid);
    if (!cloudPayload?.gameState) {
      await restoreGuestAnonymousSession();
      return { ok: false, error: 'no-cloud-save', revertedToGuest: true };
    }

    const { payloadToStoreState, saveGameState } = await import('../storage/saveGame');
    const { useGameStore } = await import('../store/gameStore');
    const restoredState = payloadToStoreState(cloudPayload.gameState);
    const saved = await saveGameState(restoredState);
    if (!saved) {
      await restoreGuestAnonymousSession();
      return { ok: false, error: 'local-save-failed', revertedToGuest: true };
    }

    const loaded = await useGameStore.getState().loadGame();
    if (!loaded) {
      await restoreGuestAnonymousSession();
      return { ok: false, error: 'load-failed', revertedToGuest: true };
    }

    try {
      await markUserProviderLinked(user.uid, provider);
    } catch (error) {
      console.warn('[auth] markUserProviderLinked after account switch failed', error);
    }

    try {
      const { initCloudSaveSync } = await import('../storage/cloudSaveSync');
      await initCloudSaveSync(() => useGameStore.getState());
    } catch (error) {
      console.warn('[auth] cloud sync refresh after account switch failed', error);
    }

    return { ok: true };
  } catch (error) {
    const mapped = mapLinkError(error);
    const appleFailure =
      provider === 'apple'
        ? normalizeAppleAuthFailure(error, 'firebase-signin', {
            firebaseCode: getAuthErrorCode(error),
          })
        : undefined;
    console.warn('[auth] switchToLinkedProviderAccount failed', mapped);
    if (signedIn) {
      await restoreGuestAnonymousSession();
      return {
        ok: false,
        error: mapped,
        revertedToGuest: true,
        appleFailure,
        diagnosticCode: appleFailure ? getAppleAuthDiagnosticCode(appleFailure) : undefined,
      };
    }
    return {
      ok: false,
      error: mapped,
      revertedToGuest: false,
      appleFailure,
      diagnosticCode: appleFailure ? getAppleAuthDiagnosticCode(appleFailure) : undefined,
    };
  }
}

export async function retryProviderAccountLink(
  provider: 'google' | 'apple',
): Promise<AccountLinkResult> {
  if (provider === 'google') {
    await clearGoogleSignInSession();
    return linkAnonymousAccountWithGoogle();
  }
  const { clearAppleSignInSession } = await import('./appleAuthService');
  await clearAppleSignInSession();
  return linkAnonymousAccountWithApple();
}

export async function deleteCurrentFirebaseUser(): Promise<void> {
  const auth = getFirebaseAuthSafe();
  const user = auth?.currentUser;
  if (!user) {
    return;
  }

  try {
    await deleteUser(user);
    resetAuthService();
  } catch (error) {
    console.warn('[auth] deleteCurrentFirebaseUser failed', error);
    throw error;
  }
}

export function getAuthDeleteErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') {
    return null;
  }

  const code =
    'code' in error && typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code
      : null;

  if (code === 'auth/requires-recent-login') {
    return 'requires-recent-login';
  }

  return code;
}

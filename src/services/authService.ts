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
  updateProfile,
  deleteUser,
  type AuthCredential,
  type User,
} from 'firebase/auth';
import { Platform } from 'react-native';

import {
  loadGameFromCloudDetailed,
  markUserProviderLinked,
} from './cloudSaveService';
import {
  recordAnonymousSignInResult,
  recordGoogleSignInResult,
  resolveCurrentUserKind,
  setBackendDiagnosticsMeta,
} from './backendDiagnostics';
import { getFirebaseAuthSafe } from './firebase';
import {
  clearGoogleSignInSession,
  clearGoogleSignInSessionStrict,
  createGoogleFirebaseCredential,
} from './googleAuthService';
import { devLog, devWarn } from '../utils/devLog';
import type { AccountLinkErrorKind } from '../utils/accountLinkErrors';
import {
  CloudSaveConflictError,
  executeAtomicCloudSaveRestore,
  validateCloudSaveRestorePayload,
  type CloudSaveConflictReason,
} from '../utils/cloudSaveConflict';
import { SAVE_GAME_VERSION } from '../storage/saveGame';
import {
  beginCloudRestoreJournal,
  completeCloudRestoreJournal,
  hasCloudRestoreReceipt,
} from '../storage/cloudRestoreJournal';
import { isLocalSaveSafeForAccountTransition } from '../utils/accountTransition';

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
}

export type AccountSwitchResult =
  | { ok: true; selectedAccountUid: string }
  | {
      ok: false;
      error: CloudSaveConflictReason;
      revertedToGuest?: boolean;
      selectedAccountUid?: string;
    };

export type AccountTransitionError =
  | 'cloud-sync-failed'
  | 'sign-out-failed'
  | 'google-disconnect-failed'
  | 'account-picker-cancelled'
  | 'auth-required'
  | 'marketplace-operation-active'
  | 'network-error'
  | 'unknown';

export type GoogleAccountSelectionResult =
  | {
      ok: true;
      credential: AuthCredential;
      selectedAccountUid: string;
      hasCloudSave: boolean;
    }
  | { ok: false; error: AccountTransitionError };

export type AccountSwitchTransitionState =
  | 'idle'
  | 'syncing-current-save'
  | 'opening-account-picker'
  | 'authenticating-new-account'
  | 'checking-cloud-save'
  | 'resolving-conflict'
  | 'completed'
  | 'failed';

type AuthStateCallback = (user: User | null) => void;

export type AuthLifecycleState =
  | 'idle'
  | 'initializing'
  | 'anonymous'
  | 'authenticated'
  | 'switching-account'
  | 'linking-provider'
  | 'checking-cloud-save'
  | 'resolving-conflict'
  | 'signing-out'
  | 'failed';

type AuthListenerHub = {
  auth: ReturnType<typeof getFirebaseAuthSafe>;
  callbacks: Set<AuthStateCallback>;
  unsubscribe: (() => void) | null;
  lastUser: User | null;
  initialized: boolean;
};

const AUTH_LISTENER_GLOBAL_KEY = '__logisticoreAuthListenerHub';
type AuthListenerGlobal = typeof globalThis & {
  [AUTH_LISTENER_GLOBAL_KEY]?: AuthListenerHub;
};

const AUTH_RESTORE_TIMEOUT_MS = 8_000;
const ACCOUNT_SWITCH_TIMEOUT_MS = 15_000;

let initPromise: Promise<User | null> | null = null;
let initialAuthStatePromise: Promise<User | null> | null = null;
let authSessionReady = false;
let authLifecycleState: AuthLifecycleState = 'idle';
let accountSwitchTransitionState: AccountSwitchTransitionState = 'idle';

function setAccountSwitchTransitionState(
  nextState: AccountSwitchTransitionState,
  transitionReason: string,
): void {
  const previousState = accountSwitchTransitionState;
  accountSwitchTransitionState = nextState;
  if (__DEV__) {
    const user = getFirebaseAuthSafe()?.currentUser;
    devLog('[auth-state-transition]', {
      previousState,
      nextState,
      hasUser: Boolean(user),
      isAnonymous: Boolean(user?.isAnonymous),
      providerIds: (user?.providerData ?? []).map((entry) => entry.providerId),
      transitionReason,
    });
  }
}

export function getAccountSwitchTransitionState(): AccountSwitchTransitionState {
  return accountSwitchTransitionState;
}

export function markAccountSwitchSyncing(): void {
  setAccountSwitchTransitionState('syncing-current-save', 'manual-cloud-sync');
}

export function markAccountSwitchResolvingConflict(): void {
  setAccountSwitchTransitionState('resolving-conflict', 'cloud-save-conflict');
}

export function resetAccountSwitchTransition(): void {
  setAccountSwitchTransitionState('idle', 'transition-finished');
}

function setAuthLifecycleState(nextState: AuthLifecycleState, reason: string): void {
  const previousState = authLifecycleState;
  authLifecycleState = nextState;
  if (__DEV__) {
    const user = getFirebaseAuthSafe()?.currentUser;
    devLog('[auth-state-transition]', {
      previousState,
      nextState,
      hasUser: Boolean(user),
      isAnonymous: Boolean(user?.isAnonymous),
      providerIds: (user?.providerData ?? []).map((entry) => entry.providerId),
      transitionReason: reason,
    });
  }
}

export function getAuthLifecycleState(): AuthLifecycleState {
  return authLifecycleState;
}

function getOrCreateAuthListenerHub(): AuthListenerHub | null {
  const auth = getFirebaseAuthSafe();
  if (!auth) return null;
  const globalStore = globalThis as AuthListenerGlobal;
  const existing = globalStore[AUTH_LISTENER_GLOBAL_KEY];
  if (existing?.auth === auth && existing.unsubscribe) {
    if (existing.initialized) authSessionReady = true;
    return existing;
  }
  existing?.unsubscribe?.();
  const hub: AuthListenerHub = {
    auth,
    callbacks: existing?.callbacks ?? new Set<AuthStateCallback>(),
    unsubscribe: null,
    lastUser: auth.currentUser,
    initialized: false,
  };
  hub.unsubscribe = onAuthStateChanged(auth, (user) => {
    hub.lastUser = user ?? null;
    hub.initialized = true;
    authSessionReady = true;
    setAuthLifecycleState(
      user?.isAnonymous ? 'anonymous' : user ? 'authenticated' : 'idle',
      'firebase-auth-listener',
    );
    for (const callback of [...hub.callbacks]) callback(user ?? null);
  });
  globalStore[AUTH_LISTENER_GLOBAL_KEY] = hub;
  return hub;
}

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

const ANONYMOUS_AUTH_BLOCKER_CODES = new Set([
  'auth/operation-not-allowed',
  'auth/network-request-failed',
  'auth/app-not-authorized',
  'auth/api-key-not-valid',
  'auth/internal-error',
]);

function categorizeAnonymousAuthFailure(code: string | null): string {
  if (!code) return 'unknown';
  if (ANONYMOUS_AUTH_BLOCKER_CODES.has(code)) return code;
  return code;
}

function syncAuthDiagnostics(user: User | null): void {
  setBackendDiagnosticsMeta({
    authInitialized: Boolean(getFirebaseAuthSafe()),
    authReady: authSessionReady,
    currentUserKind: resolveCurrentUserKind(user),
  });
}

function logAnonymousAuthResult(input: {
  attempted: boolean;
  success: boolean;
  firebaseCode?: string | null;
  user?: User | null;
}): void {
  const auth = getFirebaseAuthSafe();
  const currentUser = input.user ?? auth?.currentUser ?? null;
  const payload = {
    attempted: input.attempted,
    success: input.success,
    firebaseCode: input.firebaseCode ?? null,
    authReady: authSessionReady,
    currentUserPresent: Boolean(currentUser),
    currentUserAnonymous: currentUser?.isAnonymous ?? null,
  };
  console.info('[anonymous-auth-result]', payload);
  if (input.firebaseCode === 'auth/operation-not-allowed') {
    console.error(
      '[anonymous-auth-blocker] Firebase Anonymous Auth provider kapalı — Authentication > Sign-in method > Anonymous etkinleştirilmeli (release blocker)',
    );
  } else if (
    input.firebaseCode &&
    ANONYMOUS_AUTH_BLOCKER_CODES.has(input.firebaseCode)
  ) {
    console.error('[anonymous-auth-blocker]', {
      firebaseCode: input.firebaseCode,
      category: categorizeAnonymousAuthFailure(input.firebaseCode),
    });
  }
  recordAnonymousSignInResult({
    attempted: input.attempted,
    success: input.success,
    firebaseCode: input.firebaseCode ?? null,
  });
  syncAuthDiagnostics(currentUser);
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
    throw new Error('auth-unavailable');
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

    let unsubscribe = () => {};
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

    unsubscribe = subscribeAuthState((user) => {
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

async function applyCredentialToCurrentUser(
  credential: AuthCredential,
): Promise<
  | { ok: true; user: User }
  | { ok: false; error: string; errorKind?: AccountLinkErrorKind; pendingCredential?: AuthCredential }
> {
  const auth = getFirebaseAuthSafe();
  if (!auth) {
    return { ok: false, error: 'auth-unavailable', errorKind: 'general' };
  }

  const currentUser = await ensureAuthenticatedUser();
  if (!currentUser) {
    return { ok: false, error: 'no-current-user', errorKind: 'general' };
  }

  try {
    if (currentUser.isAnonymous) {
      const result = await linkWithCredential(currentUser, credential);
      return { ok: true, user: result.user };
    }

    const providerId = credential.providerId;
    if (currentUser.providerData.some((entry) => entry.providerId === providerId)) {
      return {
        ok: false,
        error: 'provider-already-linked',
        errorKind: 'provider-already-linked',
      };
    }
    const result = await linkWithCredential(currentUser, credential);
    return { ok: true, user: result.user };
  } catch (error) {
    const errorKind = mapLinkErrorKind(error);
    const mapped = mapLinkError(error);
    if (
      errorKind === 'credential-already-in-use' ||
      errorKind === 'account-exists-with-different-credential'
    ) {
      return { ok: false, error: mapped, errorKind, pendingCredential: credential };
    }
    return { ok: false, error: mapped, errorKind };
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
  await initAnonymousAuth();
}

async function finalizeAccountLink(
  provider: 'google' | 'apple',
  user: User,
): Promise<void> {
  devLog('[auth] account linked with', provider, user.uid);

  try {
    await markUserProviderLinked(user.uid, provider);
  } catch (error) {
    console.warn('[auth] markUserProviderLinked failed', error);
  }

  // Lazy import — cloudSaveSync / gameStore döngüsünü kırar
  try {
    const [{ syncLocalSaveToCloud }, { useGameStore }] = await Promise.all([
      import('../storage/cloudSaveSync'),
      import('../store/gameStore'),
    ]);
    const state = useGameStore.getState();
    const synced = await syncLocalSaveToCloud('account_link', {
      force: true,
      state,
    });
    if (!synced) {
      console.warn('[auth] cloud sync after account_link failed (link still ok)');
    }
  } catch (error) {
    console.warn('[auth] cloud sync after account_link failed', error);
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
    const hub = getOrCreateAuthListenerHub();
    if (!hub) {
      callback(null);
      return () => {};
    }
    hub.callbacks.add(callback);
    if (hub.initialized) callback(hub.lastUser);
    return () => {
      hub.callbacks.delete(callback);
    };
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
}

/**
 * Auth oturumunu başlatır: önce persistence restore, yoksa anonymous sign-in.
 * Sıra: Auth initialize → onAuthStateChanged initial → yoksa signInAnonymously → ready.
 */
export async function initAnonymousAuth(): Promise<User | null> {
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    setAuthLifecycleState('initializing', 'auth-bootstrap');
    const auth = getFirebaseAuthSafe();
    if (!auth) {
      console.warn('[auth] unavailable, using local save only');
      setAuthLifecycleState('failed', 'auth-initialization-failed');
      authSessionReady = true;
      logAnonymousAuthResult({
        attempted: false,
        success: false,
        firebaseCode: 'auth-unavailable',
      });
      initPromise = null;
      return null;
    }

    setBackendDiagnosticsMeta({
      authInitialized: true,
      authReady: false,
      currentUserKind: 'none',
    });

    // Persistence restore: ilk onAuthStateChanged callback'ini bekle.
    const restoredUser = await waitForInitialAuthState();

    if (restoredUser) {
      logRestoredUser(restoredUser);
      authSessionReady = true;
      setAuthLifecycleState(
        restoredUser.isAnonymous ? 'anonymous' : 'authenticated',
        'persistence-restored',
      );
      logAnonymousAuthResult({
        attempted: false,
        success: true,
        firebaseCode: null,
        user: restoredUser,
      });
      return restoredUser;
    }

    try {
      devLog('[auth] no restored user, signing in anonymously');
      const credential = await signInAnonymously(auth);
      authSessionReady = true;
      setAuthLifecycleState('anonymous', 'anonymous-created');
      logAnonymousAuthResult({
        attempted: true,
        success: true,
        firebaseCode: null,
        user: credential.user,
      });
      return credential.user;
    } catch (error) {
      const firebaseCode = getAuthErrorCode(error);
      console.warn('[auth] anonymous sign-in failed', {
        firebaseCode,
        category: categorizeAnonymousAuthFailure(firebaseCode),
        error,
      });
      authSessionReady = true;
      setAuthLifecycleState('failed', 'anonymous-sign-in-failed');
      logAnonymousAuthResult({
        attempted: true,
        success: false,
        firebaseCode,
        user: auth.currentUser,
      });
      // Anonymous user silinmez — zaten oluşturulamadı; mevcut oturum korunur.
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

  const authBefore = getFirebaseAuthSafe()?.currentUser ?? null;
  try {
    setAuthLifecycleState('linking-provider', 'google-link');
    const googleResult = await createGoogleFirebaseCredential();
    if (!googleResult.ok) {
      // Native Google hatası googleAuthService içinde [google-auth-failed] loglar.
      // Link başarısız olsa bile anonymous oturum korunmalı.
      const preserved = getFirebaseAuthSafe()?.currentUser ?? authBefore;
      console.warn('[google-auth-failed]', {
        nativeCode: googleResult.error,
        firebaseCode: null,
        category: googleResult.error,
        authReady: authSessionReady,
        currentUserPresent: Boolean(preserved),
        currentUserAnonymous: preserved?.isAnonymous ?? null,
        idTokenPresent: false,
      });
      recordGoogleSignInResult({
        success: false,
        code: googleResult.error,
      });
      syncAuthDiagnostics(preserved);
      return { ok: false, error: googleResult.error };
    }

    const uidBefore = getCurrentUserId();
    const linkResult = await applyCredentialToCurrentUser(googleResult.credential);
    if (!linkResult.ok) {
      const preserved = getFirebaseAuthSafe()?.currentUser ?? authBefore;
      console.warn('[google-auth-failed]', {
        nativeCode: null,
        firebaseCode: linkResult.error,
        category: linkResult.errorKind ?? linkResult.error,
        authReady: authSessionReady,
        currentUserPresent: Boolean(preserved),
        currentUserAnonymous: preserved?.isAnonymous ?? null,
        idTokenPresent: true,
      });
      recordGoogleSignInResult({
        success: false,
        code: linkResult.error,
        detail: linkResult.errorKind ?? null,
      });
      syncAuthDiagnostics(preserved);
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

    await finalizeAccountLink('google', linkResult.user);
    setAuthLifecycleState('authenticated', 'google-linked');
    recordGoogleSignInResult({ success: true, code: null });
    syncAuthDiagnostics(linkResult.user);
    return { ok: true, provider: 'google' };
  } catch (error) {
    const mapped = mapLinkError(error);
    const firebaseCode = getAuthErrorCode(error) ?? mapped;
    const preserved = getFirebaseAuthSafe()?.currentUser ?? authBefore;
    console.warn('[google-auth-failed]', {
      nativeCode: null,
      firebaseCode,
      category: mapLinkErrorKind(error),
      authReady: authSessionReady,
      currentUserPresent: Boolean(preserved),
      currentUserAnonymous: preserved?.isAnonymous ?? null,
      idTokenPresent: null,
    });
    recordGoogleSignInResult({ success: false, code: firebaseCode });
    syncAuthDiagnostics(preserved);
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
    setAuthLifecycleState('linking-provider', 'apple-link');
    const { linkWithAppleAccount } = await import('./appleAuthService');
    const appleResult = await linkWithAppleAccount();
    if (!appleResult.ok) {
      return { ok: false, error: appleResult.error };
    }

    const linkResult = await applyCredentialToCurrentUser(appleResult.credential);
    if (!linkResult.ok) {
      return {
        ok: false,
        error: linkResult.error,
        errorKind: linkResult.errorKind,
        pendingCredential: linkResult.pendingCredential,
        provider: 'apple',
      };
    }

    if (appleResult.profile?.displayName && !linkResult.user.displayName) {
      await updateProfile(linkResult.user, {
        displayName: appleResult.profile.displayName,
      });
    }
    await finalizeAccountLink('apple', linkResult.user);
    setAuthLifecycleState('authenticated', 'apple-linked');
    devLog('[auth] Apple account linked', linkResult.user.uid);
    return { ok: true, provider: 'apple' };
  } catch (error) {
    const mapped = mapLinkError(error);
    console.warn('[auth] linkAnonymousAccountWithApple failed', mapped);
    return { ok: false, error: mapped, errorKind: mapLinkErrorKind(error), provider: 'apple' };
  }
}

/**
 * Misafir kaydı birleştirmeden mevcut Google/Apple hesabına geçiş.
 * Onay sonrası çağrılır; bulut kaydı yoksa misafir oturumuna geri döner.
 */
async function awaitBeforeDeadline<T>(
  promise: Promise<T>,
  deadlineMs: number,
): Promise<T> {
  const remainingMs = deadlineMs - Date.now();
  if (remainingMs <= 0) throw new CloudSaveConflictError('timeout');
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new CloudSaveConflictError('timeout')),
          remainingMs,
        );
      }),
    ]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

function mapAccountSwitchFailure(error: unknown): CloudSaveConflictReason {
  if (error instanceof CloudSaveConflictError) return error.reason;
  const code = getAuthErrorCode(error);
  if (code === 'auth/network-request-failed') return 'network-error';
  if (code === 'auth/user-token-expired' || code === 'auth/invalid-user-token') {
    return 'auth-user-mismatch';
  }
  return 'unknown';
}

export async function switchToLinkedProviderAccount(
  credential: AuthCredential,
  provider: 'google' | 'apple',
  options: { expectedAccountUid?: string } = {},
): Promise<AccountSwitchResult> {
  const auth = getFirebaseAuthSafe();
  if (!auth) {
    return { ok: false, error: 'network-error' };
  }

  const deadlineMs = Date.now() + ACCOUNT_SWITCH_TIMEOUT_MS;
  let selectedAccountUid: string | undefined;
  let guestState: import('../store/gameStore').GameStore | undefined;
  let localCommitted = false;

  try {
    const { useGameStore } = await import('../store/gameStore');
    guestState = useGameStore.getState();
    const user = await awaitBeforeDeadline(
      signInWithProviderCredential(credential, provider),
      deadlineMs,
    );
    selectedAccountUid = user.uid;
    if (
      (options.expectedAccountUid && options.expectedAccountUid !== user.uid) ||
      auth.currentUser?.uid !== user.uid
    ) {
      throw new CloudSaveConflictError('auth-user-mismatch');
    }
    initPromise = Promise.resolve(user);
    authSessionReady = true;

    if (__DEV__) {
      devLog('[auth] switched to linked account', user.uid, provider);
    }

    const { payloadToStoreState, saveGameState } = await import('../storage/saveGame');
    await executeAtomicCloudSaveRestore({
      selectedAccountUid,
      expectedAccountUid: options.expectedAccountUid,
      readMetadata: async () => {
        const result = await awaitBeforeDeadline(
          loadGameFromCloudDetailed(user.uid),
          deadlineMs,
        );
        if (!result.ok) throw new CloudSaveConflictError(result.reason);
        return result.payload;
      },
      readPayload: async () => {
        const result = await awaitBeforeDeadline(
          loadGameFromCloudDetailed(user.uid),
          deadlineMs,
        );
        if (!result.ok) throw new CloudSaveConflictError(result.reason);
        if (auth.currentUser?.uid !== selectedAccountUid) {
          throw new CloudSaveConflictError('auth-user-mismatch');
        }
        return result.payload;
      },
      validate: (payload) => {
        if (auth.currentUser?.uid !== selectedAccountUid) return 'auth-user-mismatch';
        if (payload.ownerUid !== selectedAccountUid) return 'owner-mismatch';
        return validateCloudSaveRestorePayload(payload, SAVE_GAME_VERSION);
      },
      migrate: (payload) => {
        const safePayload = {
          ...payload.gameState,
          // Player save içindeki global snapshot hiçbir zaman canonical değildir.
          cachedGlobalEconomySnapshotTrusted: false,
        };
        return payloadToStoreState(safePayload);
      },
      reconcileMarketplace: async (pendingCloudRestore) => {
        const [{ getMyVehicleListings }, { reconcileFleetWithVehicleMarketplace }] =
          await Promise.all([
            import('./vehicleMarketplaceService'),
            import('../domain/vehicleMarketplaceReconciliation'),
          ]);
        const marketplace = await awaitBeforeDeadline(
          getMyVehicleListings(),
          deadlineMs,
        );
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
            money:
              reconciled.authoritativeCash ??
              pendingCloudRestore.player.money,
          },
          vehicleMarketplace: reconciled.cache,
        };
      },
      persistLocal: (pendingCloudRestore) => {
        if (auth.currentUser?.uid !== selectedAccountUid) {
          throw new CloudSaveConflictError('auth-user-mismatch');
        }
        return awaitBeforeDeadline(
          saveGameState(pendingCloudRestore),
          deadlineMs,
        );
      },
      commitState: (pendingCloudRestore) => {
        useGameStore.setState(pendingCloudRestore);
      },
      getOwnerUid: (payload) => payload.ownerUid,
      getRestoreId: (payload) =>
        `${payload.ownerUid}:${payload.saveVersion}:${payload.updatedAt}:${payload.payloadChecksum ?? 'legacy'}`,
      isRestoreApplied: hasCloudRestoreReceipt,
      beginRestore: (restoreId, ownerUid) =>
        beginCloudRestoreJournal({ restoreId, ownerUid, startedAt: Date.now() }),
      completeRestore: (restoreId, ownerUid) =>
        completeCloudRestoreJournal({ restoreId, ownerUid, startedAt: Date.now() }),
      validateState: isLocalSaveSafeForAccountTransition,
    });
    localCommitted = true;

    // Global piyasa player save'den değil authoritative repository'den yenilenir.
    void useGameStore.getState().refreshMarketSnapshot();

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

    return { ok: true, selectedAccountUid };
  } catch (error) {
    const mapped = mapAccountSwitchFailure(error);
    console.warn('[auth] switchToLinkedProviderAccount failed', mapped);
    if (localCommitted && guestState) {
      try {
        const { saveGameState } = await import('../storage/saveGame');
        await saveGameState(guestState);
        const { useGameStore } = await import('../store/gameStore');
        useGameStore.setState(guestState);
      } catch (rollbackError) {
        console.warn('[auth] guest state rollback failed', rollbackError);
      }
    }
    await restoreGuestAnonymousSession();
    return {
      ok: false,
      error: mapped,
      revertedToGuest: true,
      selectedAccountUid,
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

export async function beginGoogleAccountSwitchSelection(): Promise<GoogleAccountSelectionResult> {
  const auth = getFirebaseAuthSafe();
  const currentUser = auth?.currentUser;
  if (!auth || !currentUser) {
    return { ok: false, error: 'auth-required' };
  }

  try {
    setAuthLifecycleState('switching-account', 'google-account-switch');
    // Provider cache temizliği Firebase Auth kullanıcısını düşürmez. Picker iptal
    // edilirse mevcut Firebase oturumu aynen korunur.
    setAccountSwitchTransitionState('opening-account-picker', 'google-picker');
    const providerCleared = await clearGoogleSignInSessionStrict();
    if (!providerCleared.ok) {
      setAccountSwitchTransitionState('failed', providerCleared.error);
      return providerCleared;
    }
    const google = await createGoogleFirebaseCredential();
    if (!google.ok) {
      const error =
        google.error === 'cancelled'
          ? 'account-picker-cancelled'
          : /network/i.test(google.error)
            ? 'network-error'
            : 'unknown';
      setAccountSwitchTransitionState('failed', error);
      return { ok: false, error };
    }

    setAccountSwitchTransitionState('authenticating-new-account', 'google-credential');
    const selected = await signInWithCredential(auth, google.credential);
    authSessionReady = true;
    initPromise = Promise.resolve(selected.user);
    setAccountSwitchTransitionState('checking-cloud-save', 'selected-account-authenticated');
    setAuthLifecycleState('checking-cloud-save', 'selected-account-authenticated');
    const cloud = await loadGameFromCloudDetailed(selected.user.uid);
    if (!cloud.ok && cloud.reason !== 'cloud-save-not-found') {
      setAccountSwitchTransitionState('failed', cloud.reason);
      return {
        ok: false,
        error: cloud.reason === 'network-error' ? 'network-error' : 'unknown',
      };
    }
    if (cloud.ok) {
      const [{ setCloudRestoreCandidateForConflict }, { useGameStore }] =
        await Promise.all([
          import('../storage/cloudSaveSync'),
          import('../store/gameStore'),
        ]);
      setCloudRestoreCandidateForConflict(useGameStore.getState(), cloud.payload);
    }
    setAccountSwitchTransitionState(
      cloud.ok ? 'resolving-conflict' : 'completed',
      cloud.ok ? 'cloud-save-found' : 'new-account',
    );
    setAuthLifecycleState(
      cloud.ok ? 'resolving-conflict' : 'authenticated',
      cloud.ok ? 'cloud-save-found' : 'new-account',
    );
    return {
      ok: true,
      credential: google.credential,
      selectedAccountUid: selected.user.uid,
      hasCloudSave: cloud.ok,
    };
  } catch (error) {
    console.warn('[auth] Google account selection failed', error);
    const code = getAuthErrorCode(error);
    const mapped: AccountTransitionError =
      code === 'auth/network-request-failed' ? 'network-error' : 'unknown';
    setAccountSwitchTransitionState('failed', mapped);
    return { ok: false, error: mapped };
  }
}

export async function linkSelectedGoogleAccountToGuest(
  credential: AuthCredential,
): Promise<AccountLinkResult> {
  const alreadySelected = getFirebaseAuthSafe()?.currentUser;
  if (alreadySelected && !alreadySelected.isAnonymous) {
    await finalizeAccountLink('google', alreadySelected);
    setAccountSwitchTransitionState('completed', 'local-save-linked');
    return { ok: true, provider: 'google' };
  }
  const linkResult = await applyCredentialToCurrentUser(credential);
  if (!linkResult.ok) {
    return {
      ok: false,
      error: linkResult.error,
      errorKind: linkResult.errorKind,
      pendingCredential: linkResult.pendingCredential,
      provider: 'google',
    };
  }
  await finalizeAccountLink('google', linkResult.user);
  return { ok: true, provider: 'google' };
}

export async function signInSelectedGoogleAccountForNewGame(
  credential: AuthCredential,
): Promise<{ ok: boolean; error?: AccountTransitionError }> {
  const auth = getFirebaseAuthSafe();
  if (!auth) return { ok: false, error: 'auth-required' };
  try {
    const result = await signInWithCredential(auth, credential);
    authSessionReady = true;
    initPromise = Promise.resolve(result.user);
    await markUserProviderLinked(result.user.uid, 'google');
    setAccountSwitchTransitionState('completed', 'new-game-selected');
    return { ok: true };
  } catch (error) {
    console.warn('[auth] selected Google sign-in failed', error);
    return { ok: false, error: 'network-error' };
  }
}

export async function signOutGoogleAccountToGuest(): Promise<{
  ok: boolean;
  error?: AccountTransitionError;
}> {
  const auth = getFirebaseAuthSafe();
  if (!auth?.currentUser || auth.currentUser.isAnonymous) {
    return { ok: false, error: 'auth-required' };
  }
  const providerCleared = await clearGoogleSignInSessionStrict();
  if (!providerCleared.ok) return providerCleared;
  try {
    setAuthLifecycleState('signing-out', 'google-sign-out');
    await signOut(auth);
    resetAuthService();
    const guest = await initAnonymousAuth();
    return guest
      ? { ok: true }
      : { ok: false, error: 'sign-out-failed' };
  } catch (error) {
    console.warn('[auth] sign out to guest failed', error);
    return { ok: false, error: 'sign-out-failed' };
  }
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

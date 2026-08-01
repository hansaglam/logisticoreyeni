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
  type AuthCredential,
  type User,
} from 'firebase/auth';
import { Platform } from 'react-native';

import { loadGameFromCloud, markUserProviderLinked } from './cloudSaveService';
import { getFirebaseAuthSafe, resetFirebaseAuthCache } from './firebase';
import { clearGoogleSignInSession, createGoogleFirebaseCredential } from './googleAuthService';
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
}

export type AccountSwitchResult =
  | { ok: true }
  | { ok: false; error: string; revertedToGuest?: boolean };

type AuthStateCallback = (user: User | null) => void;

const AUTH_RESTORE_TIMEOUT_MS = 8_000;

let initPromise: Promise<User | null> | null = null;
let initialAuthStatePromise: Promise<User | null> | null = null;
let authSessionReady = false;

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

    // Misafir değilse oturum değiştirme — V1 güvenli davranış
    return { ok: false, error: 'already-linked', errorKind: 'general' };
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

async function finalizeAccountLink(
  provider: 'google' | 'apple',
  user: User,
  appleProfile?: AppleLinkProfile,
): Promise<void> {
  devLog('[auth] account linked with', provider, user.uid);

  if (provider === 'apple') {
    await applyAppleFirstLoginProfile(user, appleProfile);
  } else {
    try {
      await markUserProviderLinked(user.uid, provider);
    } catch (error) {
      console.warn('[auth] markUserProviderLinked failed', error);
    }
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
      logRestoredUser(restoredUser);
      authSessionReady = true;
      return restoredUser;
    }

    try {
      devLog('[auth] no restored user, signing in anonymously');
      const credential = await signInAnonymously(auth);
      devLog('[auth] anonymous user ready', credential.user.uid);
      authSessionReady = true;
      return credential.user;
    } catch (error) {
      console.warn('[auth] anonymous sign-in failed', error);
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
    const linkResult = await applyCredentialToCurrentUser(googleResult.credential);
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

    await finalizeAccountLink('google', linkResult.user);
    return { ok: true, provider: 'google' };
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

    await finalizeAccountLink('apple', linkResult.user, appleResult.profile);
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
export async function switchToLinkedProviderAccount(
  credential: AuthCredential,
  provider: 'google' | 'apple',
): Promise<AccountSwitchResult> {
  const auth = getFirebaseAuthSafe();
  if (!auth) {
    return { ok: false, error: 'auth-unavailable' };
  }

  try {
    const user = await signInWithProviderCredential(credential, provider);
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
    console.warn('[auth] switchToLinkedProviderAccount failed', mapped);
    await restoreGuestAnonymousSession();
    return { ok: false, error: mapped, revertedToGuest: true };
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

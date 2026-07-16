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
  deleteUser,
  type AuthCredential,
  type User,
} from 'firebase/auth';
import { Platform } from 'react-native';

import { markUserProviderLinked } from './cloudSaveService';
import { getFirebaseAuthSafe, resetFirebaseAuthCache } from './firebase';
import { createGoogleFirebaseCredential } from './googleAuthService';

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
  provider?: 'google' | 'apple';
}

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
  console.log('[auth] restored user', user.uid, {
    isAnonymous: user.isAnonymous,
    provider,
  });
  if (!user.isAnonymous && provider !== 'guest' && provider !== 'unknown') {
    console.log('[auth] provider', provider);
  }
}

function mapLinkError(error: unknown): string {
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

  if (
    code === 'auth/credential-already-in-use' ||
    code === 'auth/email-already-in-use' ||
    message.includes('credential-already-in-use')
  ) {
    return 'credential-already-in-use';
  }

  if (code === 'auth/cancelled-popup-request' || code === 'auth/popup-closed-by-user') {
    return 'cancelled';
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
): Promise<{ ok: true; user: User } | { ok: false; error: string }> {
  const auth = getFirebaseAuthSafe();
  if (!auth) {
    return { ok: false, error: 'auth-unavailable' };
  }

  const currentUser = await ensureAuthenticatedUser();
  if (!currentUser) {
    return { ok: false, error: 'no-current-user' };
  }

  try {
    if (currentUser.isAnonymous) {
      const result = await linkWithCredential(currentUser, credential);
      return { ok: true, user: result.user };
    }

    // Misafir değilse oturum değiştirme — V1 güvenli davranış
    return { ok: false, error: 'already-linked' };
  } catch (error) {
    return { ok: false, error: mapLinkError(error) };
  }
}

async function finalizeAccountLink(
  provider: 'google' | 'apple',
  user: User,
): Promise<void> {
  console.log('[auth] account linked with', provider, user.uid);

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
      console.log('[auth] no restored user, signing in anonymously');
      const credential = await signInAnonymously(auth);
      console.log('[auth] anonymous user ready', credential.user.uid);
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
      return { ok: false, error: linkResult.error };
    }

    const uidAfter = linkResult.user.uid;
    if (uidBefore && uidAfter !== uidBefore) {
      console.warn('[auth] UID changed during Google link', { uidBefore, uidAfter });
    } else {
      console.log('[auth] Google account linked, UID preserved', uidAfter);
    }

    await finalizeAccountLink('google', linkResult.user);
    return { ok: true, provider: 'google' };
  } catch (error) {
    const mapped = mapLinkError(error);
    console.warn('[auth] linkAnonymousAccountWithGoogle failed', mapped);
    return { ok: false, error: mapped };
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
    const { createAppleFirebaseCredential } = await import('./appleAuthService');
    const appleResult = await createAppleFirebaseCredential();
    if (!appleResult.ok) {
      return { ok: false, error: appleResult.error };
    }

    const linkResult = await applyCredentialToCurrentUser(appleResult.credential);
    if (!linkResult.ok) {
      return { ok: false, error: linkResult.error };
    }

    await finalizeAccountLink('apple', linkResult.user);
    console.log('[auth] Apple account linked', linkResult.user.uid);
    return { ok: true, provider: 'apple' };
  } catch (error) {
    const mapped = mapLinkError(error);
    console.warn('[auth] linkAnonymousAccountWithApple failed', mapped);
    return { ok: false, error: mapped };
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

/**
 * Apple Sign-In — Expo Apple Authentication + Firebase OAuth.
 *
 * Native modüller (expo-apple-authentication, expo-crypto) lazy yüklenir.
 * Android'de veya app açılışında çağrılmaz; yalnızca Apple ile Bağlan'da.
 *
 * App Store: iOS’ta Google veya başka 3. taraf login sunulursa
 * Apple ile Giriş de sunulmalıdır (Guideline 4.8).
 */

import { OAuthProvider, type AuthCredential } from 'firebase/auth';
import { Platform } from 'react-native';

import { getFirebaseAuthSafe } from './firebase';
import { generateSecureNonceAsync, sha256 } from '../utils/authNonce';

type AppleAuthModule = typeof import('expo-apple-authentication');

export type AppleSignInProfile = {
  fullName: string | null;
  email: string | null;
};

export type AppleCredentialResult =
  | { ok: true; credential: AuthCredential; profile: AppleSignInProfile }
  | { ok: false; error: string };

function loadAppleAuthentication(): AppleAuthModule | null {
  if (Platform.OS !== 'ios') {
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-apple-authentication') as AppleAuthModule;
  } catch (error) {
    console.warn('[auth] expo-apple-authentication unavailable', error);
    return null;
  }
}

function formatAppleFullName(
  fullName: {
    givenName?: string | null;
    familyName?: string | null;
    middleName?: string | null;
  } | null
  | undefined,
): string | null {
  if (!fullName) {
    return null;
  }
  const parts = [fullName.givenName, fullName.middleName, fullName.familyName]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter((part) => part.length > 0);
  return parts.length > 0 ? parts.join(' ') : null;
}

function getNativeErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') {
    return null;
  }
  return 'code' in error && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : null;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    return (error as { message: string }).message;
  }
  return 'apple-sign-in-failed';
}

/** Token / nonce / email / UID loglanmaz. */
function logAppleAuthFailed(fields: {
  nativeCode: string | null;
  firebaseCode: string | null;
  category: string;
  identityTokenPresent: boolean;
  rawNoncePresent: boolean;
}): void {
  const auth = getFirebaseAuthSafe();
  const currentUser = auth?.currentUser ?? null;
  console.warn('[apple-auth-failed]', {
    nativeCode: fields.nativeCode,
    firebaseCode: fields.firebaseCode,
    category: fields.category,
    identityTokenPresent: fields.identityTokenPresent,
    rawNoncePresent: fields.rawNoncePresent,
    authInitialized: Boolean(auth),
    currentUserPresent: Boolean(currentUser),
    currentUserAnonymous: currentUser ? Boolean(currentUser.isAnonymous) : null,
  });
}

export async function isAppleSignInAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') {
    return false;
  }

  const AppleAuthentication = loadAppleAuthentication();
  if (!AppleAuthentication) {
    return false;
  }

  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

export async function createAppleFirebaseCredential(): Promise<AppleCredentialResult> {
  return requestAppleFirebaseCredential();
}

/**
 * Misafir hesabı Apple'a bağlamak için credential üretir (linkWithCredential).
 */
export async function linkWithAppleAccount(): Promise<AppleCredentialResult> {
  return requestAppleFirebaseCredential();
}

/**
 * Mevcut Apple hesabına giriş için credential üretir (signInWithCredential).
 * Apple authorization tek kullanımlık olabileceğinden çakışma geçişinde yeniden çağrılır.
 */
export async function signInWithAppleAccount(): Promise<AppleCredentialResult> {
  return requestAppleFirebaseCredential();
}

/**
 * Apple oturumunu sıfırlar — native tarafta kalıcı session yok; no-op.
 */
export async function clearAppleSignInSession(): Promise<void> {
  // Apple Sign-In her signInAsync çağrısında kullanıcıyı yeniden doğrular.
}

async function requestAppleFirebaseCredential(): Promise<AppleCredentialResult> {
  if (Platform.OS !== 'ios') {
    return { ok: false, error: 'apple-not-supported' };
  }

  const AppleAuthentication = loadAppleAuthentication();
  if (!AppleAuthentication) {
    return { ok: false, error: 'apple-not-available' };
  }

  let available = false;
  try {
    available = await AppleAuthentication.isAvailableAsync();
  } catch {
    return { ok: false, error: 'apple-not-available' };
  }

  if (!available) {
    return { ok: false, error: 'apple-not-available' };
  }

  let rawNoncePresent = false;
  let identityTokenPresent = false;

  try {
    const nonceResult = await generateSecureNonceAsync(32);
    if (!nonceResult.ok) {
      logAppleAuthFailed({
        nativeCode: null,
        firebaseCode: null,
        category: 'crypto-unavailable',
        identityTokenPresent: false,
        rawNoncePresent: false,
      });
      return { ok: false, error: 'crypto-unavailable' };
    }

    const rawNonce = nonceResult.nonce;
    rawNoncePresent = true;

    const hashedResult = await sha256(rawNonce);
    if (!hashedResult.ok) {
      logAppleAuthFailed({
        nativeCode: null,
        firebaseCode: null,
        category: 'crypto-unavailable',
        identityTokenPresent: false,
        rawNoncePresent: true,
      });
      return { ok: false, error: hashedResult.error };
    }

    const appleCredential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedResult.hash,
    });

    // identityToken zorunlu; authorizationCode asla idToken yerine kullanılmaz
    const identityToken =
      typeof appleCredential.identityToken === 'string'
        ? appleCredential.identityToken.trim()
        : '';
    identityTokenPresent = identityToken.length > 0;

    if (!identityTokenPresent) {
      logAppleAuthFailed({
        nativeCode: null,
        firebaseCode: null,
        category: 'apple-token-missing',
        identityTokenPresent: false,
        rawNoncePresent: true,
      });
      return { ok: false, error: 'apple-token-missing' };
    }

    const provider = new OAuthProvider('apple.com');
    const credential = provider.credential({
      idToken: identityToken,
      rawNonce,
    });

    const fullName = formatAppleFullName(appleCredential.fullName);
    const email =
      typeof appleCredential.email === 'string' && appleCredential.email.trim().length > 0
        ? appleCredential.email.trim()
        : null;

    return {
      ok: true,
      credential,
      profile: {
        fullName,
        email,
      },
    };
  } catch (error: unknown) {
    const nativeCode = getNativeErrorCode(error);

    if (nativeCode === 'ERR_REQUEST_CANCELED') {
      return { ok: false, error: 'cancelled' };
    }

    const message = getErrorMessage(error);

    if (
      message.includes('ExpoCrypto') ||
      message.includes('native module') ||
      message.includes('Native module')
    ) {
      logAppleAuthFailed({
        nativeCode,
        firebaseCode: null,
        category: 'crypto-unavailable',
        identityTokenPresent,
        rawNoncePresent,
      });
      return { ok: false, error: 'crypto-unavailable' };
    }

    if (
      nativeCode === 'ERR_REQUEST_UNKNOWN' ||
      /invalid.?credential|credential.?invalid/i.test(message)
    ) {
      logAppleAuthFailed({
        nativeCode,
        firebaseCode: null,
        category: 'apple-credential-invalid',
        identityTokenPresent,
        rawNoncePresent,
      });
      return { ok: false, error: 'apple-credential-invalid' };
    }

    if (/revoked/i.test(message)) {
      logAppleAuthFailed({
        nativeCode,
        firebaseCode: null,
        category: 'apple-credential-revoked',
        identityTokenPresent,
        rawNoncePresent,
      });
      return { ok: false, error: 'apple-credential-revoked' };
    }

    logAppleAuthFailed({
      nativeCode,
      firebaseCode: null,
      category: 'apple-sign-in-failed',
      identityTokenPresent,
      rawNoncePresent,
    });
    return { ok: false, error: 'apple-sign-in-failed' };
  }
}

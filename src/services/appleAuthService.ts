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

import { generateRandomNonce, sha256 } from '../utils/authNonce';

type AppleAuthModule = typeof import('expo-apple-authentication');

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

export type AppleCredentialResult =
  | { ok: true; credential: AuthCredential }
  | { ok: false; error: string };

export async function createAppleFirebaseCredential(): Promise<AppleCredentialResult> {
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

  try {
    const rawNonce = generateRandomNonce(32);
    const hashedResult = await sha256(rawNonce);

    if (!hashedResult.ok) {
      return { ok: false, error: hashedResult.error };
    }

    const appleCredential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedResult.hash,
    });

    if (!appleCredential.identityToken) {
      return { ok: false, error: 'apple-missing-token' };
    }

    const provider = new OAuthProvider('apple.com');
    const credential = provider.credential({
      idToken: appleCredential.identityToken,
      rawNonce,
    });

    return { ok: true, credential };
  } catch (error: unknown) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'ERR_REQUEST_CANCELED'
    ) {
      return { ok: false, error: 'cancelled' };
    }

    const message =
      error instanceof Error
        ? error.message
        : typeof error === 'object' &&
            error &&
            'message' in error &&
            typeof (error as { message?: unknown }).message === 'string'
          ? (error as { message: string }).message
          : 'apple-sign-in-failed';

    if (
      message.includes('ExpoCrypto') ||
      message.includes('native module') ||
      message.includes('Native module')
    ) {
      return { ok: false, error: 'crypto-unavailable' };
    }

    console.warn('[auth] Apple Sign-In failed', error);
    return { ok: false, error: message };
  }
}

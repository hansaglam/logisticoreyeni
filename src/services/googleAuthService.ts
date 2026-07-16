/**
 * Google Sign-In yapılandırması + Firebase credential.
 *
 * Env okuma: firebase.ts ile aynı desen —
 * önce process.env.EXPO_PUBLIC_* (dot notation, Expo inline),
 * sonra Constants.expoConfig.extra.google fallback.
 *
 * NOT: Native Google Sign-In Expo Go'da çalışmayabilir.
 * Development build / production build gerekir:
 *   npx expo run:android | npx expo run:ios
 */

import Constants from 'expo-constants';
import { GoogleAuthProvider, type AuthCredential } from 'firebase/auth';
import { Platform } from 'react-native';

export type GoogleSignInConfig = {
  webClientId?: string;
  iosClientId?: string;
};

export type GoogleCredentialResult =
  | { ok: true; credential: AuthCredential }
  | { ok: false; error: string };

let configured = false;
let configureAttempted = false;
let envCheckLogged = false;

function normalizeEnvValue(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readExtraGoogleConfig(): Partial<GoogleSignInConfig> {
  const extra = Constants.expoConfig?.extra as
    | { google?: Partial<Record<'webClientId' | 'iosClientId', unknown>> }
    | undefined;
  const googleExtra = extra?.google;
  if (!googleExtra || typeof googleExtra !== 'object') {
    return {};
  }

  return {
    webClientId: normalizeEnvValue(googleExtra.webClientId),
    iosClientId: normalizeEnvValue(googleExtra.iosClientId),
  };
}

function readGoogleConfig(): GoogleSignInConfig {
  const fromExtra = readExtraGoogleConfig();

  const googleWebClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  const googleIosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;

  return {
    webClientId:
      normalizeEnvValue(googleWebClientId) ?? fromExtra.webClientId,
    iosClientId:
      normalizeEnvValue(googleIosClientId) ?? fromExtra.iosClientId,
  };
}

function logGoogleEnvCheckOnce(): void {
  if (envCheckLogged) {
    return;
  }
  envCheckLogged = true;

  const googleWebClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  const googleIosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  const config = readGoogleConfig();
  const fromExtra = readExtraGoogleConfig();

  console.log('[google-auth] env check', {
    webClientIdExists: Boolean(config.webClientId),
    webClientIdLength: config.webClientId?.length ?? 0,
    iosClientIdExists: Boolean(config.iosClientId),
    iosClientIdLength: config.iosClientId?.length ?? 0,
    fromProcessEnv: {
      webClientIdExists: Boolean(normalizeEnvValue(googleWebClientId)),
      webClientIdLength: normalizeEnvValue(googleWebClientId)?.length ?? 0,
      iosClientIdExists: Boolean(normalizeEnvValue(googleIosClientId)),
    },
    fromExtra: {
      webClientIdExists: Boolean(fromExtra.webClientId),
      iosClientIdExists: Boolean(fromExtra.iosClientId),
    },
    platform: Platform.OS,
  });
}

/**
 * Android: yalnızca webClientId yeterli.
 * iOS: webClientId zorunlu; iosClientId önerilir (configure sırasında uyarı).
 */
export function isGoogleSignInConfigured(): boolean {
  logGoogleEnvCheckOnce();
  const config = readGoogleConfig();
  return Boolean(config.webClientId);
}

export function getGoogleSignInConfig(): GoogleSignInConfig {
  return readGoogleConfig();
}

/**
 * App açılışında bir kez çağır.
 * Expo Go / native modül yoksa crash etmez.
 */
export function configureGoogleSignIn(): boolean {
  if (configured) {
    return true;
  }

  logGoogleEnvCheckOnce();

  const config = readGoogleConfig();
  const googleWebClientId = config.webClientId;
  const googleIosClientId = config.iosClientId;

  if (!googleWebClientId) {
    console.warn('[google-auth] missing EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID');
    return false;
  }

  if (Platform.OS === 'ios' && !googleIosClientId) {
    console.warn(
      '[google-auth] EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID missing — iOS Google Sign-In may fail',
    );
  }

  if (configureAttempted) {
    return configured;
  }
  configureAttempted = true;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { GoogleSignin } = require('@react-native-google-signin/google-signin') as typeof import('@react-native-google-signin/google-signin');

    GoogleSignin.configure({
      webClientId: googleWebClientId,
      iosClientId: googleIosClientId || undefined,
      offlineAccess: false,
    });
    configured = true;
    console.log('[google-auth] GoogleSignin.configure ok', {
      webClientIdLength: googleWebClientId.length,
      hasIosClientId: Boolean(googleIosClientId),
    });
    return true;
  } catch (error) {
    console.warn(
      '[google-auth] native module unavailable (Expo Go?). Use a development build.',
      error,
    );
    return false;
  }
}

/**
 * Google hesabından Firebase AuthCredential üretir.
 * link / signIn kararını authService verir.
 */
export async function createGoogleFirebaseCredential(): Promise<GoogleCredentialResult> {
  logGoogleEnvCheckOnce();

  if (!isGoogleSignInConfigured()) {
    return { ok: false, error: 'config-missing' };
  }

  if (!configureGoogleSignIn()) {
    const config = readGoogleConfig();
    if (!config.webClientId) {
      return { ok: false, error: 'config-missing' };
    }
    return { ok: false, error: 'native-module-unavailable' };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const googleSignIn = require('@react-native-google-signin/google-signin') as typeof import('@react-native-google-signin/google-signin');
    const { GoogleSignin } = googleSignIn;

    if (Platform.OS === 'android') {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    }
    const response = await GoogleSignin.signIn();

    if (response.type === 'cancelled') {
      return { ok: false, error: 'cancelled' };
    }

    let idToken = response.data?.idToken ?? null;

    if (!idToken) {
      try {
        const tokens = await GoogleSignin.getTokens();
        idToken = tokens?.idToken ?? null;
      } catch {
        // fall through
      }
    }

    if (!idToken) {
      return { ok: false, error: 'google-missing-token' };
    }

    return {
      ok: true,
      credential: GoogleAuthProvider.credential(idToken),
    };
  } catch (error: unknown) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    let cancelledCode: string | undefined;
    let inProgressCode: string | undefined;
    try {
      const { statusCodes } = require('@react-native-google-signin/google-signin') as typeof import('@react-native-google-signin/google-signin');
      cancelledCode = statusCodes.SIGN_IN_CANCELLED;
      inProgressCode = statusCodes.IN_PROGRESS;
    } catch {
      // native module missing
    }

    const code =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: unknown }).code)
        : null;

    if (code === cancelledCode || code === 'SIGN_IN_CANCELLED' || code === '-5') {
      return { ok: false, error: 'cancelled' };
    }

    if (code === inProgressCode) {
      return { ok: false, error: 'in-progress' };
    }

    console.warn('[google-auth] sign-in failed', error);
    const message =
      error instanceof Error
        ? error.message
        : code ?? 'google-sign-in-failed';

    if (
      message.includes('Native module') ||
      message.includes('RNGoogleSignin') ||
      message.includes('null is not an object')
    ) {
      return { ok: false, error: 'native-module-unavailable' };
    }

    return { ok: false, error: code ?? message };
  }
}

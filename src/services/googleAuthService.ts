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

import { recordGoogleSignInResult } from './backendDiagnostics';
import { getFirebaseAuthSafe } from './firebase';
import { devLog, devWarn } from '../utils/devLog';

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

  devLog('[google-auth] env check', {
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
    devLog('[google-auth] GoogleSignin.configure ok', {
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

    const category = categorizeGoogleAuthFailure(code, error);
    const currentUser = getFirebaseAuthSafe()?.currentUser ?? null;
    const firebaseConfigPresent = Boolean(
      normalizeEnvValue(process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID) ??
        (Constants.expoConfig?.extra as { firebase?: { projectId?: string } } | undefined)
          ?.firebase?.projectId,
    );
    console.warn('[google-auth-failed]', {
      nativeCode: code ?? null,
      firebaseCode: null,
      category,
      authReady: Boolean(getFirebaseAuthSafe()),
      currentUserPresent: Boolean(currentUser),
      currentUserAnonymous: currentUser?.isAnonymous ?? null,
      idTokenPresent: false,
      packageName:
        Platform.OS === 'android'
          ? (Constants.expoConfig?.android?.package ?? null)
          : (Constants.expoConfig?.ios?.bundleIdentifier ?? null),
      projectId:
        normalizeEnvValue(process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID) ??
        (Constants.expoConfig?.extra as { firebase?: { projectId?: string } } | undefined)
          ?.firebase?.projectId ??
        null,
      webClientIdPresent: Boolean(readGoogleConfig().webClientId),
      authInitialized: firebaseConfigPresent,
      googleServicesConfigured: configured,
    });
    recordGoogleSignInResult({
      success: false,
      code: category === 'unknown' ? (code ?? 'google-sign-in-failed') : category,
    });

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

    return { ok: false, error: category === 'unknown' ? (code ?? message) : category };
  }
}

function categorizeGoogleAuthFailure(code: string | null, error: unknown): string {
  const raw =
    code ??
    (error instanceof Error ? error.message : typeof error === 'string' ? error : '');
  const lower = raw.toLowerCase();
  if (
    raw === '10' ||
    raw === 'DEVELOPER_ERROR' ||
    lower.includes('developer_error') ||
    lower.includes('code: 10')
  ) {
    return 'DEVELOPER_ERROR';
  }
  if (raw === 'SIGN_IN_CANCELLED' || raw === '-5' || lower.includes('cancel')) {
    return 'SIGN_IN_CANCELLED';
  }
  if (raw === 'IN_PROGRESS' || lower.includes('in_progress')) {
    return 'IN_PROGRESS';
  }
  if (lower.includes('play_services') || lower.includes('play services')) {
    return 'PLAY_SERVICES_NOT_AVAILABLE';
  }
  if (lower.includes('auth/credential-already-in-use')) {
    return 'auth/credential-already-in-use';
  }
  if (lower.includes('auth/account-exists-with-different-credential')) {
    return 'auth/account-exists-with-different-credential';
  }
  if (lower.includes('auth/operation-not-allowed')) return 'auth/operation-not-allowed';
  if (lower.includes('auth/network-request-failed')) return 'auth/network-request-failed';
  if (lower.includes('auth/api-key-not-valid')) return 'auth/api-key-not-valid';
  if (lower.includes('auth/app-not-authorized')) return 'auth/app-not-authorized';
  if (lower.includes('auth/internal-error')) return 'auth/internal-error';
  if (lower.includes('auth/invalid-credential')) return 'auth/invalid-credential';
  return 'unknown';
}

export async function clearGoogleSignInSession(): Promise<void> {
  if (!configureGoogleSignIn()) {
    return;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { GoogleSignin } = require('@react-native-google-signin/google-signin') as typeof import('@react-native-google-signin/google-signin');
    await GoogleSignin.signOut();
    if (__DEV__) {
      devLog('[google-auth] signOut ok — account picker can reopen');
    }
  } catch (error) {
    if (__DEV__) {
      devWarn('[google-auth] signOut failed', error);
    }
  }
}

export async function clearGoogleSignInSessionStrict(): Promise<{
  ok: true;
} | {
  ok: false;
  error: 'google-disconnect-failed';
}> {
  if (!configureGoogleSignIn()) {
    return { ok: false, error: 'google-disconnect-failed' };
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { GoogleSignin } = require('@react-native-google-signin/google-signin') as typeof import('@react-native-google-signin/google-signin');
    await GoogleSignin.signOut();
    return { ok: true };
  } catch (error) {
    devWarn('[google-auth] strict signOut failed', error);
    return { ok: false, error: 'google-disconnect-failed' };
  }
}

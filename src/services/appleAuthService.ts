/**
 * Apple Sign-In — Expo Apple Authentication + Firebase OAuth.
 *
 * Native modüller (expo-apple-authentication, expo-crypto) lazy yüklenir.
 * Android'de veya app açılışında çağrılmaz; yalnızca Apple ile Bağlan'da.
 *
 * App Store: iOS’ta Google veya başka 3. taraf login sunulursa
 * Apple ile Giriş de sunulmalıdır (Guideline 4.8).
 */

import Constants from 'expo-constants';
import { OAuthProvider, type AuthCredential } from 'firebase/auth';
import { Platform } from 'react-native';

import { getFirebaseAppSafe, getFirebaseAuthSafe } from './firebase';
import { generateSecureNonceAsync, sha256 } from '../utils/authNonce';
import {
  createAppleOAuthCredentialParams,
  extractSafeAppleErrorFields,
  getAppleAuthDiagnosticCode,
  logAppleAuthFlow,
  normalizeAppleAuthFailure,
  sanitizeAppleFullName,
  type AppleAuthFailure,
} from '../utils/appleAuthDiagnostics';
import {
  captureFirebaseRuntimeConfigSnapshot,
  createFirebaseRuntimeMismatchFailure,
  logFirebaseRuntimeConfigOnce,
  shouldBlockAppleAuthForRuntimeConfig,
} from '../utils/firebaseRuntimeConfig';
import { FIREBASE_RUNTIME_CONFIG_MISMATCH } from '../config/firebaseRuntimeContract';

type AppleAuthModule = typeof import('expo-apple-authentication');

export type AppleSignInProfile = {
  fullName: string | null;
  email: string | null;
};

export type AppleCredentialResult =
  | { ok: true; credential: AuthCredential; profile: AppleSignInProfile }
  | { ok: false; error: string; failure: AppleAuthFailure };

function loadAppleAuthentication(): AppleAuthModule | null {
  if (Platform.OS !== 'ios') {
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-apple-authentication') as AppleAuthModule;
  } catch (error) {
    console.warn('[auth] expo-apple-authentication unavailable', extractSafeAppleErrorFields(error));
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
  return sanitizeAppleFullName(parts.length > 0 ? parts.join(' ') : null);
}

function getRuntimeBundleId(): string | null {
  return Constants.expoConfig?.ios?.bundleIdentifier ?? null;
}

function getRuntimeFirebaseMeta(): {
  projectId: string | null;
  appId: string | null;
  appName: string | null;
} {
  const app = getFirebaseAppSafe();
  return {
    projectId: app?.options.projectId ?? null,
    appId: typeof app?.options.appId === 'string' ? app.options.appId : null,
    appName: app?.name ?? null,
  };
}

function getCurrentAuthMeta(): {
  isAnonymous: boolean | null;
  providerIds: string[];
} {
  const user = getFirebaseAuthSafe()?.currentUser ?? null;
  return {
    isAnonymous: user ? Boolean(user.isAnonymous) : null,
    providerIds: (user?.providerData ?? []).map((entry) => entry.providerId),
  };
}

function logAppleAuthConfig(appleAuthenticationAvailable: boolean): void {
  const authMeta = getCurrentAuthMeta();
  const firebaseMeta = getRuntimeFirebaseMeta();
  console.warn('[apple-auth-config]', {
    appBundleId: getRuntimeBundleId(),
    firebaseProjectId: firebaseMeta.projectId,
    firebaseAppId: firebaseMeta.appId,
    firebaseAppName: firebaseMeta.appName,
    authCurrentUserType:
      authMeta.isAnonymous === null ? 'none' : authMeta.isAnonymous ? 'anonymous' : 'registered',
    isAnonymous: authMeta.isAnonymous,
    providerIds: authMeta.providerIds,
    appleAuthenticationAvailable,
  });
}

function baseFlowFields(
  extras: Omit<Parameters<typeof logAppleAuthFlow>[0], 'isAnonymous' | 'providerIds' | 'bundleId' | 'firebaseProjectId' | 'firebaseAppId'> &
    Partial<Pick<Parameters<typeof logAppleAuthFlow>[0], 'isAnonymous' | 'providerIds' | 'bundleId' | 'firebaseProjectId' | 'firebaseAppId'>>,
): Parameters<typeof logAppleAuthFlow>[0] {
  const authMeta = getCurrentAuthMeta();
  const firebaseMeta = getRuntimeFirebaseMeta();
  return {
    isAnonymous: authMeta.isAnonymous,
    providerIds: authMeta.providerIds,
    bundleId: getRuntimeBundleId(),
    firebaseProjectId: firebaseMeta.projectId,
    firebaseAppId: firebaseMeta.appId,
    ...extras,
  };
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

function fail(
  error: string,
  failure: AppleAuthFailure,
  extras?: {
    hasIdentityToken?: boolean;
    hasAuthorizationCode?: boolean;
    hasEmail?: boolean;
    hasFullName?: boolean;
    hasAppleUserId?: boolean;
    hasRawNonce?: boolean;
    hasHashedNonce?: boolean;
  },
): AppleCredentialResult {
  logAppleAuthFlow(
    baseFlowFields({
      stage: failure.stage,
      result: failure.code === 'ERR_REQUEST_CANCELED' ? 'cancel' : 'failure',
      name: failure.name ?? null,
      code: failure.code,
      message: failure.message ?? null,
      normalizedCode: getAppleAuthDiagnosticCode(failure),
      nativeCode: failure.nativeCode ?? null,
      firebaseCode: failure.firebaseCode ?? null,
      domain: failure.domain ?? null,
      hasIdentityToken: extras?.hasIdentityToken,
      hasAuthorizationCode: extras?.hasAuthorizationCode,
      hasEmail: extras?.hasEmail,
      hasFullName: extras?.hasFullName,
      hasAppleUserId: extras?.hasAppleUserId,
      hasRawNonce: extras?.hasRawNonce,
      hasHashedNonce: extras?.hasHashedNonce,
    }),
  );
  return { ok: false, error, failure };
}

function guardAppleAuthRuntimeConfig(): AppleCredentialResult | null {
  logFirebaseRuntimeConfigOnce();
  const snapshot = captureFirebaseRuntimeConfigSnapshot();
  logAppleAuthFlow(
    baseFlowFields({
      stage: 'config-validation',
      result: shouldBlockAppleAuthForRuntimeConfig(snapshot) ? 'failure' : 'success',
      code: shouldBlockAppleAuthForRuntimeConfig(snapshot)
        ? FIREBASE_RUNTIME_CONFIG_MISMATCH
        : 'firebase-runtime-config-ok',
      firebaseProjectId: snapshot.firebaseProjectId,
      bundleId: snapshot.currentBundleId,
    }),
  );

  if (!shouldBlockAppleAuthForRuntimeConfig(snapshot)) {
    return null;
  }

  return fail(FIREBASE_RUNTIME_CONFIG_MISMATCH, createFirebaseRuntimeMismatchFailure(snapshot));
}

async function requestAppleFirebaseCredential(): Promise<AppleCredentialResult> {
  if (Platform.OS !== 'ios') {
    const failure = normalizeAppleAuthFailure(null, 'availability', {
      code: 'apple-not-supported',
    });
    return fail('apple-not-supported', failure);
  }

  const configGuard = guardAppleAuthRuntimeConfig();
  if (configGuard) {
    return configGuard;
  }

  const { ensureFirebaseAuthReady } = await import('./authService');
  const ready = await ensureFirebaseAuthReady();
  if (!ready.ok) {
    return fail(ready.failure.code, ready.failure);
  }

  const AppleAuthentication = loadAppleAuthentication();
  if (!AppleAuthentication) {
    const failure = normalizeAppleAuthFailure(null, 'availability', {
      code: 'apple-not-available',
    });
    return fail('apple-not-available', failure);
  }

  let available = false;
  try {
    available = await AppleAuthentication.isAvailableAsync();
  } catch (error) {
    const failure = normalizeAppleAuthFailure(error, 'availability', {
      code: 'apple-not-available',
    });
    return fail('apple-not-available', failure);
  }

  logAppleAuthConfig(available);
  logAppleAuthFlow(
    baseFlowFields({
      stage: 'availability',
      result: available ? 'success' : 'failure',
      code: available ? 'apple-available' : 'apple-not-available',
    }),
  );

  if (!available) {
    const failure = normalizeAppleAuthFailure(null, 'availability', {
      code: 'apple-not-available',
    });
    return fail('apple-not-available', failure);
  }

  let hasRawNonce = false;
  let hasHashedNonce = false;
  let hasIdentityToken = false;
  let hasAuthorizationCode = false;
  let hasEmail = false;
  let hasFullName = false;
  let hasAppleUserId = false;

  try {
    const nonceResult = await generateSecureNonceAsync(32);
    if (!nonceResult.ok) {
      const failure = normalizeAppleAuthFailure(null, 'native-request-start', {
        code: 'crypto-unavailable',
      });
      return fail('crypto-unavailable', failure, { hasRawNonce, hasHashedNonce });
    }

    const rawNonce = nonceResult.nonce;
    hasRawNonce = true;

    const hashedResult = await sha256(rawNonce);
    if (!hashedResult.ok) {
      const failure = normalizeAppleAuthFailure(null, 'native-request-start', {
        code: 'crypto-unavailable',
      });
      return fail('crypto-unavailable', failure, { hasRawNonce, hasHashedNonce: false });
    }

    const hashedNonce = hashedResult.hash;
    hasHashedNonce = hashedNonce.length > 0;

    logAppleAuthFlow(
      baseFlowFields({
        stage: 'native-request-start',
        result: 'info',
        hasRawNonce,
        hasHashedNonce,
      }),
    );

    const appleCredential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });

    logAppleAuthFlow(
      baseFlowFields({
        stage: 'native-request-success',
        result: 'success',
        hasRawNonce,
        hasHashedNonce,
        hasIdentityToken: Boolean(appleCredential.identityToken),
        hasAuthorizationCode: Boolean(appleCredential.authorizationCode),
        hasEmail: Boolean(appleCredential.email),
        hasFullName: Boolean(appleCredential.fullName),
        hasAppleUserId: Boolean(appleCredential.user),
      }),
    );

    const identityToken =
      typeof appleCredential.identityToken === 'string'
        ? appleCredential.identityToken.trim()
        : '';
    hasIdentityToken = identityToken.length > 0;
    hasAuthorizationCode =
      typeof appleCredential.authorizationCode === 'string' &&
      appleCredential.authorizationCode.trim().length > 0;
    hasAppleUserId = typeof appleCredential.user === 'string' && appleCredential.user.trim().length > 0;
    hasEmail = typeof appleCredential.email === 'string' && appleCredential.email.trim().length > 0;
    const fullName = formatAppleFullName(appleCredential.fullName);
    hasFullName = Boolean(fullName);

    logAppleAuthFlow(
      baseFlowFields({
        stage: 'identity-token-validation',
        result: hasIdentityToken ? 'success' : 'failure',
        code: hasIdentityToken ? 'identity-token-present' : 'APPLE_IDENTITY_TOKEN_MISSING',
        normalizedCode: hasIdentityToken ? undefined : 'APPLE_IDENTITY_TOKEN_MISSING',
        hasIdentityToken,
        hasAuthorizationCode,
        hasEmail,
        hasFullName,
        hasAppleUserId,
        hasRawNonce,
        hasHashedNonce,
      }),
    );

    if (!hasIdentityToken) {
      const failure = normalizeAppleAuthFailure(null, 'identity-token-validation', {
        code: 'APPLE_IDENTITY_TOKEN_MISSING',
      });
      return fail('APPLE_IDENTITY_TOKEN_MISSING', failure, {
        hasIdentityToken,
        hasAuthorizationCode,
        hasEmail,
        hasFullName,
        hasAppleUserId,
        hasRawNonce,
        hasHashedNonce,
      });
    }

    const provider = new OAuthProvider('apple.com');
    const credential = provider.credential(
      createAppleOAuthCredentialParams(identityToken, rawNonce),
    );

    logAppleAuthFlow(
      baseFlowFields({
        stage: 'firebase-credential-created',
        result: 'success',
        code: 'firebase-credential-created',
        hasIdentityToken,
        hasAuthorizationCode,
        hasEmail,
        hasFullName,
        hasAppleUserId,
        hasRawNonce,
        hasHashedNonce,
      }),
    );

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
    const extracted = extractSafeAppleErrorFields(error);
    const failure = normalizeAppleAuthFailure(error, 'native-request-start');
    const mappedError =
      failure.code === 'ERR_REQUEST_CANCELED'
        ? 'cancelled'
        : failure.code === 'crypto-unavailable'
          ? 'crypto-unavailable'
          : failure.code;

    logAppleAuthFlow(
      baseFlowFields({
        stage: 'native-request-start',
        result: failure.code === 'ERR_REQUEST_CANCELED' ? 'cancel' : 'failure',
        name: extracted.name,
        code: failure.code,
        message: extracted.message,
        nativeCode: extracted.nativeCode,
        firebaseCode: extracted.firebaseCode,
        domain: extracted.domain,
        hasIdentityToken,
        hasAuthorizationCode,
        hasEmail,
        hasFullName,
        hasAppleUserId,
        hasRawNonce,
        hasHashedNonce,
      }),
    );

    return fail(mappedError, failure, {
      hasIdentityToken,
      hasAuthorizationCode,
      hasEmail,
      hasFullName,
      hasAppleUserId,
      hasRawNonce,
      hasHashedNonce,
    });
  }
}

/**
 * Firebase Auth readiness + error preservation helpers.
 * Pure — safe for Node regression tests.
 */

import { FIREBASE_RUNTIME_CONFIG_MISMATCH } from '../config/firebaseRuntimeContract';

export const AUTH_NOT_READY = 'AUTH_NOT_READY';
export const AUTH_INSTANCE_UNAVAILABLE = 'AUTH_INSTANCE_UNAVAILABLE';
export const FIREBASE_CONFIG_MISSING = 'FIREBASE_CONFIG_MISSING';
export const MIXED_FIREBASE_SDK_CREDENTIAL = 'MIXED_FIREBASE_SDK_CREDENTIAL';
export const LEGACY_AUTH_UNAVAILABLE = 'auth-unavailable';

export type AuthReadinessSnapshot = {
  hasFirebaseApp: boolean;
  hasAuthInstance: boolean;
  hasCurrentUser: boolean;
  currentUserAnonymous: boolean | null;
  providerIds: string[];
  authAppName: string | null;
  authProjectId: string | null;
};

export type AuthReadinessDecision = {
  ready: boolean;
  shouldStartApple: boolean;
  stage: 'auth-readiness' | 'config-validation';
  code: string;
  firebaseCode: string | null;
  message: string | null;
  usedFallback: boolean;
};

const SENSITIVE_KEY_PATTERN =
  /(token|nonce|authorizationcode|identitytoken|email|fullname|uid|private.?key|secret|idtoken|password|apiKey)/i;

function readErrorProp(error: unknown, key: string): unknown {
  if (!error || (typeof error !== 'object' && typeof error !== 'function')) {
    return undefined;
  }
  try {
    return Reflect.get(error as object, key);
  } catch {
    return undefined;
  }
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return null;
}

export function preserveAuthError(error: unknown, fallbackCode: string): {
  code: string;
  message: string | null;
  firebaseCode: string | null;
  usedFallback: boolean;
} {
  if (error == null) {
    return {
      code: fallbackCode,
      message: null,
      firebaseCode: null,
      usedFallback: true,
    };
  }

  const code =
    asNonEmptyString(readErrorProp(error, 'code')) ??
    (error instanceof Error && error.message === LEGACY_AUTH_UNAVAILABLE
      ? null
      : null);
  const message =
    asNonEmptyString(readErrorProp(error, 'message')) ??
    (error instanceof Error ? asNonEmptyString(error.message) : asNonEmptyString(error));

  const firebaseCode =
    code?.startsWith('auth/')
      ? code
      : message?.match(/auth\/[a-z0-9-]+/i)?.[0] ?? null;

  if (firebaseCode) {
    return {
      code: firebaseCode,
      message,
      firebaseCode,
      usedFallback: false,
    };
  }

  if (code && code !== LEGACY_AUTH_UNAVAILABLE) {
    return {
      code,
      message,
      firebaseCode: null,
      usedFallback: false,
    };
  }

  if (message && message !== LEGACY_AUTH_UNAVAILABLE && !message.startsWith('auth-unavailable')) {
    return {
      code: message,
      message,
      firebaseCode: null,
      usedFallback: false,
    };
  }

  return {
    code: fallbackCode,
    message,
    firebaseCode: null,
    usedFallback: true,
  };
}

export function resolveAuthReadiness(input: {
  firebaseEnabled: boolean;
  hasFirebaseApp: boolean;
  hasAuthInstance: boolean;
  hasCurrentUser: boolean;
  currentUserAnonymous: boolean | null;
  authStateResolved: boolean;
  anonymousBootstrapCompleted: boolean;
  projectMatches: boolean;
  bundleMatches: boolean;
  appInitError?: unknown;
  authInitError?: unknown;
  anonymousAuthError?: unknown;
  missingConfigKeys?: string[];
}): AuthReadinessDecision {
  if (!input.projectMatches || !input.bundleMatches) {
    return {
      ready: false,
      shouldStartApple: false,
      stage: 'config-validation',
      code: FIREBASE_RUNTIME_CONFIG_MISMATCH,
      firebaseCode: null,
      message: 'Firebase yapılandırması eşleşmiyor.',
      usedFallback: false,
    };
  }

  if (!input.firebaseEnabled) {
    return {
      ready: false,
      shouldStartApple: false,
      stage: 'auth-readiness',
      code: FIREBASE_CONFIG_MISSING,
      firebaseCode: null,
      message: (input.missingConfigKeys ?? []).length
        ? `missing:${input.missingConfigKeys?.join(',')}`
        : 'Firebase config missing',
      usedFallback: false,
    };
  }

  if (input.appInitError != null) {
    const preserved = preserveAuthError(input.appInitError, AUTH_INSTANCE_UNAVAILABLE);
    return {
      ready: false,
      shouldStartApple: false,
      stage: 'auth-readiness',
      code: preserved.code,
      firebaseCode: preserved.firebaseCode,
      message: preserved.message,
      usedFallback: preserved.usedFallback,
    };
  }

  if (!input.hasFirebaseApp) {
    return {
      ready: false,
      shouldStartApple: false,
      stage: 'auth-readiness',
      code: AUTH_INSTANCE_UNAVAILABLE,
      firebaseCode: null,
      message: 'Firebase app unavailable',
      usedFallback: true,
    };
  }

  if (input.authInitError != null) {
    const preserved = preserveAuthError(input.authInitError, AUTH_INSTANCE_UNAVAILABLE);
    return {
      ready: false,
      shouldStartApple: false,
      stage: 'auth-readiness',
      code: preserved.code,
      firebaseCode: preserved.firebaseCode,
      message: preserved.message,
      usedFallback: preserved.usedFallback,
    };
  }

  if (!input.hasAuthInstance) {
    return {
      ready: false,
      shouldStartApple: false,
      stage: 'auth-readiness',
      code: AUTH_INSTANCE_UNAVAILABLE,
      firebaseCode: null,
      message: 'Firebase Auth instance unavailable',
      usedFallback: true,
    };
  }

  if (!input.authStateResolved || !input.anonymousBootstrapCompleted) {
    return {
      ready: false,
      shouldStartApple: false,
      stage: 'auth-readiness',
      code: AUTH_NOT_READY,
      firebaseCode: null,
      message: 'Firebase Auth bootstrap incomplete',
      usedFallback: false,
    };
  }

  if (!input.hasCurrentUser && input.anonymousAuthError != null) {
    const preserved = preserveAuthError(input.anonymousAuthError, AUTH_NOT_READY);
    return {
      ready: false,
      shouldStartApple: false,
      stage: 'auth-readiness',
      code: preserved.code,
      firebaseCode: preserved.firebaseCode,
      message: preserved.message,
      usedFallback: preserved.usedFallback,
    };
  }

  if (!input.hasCurrentUser) {
    return {
      ready: false,
      shouldStartApple: false,
      stage: 'auth-readiness',
      code: AUTH_NOT_READY,
      firebaseCode: null,
      message: 'currentUser unavailable after bootstrap',
      usedFallback: false,
    };
  }

  return {
    ready: true,
    shouldStartApple: true,
    stage: 'auth-readiness',
    code: 'AUTH_READY',
    firebaseCode: null,
    message: null,
    usedFallback: false,
  };
}

export function isModularFirebaseAuthCredential(credential: unknown): boolean {
  if (!credential || typeof credential !== 'object') {
    return false;
  }
  const value = credential as {
    providerId?: unknown;
    signInMethod?: unknown;
    _auth?: unknown;
    native?: unknown;
  };
  if (value._auth != null || value.native != null) {
    return false;
  }
  return typeof value.providerId === 'string' && value.providerId.length > 0;
}

export function createAuthReadinessLogPayload(
  snapshot: AuthReadinessSnapshot,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    hasFirebaseApp: snapshot.hasFirebaseApp,
    hasAuthInstance: snapshot.hasAuthInstance,
    hasCurrentUser: snapshot.hasCurrentUser,
    currentUserAnonymous: snapshot.currentUserAnonymous,
    providerIds: snapshot.providerIds,
    authAppName: snapshot.authAppName,
    authProjectId: snapshot.authProjectId,
  };
  assertSafeAuthReadinessLogPayload(payload);
  return payload;
}

export function assertSafeAuthReadinessLogPayload(payload: Record<string, unknown>): void {
  for (const key of Object.keys(payload)) {
    if (SENSITIVE_KEY_PATTERN.test(key) && !/^has[A-Z]/.test(key) && key !== 'authAppName') {
      throw new Error(`Refusing to log sensitive auth-readiness key: ${key}`);
    }
    const value = payload[key];
    if (typeof value === 'string' && /^AIza[0-9A-Za-z_-]{20,}$/.test(value)) {
      throw new Error('Refusing to log Firebase API key');
    }
  }
}

/**
 * Canonical Firebase / iOS identity contract.
 * Pure helpers — safe to import from Node verify/regression scripts.
 */

export const EXPECTED_FIREBASE_PROJECT_ID = 'logisticore-53ab4';
export const EXPECTED_IOS_BUNDLE_ID = 'com.ethemsincar.logisticore';
export const EXPECTED_FIREBASE_AUTH_DOMAIN = 'logisticore-53ab4.firebaseapp.com';
export const EXPECTED_FIREBASE_MESSAGING_SENDER_ID = '363783837598';

export const FORBIDDEN_IOS_BUNDLE_IDS = [
  'com.anonymous.logisticore',
  'com.ethemsincar.echoespeak',
] as const;

export const FIREBASE_RUNTIME_CONFIG_MISMATCH = 'FIREBASE_RUNTIME_CONFIG_MISMATCH';

export type FirebasePublicConfig = {
  apiKey?: string;
  authDomain?: string;
  projectId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
};

export type FirebaseRuntimeConfigSnapshot = {
  firebaseAppName: string | null;
  firebaseProjectId: string | null;
  firebaseAppIdPrefix: string | null;
  authDomain: string | null;
  currentBundleId: string | null;
  expectedProjectId: string;
  expectedBundleId: string;
  projectMatches: boolean;
  bundleMatches: boolean;
  firebaseAppsCount: number;
  authAppName: string | null;
  authProjectId: string | null;
  authAppIdPrefix: string | null;
  currentUserIsAnonymous: boolean | null;
  currentUserProviderIds: string[];
};

const SENSITIVE_KEY_PATTERN =
  /(apiKey|token|nonce|authorizationcode|identitytoken|email|fullname|uid|private.?key|secret|idtoken|password)/i;

const ALLOWED_SENSITIVE_LOOKALIKE_KEYS = new Set([
  'firebaseAppName',
  'firebaseProjectId',
  'firebaseAppIdPrefix',
  'authDomain',
  'currentBundleId',
  'expectedProjectId',
  'expectedBundleId',
  'projectMatches',
  'bundleMatches',
  'firebaseAppsCount',
  'authAppName',
  'authProjectId',
  'authAppIdPrefix',
  'currentUserIsAnonymous',
  'currentUserProviderIds',
]);

export function normalizeConfigValue(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function toFirebaseAppIdPrefix(appId: string | null | undefined): string | null {
  const value = normalizeConfigValue(appId) ?? null;
  if (!value) {
    return null;
  }
  const parts = value.split(':');
  if (parts.length >= 4) {
    const hash = parts[3] ?? '';
    const visible = hash.slice(0, 6);
    return `${parts[0]}:${parts[1]}:${parts[2]}:${visible}${hash.length > 6 ? '…' : ''}`;
  }
  return `${value.slice(0, 18)}${value.length > 18 ? '…' : ''}`;
}

export function isForbiddenIosBundleId(bundleId: string | null | undefined): boolean {
  const value = normalizeConfigValue(bundleId);
  if (!value) {
    return false;
  }
  return (FORBIDDEN_IOS_BUNDLE_IDS as readonly string[]).includes(value);
}

export function evaluateFirebaseRuntimeConfig(input: {
  firebaseAppName?: string | null;
  firebaseProjectId?: string | null;
  firebaseAppId?: string | null;
  authDomain?: string | null;
  currentBundleId?: string | null;
  firebaseAppsCount?: number;
  authAppName?: string | null;
  authProjectId?: string | null;
  authAppId?: string | null;
  currentUserIsAnonymous?: boolean | null;
  currentUserProviderIds?: string[];
}): FirebaseRuntimeConfigSnapshot {
  const firebaseProjectId = normalizeConfigValue(input.firebaseProjectId) ?? null;
  const currentBundleId = normalizeConfigValue(input.currentBundleId) ?? null;
  const authProjectId = normalizeConfigValue(input.authProjectId) ?? null;

  return {
    firebaseAppName: normalizeConfigValue(input.firebaseAppName) ?? null,
    firebaseProjectId,
    firebaseAppIdPrefix: toFirebaseAppIdPrefix(input.firebaseAppId),
    authDomain: normalizeConfigValue(input.authDomain) ?? null,
    currentBundleId,
    expectedProjectId: EXPECTED_FIREBASE_PROJECT_ID,
    expectedBundleId: EXPECTED_IOS_BUNDLE_ID,
    projectMatches: firebaseProjectId === EXPECTED_FIREBASE_PROJECT_ID,
    bundleMatches: currentBundleId === EXPECTED_IOS_BUNDLE_ID,
    firebaseAppsCount: Number.isFinite(input.firebaseAppsCount) ? Number(input.firebaseAppsCount) : 0,
    authAppName: normalizeConfigValue(input.authAppName) ?? null,
    authProjectId,
    authAppIdPrefix: toFirebaseAppIdPrefix(input.authAppId),
    currentUserIsAnonymous:
      typeof input.currentUserIsAnonymous === 'boolean' ? input.currentUserIsAnonymous : null,
    currentUserProviderIds: Array.isArray(input.currentUserProviderIds)
      ? input.currentUserProviderIds.filter((id): id is string => typeof id === 'string')
      : [],
  };
}

export function isFirebaseRuntimeConfigValid(snapshot: FirebaseRuntimeConfigSnapshot): boolean {
  return (
    snapshot.projectMatches &&
    snapshot.bundleMatches &&
    snapshot.firebaseAppsCount === 1 &&
    snapshot.authProjectId === EXPECTED_FIREBASE_PROJECT_ID &&
    Boolean(snapshot.authAppName) &&
    !isForbiddenIosBundleId(snapshot.currentBundleId)
  );
}

export function shouldBlockAppleAuthForRuntimeConfig(
  snapshot: FirebaseRuntimeConfigSnapshot,
): boolean {
  return !isFirebaseRuntimeConfigValid(snapshot);
}

export function assertSafeFirebaseRuntimeLogPayload(payload: Record<string, unknown>): void {
  for (const key of Object.keys(payload)) {
    if (ALLOWED_SENSITIVE_LOOKALIKE_KEYS.has(key)) {
      continue;
    }
    if (SENSITIVE_KEY_PATTERN.test(key) && !/^has[A-Z]/.test(key) && !/Prefix$/.test(key)) {
      throw new Error(`Refusing to log sensitive firebase-runtime key: ${key}`);
    }
    const value = payload[key];
    if (typeof value === 'string' && /^AIza[0-9A-Za-z_-]{20,}$/.test(value)) {
      throw new Error('Refusing to log Firebase API key');
    }
  }
}

export function createFirebaseRuntimeLogPayload(
  snapshot: FirebaseRuntimeConfigSnapshot,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    firebaseAppName: snapshot.firebaseAppName,
    firebaseProjectId: snapshot.firebaseProjectId,
    firebaseAppIdPrefix: snapshot.firebaseAppIdPrefix,
    authDomain: snapshot.authDomain,
    currentBundleId: snapshot.currentBundleId,
    expectedProjectId: snapshot.expectedProjectId,
    expectedBundleId: snapshot.expectedBundleId,
    projectMatches: snapshot.projectMatches,
    bundleMatches: snapshot.bundleMatches,
    firebaseAppsCount: snapshot.firebaseAppsCount,
  };
  assertSafeFirebaseRuntimeLogPayload(payload);
  return payload;
}

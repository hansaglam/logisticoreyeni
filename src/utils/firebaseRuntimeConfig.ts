import Constants from 'expo-constants';
import { getApp, getApps } from 'firebase/app';

import publicFirebaseConfig from '../config/firebase.public.json';
import {
  createFirebaseRuntimeLogPayload,
  evaluateFirebaseRuntimeConfig,
  EXPECTED_FIREBASE_PROJECT_ID,
  EXPECTED_IOS_BUNDLE_ID,
  FIREBASE_RUNTIME_CONFIG_MISMATCH,
  isFirebaseRuntimeConfigValid,
  normalizeConfigValue,
  shouldBlockAppleAuthForRuntimeConfig,
  type FirebasePublicConfig,
  type FirebaseRuntimeConfigSnapshot,
} from '../config/firebaseRuntimeContract';
import { getFirebaseAppSafe, getFirebaseAuthSafe, getResolvedFirebaseConfig } from '../services/firebase';
import type { AppleAuthFailure } from './appleAuthDiagnostics';

let runtimeConfigLogged = false;

export function getRuntimeBundleId(): string | null {
  return normalizeConfigValue(Constants.expoConfig?.ios?.bundleIdentifier) ?? null;
}

export function getPublicFirebaseFallbackConfig(): FirebasePublicConfig {
  return publicFirebaseConfig;
}

export function captureFirebaseRuntimeConfigSnapshot(): FirebaseRuntimeConfigSnapshot {
  const resolved = getResolvedFirebaseConfig();
  const app = getFirebaseAppSafe() ?? (getApps().length > 0 ? getApp() : null);
  const auth = getFirebaseAuthSafe();
  const authApp = auth?.app ?? null;
  const user = auth?.currentUser ?? null;

  return evaluateFirebaseRuntimeConfig({
    firebaseAppName: app?.name ?? null,
    firebaseProjectId: app?.options.projectId ?? resolved.projectId ?? null,
    firebaseAppId: typeof app?.options.appId === 'string' ? app.options.appId : resolved.appId ?? null,
    authDomain:
      (typeof app?.options.authDomain === 'string' ? app.options.authDomain : null) ??
      resolved.authDomain ??
      null,
    currentBundleId: getRuntimeBundleId(),
    firebaseAppsCount: getApps().length,
    authAppName: authApp?.name ?? null,
    authProjectId: authApp?.options.projectId ?? null,
    authAppId: typeof authApp?.options.appId === 'string' ? authApp.options.appId : null,
    currentUserIsAnonymous: user ? Boolean(user.isAnonymous) : null,
    currentUserProviderIds: (user?.providerData ?? []).map((entry) => entry.providerId),
  });
}

export function logFirebaseRuntimeConfigOnce(): FirebaseRuntimeConfigSnapshot {
  const snapshot = captureFirebaseRuntimeConfigSnapshot();
  if (!runtimeConfigLogged) {
    runtimeConfigLogged = true;
    console.warn('[firebase-runtime-config]', createFirebaseRuntimeLogPayload(snapshot));
  }
  return snapshot;
}

export function createFirebaseRuntimeMismatchFailure(
  snapshot: FirebaseRuntimeConfigSnapshot = captureFirebaseRuntimeConfigSnapshot(),
): AppleAuthFailure {
  return {
    stage: 'config-validation',
    code: FIREBASE_RUNTIME_CONFIG_MISMATCH,
    message: 'Firebase yapılandırması eşleşmiyor.',
    recoverable: false,
    projectId: snapshot.firebaseProjectId,
    bundleId: snapshot.currentBundleId,
  };
}

export function assertExpectedFirebaseAuthBinding(): {
  ok: true;
  snapshot: FirebaseRuntimeConfigSnapshot;
} | {
  ok: false;
  snapshot: FirebaseRuntimeConfigSnapshot;
  failure: AppleAuthFailure;
} {
  const snapshot = captureFirebaseRuntimeConfigSnapshot();
  if (isFirebaseRuntimeConfigValid(snapshot)) {
    return { ok: true, snapshot };
  }
  return {
    ok: false,
    snapshot,
    failure: createFirebaseRuntimeMismatchFailure(snapshot),
  };
}

export { EXPECTED_FIREBASE_PROJECT_ID, EXPECTED_IOS_BUNDLE_ID, shouldBlockAppleAuthForRuntimeConfig };

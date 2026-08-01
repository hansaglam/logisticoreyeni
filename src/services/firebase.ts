/**
 * Firebase başlatma — Expo / React Native (Metro) uyumlu singleton.
 *
 * Auth yalnızca initializeAuth + AsyncStorage persistence ile kurulur.
 * getAuth kullanılmaz (RN'de AsyncStorage warning / register hatası üretir).
 *
 * Env: process.env.EXPO_PUBLIC_* → Constants.expoConfig.extra.firebase
 */

import ReactNativeAsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  getReactNativePersistence,
  initializeAuth,
  type Auth,
} from 'firebase/auth';
import { getFirestore, initializeFirestore, type Firestore } from 'firebase/firestore';
import { getFunctions, type Functions } from 'firebase/functions';
import { getStorage, type FirebaseStorage } from 'firebase/storage';

import { devLog, devWarn } from '../utils/devLog';

export interface FirebaseConfig {
  apiKey?: string;
  authDomain?: string;
  projectId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
}

type FirebaseConfigKey = keyof FirebaseConfig;

const AUTH_GLOBAL_KEY = '__logisticoreFirebaseAuth';
const FIRESTORE_GLOBAL_KEY = '__logisticoreFirebaseFirestore';
const FUNCTIONS_GLOBAL_KEY = '__logisticoreFirebaseFunctions';
const STORAGE_GLOBAL_KEY = '__logisticoreFirebaseStorage';
export const FIREBASE_FUNCTIONS_REGION = 'us-central1';

type GlobalAuthStore = typeof globalThis & {
  [AUTH_GLOBAL_KEY]?: Auth;
};

type GlobalFirestoreStore = typeof globalThis & {
  [FIRESTORE_GLOBAL_KEY]?: Firestore;
};

type GlobalServiceStore = typeof globalThis & {
  [FUNCTIONS_GLOBAL_KEY]?: Map<string, Functions>;
  [STORAGE_GLOBAL_KEY]?: FirebaseStorage;
};

let appInstance: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let firestoreInstance: Firestore | null = null;
let storageInstance: FirebaseStorage | null = null;
let authInitFailed = false;
let firestoreInitFailed = false;
let envCheckLogged = false;
let missingConfigLogged = false;
let enabledLogged = false;
let authInitializedLogged = false;
let firestoreInitializedLogged = false;

function normalizeEnvValue(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readExtraFirebaseConfig(): Partial<FirebaseConfig> {
  const extra = Constants.expoConfig?.extra as
    | { firebase?: Partial<Record<FirebaseConfigKey, unknown>> }
    | undefined;
  const firebaseExtra = extra?.firebase;
  if (!firebaseExtra || typeof firebaseExtra !== 'object') {
    return {};
  }

  return {
    apiKey: normalizeEnvValue(firebaseExtra.apiKey),
    authDomain: normalizeEnvValue(firebaseExtra.authDomain),
    projectId: normalizeEnvValue(firebaseExtra.projectId),
    storageBucket: normalizeEnvValue(firebaseExtra.storageBucket),
    messagingSenderId: normalizeEnvValue(firebaseExtra.messagingSenderId),
    appId: normalizeEnvValue(firebaseExtra.appId),
  };
}

function readFirebaseConfig(): FirebaseConfig {
  const fromExtra = readExtraFirebaseConfig();

  return {
    apiKey:
      normalizeEnvValue(process.env.EXPO_PUBLIC_FIREBASE_API_KEY) ?? fromExtra.apiKey,
    authDomain:
      normalizeEnvValue(process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN) ?? fromExtra.authDomain,
    projectId:
      normalizeEnvValue(process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID) ?? fromExtra.projectId,
    storageBucket:
      normalizeEnvValue(process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET) ??
      fromExtra.storageBucket,
    messagingSenderId:
      normalizeEnvValue(process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID) ??
      fromExtra.messagingSenderId,
    appId: normalizeEnvValue(process.env.EXPO_PUBLIC_FIREBASE_APP_ID) ?? fromExtra.appId,
  };
}

function getMissingFirebaseEnvKeys(config: FirebaseConfig = readFirebaseConfig()): string[] {
  return (Object.entries(config) as Array<[FirebaseConfigKey, string | undefined]>)
    .filter(([, value]) => !value || String(value).trim().length === 0)
    .map(([key]) => key);
}

function logEnvCheckOnce(): void {
  if (envCheckLogged) {
    return;
  }
  envCheckLogged = true;

  const config = readFirebaseConfig();
  devLog('[firebase] env check', {
    apiKey: Boolean(config.apiKey),
    authDomain: Boolean(config.authDomain),
    projectId: Boolean(config.projectId),
    storageBucket: Boolean(config.storageBucket),
    messagingSenderId: Boolean(config.messagingSenderId),
    appId: Boolean(config.appId),
  });
}

export function hasFirebaseConfig(): boolean {
  logEnvCheckOnce();
  return getMissingFirebaseEnvKeys().length === 0;
}

export function isFirebaseEnabled(): boolean {
  return hasFirebaseConfig();
}

export function getMissingFirebaseConfigKeys(): string[] {
  return getMissingFirebaseEnvKeys();
}

/** Audit / validate — tam secret değerleri döndürmez; yalnız presence + projectId. */
export function readFirebaseConfigForAudit(): {
  projectId?: string;
  apiKey?: string;
  authDomain?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
} {
  return readFirebaseConfig();
}

function logMissingConfigOnce(): void {
  if (missingConfigLogged) {
    return;
  }
  missingConfigLogged = true;
  console.warn('[firebase] missing config keys', getMissingFirebaseEnvKeys());
}

function getCachedAuthFromGlobal(): Auth | null {
  return (globalThis as GlobalAuthStore)[AUTH_GLOBAL_KEY] ?? null;
}

function cacheAuthGlobally(auth: Auth): void {
  (globalThis as GlobalAuthStore)[AUTH_GLOBAL_KEY] = auth;
}

function isAuthAlreadyInitializedError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return /already.*(initialized|exist)/i.test(String(error));
  }

  const code = 'code' in error ? String((error as { code?: string }).code ?? '') : '';
  const message = 'message' in error ? String((error as { message?: string }).message ?? '') : '';
  return (
    code === 'auth/already-initialized' ||
    /already.*(initialized|exist)/i.test(code) ||
    /already.*(initialized|exist)/i.test(message)
  );
}

export function getFirebaseAppSafe(): FirebaseApp | null {
  if (!isFirebaseEnabled()) {
    logMissingConfigOnce();
    return null;
  }

  if (appInstance) {
    return appInstance;
  }

  try {
    const firebaseConfig = readFirebaseConfig();
    appInstance =
      getApps().length > 0
        ? getApp()
        : initializeApp({
            apiKey: firebaseConfig.apiKey!,
            authDomain: firebaseConfig.authDomain,
            projectId: firebaseConfig.projectId!,
            storageBucket: firebaseConfig.storageBucket,
            messagingSenderId: firebaseConfig.messagingSenderId,
            appId: firebaseConfig.appId!,
          });

    if (!enabledLogged) {
      enabledLogged = true;
      devLog('[firebase] enabled');
    }

    return appInstance;
  } catch (error) {
    console.warn('[firebase] app initialization failed', error);
    return null;
  }
}

export function getFirebaseAuthSafe(): Auth | null {
  if (!isFirebaseEnabled()) {
    logMissingConfigOnce();
    return null;
  }

  if (authInstance) {
    return authInstance;
  }

  const cached = getCachedAuthFromGlobal();
  if (cached) {
    authInstance = cached;
    return authInstance;
  }

  if (authInitFailed) {
    return null;
  }

  const app = getFirebaseAppSafe();
  if (!app) {
    return null;
  }

  if (typeof getReactNativePersistence !== 'function') {
    console.warn(
      '[firebase] getReactNativePersistence unavailable — Metro RN resolve failed',
    );
    authInitFailed = true;
    return null;
  }

  try {
    authInstance = initializeAuth(app, {
      persistence: getReactNativePersistence(ReactNativeAsyncStorage),
    });
    cacheAuthGlobally(authInstance);

    if (!authInitializedLogged) {
      authInitializedLogged = true;
      devLog('[firebase] auth initialized with AsyncStorage persistence');
    }

    return authInstance;
  } catch (error) {
    if (isAuthAlreadyInitializedError(error)) {
      const existing = getCachedAuthFromGlobal();
      if (existing) {
        authInstance = existing;
        devLog('[firebase] auth reused after Fast Refresh');
        return authInstance;
      }

      try {
        authInstance = getAuth(app);
        cacheAuthGlobally(authInstance);
        devLog('[firebase] existing auth instance recovered from Firebase app');
        return authInstance;
      } catch (recoveryError) {
        console.warn('[firebase] existing auth instance recovery failed', recoveryError);
        authInitFailed = true;
        return null;
      }
    }

    console.warn('[firebase] auth initialization failed', error);
    authInitFailed = true;
    return null;
  }
}

export function getFirestoreSafe(): Firestore | null {
  if (!isFirebaseEnabled()) {
    logMissingConfigOnce();
    return null;
  }

  if (firestoreInstance) {
    return firestoreInstance;
  }

  const cached = (globalThis as GlobalFirestoreStore)[FIRESTORE_GLOBAL_KEY];
  if (cached) {
    firestoreInstance = cached;
    return firestoreInstance;
  }

  if (firestoreInitFailed) {
    return null;
  }

  const app = getFirebaseAppSafe();
  if (!app) {
    return null;
  }

  try {
    firestoreInstance = initializeFirestore(app, {
      experimentalForceLongPolling: true,
      ignoreUndefinedProperties: true,
    });
    (globalThis as GlobalFirestoreStore)[FIRESTORE_GLOBAL_KEY] = firestoreInstance;

    if (!firestoreInitializedLogged) {
      firestoreInitializedLogged = true;
      devLog('[firebase] firestore initialized with long polling');
    }

    return firestoreInstance;
  } catch (error) {
    try {
      firestoreInstance = getFirestore(app);
      (globalThis as GlobalFirestoreStore)[FIRESTORE_GLOBAL_KEY] = firestoreInstance;
      devLog('[firebase] firestore existing instance reused');
      return firestoreInstance;
    } catch (fallbackError) {
      firestoreInitFailed = true;
      const message =
        fallbackError instanceof Error
          ? fallbackError.message
          : error instanceof Error
            ? error.message
            : String(fallbackError);
      console.warn('[firebase] firestore initialization failed', {
        message,
        code:
          fallbackError &&
          typeof fallbackError === 'object' &&
          'code' in fallbackError &&
          typeof (fallbackError as { code?: unknown }).code === 'string'
            ? (fallbackError as { code: string }).code
            : null,
      });
      return null;
    }
  }
}

export function getFirebaseFunctionsSafe(
  region = FIREBASE_FUNCTIONS_REGION,
): Functions | null {
  const app = getFirebaseAppSafe();
  if (!app) return null;
  const globalStore = globalThis as GlobalServiceStore;
  const cache = globalStore[FUNCTIONS_GLOBAL_KEY] ?? new Map<string, Functions>();
  globalStore[FUNCTIONS_GLOBAL_KEY] = cache;
  const cached = cache.get(region);
  if (cached) return cached;
  const instance = getFunctions(app, region);
  cache.set(region, instance);
  return instance;
}

export function getFirebaseStorageSafe(): FirebaseStorage | null {
  if (storageInstance) return storageInstance;
  const globalStore = globalThis as GlobalServiceStore;
  const cached = globalStore[STORAGE_GLOBAL_KEY];
  if (cached) {
    storageInstance = cached;
    return cached;
  }
  const app = getFirebaseAppSafe();
  if (!app) return null;
  storageInstance = getStorage(app);
  globalStore[STORAGE_GLOBAL_KEY] = storageInstance;
  return storageInstance;
}

/** @deprecated Use getFirebaseAppSafe */
export function getFirebaseApp(): FirebaseApp | null {
  return getFirebaseAppSafe();
}

/** @deprecated Use getFirebaseAuthSafe */
export function getFirebaseAuth(): Auth | null {
  return getFirebaseAuthSafe();
}

/** @deprecated Use getFirestoreSafe */
export function getFirestoreDb(): Firestore | null {
  return getFirestoreSafe();
}

export const getFirebaseFunctions = getFirebaseFunctionsSafe;
export const getFirebaseStorage = getFirebaseStorageSafe;

/** @deprecated Prefer getFirebaseAppSafe / getFirebaseAuthSafe */
export function initializeFirebase(): boolean {
  return getFirebaseAppSafe() !== null && getFirebaseAuthSafe() !== null;
}

export function resetFirebaseFirestoreCache(): void {
  firestoreInstance = null;
  firestoreInitFailed = false;
  delete (globalThis as GlobalFirestoreStore)[FIRESTORE_GLOBAL_KEY];
}

/**
 * @deprecated Firebase Auth app-scoped bir singleton'dır ve oturum geçişlerinde
 * sıfırlanmamalıdır. Bu fonksiyon yalnız gerçek bootstrap retry'si için tutulur;
 * SDK instance/global cache bilinçli olarak korunur.
 */
export function resetFirebaseAuthCache(): void {
  authInitFailed = false;
}

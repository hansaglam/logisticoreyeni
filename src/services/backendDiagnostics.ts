/**
 * Internal Testing backend tanılama durumu.
 * UID / token / API key tutulmaz.
 */

import Constants from 'expo-constants';

import {
  getAdsDiagnosticsSnapshot,
  subscribeAdsDiagnostics,
  type AdsDiagnosticsSnapshot,
} from './adProvider';

export type BackendDiagStatus = 'idle' | 'ok' | 'failed' | 'skipped' | 'pending';

export type BackendDiagEntry = {
  status: BackendDiagStatus;
  code?: string | null;
  detail?: string | null;
  updatedAtMs?: number;
};

export type GlobalEconomyDiagnostics = {
  documentExists: boolean | null;
  validationPassed: boolean | null;
  source: 'live' | 'cached' | 'unavailable';
  snapshotAgeMs: number | null;
  fuelPriceFinite: boolean | null;
  cacheAvailable: boolean;
  cacheAgeMs: number | null;
};

export type BackendDiagnosticsSnapshot = {
  projectId: string;
  region: string;
  appCheck: 'disabled';
  authInitialized: boolean;
  currentUserKind: 'none' | 'anonymous' | 'google' | 'apple' | 'unknown';
  authReady: boolean;
  anonymousSignIn: BackendDiagEntry;
  globalEconomy: BackendDiagEntry;
  globalEconomyDetails: GlobalEconomyDiagnostics;
  googleSignIn: BackendDiagEntry;
  marketplaceCallable: BackendDiagEntry;
  ads: AdsDiagnosticsSnapshot;
};

type Listener = () => void;

const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of [...listeners]) listener();
}

let snapshot: BackendDiagnosticsSnapshot = {
  projectId: 'logisticore-53ab4',
  region: 'us-central1',
  appCheck: 'disabled',
  authInitialized: false,
  currentUserKind: 'none',
  authReady: false,
  anonymousSignIn: { status: 'idle' },
  globalEconomy: { status: 'idle' },
  globalEconomyDetails: {
    documentExists: null,
    validationPassed: null,
    source: 'unavailable',
    snapshotAgeMs: null,
    fuelPriceFinite: null,
    cacheAvailable: false,
    cacheAgeMs: null,
  },
  googleSignIn: { status: 'idle' },
  marketplaceCallable: { status: 'idle' },
  ads: getAdsDiagnosticsSnapshot(),
};

subscribeAdsDiagnostics(() => {
  snapshot = {
    ...snapshot,
    ads: getAdsDiagnosticsSnapshot(),
  };
  notify();
});

function touch(
  entry: BackendDiagEntry,
  patch: Partial<BackendDiagEntry>,
): BackendDiagEntry {
  return {
    ...entry,
    ...patch,
    updatedAtMs: Date.now(),
  };
}

export function getBackendDiagnosticsSnapshot(): BackendDiagnosticsSnapshot {
  return snapshot;
}

export function subscribeBackendDiagnostics(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setBackendDiagnosticsMeta(input: {
  projectId?: string | null;
  region?: string | null;
  authInitialized?: boolean;
  authReady?: boolean;
  currentUserKind?: BackendDiagnosticsSnapshot['currentUserKind'];
}): void {
  snapshot = {
    ...snapshot,
    projectId: input.projectId?.trim() || snapshot.projectId,
    region: input.region?.trim() || snapshot.region,
    authInitialized:
      input.authInitialized !== undefined
        ? input.authInitialized
        : snapshot.authInitialized,
    authReady:
      input.authReady !== undefined ? input.authReady : snapshot.authReady,
    currentUserKind: input.currentUserKind ?? snapshot.currentUserKind,
  };
  notify();
}

export function recordAnonymousSignInResult(input: {
  attempted: boolean;
  success: boolean;
  firebaseCode?: string | null;
  detail?: string | null;
}): void {
  snapshot = {
    ...snapshot,
    anonymousSignIn: touch(snapshot.anonymousSignIn, {
      status: input.success ? 'ok' : input.attempted ? 'failed' : 'skipped',
      code: input.firebaseCode ?? null,
      detail: input.detail ?? null,
    }),
  };
  notify();
}

export function recordGlobalEconomyResult(input: {
  success: boolean;
  code?: string | null;
  detail?: string | null;
  diagnostics?: Partial<GlobalEconomyDiagnostics>;
}): void {
  snapshot = {
    ...snapshot,
    globalEconomy: touch(snapshot.globalEconomy, {
      status: input.success ? 'ok' : 'failed',
      code: input.code ?? null,
      detail: input.detail ?? null,
    }),
    globalEconomyDetails: {
      ...snapshot.globalEconomyDetails,
      ...(input.diagnostics ?? {}),
    },
  };
  notify();
}

export function recordGoogleSignInResult(input: {
  success: boolean;
  code?: string | null;
  detail?: string | null;
}): void {
  snapshot = {
    ...snapshot,
    googleSignIn: touch(snapshot.googleSignIn, {
      status: input.success ? 'ok' : 'failed',
      code: input.code ?? null,
      detail: input.detail ?? null,
    }),
  };
  notify();
}

export function recordMarketplaceCallableResult(input: {
  success: boolean;
  code?: string | null;
  detail?: string | null;
}): void {
  snapshot = {
    ...snapshot,
    marketplaceCallable: touch(snapshot.marketplaceCallable, {
      status: input.success ? 'ok' : 'failed',
      code: input.code ?? null,
      detail: input.detail ?? null,
    }),
  };
  notify();
}

export function resolveCurrentUserKind(user: {
  isAnonymous?: boolean;
  providerData?: Array<{ providerId?: string | null }>;
} | null): BackendDiagnosticsSnapshot['currentUserKind'] {
  if (!user) return 'none';
  if (user.isAnonymous) return 'anonymous';
  const providers = (user.providerData ?? []).map((entry) => entry.providerId ?? '');
  if (providers.some((id) => id === 'google.com' || id.includes('google'))) {
    return 'google';
  }
  if (providers.some((id) => id === 'apple.com' || id.includes('apple'))) {
    return 'apple';
  }
  return 'unknown';
}

export function isBackendDiagnosticsEnabled(): boolean {
  // Production store build: tamamen gizli.
  // Internal/dev: yalnız açık flag veya __DEV__.
  if (typeof __DEV__ !== 'undefined' && __DEV__) return true;
  if (process.env.EXPO_PUBLIC_BACKEND_DIAGNOSTICS_ENABLED === 'true') return true;
  const extra = Constants.expoConfig?.extra as
    | { features?: Record<string, unknown> }
    | undefined;
  if (extra?.features?.backendDiagnosticsEnabled === 'true') return true;
  return false;
}

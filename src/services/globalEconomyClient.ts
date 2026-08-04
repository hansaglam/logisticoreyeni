import { ECONOMY_CONFIG_VERSION, MARKET_EPOCH_MS } from '../simulation/economyClock';
import { SUPPORTED_GLOBAL_SNAPSHOT_VERSION } from '../simulation/globalMarketAvailability';
import type { GlobalEconomySnapshot, GlobalMarketSyncStatus } from '../types/game';

export type GlobalEconomyLoadErrorCode =
  | 'unauthenticated'
  | 'permission-denied'
  | 'unavailable'
  | 'not-found'
  | 'deadline-exceeded'
  | 'failed-precondition'
  | 'invalid-snapshot'
  | 'stale-snapshot'
  | 'parse-failed'
  | 'unknown';

export type GlobalEconomySource = 'live' | 'cached' | 'unavailable';

export interface GlobalEconomyValidationResult {
  marketDataValid: boolean;
  fuelPriceValid: boolean;
  historyValid: boolean;
  generatedAtValid: boolean;
  supportedVersion: boolean;
}

export interface ParsedGlobalEconomyDocument {
  snapshot: GlobalEconomySnapshot;
  serverTimeMs?: number;
  validation: GlobalEconomyValidationResult;
}

export class GlobalEconomyClientError extends Error {
  constructor(
    public readonly code: GlobalEconomyLoadErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'GlobalEconomyClientError';
  }
}

export function canReadGlobalEconomy(input: {
  authReady: boolean;
  userPresent: boolean;
}): boolean {
  return input.authReady && input.userPresent;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseFirestoreMillis(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isFinite(millis) ? millis : null;
  }
  if (!isRecord(value)) return null;

  const toMillis = value.toMillis;
  if (typeof toMillis === 'function') {
    try {
      const millis = Number(toMillis.call(value));
      if (Number.isFinite(millis)) return millis;
    } catch {
      // Fall through to serialized timestamp parsing.
    }
  }

  const seconds = Number(value.seconds ?? value._seconds);
  const nanoseconds = Number(value.nanoseconds ?? value._nanoseconds ?? 0);
  if (Number.isFinite(seconds) && Number.isFinite(nanoseconds)) {
    const millis = seconds * 1_000 + nanoseconds / 1_000_000;
    return Number.isFinite(millis) ? millis : null;
  }
  return null;
}

export function validateGlobalEconomySnapshot(
  snapshot: Partial<GlobalEconomySnapshot> | null | undefined,
): GlobalEconomyValidationResult {
  const supportedVersion =
    snapshot?.version === SUPPORTED_GLOBAL_SNAPSHOT_VERSION &&
    snapshot?.configVersion === ECONOMY_CONFIG_VERSION;
  const generatedAtValid = Number.isFinite(snapshot?.generatedAt);
  const marketDataValid = Boolean(
    supportedVersion &&
      Number.isFinite(snapshot?.epoch) &&
      generatedAtValid &&
      Number.isFinite(snapshot?.validUntil) &&
      isRecord(snapshot?.cityMarketPrices) &&
      isRecord(snapshot?.supplyDemandState) &&
      Array.isArray(snapshot?.marketMovements) &&
      Array.isArray(snapshot?.opportunities) &&
      Array.isArray(snapshot?.activeEvents) &&
      isRecord(snapshot?.modifiers),
  );
  return {
    marketDataValid,
    fuelPriceValid:
      typeof snapshot?.fuelPricePerLiter === 'number' &&
      Number.isFinite(snapshot.fuelPricePerLiter) &&
      snapshot.fuelPricePerLiter > 0,
    historyValid: Array.isArray(snapshot?.marketMovements),
    generatedAtValid,
    supportedVersion,
  };
}

export function parseGlobalEconomyCurrentDocument(
  rawDocument: unknown,
): ParsedGlobalEconomyDocument {
  if (!isRecord(rawDocument)) {
    throw new GlobalEconomyClientError('parse-failed', 'Current document is not an object');
  }
  const rawSnapshot = isRecord(rawDocument.snapshot)
    ? rawDocument.snapshot
    : rawDocument;
  const generatedAt =
    parseFirestoreMillis(rawSnapshot.generatedAt) ??
    parseFirestoreMillis(rawDocument.generatedAt) ??
    parseFirestoreMillis(rawDocument.serverTimeMs);
  if (generatedAt == null) {
    throw new GlobalEconomyClientError('invalid-snapshot', 'generatedAt is invalid');
  }
  const validUntil =
    parseFirestoreMillis(rawSnapshot.validUntil) ??
    parseFirestoreMillis(rawDocument.validUntil) ??
    generatedAt + MARKET_EPOCH_MS;
  const snapshot = {
    ...rawSnapshot,
    generatedAt,
    validUntil,
    fuelPricePerLiter: Number(rawSnapshot.fuelPricePerLiter),
  } as unknown as GlobalEconomySnapshot;
  const validation = validateGlobalEconomySnapshot(snapshot);
  if (!validation.marketDataValid) {
    throw new GlobalEconomyClientError('invalid-snapshot', 'Market snapshot validation failed');
  }
  return {
    snapshot,
    serverTimeMs: parseFirestoreMillis(rawDocument.serverTimeMs) ?? undefined,
    validation,
  };
}

export function categorizeGlobalEconomyClientError(
  error: unknown,
): GlobalEconomyLoadErrorCode {
  if (error instanceof GlobalEconomyClientError) return error.code;
  const raw =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code ?? '')
      : error instanceof Error
        ? `${error.name}:${error.message}`
        : String(error ?? '');
  const code = raw.toLowerCase().replace(/^firestore\//, '');
  if (code.includes('permission-denied')) return 'permission-denied';
  if (code.includes('unauthenticated')) return 'unauthenticated';
  if (code.includes('deadline-exceeded')) return 'deadline-exceeded';
  if (code.includes('failed-precondition')) return 'failed-precondition';
  if (code.includes('not-found')) return 'not-found';
  if (code.includes('unavailable')) return 'unavailable';
  if (code.includes('invalid-snapshot')) return 'invalid-snapshot';
  if (code.includes('stale-snapshot')) return 'stale-snapshot';
  if (code.includes('parse')) return 'parse-failed';
  return 'unknown';
}

export function resolveGlobalEconomyClientState(input: {
  snapshot?: GlobalEconomySnapshot | null;
  trusted: boolean;
  syncStatus?: GlobalMarketSyncStatus | null;
  loadedAt?: number | null;
  errorCode?: GlobalEconomyLoadErrorCode | null;
}): {
  snapshot: GlobalEconomySnapshot | null;
  source: GlobalEconomySource;
  loadedAt: number | null;
  errorCode: GlobalEconomyLoadErrorCode | null;
  validation: GlobalEconomyValidationResult;
} {
  const snapshot = input.snapshot ?? null;
  const validation = validateGlobalEconomySnapshot(snapshot);
  const usable = Boolean(snapshot && input.trusted && validation.marketDataValid);
  const source: GlobalEconomySource =
    usable && input.syncStatus === 'online'
      ? 'live'
      : usable
        ? 'cached'
        : 'unavailable';
  return {
    snapshot: usable ? snapshot : null,
    source,
    loadedAt:
      input.loadedAt != null && Number.isFinite(input.loadedAt)
        ? Number(input.loadedAt)
        : snapshot?.generatedAt ?? null,
    errorCode: source === 'live' ? null : input.errorCode ?? null,
    validation,
  };
}

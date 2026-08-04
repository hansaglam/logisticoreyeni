/**
 * Canonical yakıt fiyatı sonucu — RefuelSheet ve refuelTruck aynı selector'ı kullanır.
 *
 * Global market error'ı doğrudan UI'ya yansıtılmaz; yalnız bu result şekli kullanılır.
 */

import type {
  GlobalEconomySnapshot,
  GlobalMarketSyncStatus,
} from '../types/game';
import { isSupportedGlobalEconomySnapshot } from './globalMarketAvailability';
import { sanitizeFuelPricePerLiter } from './economy';

export type FuelPriceSource = 'live' | 'cached' | 'fallback' | 'unavailable';

export type FuelPriceErrorCode =
  | 'unavailable'
  | 'untrusted'
  | 'unsupported'
  | 'invalid-price'
  | null;

export type FuelPriceStatusTone = 'none' | 'amber' | 'danger';

export interface FuelPriceQuoteResult {
  pricePerLiter: number | null;
  source: FuelPriceSource;
  fetchedAt: number | null;
  isTrusted: boolean;
  errorCode: FuelPriceErrorCode;
  purchaseAllowed: boolean;
  snapshotEpoch: number | null;
  priceLabel: string;
  statusMessage: string | null;
  statusTone: FuelPriceStatusTone;
}

export interface ResolveFuelPriceQuoteInput {
  snapshot?: GlobalEconomySnapshot | null;
  trusted: boolean;
  syncStatus?: GlobalMarketSyncStatus | null;
  development: boolean;
  lastSyncedAtMs?: number | null;
}

const LIVE_LABEL = 'Canlı litre fiyatı';
const CACHED_LABEL = 'Son güvenilir litre fiyatı';
const FALLBACK_LABEL = 'Tahmini litre fiyatı';
const UNAVAILABLE_LABEL = 'Litre fiyatı';

function snapshotPrice(snapshot: GlobalEconomySnapshot): number | null {
  const rawPrice = snapshot.fuelPricePerLiter;
  if (!Number.isFinite(rawPrice) || rawPrice <= 0) return null;
  return sanitizeFuelPricePerLiter(rawPrice);
}

function baseResult(
  partial: Omit<FuelPriceQuoteResult, 'priceLabel' | 'statusMessage' | 'statusTone'> &
    Partial<Pick<FuelPriceQuoteResult, 'priceLabel' | 'statusMessage' | 'statusTone'>>,
): FuelPriceQuoteResult {
  return {
    priceLabel: UNAVAILABLE_LABEL,
    statusMessage: null,
    statusTone: 'none',
    ...partial,
  };
}

/**
 * Yakıt modalı ve satın alma işlemi için tek canonical fiyat sonucu.
 */
export function resolveFuelPriceQuote(
  input: ResolveFuelPriceQuoteInput,
): FuelPriceQuoteResult {
  const snapshot = input.snapshot ?? null;
  const fetchedAt =
    input.lastSyncedAtMs != null && Number.isFinite(input.lastSyncedAtMs)
      ? Number(input.lastSyncedAtMs)
      : snapshot?.generatedAt != null && Number.isFinite(snapshot.generatedAt)
        ? Number(snapshot.generatedAt)
        : null;

  if (!snapshot) {
    return baseResult({
      pricePerLiter: null,
      source: 'unavailable',
      fetchedAt: null,
      isTrusted: false,
      errorCode: 'unavailable',
      purchaseAllowed: false,
      snapshotEpoch: null,
      statusMessage: 'Yakıt fiyatına ulaşılamıyor. Tekrar dene.',
      statusTone: 'danger',
    });
  }

  const snapshotEpoch = Number.isFinite(snapshot.epoch) ? Number(snapshot.epoch) : null;

  if (!isSupportedGlobalEconomySnapshot(snapshot)) {
    return baseResult({
      pricePerLiter: null,
      source: 'unavailable',
      fetchedAt,
      isTrusted: false,
      errorCode: 'unsupported',
      purchaseAllowed: false,
      snapshotEpoch,
      statusMessage: 'Yakıt fiyatı doğrulanamadı.',
      statusTone: 'danger',
    });
  }

  const price = snapshotPrice(snapshot);
  if (price == null) {
    return baseResult({
      pricePerLiter: null,
      source: 'unavailable',
      fetchedAt,
      isTrusted: input.trusted,
      errorCode: 'invalid-price',
      purchaseAllowed: false,
      snapshotEpoch,
      statusMessage: 'YakÄ±t fiyatÄ±na ulaÅŸÄ±lamÄ±yor. Tekrar dene.',
      statusTone: 'danger',
    });
  }
  const isOnline = input.syncStatus === 'online';

  if (input.trusted && isOnline) {
    return baseResult({
      pricePerLiter: price,
      source: 'live',
      fetchedAt,
      isTrusted: true,
      errorCode: null,
      purchaseAllowed: Number.isFinite(price) && price > 0,
      snapshotEpoch,
      priceLabel: LIVE_LABEL,
      statusMessage: null,
      statusTone: 'none',
    });
  }

  if (input.trusted) {
    return baseResult({
      pricePerLiter: price,
      source: 'cached',
      fetchedAt,
      isTrusted: true,
      errorCode: null,
      purchaseAllowed: Number.isFinite(price) && price > 0,
      snapshotEpoch,
      priceLabel: CACHED_LABEL,
      statusMessage:
        'Güncel piyasa verisine ulaşılamadı. Son güvenilir fiyat kullanılıyor.',
      statusTone: 'amber',
    });
  }

  // Development local snapshot (untrusted) — işlem için izinli tahmini fiyat.
  if (input.development) {
    return baseResult({
      pricePerLiter: price,
      source: 'fallback',
      fetchedAt,
      isTrusted: false,
      errorCode: null,
      purchaseAllowed: Number.isFinite(price) && price > 0,
      snapshotEpoch,
      priceLabel: FALLBACK_LABEL,
      statusMessage: 'Tahmini litre fiyatı kullanılıyor (geliştirme).',
      statusTone: 'amber',
    });
  }

  return baseResult({
    pricePerLiter: null,
    source: 'unavailable',
    fetchedAt,
    isTrusted: false,
    errorCode: 'untrusted',
    purchaseAllowed: false,
    snapshotEpoch,
    statusMessage: 'Yakıt fiyatı doğrulanamadı.',
    statusTone: 'danger',
  });
}

/** UI ve store iÃ§in canonical yakÄ±t fiyat state selector'Ä±. */
export function selectFuelPriceState(input: ResolveFuelPriceQuoteInput): {
  pricePerLiter: number | null;
  source: 'live' | 'cached' | 'unavailable';
  isTrusted: boolean;
  snapshotEpoch: number | null;
  updatedAt: number | null;
  errorCode: FuelPriceErrorCode;
  purchaseAllowed: boolean;
} {
  const quote = resolveFuelPriceQuote(input);
  return {
    pricePerLiter: quote.pricePerLiter,
    source:
      quote.source === 'live'
        ? 'live'
        : quote.source === 'cached' || quote.source === 'fallback'
          ? 'cached'
          : 'unavailable',
    isTrusted: quote.isTrusted,
    snapshotEpoch: quote.snapshotEpoch,
    updatedAt: quote.fetchedAt,
    errorCode: quote.errorCode,
    purchaseAllowed: quote.purchaseAllowed,
  };
}

export function isFuelPricePurchaseReady(quote: FuelPriceQuoteResult): boolean {
  return (
    quote.purchaseAllowed &&
    quote.pricePerLiter != null &&
    Number.isFinite(quote.pricePerLiter) &&
    quote.pricePerLiter > 0
  );
}

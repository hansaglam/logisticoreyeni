import type { VehicleMarketplaceFailureReason } from '../types/vehicleMarketplace';
import {
  getMarketplaceBackendReason,
  getMarketplaceFirebaseErrorCode,
} from './vehicleMarketplaceErrors';

export type MarketplaceErrorKind =
  | 'offline'
  | 'timeout'
  | 'unauthenticated'
  | 'permission-denied'
  | 'index-building'
  | 'not-found'
  | 'conflict'
  | 'rate-limited'
  | 'server-error'
  | 'invalid-response'
  | 'unknown';

export const MARKETPLACE_TIMEOUT_ERROR = 'marketplace-timeout';

export function isMarketplaceTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error && error.message === MARKETPLACE_TIMEOUT_ERROR
  );
}

function firebaseMessage(error: unknown): string {
  const message = (error as { message?: unknown })?.message;
  return typeof message === 'string' ? message.toLowerCase() : '';
}

export function mapFailureReasonToMarketplaceKind(
  reason?: VehicleMarketplaceFailureReason,
): MarketplaceErrorKind {
  switch (reason) {
    case 'auth-required':
    case 'unauthenticated':
    case 'username-required':
      return 'unauthenticated';
    case 'permission-denied':
      return 'permission-denied';
    case 'network-error':
      return 'offline';
    case 'timeout':
      return 'timeout';
    case 'rate-limited':
      return 'rate-limited';
    case 'function-not-found':
    case 'listing-not-found':
      return 'not-found';
    case 'save-conflict':
    case 'stale-listing-version':
    case 'already-completed':
      return 'conflict';
    case 'invalid-request':
      return 'invalid-response';
    case 'service-unavailable':
    case 'marketplace-unavailable':
    case 'marketplace-state-missing':
      return 'server-error';
    default:
      return 'unknown';
  }
}

export function mapFirebaseErrorToMarketplaceKind(error: unknown): MarketplaceErrorKind {
  if (isMarketplaceTimeoutError(error)) return 'timeout';
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return 'offline';
  }

  const backendReason = getMarketplaceBackendReason(error);
  if (backendReason) {
    return mapFailureReasonToMarketplaceKind(backendReason);
  }

  const message = firebaseMessage(error);
  if (message.includes('index') && message.includes('building')) {
    return 'index-building';
  }

  switch (getMarketplaceFirebaseErrorCode(error)) {
    case 'functions/unauthenticated':
      return 'unauthenticated';
    case 'functions/permission-denied':
      return 'permission-denied';
    case 'functions/not-found':
      return 'not-found';
    case 'functions/deadline-exceeded':
    case 'functions/cancelled':
      return 'timeout';
    case 'functions/resource-exhausted':
      return 'rate-limited';
    case 'functions/failed-precondition':
      return message.includes('index') ? 'index-building' : 'conflict';
    case 'functions/unavailable':
    case 'functions/internal':
    case 'functions/unknown':
      return 'server-error';
    default:
      return 'unknown';
  }
}

export function getMarketplaceKindTitle(kind: MarketplaceErrorKind): string {
  switch (kind) {
    case 'unauthenticated':
      return 'Araç Pazarı hesabı gerekli';
    case 'offline':
    case 'timeout':
    case 'server-error':
    case 'index-building':
    case 'invalid-response':
    case 'unknown':
      return 'Araç Pazarı yüklenemedi';
    case 'permission-denied':
      return 'İşlem reddedildi';
    case 'not-found':
      return 'Araç Pazarı servisi bulunamadı';
    case 'conflict':
      return 'İlan bilgileri güncellendi';
    case 'rate-limited':
      return 'Çok fazla istek';
    default:
      return 'Araç Pazarı yüklenemedi';
  }
}

export function getMarketplaceKindMessage(kind: MarketplaceErrorKind): string {
  switch (kind) {
    case 'offline':
      return 'İnternet bağlantısı bulunamadı.';
    case 'timeout':
      return 'Araç Pazarı yanıt vermedi. Tekrar deneyin.';
    case 'unauthenticated':
      return 'Araç Pazarı’nı kullanmak için hesabına giriş yap.';
    case 'permission-denied':
      return 'Bu işlem için yetkin bulunmuyor.';
    case 'index-building':
      return 'Araç Pazarı hazırlanıyor. Birkaç dakika sonra tekrar deneyin.';
    case 'server-error':
      return 'Araç Pazarı şu anda yanıt veremiyor.';
    case 'invalid-response':
      return 'İlanlar şu anda yüklenemiyor. Tekrar dene.';
    case 'not-found':
      return 'Araç Pazarı servisi bu sürüm için deploy edilmemiş.';
    case 'conflict':
      return 'İlan bilgileri güncellendi. Tekrar kontrol et.';
    case 'rate-limited':
      return 'Çok fazla istek gönderdin. Kısa bir süre sonra tekrar dene.';
    case 'unknown':
    default:
      return 'Araç Pazarı yüklenemedi.';
  }
}

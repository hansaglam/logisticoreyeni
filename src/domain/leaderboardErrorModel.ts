import type { LeaderboardErrorCode } from '../services/leaderboardService';

export type LeaderboardErrorKind =
  | 'offline'
  | 'timeout'
  | 'unauthenticated'
  | 'username-required'
  | 'permission-denied'
  | 'index-building'
  | 'invalid-response'
  | 'server-error'
  | 'unknown';

export function mapLeaderboardErrorCodeToKind(
  code?: LeaderboardErrorCode | string,
): LeaderboardErrorKind {
  switch (code) {
    case 'auth-required':
    case 'anonymous-not-supported':
      return 'unauthenticated';
    case 'username-required':
      return 'username-required';
    case 'permission-denied':
    case 'app-check-failed':
      return 'permission-denied';
    case 'network-error':
      return 'offline';
    case 'timeout':
      return 'timeout';
    case 'malformed-response':
    case 'invalid-request':
      return 'invalid-response';
    case 'function-not-found':
    case 'function-unavailable':
    case 'service-unavailable':
    case 'backend-not-ready':
    case 'server-state-missing':
    case 'save-not-found':
    case 'invalid-player-state':
      return 'server-error';
    default:
      return 'unknown';
  }
}

export function getLeaderboardKindMessage(kind: LeaderboardErrorKind): string {
  switch (kind) {
    case 'offline':
      return 'Liderlik tablosu için internet bağlantısı gerekli.';
    case 'timeout':
      return 'Liderlik tablosu yanıt vermedi. Tekrar deneyin.';
    case 'username-required':
      return 'Sıralamaya katılmak için bir kullanıcı adı oluştur.';
    case 'unauthenticated':
      return 'Sıralamaya katılmak için hesabına giriş yap.';
    case 'index-building':
      return 'Liderlik tablosu hazırlanıyor. Birkaç dakika sonra tekrar deneyin.';
    case 'server-error':
      return 'Liderlik tablosu şu anda yüklenemiyor.';
    case 'invalid-response':
      return 'Sunucudan geçersiz veri alındı.';
    case 'permission-denied':
      return 'Bu işlem için yetkin bulunmuyor.';
    case 'unknown':
    default:
      return 'Liderlik tablosu şu anda yüklenemedi.';
  }
}

export function getLeaderboardKindTitle(kind: LeaderboardErrorKind): string {
  switch (kind) {
    case 'username-required':
      return 'Kullanıcı adı gerekli';
    case 'unauthenticated':
      return 'Hesap bağlantısı gerekli';
    default:
      return 'Liderlik tablosu yüklenemedi';
  }
}

export const LEADERBOARD_EMPTY_SEASON_MESSAGE =
  'Bu sezon henüz katılımcı yok.';

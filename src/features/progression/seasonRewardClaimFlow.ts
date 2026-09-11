/**
 * Phase 7 Step 6 — Season reward claim attempt helpers (client).
 * Mirrors challenge claim idempotency conventions. No authority fields.
 */

export type SeasonRewardClaimAttempt = {
  seasonKey: string;
  idempotencyKey: string;
};

export function createSeasonRewardClaimAttempt(
  seasonKey: string,
  createId: () => string,
): SeasonRewardClaimAttempt {
  return {
    seasonKey,
    idempotencyKey: `season-reward-${createId()}`,
  };
}

export function shouldRetainSeasonRewardClaimAttempt(reason: string): boolean {
  return (
    reason === 'service-unavailable' ||
    reason === 'timeout' ||
    reason === 'deadline-exceeded'
  );
}

export function getSeasonRewardClaimErrorMessage(reason: string): string {
  switch (reason) {
    case 'auth-required':
    case 'unauthenticated':
      return 'Ödül almak için hesabını bağlamalısın.';
    case 'anonymous-not-allowed':
      return 'Ödül almak için bağlı bir hesap gerekir.';
    case 'already-claimed':
      return 'Bu ödül daha önce alındı.';
    case 'no_reward':
      return 'Bu sezon için alınabilir bir ödül yok.';
    case 'rewards_disabled':
      return 'Bu sezon için ödül dağıtımı kapalı.';
    case 'insufficient_participants':
      return 'Bu sezonda ödül dağıtımı için yeterli katılımcı yoktu.';
    case 'season_active':
    case 'season_future':
    case 'season_pending':
    case 'pending':
      return 'Sezon ödülü henüz hazır değil.';
    case 'server-state-not-initialized':
      return 'Hesap verilerin hazırlanıyor. Biraz sonra tekrar dene.';
    case 'reconciliation-failed':
      return 'Ödül kaydedildi ancak nakit bilgisi yenilenemedi. Tekrar dene.';
    case 'timeout':
    case 'deadline-exceeded':
      return 'İstek zaman aşımına uğradı. Durum kontrol ediliyor.';
    case 'feature-disabled':
      return 'Sezon ödülleri bu sürümde kullanılamıyor.';
    case 'rate-limited':
      return 'Çok fazla deneme yapıldı. Biraz sonra tekrar dene.';
    default:
      return 'Sunucuya ulaşılamadı. Bağlantını kontrol edip tekrar dene.';
  }
}

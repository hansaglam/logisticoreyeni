/** Haftalık sıralamaya girmek için gereken tamamlanmış teslimat sayısı. */
export const LEADERBOARD_MIN_COMPLETED_DELIVERIES = 3;

export function isLeaderboardRankedEligible(completedDeliveries: number): boolean {
  return (
    Number.isFinite(completedDeliveries) &&
    completedDeliveries >= LEADERBOARD_MIN_COMPLETED_DELIVERIES
  );
}

export const LEADERBOARD_UNRANKED_TITLE = 'Henüz sıralamaya dahil değilsin';
export const LEADERBOARD_UNRANKED_MESSAGE =
  '3 teslimat tamamlayarak haftalık sıralamaya katıl.';
export const LEADERBOARD_SCORE_EXPLAINER =
  'Şirket puanı; teslimat performansı, şirket gelişimi, itibar, filo değeri ve haftalık operasyon sonuçlarından hesaplanır.';

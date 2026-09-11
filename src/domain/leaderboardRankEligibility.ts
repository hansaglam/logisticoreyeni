/**
 * Haftalık sıralama — v3: teslimat eşiği yok.
 * Bağlı hesap + kullanıcı adı yeterli; puan 0 ile de listede yer alınır.
 *
 * @deprecated Constant kept at 0 for import compatibility; delivery gate removed.
 */
export const LEADERBOARD_MIN_COMPLETED_DELIVERIES = 0;

export function isLeaderboardRankedEligible(_completedDeliveries?: number): boolean {
  return true;
}

/** Misafir / profil eksikliği mesajları için genel kopya (teslimat eşiği değil). */
export const LEADERBOARD_UNRANKED_TITLE = 'Sıralamada yerin hazır';
export const LEADERBOARD_UNRANKED_MESSAGE =
  'Yeni şirketler 0 puanla başlar. Teslimat ve gelişimle puanın artar.';
export const LEADERBOARD_SCORE_EXPLAINER =
  'Şirket puanı; teslimat performansı, şirket gelişimi, itibar, filo değeri (başlangıç filonun üstü) ve haftalık operasyon sonuçlarından hesaplanır. Başlangıç nakit ve starter filo ücretsiz puan vermez.';

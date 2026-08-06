/**
 * Haftalık leaderboard yapılandırması (V1 — sıralama prestiji).
 *
 * Ekonomik ödül dağıtımı kapalıdır; ilk 3 sıra yalnızca prestij rozeti gösterir.
 */

export const leaderboardConfig = {
  seasonType: 'weekly' as const,
  leaderboardSize: 100,
  /** Ekonomik ödül dağıtımı kapalı — yalnızca prestij/sıralama. */
  rewardsEnabled: false,
  prestigeRanks: [1, 2, 3] as const,
  prestigeLabels: {
    1: 'Şampiyon',
    2: 'İkinci',
    3: 'Üçüncü',
  } as const,
};

export type LeaderboardPrestigeRank = keyof typeof leaderboardConfig.prestigeLabels;

export function getLeaderboardPrestigeLabel(rank: number): string | null {
  if (rank < 1 || rank > 3) return null;
  return leaderboardConfig.prestigeLabels[rank as LeaderboardPrestigeRank] ?? null;
}

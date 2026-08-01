/**
 * Haftalık leaderboard yapılandırması (V1 — sıralama).
 *
 * Ödül dağıtımı V1'de kapalıdır; yarım çalışan claim sistemi yoktur.
 */

export const leaderboardConfig = {
  seasonType: 'weekly' as const,
  leaderboardSize: 100,
  /** V1: ödül UI ve claim kapalı. */
  rewardsEnabled: false,
  rewardRanks: [1, 2, 3] as const,
  rewards: {
    1: { diamonds: 300 },
    2: { diamonds: 200 },
    3: { diamonds: 100 },
  },
  rewardCurrency: 'diamonds' as const,
  cashRewardsEnabled: false,
};

export type LeaderboardRewardRank = keyof typeof leaderboardConfig.rewards;

export function getLeaderboardDiamondReward(rank: number): number {
  if (!leaderboardConfig.rewardsEnabled) return 0;
  const reward = leaderboardConfig.rewards[rank as LeaderboardRewardRank];
  return reward?.diamonds ?? 0;
}

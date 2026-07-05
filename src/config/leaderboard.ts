/**
 * Haftalık leaderboard ödül yapılandırması.
 *
 * TODO: Weekly leaderboard and diamond reward distribution will be handled by
 * Firebase backend / Cloud Functions.
 */

export const leaderboardConfig = {
  seasonType: 'weekly' as const,
  leaderboardSize: 10,
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
  const reward = leaderboardConfig.rewards[rank as LeaderboardRewardRank];
  return reward?.diamonds ?? 0;
}

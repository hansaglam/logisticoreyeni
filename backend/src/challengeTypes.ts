export type ChallengeCadence = 'daily' | 'weekly';
export type ChallengeMetric =
  | 'deliveries_completed'
  | 'contracts_completed_on_time'
  | 'distance_completed'
  | 'money_earned_from_deliveries'
  | 'reputation_gained'
  | 'marketplace_sales'
  | 'marketplace_purchases';

export interface ChallengeReward {
  cash?: number;
  reputation?: number;
  seasonPoints?: number;
}

export interface ChallengeDefinition {
  id: string;
  cadence: ChallengeCadence;
  metric: ChallengeMetric;
  target: number;
  reward: ChallengeReward;
  title: string;
  description: string;
  enabled: boolean;
  version: number;
}

export interface ChallengeProgress {
  challengeId: string;
  periodKey: string;
  current: number;
  target: number;
  completed: boolean;
  claimed: boolean;
  completedAt?: number;
  claimedAt?: number;
}

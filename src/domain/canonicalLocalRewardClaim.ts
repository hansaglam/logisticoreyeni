/**
 * Canonical local reward claims (Map V2 Step 29W).
 *
 * Only rewards whose eligibility is derivable from canonical server documents
 * can be claimed. Client completion, progress, and amounts are rejected.
 * Ads stay unverified. Weekly/season/challenge claims are not duplicated.
 * Pure. No React. No Firebase.
 */

import { ALL_MISSIONS, getMissionById } from '../config/missions';
import { MILESTONE_DEFINITIONS } from '../data/milestones';
import type { CanonicalFleetAssetDocument } from './canonicalRoadFleet';

export const CANONICAL_LOCAL_REWARD_CLAIM_AUTHORITY_STATUS =
  'CANONICAL_LOCAL_REWARD_CLAIM_AUTHORITY_PASS_PARTIAL' as const;

export const LOCAL_REWARD_READINESS_STATUS = 'LOCAL_REWARD_PARTIAL' as const;
export const AD_REWARD_AUTHORITY_STATUS = 'AD_REWARD_AUTHORITY_BLOCKED_VERIFICATION' as const;
export const AD_CALLBACK_AUTHORITY = 'AD_REWARD_CLIENT_CALLBACK_ONLY_UNVERIFIED' as const;
export const AD_SSV_STATUS = 'AD_REWARD_PROVIDER_SSV_AVAILABLE_NOT_IMPLEMENTED' as const;
export const LOCAL_WEEKLY_OBJECTIVE_STATUS =
  'LOCAL_WEEKLY_OBJECTIVE_SEPARATE_DO_NOT_DUAL_PAY' as const;
export const DAILY_LOGIN_REWARD_STATUS = 'NOT_PRESENT' as const;
export const ONBOARDING_CASH_REWARD_STATUS = 'NOT_A_SEPARATE_CASH_PATH' as const;
export const ACHIEVEMENT_CATALOG_CASH_STATUS = 'NON_CASH_INFORMATIONAL' as const;
export const REWARD_REVOCATION_STATUS = 'NOT_PRESENT' as const;

export const CANONICAL_LOCAL_REWARD_ENV = 'CANONICAL_LOCAL_REWARD_AUTHORITY' as const;
export const CANONICAL_LOCAL_REWARD_POLICY_VERSION = 'canonical-local-reward-internal-v1' as const;
export const CANONICAL_LOCAL_REWARD_SCHEMA_VERSION = 1 as const;
export const CANONICAL_REWARD_CLAIMS_COLLECTION = 'canonicalRewardClaims' as const;

export type CanonicalLocalRewardGate = 'OFF' | 'INTERNAL_TEST';

export function resolveCanonicalLocalRewardGate(options?: {
  envValue?: string | null;
}): CanonicalLocalRewardGate {
  const raw =
    options?.envValue === undefined
      ? String(process.env.CANONICAL_LOCAL_REWARD_AUTHORITY ?? '')
      : String(options.envValue ?? '');
  return raw.trim() === 'INTERNAL_TEST' ? 'INTERNAL_TEST' : 'OFF';
}

export function isCanonicalLocalRewardAllowed(options?: { envValue?: string | null }): boolean {
  return resolveCanonicalLocalRewardGate(options) === 'INTERNAL_TEST';
}

const FORBIDDEN = [
  'completed',
  'progress',
  'rewardAmount',
  'cashDelta',
  'amount',
  'money',
  'multiplier',
  'watchedAd',
  'missionDone',
  'milestoneReached',
  'period',
  'periodId',
] as const;

export function hasOnlyCanonicalLocalRewardKeys(data: Record<string, unknown>): boolean {
  if (FORBIDDEN.some((key) => key in data)) return false;
  return Object.keys(data).every((key) => ['rewardId', 'canonicalSchemaVersion'].includes(key));
}

export type RewardAuditClassification =
  | 'SERVER_DERIVABLE'
  | 'ALREADY_CANONICAL'
  | 'CLIENT_PROGRESS_UNVERIFIED'
  | 'CLIENT_EVENT_UNVERIFIED'
  | 'PROVIDER_VERIFIABLE'
  | 'GUEST_ONLY'
  | 'DEV_ONLY'
  | 'NON_CASH'
  | 'INTERNAL_CANONICAL_ONLY';

export type RewardAuditRow = {
  family: string;
  fn: string;
  classification: RewardAuditClassification;
  canonicalStatus: string;
};

export const REWARD_CASH_AUDIT: readonly RewardAuditRow[] = [
  {
    family: 'career-mission-own-2-trucks',
    fn: 'claimMissionReward',
    classification: 'INTERNAL_CANONICAL_ONLY',
    canonicalStatus: 'MISSION_INTERNAL_CANONICAL_STATE_ONLY',
  },
  {
    family: 'other-local-missions',
    fn: 'claimMissionReward',
    classification: 'CLIENT_PROGRESS_UNVERIFIED',
    canonicalStatus: 'MISSION_CLIENT_PROGRESS_UNVERIFIED',
  },
  {
    family: 'milestone-ms-second-truck',
    fn: 'claimMilestoneReward',
    classification: 'INTERNAL_CANONICAL_ONLY',
    canonicalStatus: 'MILESTONE_INTERNAL_CANONICAL_STATE_ONLY',
  },
  {
    family: 'other-milestones',
    fn: 'claimMilestoneReward',
    classification: 'CLIENT_PROGRESS_UNVERIFIED',
    canonicalStatus: 'MILESTONE_CLIENT_PROGRESS_UNVERIFIED',
  },
  {
    family: 'local-weekly-objectives',
    fn: 'claimWeeklyObjectiveReward',
    classification: 'CLIENT_PROGRESS_UNVERIFIED',
    canonicalStatus: LOCAL_WEEKLY_OBJECTIVE_STATUS,
  },
  {
    family: 'server-weekly-missions',
    fn: 'claimWeeklyMissionReward',
    classification: 'ALREADY_CANONICAL',
    canonicalStatus: 'WEEKLY_ALREADY_CANONICAL',
  },
  {
    family: 'server-season-rewards',
    fn: 'claimSeasonReward',
    classification: 'ALREADY_CANONICAL',
    canonicalStatus: 'SEASON_ALREADY_CANONICAL',
  },
  {
    family: 'server-challenge-rewards',
    fn: 'claimChallengeReward',
    classification: 'ALREADY_CANONICAL',
    canonicalStatus: 'CHALLENGE_ALREADY_CANONICAL',
  },
  {
    family: 'rewarded-ad-daily-ops-cash',
    fn: 'applyAdReward',
    classification: 'CLIENT_EVENT_UNVERIFIED',
    canonicalStatus: AD_REWARD_AUTHORITY_STATUS,
  },
  {
    family: 'rewarded-ad-non-cash-slots',
    fn: 'applyAdReward',
    classification: 'NON_CASH',
    canonicalStatus: 'NON_CASH',
  },
  {
    family: 'achievement-catalog',
    fn: 'progressionFoundation',
    classification: 'NON_CASH',
    canonicalStatus: ACHIEVEMENT_CATALOG_CASH_STATUS,
  },
  {
    family: 'onboarding',
    fn: 'markOnboardingMissionRewardClaimed',
    classification: 'NON_CASH',
    canonicalStatus: ONBOARDING_CASH_REWARD_STATUS,
  },
  {
    family: 'daily-login',
    fn: 'none',
    classification: 'NON_CASH',
    canonicalStatus: DAILY_LOGIN_REWARD_STATUS,
  },
  {
    family: 'debug-cash',
    fn: 'debugAddMoney',
    classification: 'DEV_ONLY',
    canonicalStatus: 'LOCAL_ONLY',
  },
  {
    family: 'guest-rewards',
    fn: 'local claim helpers',
    classification: 'GUEST_ONLY',
    canonicalStatus: 'GUEST_LOCAL',
  },
];

export function rewardAuditHasUnknown(): boolean {
  return REWARD_CASH_AUDIT.some((row) => row.classification === ('UNKNOWN' as RewardAuditClassification));
}

export type CanonicalRewardDefinition = {
  rewardId: string;
  family: 'MISSION' | 'MILESTONE';
  amount: number;
  targetCount: number;
  multiplicity: 'ONE_TIME';
  eligibility: 'CANONICAL_ACTIVE_TRUCK_COUNT';
  operationType: 'CANONICAL_MISSION_REWARD' | 'CANONICAL_MILESTONE_REWARD';
};

function missionAmount(id: string): number {
  const money = getMissionById(id)?.reward.money;
  if (!Number.isSafeInteger(money) || !money || money <= 0) {
    throw new Error(`MISSING_MISSION_CASH:${id}`);
  }
  return money;
}

function milestoneAmount(id: string): number {
  const cash = MILESTONE_DEFINITIONS.find((row) => row.id === id)?.reward.cash;
  if (!Number.isSafeInteger(cash) || !cash || cash <= 0) {
    throw new Error(`MISSING_MILESTONE_CASH:${id}`);
  }
  return cash;
}

export const CANONICAL_LOCAL_REWARD_REGISTRY: readonly CanonicalRewardDefinition[] = [
  {
    rewardId: 'own_2_trucks',
    family: 'MISSION',
    amount: missionAmount('own_2_trucks'),
    targetCount: 2,
    multiplicity: 'ONE_TIME',
    eligibility: 'CANONICAL_ACTIVE_TRUCK_COUNT',
    operationType: 'CANONICAL_MISSION_REWARD',
  },
  {
    rewardId: 'ms_second_truck',
    family: 'MILESTONE',
    amount: milestoneAmount('ms_second_truck'),
    targetCount: 2,
    multiplicity: 'ONE_TIME',
    eligibility: 'CANONICAL_ACTIVE_TRUCK_COUNT',
    operationType: 'CANONICAL_MILESTONE_REWARD',
  },
];

export function findCanonicalLocalReward(rewardId: string): CanonicalRewardDefinition | null {
  return CANONICAL_LOCAL_REWARD_REGISTRY.find((row) => row.rewardId === rewardId) ?? null;
}

export function createCanonicalRewardClaimId(reward: CanonicalRewardDefinition): string {
  const family = reward.family === 'MISSION' ? 'mission' : 'milestone';
  return `reward:${family}:${reward.rewardId}`;
}

export function isCanonicalActiveRewardTruck(asset: {
  assetType?: string;
  ownershipType?: string;
  lifecycleStatus?: string;
}): boolean {
  if (asset.assetType !== 'TRUCK') return false;
  if (asset.lifecycleStatus === 'SOLD') return false;
  if (asset.lifecycleStatus === 'LEASE_ACTIVE') return true;
  if ((asset.ownershipType ?? 'owned') === 'leased') return false;
  return true;
}

export function countCanonicalActiveRewardTrucks(
  assets: readonly Pick<CanonicalFleetAssetDocument, 'assetType' | 'ownershipType' | 'lifecycleStatus'>[],
): number {
  return assets.filter((asset) => isCanonicalActiveRewardTruck(asset)).length;
}

export function deriveCanonicalLocalRewardEligibility(
  reward: CanonicalRewardDefinition,
  truckCount: number,
): { ok: true; amount: number } | { ok: false; reason: 'REWARD_NOT_ELIGIBLE' } {
  if (!Number.isSafeInteger(truckCount) || truckCount < reward.targetCount) {
    return { ok: false, reason: 'REWARD_NOT_ELIGIBLE' };
  }
  return { ok: true, amount: reward.amount };
}

export function missionCanonicalStatus(missionId: string): string {
  if (missionId === 'own_2_trucks') return 'MISSION_INTERNAL_CANONICAL_STATE_ONLY';
  if (!ALL_MISSIONS.some((mission) => mission.id === missionId)) return 'UNKNOWN_REWARD';
  return 'MISSION_CLIENT_PROGRESS_UNVERIFIED';
}

export type CanonicalRewardClaimReceipt = {
  schemaVersion: typeof CANONICAL_LOCAL_REWARD_SCHEMA_VERSION;
  claimId: string;
  rewardId: string;
  rewardFamily: 'MISSION' | 'MILESTONE';
  eligibilityPolicyVersion: typeof CANONICAL_LOCAL_REWARD_POLICY_VERSION;
  rewardAmount: number;
  cashBefore: number;
  cashAfter: number;
  cashTransactionId: string;
  eligibilityEvidenceClass: 'CANONICAL_ACTIVE_TRUCK_COUNT';
  claimedAtMs: number;
  authoritySource: 'INTERNAL_CANONICAL_FLEET';
  multiplicity: 'ONE_TIME';
  ownerUid: string;
};

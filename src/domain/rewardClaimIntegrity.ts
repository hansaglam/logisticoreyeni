/**
 * Canonical reward claim receipts — idempotent mission / achievement / weekly claims.
 */

import { MILESTONE_DEFINITIONS } from '../data/milestones';
import { CAREER_MISSION_IDS, STARTER_MISSION_IDS } from '../config/missions';
import { getWeeklyObjectiveDefinitions } from '../data/weeklyObjectives';
import type { MissionsState, RetentionState, RewardReceipt } from '../types/game';

export type RewardClaimScope = 'mission' | 'achievement' | 'weekly';

export type RewardClaimAttemptStatus = 'ACCEPTED' | 'ALREADY_CLAIMED' | 'NOT_COMPLETE';

export interface RewardClaimAttemptResult {
  status: RewardClaimAttemptStatus;
  receiptKey: string;
  claimedAt?: number;
  nextReceipts?: Record<string, RewardReceipt>;
}

export function buildRewardReceiptKey(
  scope: RewardClaimScope,
  rewardId: string,
  seasonKey?: string,
): string {
  if (scope === 'weekly') {
    const season = seasonKey?.trim() || 'unknown-season';
    return `weekly:${season}:${rewardId}:reward`;
  }
  if (scope === 'achievement') {
    return `achievement:${rewardId}:reward`;
  }
  return `mission:${rewardId}:reward`;
}

export function normalizeRewardReceipts(
  raw?: Record<string, unknown> | null,
): Record<string, RewardReceipt> {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  const receipts: Record<string, RewardReceipt> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!key || typeof key !== 'string') continue;
    if (!value || typeof value !== 'object') continue;
    const record = value as Record<string, unknown>;
    const claimedAt = Number(record.claimedAt);
    if (!Number.isFinite(claimedAt) || claimedAt < 0) continue;
    receipts[key] = {
      claimedAt,
      ...(typeof record.rewardVersion === 'number' && Number.isFinite(record.rewardVersion)
        ? { rewardVersion: record.rewardVersion }
        : {}),
    };
  }
  return receipts;
}

export function isRewardClaimed(
  receipts: Record<string, RewardReceipt> | undefined | null,
  receiptKey: string,
): boolean {
  return Boolean(receipts?.[receiptKey]);
}

export function stampRewardReceipt(
  receipts: Record<string, RewardReceipt> | undefined | null,
  receiptKey: string,
  claimedAt: number,
): Record<string, RewardReceipt> {
  return {
    ...(receipts ?? {}),
    [receiptKey]: {
      claimedAt,
    },
  };
}

/** Claimed receipts are irreversible — union both sides. */
export function mergeRewardReceiptsMonotonic(
  local: Record<string, RewardReceipt> | undefined | null,
  cloud: Record<string, RewardReceipt> | undefined | null,
): Record<string, RewardReceipt> {
  const merged = { ...(local ?? {}) };
  for (const [key, receipt] of Object.entries(cloud ?? {})) {
    const existing = merged[key];
    if (!existing || receipt.claimedAt >= existing.claimedAt) {
      merged[key] = receipt;
    }
  }
  return merged;
}

export function listClaimedRewardReceiptKeys(
  receipts: Record<string, RewardReceipt> | undefined | null,
): string[] {
  return Object.keys(receipts ?? {}).sort();
}

export function attemptRewardClaim(input: {
  scope: RewardClaimScope;
  rewardId: string;
  seasonKey?: string;
  currentTime: number;
  rewardReceipts?: Record<string, RewardReceipt> | null;
  isComplete: boolean;
  isAlreadyMarkedClaimed: boolean;
}): RewardClaimAttemptResult {
  const receiptKey = buildRewardReceiptKey(input.scope, input.rewardId, input.seasonKey);
  const alreadyClaimed =
    isRewardClaimed(input.rewardReceipts, receiptKey) || input.isAlreadyMarkedClaimed;

  if (alreadyClaimed) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.info('[ACHIEVEMENT_CLAIM]', {
        achievementId: input.rewardId,
        scope: input.scope,
        wasCompleted: input.isComplete,
        wasAlreadyClaimed: true,
        claimAccepted: false,
      });
    }
    return { status: 'ALREADY_CLAIMED', receiptKey };
  }

  if (!input.isComplete) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.info('[ACHIEVEMENT_CLAIM]', {
        achievementId: input.rewardId,
        scope: input.scope,
        wasCompleted: false,
        wasAlreadyClaimed: false,
        claimAccepted: false,
      });
    }
    return { status: 'NOT_COMPLETE', receiptKey };
  }

  const claimedAt = input.currentTime;
  const nextReceipts = stampRewardReceipt(input.rewardReceipts, receiptKey, claimedAt);

  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.info('[ACHIEVEMENT_CLAIM]', {
      achievementId: input.rewardId,
      scope: input.scope,
      wasCompleted: true,
      wasAlreadyClaimed: false,
      claimAccepted: true,
      receiptKey,
    });
  }

  return {
    status: 'ACCEPTED',
    receiptKey,
    claimedAt,
    nextReceipts,
  };
}

export function buildReceiptsFromLegacyClaimState(input: {
  missions: MissionsState;
  retention: RetentionState;
  seasonKey: string;
  fallbackClaimedAt?: number;
}): Record<string, RewardReceipt> {
  const fallbackClaimedAt = input.fallbackClaimedAt ?? 0;
  let receipts: Record<string, RewardReceipt> = {};

  for (const missionId of input.missions.claimedMissionRewardIds ?? []) {
    const claimedAt = input.missions.completedAtByMissionId?.[missionId] ?? fallbackClaimedAt;
    receipts = stampRewardReceipt(receipts, buildRewardReceiptKey('mission', missionId), claimedAt);
  }

  for (const def of MILESTONE_DEFINITIONS) {
    const entry = input.retention.milestones?.[def.id];
    if (!entry?.isClaimed) continue;
    receipts = stampRewardReceipt(
      receipts,
      buildRewardReceiptKey('achievement', def.id),
      entry.completedAt ?? fallbackClaimedAt,
    );
  }

  for (const def of getWeeklyObjectiveDefinitions(input.seasonKey)) {
    const entry = input.retention.weeklyObjectives?.[def.id];
    if (!entry?.isClaimed) continue;
    receipts = stampRewardReceipt(
      receipts,
      buildRewardReceiptKey('weekly', def.id, input.seasonKey),
      entry.completedAt ?? fallbackClaimedAt,
    );
  }

  return receipts;
}

export function applyRewardReceiptsToMissions(
  missions: MissionsState,
  receipts: Record<string, RewardReceipt>,
): MissionsState {
  const claimedMissionRewardIds = new Set(missions.claimedMissionRewardIds ?? []);
  for (const missionId of [...STARTER_MISSION_IDS, ...CAREER_MISSION_IDS]) {
    if (isRewardClaimed(receipts, buildRewardReceiptKey('mission', missionId))) {
      claimedMissionRewardIds.add(missionId);
    }
  }
  return {
    ...missions,
    claimedMissionRewardIds: [...claimedMissionRewardIds],
  };
}

export function applyRewardReceiptsToRetention(
  retention: RetentionState,
  receipts: Record<string, RewardReceipt>,
  seasonKey: string = retention.currentWeeklySeasonKey,
): RetentionState {
  const milestones = { ...retention.milestones };
  for (const def of MILESTONE_DEFINITIONS) {
    const existing = milestones[def.id] ?? { progress: 0, isClaimed: false };
    const claimed = isRewardClaimed(receipts, buildRewardReceiptKey('achievement', def.id));
    milestones[def.id] = claimed
      ? {
          ...existing,
          isClaimed: true,
          completedAt: existing.completedAt ?? receipts[buildRewardReceiptKey('achievement', def.id)]?.claimedAt,
        }
      : existing;
  }

  const weeklyObjectives = { ...retention.weeklyObjectives };
  for (const def of getWeeklyObjectiveDefinitions(seasonKey)) {
    const existing = weeklyObjectives[def.id] ?? { progress: 0, isClaimed: false };
    const receiptKey = buildRewardReceiptKey('weekly', def.id, seasonKey);
    const claimed = isRewardClaimed(receipts, receiptKey);
    weeklyObjectives[def.id] = claimed
      ? {
          ...existing,
          isClaimed: true,
          completedAt: existing.completedAt ?? receipts[receiptKey]?.claimedAt,
        }
      : existing;
  }

  return {
    ...retention,
    milestones,
    weeklyObjectives,
  };
}

export function hydrateRewardClaimState(input: {
  rewardReceipts?: Record<string, RewardReceipt> | null;
  missions: MissionsState;
  retention: RetentionState;
  seasonKey: string;
  fallbackClaimedAt?: number;
}): {
  rewardReceipts: Record<string, RewardReceipt>;
  missions: MissionsState;
  retention: RetentionState;
} {
  const legacyReceipts = buildReceiptsFromLegacyClaimState({
    missions: input.missions,
    retention: input.retention,
    seasonKey: input.seasonKey,
    fallbackClaimedAt: input.fallbackClaimedAt,
  });
  const rewardReceipts = mergeRewardReceiptsMonotonic(
    normalizeRewardReceipts(input.rewardReceipts),
    legacyReceipts,
  );
  const missions = applyRewardReceiptsToMissions(input.missions, rewardReceipts);
  const retention = applyRewardReceiptsToRetention(
    input.retention,
    rewardReceipts,
    input.seasonKey,
  );
  return { rewardReceipts, missions, retention };
}

export function logAchievementHydrate(receipts: Record<string, RewardReceipt>): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return;
  console.info('[ACHIEVEMENT_HYDRATE]', {
    claimedAchievementIds: listClaimedRewardReceiptKeys(receipts).filter((key) =>
      key.startsWith('achievement:'),
    ),
    claimedRewardReceiptKeys: listClaimedRewardReceiptKeys(receipts),
  });
}

export function logAchievementClaimPersisted(achievementId: string): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return;
  console.info('[ACHIEVEMENT_CLAIM_PERSISTED]', {
    achievementId,
    claimed: true,
  });
}

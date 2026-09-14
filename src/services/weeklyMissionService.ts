/**
 * Client wrappers for backend Weekly Missions callables.
 * Fail-closed when EXPO_PUBLIC_ENABLE_BACKEND_WEEKLY_MISSIONS is off.
 */

import { httpsCallable } from 'firebase/functions';

import { BACKEND_WEEKLY_MISSIONS_ENABLED } from '../config/backendRoadmap';
import { waitForInitialAuthState } from './authService';
import { withCallableTimeout } from './callableServiceUtils';
import {
  FIREBASE_FUNCTIONS_REGION,
  getFirebaseAuthSafe,
  getFirebaseFunctionsSafe,
  isFirebaseEnabled,
} from './firebase';

export const WEEKLY_MISSION_CALLABLES = {
  getWeeklyMissions: 'getWeeklyMissions',
  claimWeeklyMissionReward: 'claimWeeklyMissionReward',
  recordCanonicalDeliveryCompletion: 'recordCanonicalDeliveryCompletion',
} as const;

export type WeeklyMissionDifficulty = 'easy' | 'medium' | 'hard';

export type WeeklyMissionPlayerView = {
  id: string;
  type: string;
  target: number;
  difficulty: WeeklyMissionDifficulty;
  reward: { cash: number };
  title: string;
  description: string;
  progress: number;
  completed: boolean;
  claimed: boolean;
  claimedAt: number | null;
  claimAvailable: boolean;
};

export type GetWeeklyMissionsClientResponse =
  | {
      ok: true;
      weekKey: string;
      startsAt: number;
      endsAt: number;
      remainingMs: number;
      claimAvailableForAccount: boolean;
      missions: WeeklyMissionPlayerView[];
    }
  | {
      ok: false;
      reason: string;
    };

export type ClaimWeeklyMissionClientResponse =
  | {
      ok: true;
      weekKey: string;
      missionId: string;
      cashBefore: number;
      cashAfter: number;
      cashAmount: number;
      claimedAt: number;
    }
  | {
      ok: false;
      reason: string;
      weekKey: string;
      missionId: string;
    };

export type RecordCanonicalDeliveryClientResponse =
  | {
      ok: true;
      deliveryId: string;
      alreadyRecorded: boolean;
      completedDeliveries: number;
    }
  | {
      ok: false;
      reason: string;
      deliveryId: string;
    };

function createIdempotencyKey(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${rand}`.slice(0, 120);
}

export function createWeeklyMissionClaimIdempotencyKey(
  weekKey: string,
  missionId: string,
): string {
  return createIdempotencyKey(`wm-${weekKey}-${missionId}`);
}

async function getCallableContext(options?: { allowAnonymous?: boolean }) {
  await waitForInitialAuthState();
  if (!isFirebaseEnabled()) {
    return { ok: false as const, reason: 'firebase-disabled' as const };
  }
  const user = getFirebaseAuthSafe()?.currentUser;
  const functions = getFirebaseFunctionsSafe(FIREBASE_FUNCTIONS_REGION);
  if (!user) {
    return { ok: false as const, reason: 'auth-required' as const };
  }
  if (!options?.allowAnonymous && user.isAnonymous) {
    return { ok: false as const, reason: 'anonymous-not-supported' as const };
  }
  if (!functions) {
    return { ok: false as const, reason: 'service-unavailable' as const };
  }
  return { ok: true as const, functions, user };
}

function isWeeklyMissionDifficulty(value: unknown): value is WeeklyMissionDifficulty {
  return value === 'easy' || value === 'medium' || value === 'hard';
}

function parseMission(raw: unknown): WeeklyMissionPlayerView | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const reward = record.reward as Record<string, unknown> | undefined;
  if (
    typeof record.id !== 'string' ||
    typeof record.target !== 'number' ||
    !isWeeklyMissionDifficulty(record.difficulty) ||
    typeof record.title !== 'string' ||
    typeof record.description !== 'string' ||
    typeof record.progress !== 'number' ||
    typeof reward?.cash !== 'number'
  ) {
    return null;
  }
  return {
    id: record.id,
    type: typeof record.type === 'string' ? record.type : 'weekly_completed_deliveries',
    target: Math.max(0, Math.floor(record.target)),
    difficulty: record.difficulty,
    reward: { cash: Math.max(0, Math.floor(reward.cash)) },
    title: record.title,
    description: record.description,
    progress: Math.max(0, Math.floor(record.progress)),
    completed: record.completed === true,
    claimed: record.claimed === true,
    claimedAt:
      typeof record.claimedAt === 'number' && Number.isFinite(record.claimedAt)
        ? record.claimedAt
        : null,
    claimAvailable: record.claimAvailable === true,
  };
}

export async function getWeeklyMissions(): Promise<GetWeeklyMissionsClientResponse> {
  if (!BACKEND_WEEKLY_MISSIONS_ENABLED) {
    return { ok: false, reason: 'feature-disabled' };
  }
  const context = await getCallableContext({ allowAnonymous: true });
  if (!context.ok) {
    return { ok: false, reason: context.reason };
  }
  try {
    const call = httpsCallable<Record<string, never>, Record<string, unknown>>(
      context.functions,
      WEEKLY_MISSION_CALLABLES.getWeeklyMissions,
    );
    const data = (await withCallableTimeout(call({}).then((result) => result.data))) as Record<
      string,
      unknown
    >;
    if (data.ok !== true) {
      return {
        ok: false,
        reason: typeof data.reason === 'string' ? data.reason : 'service-unavailable',
      };
    }
    const missionsRaw = Array.isArray(data.missions) ? data.missions : [];
    const missions = missionsRaw
      .map(parseMission)
      .filter((item): item is WeeklyMissionPlayerView => item != null);
    if (
      typeof data.weekKey !== 'string' ||
      typeof data.startsAt !== 'number' ||
      typeof data.endsAt !== 'number'
    ) {
      return { ok: false, reason: 'malformed-response' };
    }
    return {
      ok: true,
      weekKey: data.weekKey,
      startsAt: data.startsAt,
      endsAt: data.endsAt,
      remainingMs:
        typeof data.remainingMs === 'number' && Number.isFinite(data.remainingMs)
          ? Math.max(0, data.remainingMs)
          : Math.max(0, data.endsAt - Date.now()),
      claimAvailableForAccount: data.claimAvailableForAccount === true,
      missions,
    };
  } catch {
    return { ok: false, reason: 'service-unavailable' };
  }
}

export async function claimWeeklyMissionReward(input: {
  weekKey: string;
  missionId: string;
  idempotencyKey: string;
}): Promise<ClaimWeeklyMissionClientResponse> {
  const base = { weekKey: input.weekKey, missionId: input.missionId };
  if (!BACKEND_WEEKLY_MISSIONS_ENABLED) {
    return { ok: false, reason: 'feature-disabled', ...base };
  }
  const context = await getCallableContext({ allowAnonymous: false });
  if (!context.ok) {
    return { ok: false, reason: context.reason, ...base };
  }
  try {
    const call = httpsCallable<
      { weekKey: string; missionId: string; idempotencyKey: string },
      Record<string, unknown>
    >(context.functions, WEEKLY_MISSION_CALLABLES.claimWeeklyMissionReward);
    const data = (await withCallableTimeout(
      call({
        weekKey: input.weekKey,
        missionId: input.missionId,
        idempotencyKey: input.idempotencyKey,
      }).then((result) => result.data),
    )) as Record<string, unknown>;
    if (data.ok === true) {
      return {
        ok: true,
        weekKey: typeof data.weekKey === 'string' ? data.weekKey : input.weekKey,
        missionId: typeof data.missionId === 'string' ? data.missionId : input.missionId,
        cashBefore: Number(data.cashBefore) || 0,
        cashAfter: Number(data.cashAfter) || 0,
        cashAmount: Number(data.cashAmount) || 0,
        claimedAt: Number(data.claimedAt) || Date.now(),
      };
    }
    return {
      ok: false,
      reason: typeof data.reason === 'string' ? data.reason : 'service-unavailable',
      ...base,
    };
  } catch {
    return { ok: false, reason: 'service-unavailable', ...base };
  }
}

/**
 * Linked-account only. Not gated by Weekly UI flag — builds server delivery authority.
 * Guests must never call this.
 */
export async function recordCanonicalDeliveryCompletion(input: {
  deliveryId: string;
}): Promise<RecordCanonicalDeliveryClientResponse> {
  const deliveryId = input.deliveryId;
  const context = await getCallableContext({ allowAnonymous: false });
  if (!context.ok) {
    return { ok: false, reason: context.reason, deliveryId };
  }
  try {
    const call = httpsCallable<{ deliveryId: string }, Record<string, unknown>>(
      context.functions,
      WEEKLY_MISSION_CALLABLES.recordCanonicalDeliveryCompletion,
    );
    const data = (await withCallableTimeout(
      call({ deliveryId }).then((result) => result.data),
    )) as Record<string, unknown>;
    if (data.ok === true) {
      return {
        ok: true,
        deliveryId: typeof data.deliveryId === 'string' ? data.deliveryId : deliveryId,
        alreadyRecorded: data.alreadyRecorded === true,
        completedDeliveries: Math.max(0, Math.floor(Number(data.completedDeliveries) || 0)),
      };
    }
    return {
      ok: false,
      reason: typeof data.reason === 'string' ? data.reason : 'service-unavailable',
      deliveryId,
    };
  } catch {
    return { ok: false, reason: 'service-unavailable', deliveryId };
  }
}

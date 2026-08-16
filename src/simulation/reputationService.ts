import { REPUTATION_HISTORY_MAX } from '../config/reputationRules';
import {
  clampReputation,
  type ReputationHistoryEntry,
  type ReputationReason,
  type ReputationSource,
  reputationReasonToDisplayText,
} from '../domain/reputationModel';
import type { Player } from '../types/game';

export type ReputationChangeInput = {
  source: ReputationSource;
  delta: number;
  reason: ReputationReason;
  displayReason?: string;
  deliveryId?: string;
  contractId?: string;
  eventId?: string;
  idempotencyKey: string;
  createdAt: number;
};

export type ReputationChangeResult = {
  player: Player;
  reputationHistory: ReputationHistoryEntry[];
  applied: boolean;
  delta: number;
  previousValue: number;
  nextValue: number;
};

export function hasReputationIdempotencyKey(
  history: ReputationHistoryEntry[] | undefined,
  idempotencyKey: string,
): boolean {
  return (history ?? []).some((entry) => entry.id === idempotencyKey);
}

export function applyReputationChange(
  player: Player,
  history: ReputationHistoryEntry[] | undefined,
  input: ReputationChangeInput,
): ReputationChangeResult {
  const previousValue = clampReputation(player.reputation ?? 0);
  const existingHistory = history ?? [];

  if (hasReputationIdempotencyKey(existingHistory, input.idempotencyKey)) {
    return {
      player,
      reputationHistory: existingHistory,
      applied: false,
      delta: 0,
      previousValue,
      nextValue: previousValue,
    };
  }

  if (input.delta === 0) {
    return {
      player,
      reputationHistory: existingHistory,
      applied: false,
      delta: 0,
      previousValue,
      nextValue: previousValue,
    };
  }

  const nextValue = clampReputation(previousValue + input.delta);
  const appliedDelta = nextValue - previousValue;
  const entry: ReputationHistoryEntry = {
    id: input.idempotencyKey,
    delta: appliedDelta,
    reason: input.displayReason ?? reputationReasonToDisplayText(input.reason),
    source: input.source,
    createdAt: input.createdAt,
    ...(input.deliveryId ? { deliveryId: input.deliveryId } : {}),
    ...(input.contractId ? { contractId: input.contractId } : {}),
  };

  const reputationHistory = [entry, ...existingHistory].slice(0, REPUTATION_HISTORY_MAX);

  return {
    player: {
      ...player,
      reputation: nextValue,
    },
    reputationHistory,
    applied: appliedDelta !== 0,
    delta: appliedDelta,
    previousValue,
    nextValue,
  };
}

export function normalizeReputationHistory(
  history: unknown,
): ReputationHistoryEntry[] {
  if (!Array.isArray(history)) {
    return [];
  }
  return history
    .filter((entry): entry is ReputationHistoryEntry => {
      return (
        entry != null &&
        typeof entry === 'object' &&
        typeof (entry as ReputationHistoryEntry).id === 'string' &&
        typeof (entry as ReputationHistoryEntry).delta === 'number' &&
        typeof (entry as ReputationHistoryEntry).reason === 'string' &&
        typeof (entry as ReputationHistoryEntry).source === 'string' &&
        typeof (entry as ReputationHistoryEntry).createdAt === 'number'
      );
    })
    .map((entry) => ({
      ...entry,
      ...(typeof entry.deliveryId === 'string' ? { deliveryId: entry.deliveryId } : {}),
      ...(typeof entry.contractId === 'string' ? { contractId: entry.contractId } : {}),
    }))
    .slice(0, REPUTATION_HISTORY_MAX);
}

export function mergeReputationIntoStore(
  state: { player: Player; reputationHistory?: ReputationHistoryEntry[] },
  input: ReputationChangeInput,
): {
  player: Player;
  reputationHistory: ReputationHistoryEntry[];
  result: ReputationChangeResult;
} {
  const result = applyReputationChange(state.player, state.reputationHistory, input);
  return {
    player: result.player,
    reputationHistory: result.reputationHistory,
    result,
  };
}

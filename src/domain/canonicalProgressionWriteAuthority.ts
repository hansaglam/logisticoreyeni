/**
 * Step 29AO — post-migration local progression write authority.
 * Guest and pre-migration accounts keep local XP and reputation mutations.
 * A canonical account does not advance those save fields, and a loading or
 * unavailable projection does not fall back to a local company write.
 * This module does not open a Firestore listener and does not grant canonical XP.
 */

import type { Player } from '../types/game';
import { applyXpToPlayer, type ApplyXpResult } from '../simulation/leveling';
import {
  mergeReputationIntoStore,
  type ReputationChangeInput,
  type ReputationChangeResult,
} from '../simulation/reputationService';
import type { ReputationHistoryEntry } from './reputationModel';
import {
  isCanonicalProgressionReadAuthorityAllowed,
  type EffectiveCompanyProgression,
  type ProgressionReadAuthorityClass,
} from './canonicalProgressionReadAuthority';

export const CANONICAL_PROGRESSION_WRITE_POLICY_VERSION =
  'canonical-progression-write-authority-v1' as const;

export const CANONICAL_PROGRESSION_WRITE_AUTHORITY_ENV =
  'CANONICAL_PROGRESSION_WRITE_AUTHORITY' as const;

export const CANONICAL_PROGRESSION_WRITE_AUTHORITY_STATUS =
  'CANONICAL_PROGRESSION_WRITE_AUTHORITY_PASS_INTERNAL_ONLY' as const;

export const CANONICAL_PROGRESSION_LOCAL_WRITE_BLOCKED =
  'CANONICAL_PROGRESSION_LOCAL_WRITE_BLOCKED' as const;
export const CANONICAL_PROGRESSION_WAITING_FOR_SERVER =
  'CANONICAL_PROGRESSION_WAITING_FOR_SERVER' as const;
export const LEGACY_LOCAL_PROGRESSION_WRITE_ALLOWED =
  'LEGACY_LOCAL_PROGRESSION_WRITE_ALLOWED' as const;
export const GUEST_LOCAL_PROGRESSION_WRITE_ALLOWED =
  'GUEST_LOCAL_PROGRESSION_WRITE_ALLOWED' as const;

export type ProgressionWriteDecision =
  | 'LOCAL_AUTHORITATIVE'
  | 'LOCAL_NON_AUTHORITATIVE_BLOCKED'
  | 'CANONICAL_SERVER_EXPECTED'
  | 'CANONICAL_LOADING_BLOCKED'
  | 'CANONICAL_UNAVAILABLE_BLOCKED';

export type ClientProgressionWriteSource =
  | 'delivery_completed'
  | 'delivery_failure'
  | 'delivery_cancel'
  | 'truck_purchase'
  | 'driver_hire'
  | 'warehouse_open'
  | 'warehouse_upgrade'
  | 'trade_sale'
  | 'mission_reward'
  | 'milestone_reward'
  | 'weekly_objective_reward'
  | 'operation_choice'
  | 'vehicle_recovery'
  | 'debug'
  | 'level_check'
  | 'unspecified';

export type ProgressionWriteDiagnostic =
  | typeof CANONICAL_PROGRESSION_LOCAL_WRITE_BLOCKED
  | typeof CANONICAL_PROGRESSION_WAITING_FOR_SERVER
  | typeof LEGACY_LOCAL_PROGRESSION_WRITE_ALLOWED
  | typeof GUEST_LOCAL_PROGRESSION_WRITE_ALLOWED;

export type ProgressionWriteResolution = {
  decision: ProgressionWriteDecision;
  authorityClass: ProgressionReadAuthorityClass;
  source: ClientProgressionWriteSource;
  diagnostic: ProgressionWriteDiagnostic;
  backendSource: 'CANONICAL_RECEIPT' | 'NONE';
};

const SERVER_RECEIPT_SOURCES: ReadonlySet<ClientProgressionWriteSource> = new Set([
  'delivery_completed',
  'delivery_failure',
  'delivery_cancel',
  'truck_purchase',
  'driver_hire',
  'warehouse_open',
  'warehouse_upgrade',
  'trade_sale',
  'mission_reward',
  'milestone_reward',
  'weekly_objective_reward',
]);

export function isCanonicalProgressionWriteAuthorityAllowed(input?: {
  envValue?: string | null;
  readGateEnabled?: boolean;
}): boolean {
  const raw =
    input && 'envValue' in input
      ? input.envValue
      : typeof process !== 'undefined'
        ? process.env[CANONICAL_PROGRESSION_WRITE_AUTHORITY_ENV]
        : undefined;
  const readGate =
    input && 'readGateEnabled' in input
      ? input.readGateEnabled === true
      : isCanonicalProgressionReadAuthorityAllowed();
  return raw === 'INTERNAL_TEST' && readGate;
}

export function normalizeClientProgressionWriteSource(
  reason: string | undefined | null,
): ClientProgressionWriteSource {
  switch (reason) {
    case 'delivery_completed':
    case 'delivery_failure':
    case 'delivery_cancel':
    case 'truck_purchase':
    case 'driver_hire':
    case 'warehouse_open':
    case 'warehouse_upgrade':
    case 'trade_sale':
    case 'mission_reward':
    case 'milestone_reward':
    case 'weekly_objective_reward':
    case 'operation_choice':
    case 'vehicle_recovery':
    case 'debug':
    case 'level_check':
      return reason;
    default:
      return 'unspecified';
  }
}

export function clientProgressionWriteHasCanonicalReceipt(
  source: ClientProgressionWriteSource,
): boolean {
  return SERVER_RECEIPT_SOURCES.has(source);
}

function resolution(
  decision: ProgressionWriteDecision,
  authorityClass: ProgressionReadAuthorityClass,
  source: ClientProgressionWriteSource,
  diagnostic: ProgressionWriteDiagnostic,
): ProgressionWriteResolution {
  return {
    decision,
    authorityClass,
    source,
    diagnostic,
    backendSource: clientProgressionWriteHasCanonicalReceipt(source) ? 'CANONICAL_RECEIPT' : 'NONE',
  };
}

export function resolveCanonicalProgressionWrite(input: {
  writeGateEnabled: boolean;
  progression: EffectiveCompanyProgression;
  source: ClientProgressionWriteSource;
}): ProgressionWriteResolution {
  if (!input.writeGateEnabled) {
    const guest = input.progression.authorityClass === 'GUEST_LOCAL';
    return resolution(
      'LOCAL_AUTHORITATIVE',
      guest ? 'GUEST_LOCAL' : 'SIGNED_IN_LEGACY_LOCAL',
      input.source,
      guest ? GUEST_LOCAL_PROGRESSION_WRITE_ALLOWED : LEGACY_LOCAL_PROGRESSION_WRITE_ALLOWED,
    );
  }

  const authorityClass = input.progression.authorityClass;
  if (authorityClass === 'GUEST_LOCAL') {
    return resolution(
      'LOCAL_AUTHORITATIVE',
      'GUEST_LOCAL',
      input.source,
      GUEST_LOCAL_PROGRESSION_WRITE_ALLOWED,
    );
  }
  if (authorityClass === 'SIGNED_IN_LEGACY_LOCAL') {
    return resolution(
      'LOCAL_AUTHORITATIVE',
      'SIGNED_IN_LEGACY_LOCAL',
      input.source,
      LEGACY_LOCAL_PROGRESSION_WRITE_ALLOWED,
    );
  }
  if (authorityClass === 'SIGNED_IN_CANONICAL_LOADING' || input.progression.status === 'loading') {
    return resolution(
      'CANONICAL_LOADING_BLOCKED',
      authorityClass === 'SIGNED_IN_CANONICAL_LOADING' ? authorityClass : 'SIGNED_IN_CANONICAL_LOADING',
      input.source,
      CANONICAL_PROGRESSION_WAITING_FOR_SERVER,
    );
  }
  if (authorityClass === 'SIGNED_IN_CANONICAL_SERVER' && input.progression.status === 'ready') {
    return resolution(
      clientProgressionWriteHasCanonicalReceipt(input.source)
        ? 'CANONICAL_SERVER_EXPECTED'
        : 'LOCAL_NON_AUTHORITATIVE_BLOCKED',
      'SIGNED_IN_CANONICAL_SERVER',
      input.source,
      clientProgressionWriteHasCanonicalReceipt(input.source)
        ? CANONICAL_PROGRESSION_WAITING_FOR_SERVER
        : CANONICAL_PROGRESSION_LOCAL_WRITE_BLOCKED,
    );
  }
  return resolution(
    'CANONICAL_UNAVAILABLE_BLOCKED',
    authorityClass,
    input.source,
    CANONICAL_PROGRESSION_LOCAL_WRITE_BLOCKED,
  );
}

export function applyGuardedCompanyXp(
  player: Player,
  amount: number,
  write: ProgressionWriteResolution,
): { applied: false; xpResult: null } | { applied: true; xpResult: ApplyXpResult } {
  if (write.decision !== 'LOCAL_AUTHORITATIVE' || amount <= 0) {
    return { applied: false, xpResult: null };
  }
  return { applied: true, xpResult: applyXpToPlayer(player, amount) };
}

export function applyGuardedCompanyReputation(
  state: { player: Player; reputationHistory?: ReputationHistoryEntry[] },
  input: ReputationChangeInput,
  write: ProgressionWriteResolution,
): {
  player: Player;
  reputationHistory: ReputationHistoryEntry[];
  result: ReputationChangeResult;
} {
  if (write.decision !== 'LOCAL_AUTHORITATIVE') {
    const reputationHistory = state.reputationHistory ?? [];
    const value = state.player.reputation ?? 0;
    return {
      player: state.player,
      reputationHistory,
      result: {
        player: state.player,
        reputationHistory,
        applied: false,
        delta: 0,
        previousValue: value,
        nextValue: value,
      },
    };
  }
  return mergeReputationIntoStore(state, input);
}

export type ProgressionWriteAuditRow = {
  path: string;
  trigger: string;
  currentWriteTarget: string;
  canonicalAction: 'LOCAL_PRESERVED' | 'ACK_NO_OP' | 'BLOCK_NO_BACKEND';
  canonicalBackendSource: string | null;
};

export const CLIENT_PROGRESSION_WRITE_AUDIT: readonly ProgressionWriteAuditRow[] = [
  {
    path: 'gameStore.completeDelivery → addCompanyXp',
    trigger: 'delivery_completed',
    currentWriteTarget: 'player.xp, level, totalXp',
    canonicalAction: 'ACK_NO_OP',
    canonicalBackendSource: 'ROAD_DELIVERY_COMPLETION',
  },
  {
    path: 'gameStore.completeDelivery → mergeReputation',
    trigger: 'delivery_completed reputation',
    currentWriteTarget: 'player.reputation, reputationHistory',
    canonicalAction: 'ACK_NO_OP',
    canonicalBackendSource: 'canonical-road-reputation-v1',
  },
  {
    path: 'gameStore.failDelivery → mergeReputation',
    trigger: 'delivery_failure',
    currentWriteTarget: 'player.reputation, reputationHistory',
    canonicalAction: 'ACK_NO_OP',
    canonicalBackendSource: 'ROAD_DELIVERY_SERVER_FAILURE',
  },
  {
    path: 'gameStore.failDelivery cancel → mergeReputation',
    trigger: 'delivery_cancel',
    currentWriteTarget: 'player.reputation, reputationHistory',
    canonicalAction: 'ACK_NO_OP',
    canonicalBackendSource: 'ROAD_DELIVERY_CANCEL',
  },
  {
    path: 'gameStore.buyTruck → addCompanyXp',
    trigger: 'truck_purchase',
    currentWriteTarget: 'player.xp, level, totalXp',
    canonicalAction: 'ACK_NO_OP',
    canonicalBackendSource: 'purchaseCanonicalCatalogAssetTransaction',
  },
  {
    path: 'gameStore.hireDriver → addCompanyXp',
    trigger: 'driver_hire',
    currentWriteTarget: 'player.xp, level, totalXp',
    canonicalAction: 'ACK_NO_OP',
    canonicalBackendSource: 'hireCanonicalDriverTransaction',
  },
  {
    path: 'gameStore.openWarehouse → addCompanyXp',
    trigger: 'warehouse_open',
    currentWriteTarget: 'player.xp, level, totalXp',
    canonicalAction: 'ACK_NO_OP',
    canonicalBackendSource: 'openCanonicalWarehouseTransaction',
  },
  {
    path: 'gameStore.upgradeWarehouse → addCompanyXp',
    trigger: 'warehouse_upgrade',
    currentWriteTarget: 'player.xp, level, totalXp',
    canonicalAction: 'ACK_NO_OP',
    canonicalBackendSource: 'upgradeCanonicalWarehouseTransaction',
  },
  {
    path: 'gameStore.sellProductFromWarehouse → addCompanyXp',
    trigger: 'trade_sale',
    currentWriteTarget: 'player.xp, level, totalXp',
    canonicalAction: 'ACK_NO_OP',
    canonicalBackendSource: 'sellCanonicalCargoTransaction (zero-decay only)',
  },
  {
    path: 'gameStore.claimMissionReward → addCompanyXp / reputation',
    trigger: 'mission_reward',
    currentWriteTarget: 'player.xp, reputation, reputationHistory',
    canonicalAction: 'ACK_NO_OP',
    canonicalBackendSource: 'claimCanonicalClientReward MISSION',
  },
  {
    path: 'gameStore.claimMilestoneReward → addCompanyXp / reputation',
    trigger: 'milestone_reward',
    currentWriteTarget: 'player.xp, reputation, reputationHistory',
    canonicalAction: 'ACK_NO_OP',
    canonicalBackendSource: 'claimCanonicalClientReward MILESTONE',
  },
  {
    path: 'gameStore.claimWeeklyObjectiveReward → addCompanyXp / reputation',
    trigger: 'weekly_objective_reward',
    currentWriteTarget: 'player.xp, reputation, reputationHistory',
    canonicalAction: 'ACK_NO_OP',
    canonicalBackendSource: 'claimCanonicalClientReward WEEKLY_OBJECTIVE',
  },
  {
    path: 'gameStore.resolveDeliveryOperationChoice → applyXpToPlayer / reputation',
    trigger: 'operation_choice',
    currentWriteTarget: 'player.xp, reputation, reputationHistory',
    canonicalAction: 'BLOCK_NO_BACKEND',
    canonicalBackendSource: null,
  },
  {
    path: 'gameStore vehicle recovery → mergeReputation',
    trigger: 'vehicle_recovery',
    currentWriteTarget: 'player.reputation, reputationHistory',
    canonicalAction: 'BLOCK_NO_BACKEND',
    canonicalBackendSource: null,
  },
  {
    path: 'gameStore.checkLevelUp',
    trigger: 'level_check',
    currentWriteTarget: 'player.level, xp',
    canonicalAction: 'BLOCK_NO_BACKEND',
    canonicalBackendSource: null,
  },
  {
    path: 'DebugSimulationScreen → addCompanyXp debug',
    trigger: 'debug',
    currentWriteTarget: 'player.xp, level, totalXp',
    canonicalAction: 'BLOCK_NO_BACKEND',
    canonicalBackendSource: null,
  },
];

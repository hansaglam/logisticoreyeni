/**
 * Canonical client-reward XP authority (Map V2 Step 29AI).
 *
 * Missions, milestones and local weekly objectives grant company XP on a manual claim.
 * The server owns the catalog (built from the production definitions), derives progress
 * from canonical receipts/state at claim time, and grants XP (+ production reputation)
 * once through the 29AF progression receipt. Client progress, completion flags, XP,
 * targets and cycles are never read. Pure. No React. No Firebase.
 */

import { ALL_MISSIONS, type MissionConfig } from '../config/missions';
import { MILESTONE_DEFINITIONS, type MilestoneDefinition } from '../data/milestones';
import { generateWeeklyObjectives, type WeeklyObjectiveDefinition } from '../data/weeklyObjectives';
import { getWeeklySeasonKey } from '../utils/leaderboardSeason';
import type { ProductId, WarehouseType } from '../types/game';
import type { ReputationReason } from './reputationModel';
import type {
  CanonicalCompanyProgressionState,
  CanonicalProgressionMutationInput,
} from './canonicalCompanyProgression';
import {
  countCanonicalActiveRewardTrucks,
  findCanonicalLocalReward,
  isCanonicalActiveRewardTruck,
} from './canonicalLocalRewardClaim';
import type { CanonicalFleetAssetDocument } from './canonicalRoadFleet';
import { resolveAssetTrustClass } from './canonicalProductionFleet';
import type {
  CanonicalCargoInventoryDocument,
  CanonicalCargoMarketReceipt,
} from './canonicalCargoMarketWorldState';
import type { CanonicalWarehouseDocument } from './canonicalWarehouseState';
import type { CanonicalFleetRepairUpgradeReceipt } from './canonicalFleetRepairUpgrade';
import {
  CARGO_SALE_XP_BLOCKED_QUALITY_AUTHORITY,
  progressionCargoSaleOperationId,
  resolveCanonicalCargoSaleQuality,
} from './canonicalNonDeliveryCompanyXp';

export const CANONICAL_CLIENT_REWARD_XP_AUTHORITY_ENV = 'CANONICAL_CLIENT_REWARD_XP_AUTHORITY' as const;
export const CANONICAL_CLIENT_REWARD_XP_POLICY_VERSION = 'canonical-client-reward-xp-v1' as const;
export const CANONICAL_WEEKLY_OBJECTIVE_CYCLE_POLICY_VERSION =
  'canonical-weekly-objective-cycle-iso-utc-v1' as const;
export const CANONICAL_CLIENT_REWARD_CLAIM_SCHEMA_VERSION = 2 as const;

export const CANONICAL_CLIENT_REWARD_XP_AUTHORITY_STATUS =
  'CANONICAL_CLIENT_REWARD_XP_AUTHORITY_PASS_PARTIAL' as const;

/** Production local weekly claims are disabled while the backend weekly mission mode is on. */
export const WEEKLY_MISSIONS_BACKEND_ENV = 'WEEKLY_MISSIONS_BACKEND_ENABLED' as const;

export const CLIENT_REWARD_XP_BLOCKED_CASH_AUTHORITY = 'CLIENT_REWARD_XP_BLOCKED_CASH_AUTHORITY' as const;
export const CLIENT_REWARD_XP_BLOCKED_COMPANY_SCORE_AUTHORITY =
  'CLIENT_REWARD_XP_BLOCKED_COMPANY_SCORE_AUTHORITY' as const;
export const CLIENT_REWARD_XP_BLOCKED_CLIENT_UI_EVENT = 'CLIENT_REWARD_XP_BLOCKED_CLIENT_UI_EVENT' as const;
export const CLIENT_REWARD_XP_BLOCKED_MARKET_PRICE_AUTHORITY =
  'CLIENT_REWARD_XP_BLOCKED_MARKET_PRICE_AUTHORITY' as const;
export const CLIENT_REWARD_XP_BLOCKED_FLEET_LOCATION_AUTHORITY =
  'CLIENT_REWARD_XP_BLOCKED_FLEET_LOCATION_AUTHORITY' as const;
export const CLIENT_REWARD_XP_BLOCKED_LEDGER_WINDOW_PARITY =
  'CLIENT_REWARD_XP_BLOCKED_LEDGER_WINDOW_PARITY' as const;
export const CLIENT_REWARD_XP_BLOCKED_DRIVER_LEVEL_AUTHORITY =
  'CLIENT_REWARD_XP_BLOCKED_DRIVER_LEVEL_AUTHORITY' as const;
export const CLIENT_REWARD_XP_BLOCKED_CARGO_QUALITY_AUTHORITY =
  'CLIENT_REWARD_XP_BLOCKED_CARGO_QUALITY_AUTHORITY' as const;
export const CLIENT_REWARD_XP_BLOCKED_TRADE_PROFIT_AUTHORITY =
  'CLIENT_REWARD_XP_BLOCKED_TRADE_PROFIT_AUTHORITY' as const;
export const CLIENT_REWARD_XP_HISTORICAL_CLAIM_UNAPPLIED = 'CLIENT_REWARD_XP_HISTORICAL_CLAIM_UNAPPLIED' as const;
export const CLIENT_REWARD_XP_POLICY_UNKNOWN = 'CLIENT_REWARD_XP_POLICY_UNKNOWN' as const;
export const CLIENT_REWARD_XP_CLAIM_CONFLICT = 'CLIENT_REWARD_XP_CLAIM_CONFLICT' as const;
export const CLIENT_REWARD_XP_PROGRESSION_RECEIPT_CONFLICT =
  'CLIENT_REWARD_XP_PROGRESSION_RECEIPT_CONFLICT' as const;
export const CLIENT_REWARD_XP_PROGRESSION_UNINITIALIZED = 'CLIENT_REWARD_XP_PROGRESSION_UNINITIALIZED' as const;
export const CLIENT_REWARD_XP_PROGRESSION_NOT_SERVER_CANONICAL =
  'CLIENT_REWARD_XP_PROGRESSION_NOT_SERVER_CANONICAL' as const;
export const CLIENT_REWARD_CASH_AUTHORITY_REQUIRED = 'CLIENT_REWARD_CASH_AUTHORITY_REQUIRED' as const;
export const CLIENT_REWARD_XP_CLAIM_PATH_REQUIRED = 'CLIENT_REWARD_XP_CLAIM_PATH_REQUIRED' as const;
export const LOCAL_WEEKLY_OBJECTIVE_DISABLED_BACKEND_WEEKLY_MODE =
  'LOCAL_WEEKLY_OBJECTIVE_DISABLED_BACKEND_WEEKLY_MODE' as const;
export const LEGACY_REWARD_PROGRESS_UNVERIFIED = 'LEGACY_REWARD_PROGRESS_UNVERIFIED' as const;
export const REWARD_NOT_ELIGIBLE = 'REWARD_NOT_ELIGIBLE' as const;
export const REWARD_CYCLE_NOT_CURRENT = 'REWARD_CYCLE_NOT_CURRENT' as const;
export const UNKNOWN_REWARD = 'UNKNOWN_REWARD' as const;
export const OPERATION_CHOICE_XP_CLIENT_OWNED_DORMANT = 'OPERATION_CHOICE_XP_CLIENT_OWNED_DORMANT' as const;

export type CanonicalClientRewardStaticBlock =
  | typeof CLIENT_REWARD_XP_BLOCKED_CASH_AUTHORITY
  | typeof CLIENT_REWARD_XP_BLOCKED_COMPANY_SCORE_AUTHORITY
  | typeof CLIENT_REWARD_XP_BLOCKED_CLIENT_UI_EVENT
  | typeof CLIENT_REWARD_XP_BLOCKED_MARKET_PRICE_AUTHORITY
  | typeof CLIENT_REWARD_XP_BLOCKED_FLEET_LOCATION_AUTHORITY
  | typeof CLIENT_REWARD_XP_BLOCKED_LEDGER_WINDOW_PARITY
  | typeof CLIENT_REWARD_XP_BLOCKED_DRIVER_LEVEL_AUTHORITY;

export type CanonicalClientRewardFamily = 'MISSION' | 'MILESTONE' | 'WEEKLY_OBJECTIVE';

export type CanonicalClientRewardSourceType =
  | 'CLIENT_REWARD_MISSION'
  | 'CLIENT_REWARD_MILESTONE'
  | 'CLIENT_REWARD_WEEKLY_OBJECTIVE';

export type CanonicalRewardProgressSource =
  | 'SERVER_RECEIPT_DERIVABLE'
  | 'SERVER_STATE_DERIVABLE'
  | 'CLIENT_ONLY'
  | 'HISTORICAL_UNAVAILABLE'
  | 'UNSUPPORTED';

export type CanonicalRewardMetric =
  | { kind: 'DELIVERIES_STARTED' }
  | { kind: 'DELIVERIES_COMPLETED' }
  | { kind: 'CITY_DELIVERIES'; cityId: string }
  | { kind: 'CONTRACT_TYPE_COMPLETED'; contractType: 'urgent' | 'fragile' | 'high_reputation' }
  | { kind: 'CARGO_BOUGHT' }
  | { kind: 'TRADE_CASH_FLOW_PROFIT' }
  | { kind: 'ACTIVE_TRUCKS' }
  | { kind: 'HIGH_CAPACITY_TRUCK'; minCapacity: number }
  | { kind: 'WAREHOUSE_STOCK_ACTIVE' }
  | { kind: 'WAREHOUSE_STOCK_TONS' }
  | { kind: 'WAREHOUSE_STOCK_CITIES' }
  | { kind: 'REPUTATION' }
  | { kind: 'TRUCK_UPGRADES' }
  | { kind: 'TRUCK_REPAIRS' }
  | { kind: 'WEEKLY_DELIVERIES' }
  | { kind: 'WEEKLY_ON_TIME_DELIVERIES' }
  | { kind: 'WEEKLY_CITIES_OPERATED' }
  | { kind: 'WEEKLY_TRADE_PROFIT' }
  | { kind: 'WEEKLY_STOCK_STORED' };

export type CanonicalRewardMetricKind = CanonicalRewardMetric['kind'];

export type CanonicalRewardEvidenceKind =
  | 'DELIVERIES'
  | 'CARGO_RECEIPTS'
  | 'CARGO_SALE_PROGRESSION'
  | 'INVENTORY'
  | 'WAREHOUSES'
  | 'FLEET'
  | 'FLEET_MUTATIONS'
  | 'PROGRESSION';

export type CanonicalRewardCashAuthority =
  | 'CANONICAL_29W_INTERNAL'
  | 'CASH_BLOCKED_NO_SERVER_CASH_AUTHORITY'
  | 'NO_CASH_COMPONENT';

type CanonicalRewardRule =
  | { metric: CanonicalRewardMetric; progressSource: 'SERVER_RECEIPT_DERIVABLE' | 'SERVER_STATE_DERIVABLE' }
  | { blocked: CanonicalClientRewardStaticBlock; progressSource: 'CLIENT_ONLY' | 'UNSUPPORTED' };

export type CanonicalClientRewardDefinition = {
  rewardId: string;
  family: CanonicalClientRewardFamily;
  cycleId: string | null;
  xpReward: number;
  reputationReward: number;
  productionCashReward: number;
  target: number;
  metric: CanonicalRewardMetric | null;
  blockedAuthority: CanonicalClientRewardStaticBlock | null;
  progressSource: CanonicalRewardProgressSource;
  claimPolicy: 'MANUAL_ONE_TIME' | 'MANUAL_ONE_PER_CYCLE';
  resetPolicy: 'NONE' | 'ISO_WEEK_UTC';
  cashAuthority: CanonicalRewardCashAuthority;
  policyVersion: typeof CANONICAL_CLIENT_REWARD_XP_POLICY_VERSION;
};

/** Every production mission id must appear here; a new mission without a rule fails closed. */
const MISSION_RULES: Record<string, CanonicalRewardRule> = {
  first_contract_start: { metric: { kind: 'DELIVERIES_STARTED' }, progressSource: 'SERVER_STATE_DERIVABLE' },
  first_delivery: { metric: { kind: 'DELIVERIES_COMPLETED' }, progressSource: 'SERVER_RECEIPT_DERIVABLE' },
  first_profit: { blocked: CLIENT_REWARD_XP_BLOCKED_CASH_AUTHORITY, progressSource: 'CLIENT_ONLY' },
  open_market: { blocked: CLIENT_REWARD_XP_BLOCKED_CLIENT_UI_EVENT, progressSource: 'CLIENT_ONLY' },
  first_trade: { metric: { kind: 'CARGO_BOUGHT' }, progressSource: 'SERVER_RECEIPT_DERIVABLE' },
  complete_5_deliveries: { metric: { kind: 'DELIVERIES_COMPLETED' }, progressSource: 'SERVER_RECEIPT_DERIVABLE' },
  complete_10_deliveries: { metric: { kind: 'DELIVERIES_COMPLETED' }, progressSource: 'SERVER_RECEIPT_DERIVABLE' },
  reach_company_score_150k: {
    blocked: CLIENT_REWARD_XP_BLOCKED_COMPANY_SCORE_AUTHORITY,
    progressSource: 'CLIENT_ONLY',
  },
  own_2_trucks: { metric: { kind: 'ACTIVE_TRUCKS' }, progressSource: 'SERVER_STATE_DERIVABLE' },
  reach_warehouse_value_25000: {
    blocked: CLIENT_REWARD_XP_BLOCKED_MARKET_PRICE_AUTHORITY,
    progressSource: 'CLIENT_ONLY',
  },
  earn_10000_trade_profit: {
    metric: { kind: 'TRADE_CASH_FLOW_PROFIT' },
    progressSource: 'SERVER_RECEIPT_DERIVABLE',
  },
  operate_in_3_cities: {
    blocked: CLIENT_REWARD_XP_BLOCKED_FLEET_LOCATION_AUTHORITY,
    progressSource: 'CLIENT_ONLY',
  },
};

function milestoneRule(def: MilestoneDefinition): CanonicalRewardRule {
  const metric = def.metric;
  switch (metric.type) {
    case 'completed_contracts':
      return { metric: { kind: 'DELIVERIES_COMPLETED' }, progressSource: 'SERVER_RECEIPT_DERIVABLE' };
    case 'city_deliveries':
      return metric.cityId
        ? { metric: { kind: 'CITY_DELIVERIES', cityId: metric.cityId }, progressSource: 'SERVER_RECEIPT_DERIVABLE' }
        : { blocked: CLIENT_REWARD_XP_BLOCKED_LEDGER_WINDOW_PARITY, progressSource: 'UNSUPPORTED' };
    case 'urgent_contracts_completed':
      return {
        metric: { kind: 'CONTRACT_TYPE_COMPLETED', contractType: 'urgent' },
        progressSource: 'SERVER_RECEIPT_DERIVABLE',
      };
    case 'fragile_contracts_completed':
      return {
        metric: { kind: 'CONTRACT_TYPE_COMPLETED', contractType: 'fragile' },
        progressSource: 'SERVER_RECEIPT_DERIVABLE',
      };
    case 'high_reputation_contracts_completed':
      return {
        metric: { kind: 'CONTRACT_TYPE_COMPLETED', contractType: 'high_reputation' },
        progressSource: 'SERVER_RECEIPT_DERIVABLE',
      };
    case 'truck_count':
      return { metric: { kind: 'ACTIVE_TRUCKS' }, progressSource: 'SERVER_STATE_DERIVABLE' };
    case 'high_capacity_truck':
      return {
        metric: { kind: 'HIGH_CAPACITY_TRUCK', minCapacity: metric.minCapacity ?? 20 },
        progressSource: 'SERVER_STATE_DERIVABLE',
      };
    case 'warehouse_active':
      return { metric: { kind: 'WAREHOUSE_STOCK_ACTIVE' }, progressSource: 'SERVER_STATE_DERIVABLE' };
    case 'warehouse_stock_tons':
      return { metric: { kind: 'WAREHOUSE_STOCK_TONS' }, progressSource: 'SERVER_STATE_DERIVABLE' };
    case 'warehouse_cities':
      return { metric: { kind: 'WAREHOUSE_STOCK_CITIES' }, progressSource: 'SERVER_STATE_DERIVABLE' };
    case 'reputation':
      return { metric: { kind: 'REPUTATION' }, progressSource: 'SERVER_STATE_DERIVABLE' };
    case 'truck_upgraded':
      return { metric: { kind: 'TRUCK_UPGRADES' }, progressSource: 'SERVER_RECEIPT_DERIVABLE' };
    case 'maintenance_count':
      return { metric: { kind: 'TRUCK_REPAIRS' }, progressSource: 'SERVER_RECEIPT_DERIVABLE' };
    case 'trade_profit_total':
    case 'trade_profit_product':
    case 'trade_buy_and_sell':
      return { blocked: CLIENT_REWARD_XP_BLOCKED_LEDGER_WINDOW_PARITY, progressSource: 'CLIENT_ONLY' };
    case 'cash':
      return { blocked: CLIENT_REWARD_XP_BLOCKED_CASH_AUTHORITY, progressSource: 'CLIENT_ONLY' };
    case 'company_score':
      return { blocked: CLIENT_REWARD_XP_BLOCKED_COMPANY_SCORE_AUTHORITY, progressSource: 'CLIENT_ONLY' };
    case 'driver_level_3':
      return { blocked: CLIENT_REWARD_XP_BLOCKED_DRIVER_LEVEL_AUTHORITY, progressSource: 'CLIENT_ONLY' };
    default:
      return { blocked: CLIENT_REWARD_XP_BLOCKED_LEDGER_WINDOW_PARITY, progressSource: 'UNSUPPORTED' };
  }
}

function weeklyRule(def: WeeklyObjectiveDefinition): CanonicalRewardRule {
  switch (def.metric) {
    case 'weekly_deliveries':
      return { metric: { kind: 'WEEKLY_DELIVERIES' }, progressSource: 'SERVER_RECEIPT_DERIVABLE' };
    case 'weekly_on_time_deliveries':
      return { metric: { kind: 'WEEKLY_ON_TIME_DELIVERIES' }, progressSource: 'SERVER_RECEIPT_DERIVABLE' };
    case 'weekly_cities_operated':
      return { metric: { kind: 'WEEKLY_CITIES_OPERATED' }, progressSource: 'SERVER_RECEIPT_DERIVABLE' };
    case 'weekly_trade_profit':
      return { metric: { kind: 'WEEKLY_TRADE_PROFIT' }, progressSource: 'SERVER_RECEIPT_DERIVABLE' };
    case 'weekly_stock_stored':
      return { metric: { kind: 'WEEKLY_STOCK_STORED' }, progressSource: 'SERVER_RECEIPT_DERIVABLE' };
    default:
      return { blocked: CLIENT_REWARD_XP_BLOCKED_CLIENT_UI_EVENT, progressSource: 'UNSUPPORTED' };
  }
}

function positiveInt(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function cashAuthorityFor(rewardId: string, cash: number): CanonicalRewardCashAuthority {
  if (cash <= 0) return 'NO_CASH_COMPONENT';
  return findCanonicalLocalReward(rewardId) ? 'CANONICAL_29W_INTERNAL' : 'CASH_BLOCKED_NO_SERVER_CASH_AUTHORITY';
}

function buildDefinition(input: {
  rewardId: string;
  family: CanonicalClientRewardFamily;
  cycleId: string | null;
  xp: unknown;
  reputation: unknown;
  cash: unknown;
  target: number;
  rule: CanonicalRewardRule;
}): CanonicalClientRewardDefinition {
  const cash = positiveInt(input.cash);
  return {
    rewardId: input.rewardId,
    family: input.family,
    cycleId: input.cycleId,
    xpReward: positiveInt(input.xp),
    reputationReward: typeof input.reputation === 'number' && Number.isFinite(input.reputation) ? input.reputation : 0,
    productionCashReward: cash,
    target: input.target,
    metric: 'metric' in input.rule ? input.rule.metric : null,
    blockedAuthority: 'blocked' in input.rule ? input.rule.blocked : null,
    progressSource: input.rule.progressSource,
    claimPolicy: input.family === 'WEEKLY_OBJECTIVE' ? 'MANUAL_ONE_PER_CYCLE' : 'MANUAL_ONE_TIME',
    resetPolicy: input.family === 'WEEKLY_OBJECTIVE' ? 'ISO_WEEK_UTC' : 'NONE',
    cashAuthority: cashAuthorityFor(input.rewardId, cash),
    policyVersion: CANONICAL_CLIENT_REWARD_XP_POLICY_VERSION,
  };
}

function missionDefinition(mission: MissionConfig): CanonicalClientRewardDefinition {
  const rule = MISSION_RULES[mission.id];
  if (!rule) throw new Error(`CANONICAL_CLIENT_REWARD_MISSION_RULE_MISSING:${mission.id}`);
  return buildDefinition({
    rewardId: mission.id,
    family: 'MISSION',
    cycleId: null,
    xp: mission.reward.xp,
    reputation: mission.reward.reputation,
    cash: mission.reward.money,
    target: mission.targetValue,
    rule,
  });
}

function milestoneDefinition(def: MilestoneDefinition): CanonicalClientRewardDefinition {
  return buildDefinition({
    rewardId: def.id,
    family: 'MILESTONE',
    cycleId: null,
    xp: def.reward.xp,
    reputation: def.reward.reputation,
    cash: def.reward.cash,
    target: def.target,
    rule: milestoneRule(def),
  });
}

function weeklyDefinition(def: WeeklyObjectiveDefinition): CanonicalClientRewardDefinition {
  return buildDefinition({
    rewardId: def.id,
    family: 'WEEKLY_OBJECTIVE',
    cycleId: def.seasonKey,
    xp: def.reward.xp,
    reputation: def.reward.reputation,
    cash: def.reward.cash,
    target: def.target,
    rule: weeklyRule(def),
  });
}

export const CANONICAL_MISSION_REWARD_CATALOG: readonly CanonicalClientRewardDefinition[] =
  ALL_MISSIONS.map(missionDefinition);

export const CANONICAL_MILESTONE_REWARD_CATALOG: readonly CanonicalClientRewardDefinition[] =
  MILESTONE_DEFINITIONS.map(milestoneDefinition);

// ---------------------------------------------------------------------------
// Weekly cycle (server clock)
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000;

export type CanonicalWeeklyCycle = {
  cycleId: string;
  startMs: number;
  endMs: number;
  policyVersion: typeof CANONICAL_WEEKLY_OBJECTIVE_CYCLE_POLICY_VERSION;
};

/** Production getWeeklySeasonKey (ISO-8601 week, UTC) evaluated on the server clock. */
export function resolveCanonicalWeeklyCycle(nowMs: number): CanonicalWeeklyCycle {
  const date = new Date(nowMs);
  const dayStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const isoDay = new Date(dayStart).getUTCDay() || 7;
  const startMs = dayStart - (isoDay - 1) * MS_PER_DAY;
  return {
    cycleId: getWeeklySeasonKey(date),
    startMs,
    endMs: startMs + 7 * MS_PER_DAY,
    policyVersion: CANONICAL_WEEKLY_OBJECTIVE_CYCLE_POLICY_VERSION,
  };
}

export function buildCanonicalWeeklyObjectiveCatalog(cycleId: string): CanonicalClientRewardDefinition[] {
  return generateWeeklyObjectives(cycleId).map(weeklyDefinition);
}

const WEEKLY_OBJECTIVE_ID = /^weekly_(weekly_\d{4}-W\d{2})_(delivery|trade|warehouse|reputation|bonus)$/;

export type CanonicalClientRewardResolution =
  | { ok: true; definition: CanonicalClientRewardDefinition; cycle: CanonicalWeeklyCycle | null }
  | { ok: false; reason: typeof UNKNOWN_REWARD | typeof REWARD_CYCLE_NOT_CURRENT };

/** The client rewardId is only a selector; everything else comes from the server catalog. */
export function resolveCanonicalClientReward(rewardId: unknown, nowMs: number): CanonicalClientRewardResolution {
  if (typeof rewardId !== 'string' || rewardId.length === 0 || rewardId.length > 80) {
    return { ok: false, reason: UNKNOWN_REWARD };
  }
  const mission = CANONICAL_MISSION_REWARD_CATALOG.find((row) => row.rewardId === rewardId);
  if (mission) return { ok: true, definition: mission, cycle: null };
  const milestone = CANONICAL_MILESTONE_REWARD_CATALOG.find((row) => row.rewardId === rewardId);
  if (milestone) return { ok: true, definition: milestone, cycle: null };
  const match = WEEKLY_OBJECTIVE_ID.exec(rewardId);
  if (!match) return { ok: false, reason: UNKNOWN_REWARD };
  const cycle = resolveCanonicalWeeklyCycle(nowMs);
  if (match[1] !== cycle.cycleId) return { ok: false, reason: REWARD_CYCLE_NOT_CURRENT };
  const weekly = buildCanonicalWeeklyObjectiveCatalog(cycle.cycleId).find((row) => row.rewardId === rewardId);
  return weekly ? { ok: true, definition: weekly, cycle } : { ok: false, reason: UNKNOWN_REWARD };
}

// ---------------------------------------------------------------------------
// Identities
// ---------------------------------------------------------------------------

export function canonicalClientRewardClaimId(def: Pick<CanonicalClientRewardDefinition, 'family' | 'rewardId' | 'cycleId'>): string {
  if (def.family === 'MISSION') return `reward:mission:${def.rewardId}`;
  if (def.family === 'MILESTONE') return `reward:milestone:${def.rewardId}`;
  return `reward:weekly:${def.cycleId}:${def.rewardId}`;
}

export function progressionClientRewardOperationId(
  def: Pick<CanonicalClientRewardDefinition, 'family' | 'rewardId' | 'cycleId'>,
): string {
  if (def.family === 'MISSION') return `progression:reward:mission:${def.rewardId}`;
  if (def.family === 'MILESTONE') return `progression:reward:milestone:${def.rewardId}`;
  return `progression:reward:weekly:${def.cycleId}:${def.rewardId}`;
}

export function clientRewardSourceType(family: CanonicalClientRewardFamily): CanonicalClientRewardSourceType {
  if (family === 'MISSION') return 'CLIENT_REWARD_MISSION';
  if (family === 'MILESTONE') return 'CLIENT_REWARD_MILESTONE';
  return 'CLIENT_REWARD_WEEKLY_OBJECTIVE';
}

function reputationReasonFor(family: CanonicalClientRewardFamily): ReputationReason {
  if (family === 'MISSION') return 'mission-reward';
  if (family === 'MILESTONE') return 'milestone-reward';
  return 'weekly-reward';
}

// ---------------------------------------------------------------------------
// Gate + client keys
// ---------------------------------------------------------------------------

export function isCanonicalClientRewardXpAllowed(options?: { envValue?: string | null }): boolean {
  const raw =
    options && 'envValue' in options
      ? options.envValue
      : typeof process !== 'undefined'
        ? process.env[CANONICAL_CLIENT_REWARD_XP_AUTHORITY_ENV]
        : undefined;
  return String(raw ?? '').trim() === 'INTERNAL_TEST';
}

export function isBackendWeeklyMissionModeEnabled(options?: { envValue?: string | null }): boolean {
  const raw =
    options && 'envValue' in options
      ? options.envValue
      : typeof process !== 'undefined'
        ? process.env[WEEKLY_MISSIONS_BACKEND_ENV]
        : undefined;
  return String(raw ?? '').trim() === 'true';
}

export const CANONICAL_CLIENT_REWARD_FORBIDDEN_CLIENT_KEYS = [
  'progress',
  'target',
  'completed',
  'claimed',
  'xp',
  'xpReward',
  'rewardXp',
  'cashReward',
  'rewardAmount',
  'cycleProgress',
  'missionProgress',
  'milestoneProgress',
  'weeklyProgress',
  'eligible',
  'claimable',
  'cycleId',
  'seasonKey',
  'reputation',
  'reputationReward',
  'level',
  'amount',
  'money',
  'cash',
  'isComplete',
  'isClaimed',
  'completedAt',
  'multiplier',
  'watchedAd',
] as const;

export const CANONICAL_CLIENT_REWARD_CLAIM_ALLOWED_KEYS = ['rewardId', 'canonicalSchemaVersion'] as const;

export function hasOnlyCanonicalClientRewardClaimKeys(record: Record<string, unknown>): boolean {
  if (CANONICAL_CLIENT_REWARD_FORBIDDEN_CLIENT_KEYS.some((key) => key in record)) return false;
  return Object.keys(record).every((key) =>
    (CANONICAL_CLIENT_REWARD_CLAIM_ALLOWED_KEYS as readonly string[]).includes(key),
  );
}

// ---------------------------------------------------------------------------
// Evidence + progress derivation
// ---------------------------------------------------------------------------

export type CanonicalRewardDeliveryEvidence = {
  ownerUid?: unknown;
  lifecycleState?: unknown;
  completionOutcome?: unknown;
  completionReportedAtMs?: unknown;
  originCityId?: unknown;
  destinationCityId?: unknown;
  contractType?: unknown;
  actualTravelHours?: unknown;
  deadlineHours?: unknown;
};

export type CanonicalRewardEvidence = {
  uid: string;
  nowMs: number;
  cycle: CanonicalWeeklyCycle | null;
  deliveries?: readonly CanonicalRewardDeliveryEvidence[];
  cargoReceipts?: readonly Partial<CanonicalCargoMarketReceipt>[];
  cargoSaleProgression?: ReadonlyMap<string, Record<string, unknown> | null>;
  inventory?: readonly Partial<CanonicalCargoInventoryDocument>[];
  warehouses?: readonly Partial<CanonicalWarehouseDocument>[];
  fleet?: readonly CanonicalFleetAssetDocument[];
  fleetMutations?: readonly Partial<CanonicalFleetRepairUpgradeReceipt>[];
  progression?: Pick<CanonicalCompanyProgressionState, 'reputation'> | null;
};

export function requiredEvidenceForMetric(metric: CanonicalRewardMetric): CanonicalRewardEvidenceKind[] {
  switch (metric.kind) {
    case 'DELIVERIES_STARTED':
    case 'DELIVERIES_COMPLETED':
    case 'CITY_DELIVERIES':
    case 'CONTRACT_TYPE_COMPLETED':
    case 'WEEKLY_DELIVERIES':
    case 'WEEKLY_ON_TIME_DELIVERIES':
    case 'WEEKLY_CITIES_OPERATED':
      return ['DELIVERIES'];
    case 'CARGO_BOUGHT':
      return ['CARGO_RECEIPTS'];
    case 'TRADE_CASH_FLOW_PROFIT':
      return ['CARGO_RECEIPTS', 'WAREHOUSES'];
    case 'WEEKLY_TRADE_PROFIT':
      return ['CARGO_RECEIPTS', 'CARGO_SALE_PROGRESSION'];
    case 'WEEKLY_STOCK_STORED':
      return ['CARGO_RECEIPTS'];
    case 'ACTIVE_TRUCKS':
    case 'HIGH_CAPACITY_TRUCK':
      return ['FLEET'];
    case 'WAREHOUSE_STOCK_ACTIVE':
    case 'WAREHOUSE_STOCK_TONS':
      return ['INVENTORY'];
    case 'WAREHOUSE_STOCK_CITIES':
      return ['INVENTORY', 'WAREHOUSES'];
    case 'REPUTATION':
      return ['PROGRESSION'];
    case 'TRUCK_UPGRADES':
    case 'TRUCK_REPAIRS':
      return ['FLEET_MUTATIONS'];
    default:
      return [];
  }
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function ownedBy(uid: string, row: { ownerUid?: unknown }): boolean {
  return row.ownerUid === uid;
}

/** Production completeDelivery increments completedContracts; server-derived failures do not. */
function isCompletedDelivery(uid: string, row: CanonicalRewardDeliveryEvidence): boolean {
  return (
    ownedBy(uid, row) &&
    row.completionOutcome === 'COMPLETED' &&
    (row.lifecycleState === 'COMPLETION_REPORTED' || row.lifecycleState === 'SETTLED') &&
    finite(row.completionReportedAtMs)
  );
}

function completedInCycle(evidence: CanonicalRewardEvidence): CanonicalRewardDeliveryEvidence[] {
  const cycle = evidence.cycle;
  if (!cycle) return [];
  return (evidence.deliveries ?? []).filter(
    (row) =>
      isCompletedDelivery(evidence.uid, row) &&
      (row.completionReportedAtMs as number) >= cycle.startMs &&
      (row.completionReportedAtMs as number) < cycle.endMs,
  );
}

function normalizedContractType(value: unknown): string {
  return typeof value === 'string' && value.length > 0 ? value : 'standard';
}

/** Production countActiveTrucks (lease not expired, not sold) over server-canonical assets only. */
function trustedActiveTrucks(evidence: CanonicalRewardEvidence): {
  trusted: CanonicalFleetAssetDocument[];
  untrustedCount: number;
} {
  const active = (evidence.fleet ?? []).filter(
    (asset) => ownedBy(evidence.uid, asset) && isCanonicalActiveRewardTruck(asset),
  );
  const trusted = active.filter((asset) => {
    const trust = resolveAssetTrustClass(asset);
    return trust === 'SERVER_CANONICAL' || trust === 'INTERNAL_TEST_FIXTURE';
  });
  return { trusted, untrustedCount: active.length - trusted.length };
}

function ownedInventory(evidence: CanonicalRewardEvidence) {
  return (evidence.inventory ?? []).filter(
    (row) => ownedBy(evidence.uid, row) && finite(row.quantity) && (row.quantity as number) > 0,
  );
}

function ownedCargoReceipts(evidence: CanonicalRewardEvidence) {
  return (evidence.cargoReceipts ?? [])
    .filter((row) => ownedBy(evidence.uid, row) && finite(row.createdAtMs) && finite(row.quantity))
    .slice()
    .sort((a, b) => {
      if ((a.createdAtMs as number) !== (b.createdAtMs as number)) {
        return (a.createdAtMs as number) - (b.createdAtMs as number);
      }
      const revA = finite(a.inventoryRevisionAfter) ? a.inventoryRevisionAfter : 0;
      const revB = finite(b.inventoryRevisionAfter) ? b.inventoryRevisionAfter : 0;
      return revA !== revB ? revA - revB : String(a.operationId).localeCompare(String(b.operationId));
    });
}

/** Cargo receipts store the sale intent id as operationId; the cash transaction id wraps it. */
export function cargoSaleIntentIdFromOperationId(operationId: unknown): string | null {
  if (typeof operationId !== 'string' || operationId.length === 0) return null;
  const index = operationId.lastIndexOf(':sell:');
  const intent = index < 0 ? operationId : operationId.slice(index + ':sell:'.length);
  return intent.length > 0 ? intent : null;
}

export type CanonicalRewardProgressDerivation =
  | {
      ok: true;
      progress: number;
      target: number;
      eligible: boolean;
      evidenceClass: 'EXACT' | 'LOWER_BOUND';
      sourceCount: number;
    }
  | {
      ok: false;
      reason:
        | CanonicalClientRewardStaticBlock
        | typeof CLIENT_REWARD_XP_BLOCKED_CARGO_QUALITY_AUTHORITY
        | typeof CLIENT_REWARD_XP_BLOCKED_TRADE_PROFIT_AUTHORITY
        | typeof LEGACY_REWARD_PROGRESS_UNVERIFIED;
      progress: number;
      target: number;
    };

function exact(progress: number, target: number, sourceCount: number): CanonicalRewardProgressDerivation {
  return { ok: true, progress, target, eligible: progress >= target, evidenceClass: 'EXACT', sourceCount };
}

/**
 * A lower bound decides eligibility when it already reaches the target (production is at least
 * as high). Below the target with unverifiable inputs, the claim fails closed with the reason.
 */
function lowerBound(
  progress: number,
  target: number,
  sourceCount: number,
  unverified: CanonicalRewardProgressDerivation extends infer R
    ? R extends { ok: false; reason: infer Reason }
      ? Reason
      : never
    : never,
  hasUnverified: boolean,
): CanonicalRewardProgressDerivation {
  if (!hasUnverified) return exact(progress, target, sourceCount);
  if (progress >= target) {
    return { ok: true, progress, target, eligible: true, evidenceClass: 'LOWER_BOUND', sourceCount };
  }
  return { ok: false, reason: unverified, progress, target };
}

export function deriveCanonicalRewardProgress(
  def: CanonicalClientRewardDefinition,
  evidence: CanonicalRewardEvidence,
): CanonicalRewardProgressDerivation {
  const target = def.target;
  if (!def.metric || def.blockedAuthority) {
    return {
      ok: false,
      reason: def.blockedAuthority ?? CLIENT_REWARD_XP_BLOCKED_CLIENT_UI_EVENT,
      progress: 0,
      target,
    };
  }
  const metric = def.metric;
  const uid = evidence.uid;
  switch (metric.kind) {
    case 'DELIVERIES_STARTED': {
      const started = (evidence.deliveries ?? []).filter((row) => ownedBy(uid, row)).length;
      return exact(started > 0 ? 1 : 0, target, started);
    }
    case 'DELIVERIES_COMPLETED': {
      const count = (evidence.deliveries ?? []).filter((row) => isCompletedDelivery(uid, row)).length;
      return exact(count, target, count);
    }
    case 'CITY_DELIVERIES': {
      let count = 0;
      for (const row of evidence.deliveries ?? []) {
        if (!isCompletedDelivery(uid, row)) continue;
        if (row.originCityId === metric.cityId) count += 1;
        if (row.destinationCityId === metric.cityId) count += 1;
      }
      return exact(count, target, count);
    }
    case 'CONTRACT_TYPE_COMPLETED': {
      const count = (evidence.deliveries ?? []).filter(
        (row) => isCompletedDelivery(uid, row) && normalizedContractType(row.contractType) === metric.contractType,
      ).length;
      return exact(count, target, count);
    }
    case 'CARGO_BOUGHT': {
      const buys = ownedCargoReceipts(evidence).filter((row) => row.operationType === 'BUY').length;
      return exact(buys > 0 ? 1 : 0, target, buys);
    }
    case 'TRADE_CASH_FLOW_PROFIT': {
      const warehouseType = new Map(
        (evidence.warehouses ?? [])
          .filter((row) => ownedBy(uid, row))
          .map((row) => [String(row.warehouseId), row.warehouseType as WarehouseType]),
      );
      let trustedSales = 0;
      let purchases = 0;
      let untrustedSales = 0;
      const receipts = ownedCargoReceipts(evidence);
      for (const row of receipts) {
        const delta = finite(row.totalCashDelta) ? row.totalCashDelta : 0;
        if (row.operationType === 'BUY') {
          purchases += Math.abs(delta);
          continue;
        }
        if (row.operationType !== 'SELL') continue;
        const type = warehouseType.get(String(row.warehouseId));
        const quality = type ? resolveCanonicalCargoSaleQuality(row.productId as ProductId, type) : null;
        if (quality?.ok) trustedSales += Math.max(0, delta);
        else untrustedSales += 1;
      }
      const progress = Math.max(0, trustedSales - purchases);
      return lowerBound(progress, target, receipts.length, CLIENT_REWARD_XP_BLOCKED_CARGO_QUALITY_AUTHORITY, untrustedSales > 0);
    }
    case 'ACTIVE_TRUCKS': {
      const trucks = trustedActiveTrucks(evidence);
      return lowerBound(
        countCanonicalActiveRewardTrucks(trucks.trusted),
        target,
        trucks.trusted.length,
        LEGACY_REWARD_PROGRESS_UNVERIFIED,
        trucks.untrustedCount > 0,
      );
    }
    case 'HIGH_CAPACITY_TRUCK': {
      const trucks = trustedActiveTrucks(evidence);
      const count = trucks.trusted.filter((asset) => finite(asset.capacity) && asset.capacity >= metric.minCapacity).length;
      return lowerBound(count > 0 ? 1 : 0, target, count, LEGACY_REWARD_PROGRESS_UNVERIFIED, trucks.untrustedCount > 0);
    }
    case 'WAREHOUSE_STOCK_ACTIVE': {
      const rows = ownedInventory(evidence);
      return exact(rows.length > 0 ? 1 : 0, target, rows.length);
    }
    case 'WAREHOUSE_STOCK_TONS': {
      const rows = ownedInventory(evidence);
      return exact(rows.reduce((sum, row) => sum + (row.quantity as number), 0), target, rows.length);
    }
    case 'WAREHOUSE_STOCK_CITIES': {
      const cityByWarehouse = new Map(
        (evidence.warehouses ?? [])
          .filter((row) => ownedBy(uid, row))
          .map((row) => [String(row.warehouseId), String(row.cityId)]),
      );
      const cities = new Set<string>();
      for (const row of ownedInventory(evidence)) {
        const city = cityByWarehouse.get(String(row.warehouseId));
        if (city) cities.add(city);
      }
      return exact(cities.size, target, cities.size);
    }
    case 'REPUTATION': {
      const reputation = evidence.progression?.reputation;
      return exact(finite(reputation) ? reputation : 0, target, 1);
    }
    case 'TRUCK_UPGRADES': {
      const count = (evidence.fleetMutations ?? []).filter(
        (row) => ownedBy(uid, row) && row.operationType === 'UPGRADE',
      ).length;
      return exact(count, target, count);
    }
    case 'TRUCK_REPAIRS': {
      const count = (evidence.fleetMutations ?? []).filter(
        (row) => ownedBy(uid, row) && row.operationType === 'REPAIR' && finite(row.derivedCost) && row.derivedCost > 0,
      ).length;
      return exact(count, target, count);
    }
    case 'WEEKLY_DELIVERIES': {
      const count = completedInCycle(evidence).length;
      return exact(count, target, count);
    }
    case 'WEEKLY_ON_TIME_DELIVERIES': {
      const count = completedInCycle(evidence).filter(
        (row) =>
          finite(row.actualTravelHours) && finite(row.deadlineHours) && row.actualTravelHours <= row.deadlineHours,
      ).length;
      return exact(count, target, count);
    }
    case 'WEEKLY_CITIES_OPERATED': {
      const rows = completedInCycle(evidence);
      const cities = new Set<string>();
      for (const row of rows) {
        if (typeof row.originCityId === 'string') cities.add(row.originCityId);
        if (typeof row.destinationCityId === 'string') cities.add(row.destinationCityId);
      }
      return exact(cities.size, target, rows.length);
    }
    case 'WEEKLY_TRADE_PROFIT': {
      const cycle = evidence.cycle;
      if (!cycle) return { ok: false, reason: CLIENT_REWARD_XP_BLOCKED_TRADE_PROFIT_AUTHORITY, progress: 0, target };
      let trusted = 0;
      let qualityBlocked = 0;
      let profitBlocked = 0;
      const sells = ownedCargoReceipts(evidence).filter(
        (row) =>
          row.operationType === 'SELL' &&
          (row.createdAtMs as number) >= cycle.startMs &&
          (row.createdAtMs as number) < cycle.endMs,
      );
      for (const row of sells) {
        const intent = cargoSaleIntentIdFromOperationId(row.operationId);
        const receipt = intent ? evidence.cargoSaleProgression?.get(progressionCargoSaleOperationId(intent)) : null;
        const profit = (receipt?.xpEvidence as { profit?: unknown } | undefined)?.profit;
        if (receipt?.xpAuthority === 'SERVER_DERIVED' && finite(profit)) {
          trusted += Math.max(0, profit);
        } else if (receipt?.xpAuthority === CARGO_SALE_XP_BLOCKED_QUALITY_AUTHORITY) {
          qualityBlocked += 1;
        } else {
          profitBlocked += 1;
        }
      }
      const reason =
        qualityBlocked > 0 ? CLIENT_REWARD_XP_BLOCKED_CARGO_QUALITY_AUTHORITY : CLIENT_REWARD_XP_BLOCKED_TRADE_PROFIT_AUTHORITY;
      return lowerBound(trusted, target, sells.length, reason, qualityBlocked + profitBlocked > 0);
    }
    case 'WEEKLY_STOCK_STORED': {
      const cycle = evidence.cycle;
      if (!cycle) return exact(0, target, 0);
      const stock = new Map<string, number>();
      const total = () => [...stock.values()].reduce((sum, qty) => sum + qty, 0);
      let maxInCycle = 0;
      let startCounted = false;
      let receiptsInCycle = 0;
      for (const row of ownedCargoReceipts(evidence)) {
        const at = row.createdAtMs as number;
        if (at >= cycle.endMs) break;
        if (at >= cycle.startMs && !startCounted) {
          maxInCycle = Math.max(maxInCycle, total());
          startCounted = true;
        }
        const after = finite(row.inventoryAfter) ? row.inventoryAfter : 0;
        stock.set(`${row.warehouseId}__${row.productId}`, Math.max(0, after));
        if (at >= cycle.startMs) {
          receiptsInCycle += 1;
          maxInCycle = Math.max(maxInCycle, total());
        }
      }
      maxInCycle = Math.max(maxInCycle, total());
      return exact(maxInCycle, target, receiptsInCycle);
    }
    default:
      return { ok: false, reason: CLIENT_REWARD_XP_BLOCKED_CLIENT_UI_EVENT, progress: 0, target };
  }
}

// ---------------------------------------------------------------------------
// Progression mutation + receipts
// ---------------------------------------------------------------------------

export type CanonicalClientRewardXpEvidence = {
  policyVersion: typeof CANONICAL_CLIENT_REWARD_XP_POLICY_VERSION;
  sourceType: CanonicalClientRewardSourceType;
  family: CanonicalClientRewardFamily;
  rewardId: string;
  cycleId: string | null;
  claimId: string;
  metric: CanonicalRewardMetricKind;
  progress: number;
  target: number;
  evidenceClass: 'EXACT' | 'LOWER_BOUND';
  xp: number;
  reputation: number;
};

export function buildCanonicalClientRewardProgressionInput(
  def: CanonicalClientRewardDefinition,
  derivation: Extract<CanonicalRewardProgressDerivation, { ok: true }>,
  nowMs: number,
): CanonicalProgressionMutationInput {
  const sourceType = clientRewardSourceType(def.family);
  const evidence: CanonicalClientRewardXpEvidence = {
    policyVersion: CANONICAL_CLIENT_REWARD_XP_POLICY_VERSION,
    sourceType,
    family: def.family,
    rewardId: def.rewardId,
    cycleId: def.cycleId,
    claimId: canonicalClientRewardClaimId(def),
    metric: def.metric!.kind,
    progress: derivation.progress,
    target: def.target,
    evidenceClass: derivation.evidenceClass,
    xp: def.xpReward,
    reputation: def.reputationReward,
  };
  return {
    operationId: progressionClientRewardOperationId(def),
    sourceType,
    sourceId: def.cycleId ? `${def.cycleId}:${def.rewardId}` : def.rewardId,
    xpDelta: def.xpReward,
    xpAuthority: 'SERVER_DERIVED',
    reputationDelta: def.reputationReward,
    reputationReasons: def.reputationReward !== 0 ? [reputationReasonFor(def.family)] : [],
    xpEvidence: evidence,
    nowMs,
  };
}

export type CanonicalClientRewardCashComponent = {
  productionCashReward: number;
  authority: CanonicalRewardCashAuthority;
  granted: boolean;
  cashTransactionId: string | null;
};

export type CanonicalClientRewardClaimReceipt = {
  claimSchemaVersion: typeof CANONICAL_CLIENT_REWARD_CLAIM_SCHEMA_VERSION;
  claimId: string;
  rewardId: string;
  rewardFamily: CanonicalClientRewardFamily;
  cycleId: string | null;
  cyclePolicyVersion: typeof CANONICAL_WEEKLY_OBJECTIVE_CYCLE_POLICY_VERSION | null;
  rewardXpPolicyVersion: typeof CANONICAL_CLIENT_REWARD_XP_POLICY_VERSION;
  metric: CanonicalRewardMetricKind;
  progress: number;
  target: number;
  evidenceClass: 'EXACT' | 'LOWER_BOUND';
  xpReward: number;
  reputationReward: number;
  cash: CanonicalClientRewardCashComponent;
  progressionOperationId: string;
  claimedAtMs: number;
  ownerUid: string;
  multiplicity: 'ONE_TIME' | 'ONE_PER_CYCLE';
  authoritySource: 'INTERNAL_CANONICAL_RECEIPTS';
};

export type CanonicalClientRewardReplay =
  | { kind: 'MATCH' }
  | { kind: 'HISTORICAL_CASH_ONLY' }
  | { kind: 'POLICY_UNKNOWN' }
  | { kind: 'CONFLICT' };

const LOCAL_REWARD_29W_POLICY = 'canonical-local-reward-internal-v1';

/** An existing claim receipt either replays this definition exactly, predates XP, or conflicts. */
export function classifyCanonicalClientRewardReplay(
  existing: Record<string, unknown>,
  def: CanonicalClientRewardDefinition,
  uid: string,
): CanonicalClientRewardReplay {
  if (existing.ownerUid !== uid || existing.rewardId !== def.rewardId) return { kind: 'CONFLICT' };
  if (existing.rewardXpPolicyVersion === undefined) {
    return existing.eligibilityPolicyVersion === LOCAL_REWARD_29W_POLICY && findCanonicalLocalReward(def.rewardId)
      ? { kind: 'HISTORICAL_CASH_ONLY' }
      : { kind: 'POLICY_UNKNOWN' };
  }
  if (existing.rewardXpPolicyVersion !== CANONICAL_CLIENT_REWARD_XP_POLICY_VERSION) return { kind: 'POLICY_UNKNOWN' };
  const matches =
    existing.rewardFamily === def.family &&
    (existing.cycleId ?? null) === def.cycleId &&
    existing.xpReward === def.xpReward &&
    existing.reputationReward === def.reputationReward &&
    existing.progressionOperationId === progressionClientRewardOperationId(def) &&
    existing.claimId === canonicalClientRewardClaimId(def);
  return matches ? { kind: 'MATCH' } : { kind: 'CONFLICT' };
}

// ---------------------------------------------------------------------------
// Audit table
// ---------------------------------------------------------------------------

export type CanonicalClientRewardAuditRow = {
  rewardId: string;
  family:
    | 'MISSION'
    | 'MILESTONE'
    | 'LOCAL_WEEKLY_OBJECTIVE'
    | 'SERVER_WEEKLY_MISSION'
    | 'SEASON_REWARD'
    | 'CHALLENGE_REWARD'
    | 'ACHIEVEMENT'
    | 'AD_REWARD'
    | 'OPERATION_CHOICE'
    | 'DEBUG';
  xpAmount: string;
  cashAmount: string;
  otherReward: string;
  progressCondition: string;
  progressSource: CanonicalRewardProgressSource | 'NOT_A_PROGRESS_REWARD';
  resetCycle: string;
  claimModel: string;
  clientOwnedToday: boolean;
  serverDerivable: boolean;
  canonicalStatus: string;
};

function otherRewardLabel(reputation: number, badgeId?: string): string {
  const parts: string[] = [];
  if (reputation) parts.push(`reputation +${reputation}`);
  if (badgeId) parts.push(`badge ${badgeId} (client cosmetic, not canonical)`);
  return parts.length > 0 ? parts.join('; ') : 'none';
}

function metricLabel(def: CanonicalClientRewardDefinition, production: string): string {
  return def.metric ? `${production} → ${def.metric.kind}` : production;
}

function definitionStatus(def: CanonicalClientRewardDefinition): string {
  if (def.blockedAuthority) return def.blockedAuthority;
  const conditional =
    def.metric?.kind === 'TRADE_CASH_FLOW_PROFIT' || def.metric?.kind === 'WEEKLY_TRADE_PROFIT'
      ? '_TRUSTED_TRADE_ONLY'
      : '';
  const prefix = def.family === 'MISSION' ? 'MISSION' : def.family === 'MILESTONE' ? 'MILESTONE' : 'WEEKLY_OBJECTIVE';
  return `${prefix}_XP_CANONICAL_INTERNAL${conditional}`;
}

const MISSION_CONDITIONS: Record<string, string> = {
  first_contract_start: 'any delivery started (active, completed or deliveryStarted flag)',
  first_delivery: 'player.completedContracts',
  first_profit: 'financeTotals contract income',
  open_market: 'missions.flags.marketOpened (screen opened)',
  first_trade: 'flags.tradePurchased or any trade/market purchase ledger entry',
  complete_5_deliveries: 'player.completedContracts',
  complete_10_deliveries: 'player.completedContracts',
  reach_company_score_150k: 'calculateCompanyScore (includes cash)',
  own_2_trucks: 'owned + unexpired leased trucks',
  reach_warehouse_value_25000: 'inventory × client city market price',
  earn_10000_trade_profit: 'financeTotals (sales − purchases)',
  operate_in_3_cities: 'distinct truck currentCityId/homeCityId + warehouse cities',
};

function missionAuditRow(def: CanonicalClientRewardDefinition): CanonicalClientRewardAuditRow {
  return {
    rewardId: def.rewardId,
    family: 'MISSION',
    xpAmount: String(def.xpReward),
    cashAmount: String(def.productionCashReward),
    otherReward: otherRewardLabel(def.reputationReward),
    progressCondition: metricLabel(def, `${MISSION_CONDITIONS[def.rewardId] ?? 'getMissionProgress'} ≥ ${def.target}`),
    progressSource: def.progressSource,
    resetCycle: 'one-time',
    claimModel: 'manual claim (claimMissionReward)',
    clientOwnedToday: true,
    serverDerivable: def.metric !== null,
    canonicalStatus: definitionStatus(def),
  };
}

function milestoneAuditRow(def: CanonicalClientRewardDefinition): CanonicalClientRewardAuditRow {
  const production = MILESTONE_DEFINITIONS.find((row) => row.id === def.rewardId)!;
  return {
    rewardId: def.rewardId,
    family: 'MILESTONE',
    xpAmount: String(def.xpReward),
    cashAmount: String(def.productionCashReward),
    otherReward: otherRewardLabel(def.reputationReward, production.reward.badgeId),
    progressCondition: metricLabel(def, `${production.metric.type} ≥ ${production.target}`),
    progressSource: def.progressSource,
    resetCycle: 'one-time lifetime',
    claimModel: 'manual claim (claimMilestoneReward)',
    clientOwnedToday: true,
    serverDerivable: def.metric !== null,
    canonicalStatus: definitionStatus(def),
  };
}

const WEEKLY_SLOT_AUDIT: ReadonlyArray<{
  slot: string;
  metric: WeeklyObjectiveDefinition['metric'];
  xp: string;
  cash: string;
  reputation: string;
  kind: CanonicalRewardMetricKind;
  condition: string;
}> = [
  { slot: 'delivery', metric: 'weekly_deliveries', xp: '80|100|120', cash: '3000|4000|5000', reputation: 'none', kind: 'WEEKLY_DELIVERIES', condition: 'deliveries completed this week ≥ 8|10|12|15' },
  { slot: 'trade', metric: 'weekly_trade_profit', xp: '70|90|110', cash: '2500|3500|4500', reputation: 'reputation +1 on the 90 XP option', kind: 'WEEKLY_TRADE_PROFIT', condition: 'Σ max(0, sale profit) this week ≥ 15000|20000|25000|30000' },
  { slot: 'warehouse', metric: 'weekly_stock_stored', xp: '60|80|100', cash: '2000|3000|4000', reputation: 'none', kind: 'WEEKLY_STOCK_STORED', condition: 'max total stock observed this week ≥ 30|50|75|100' },
  { slot: 'reputation', metric: 'weekly_on_time_deliveries', xp: '60|80|100', cash: '2000|3000|4000', reputation: 'reputation +1|+1|+2', kind: 'WEEKLY_ON_TIME_DELIVERIES', condition: 'deliveries with actualTravelHours ≤ deadlineHours this week ≥ 3|5|7|8' },
  { slot: 'bonus', metric: 'weekly_cities_operated', xp: '70|90|120', cash: '2500|3500|5000', reputation: 'none', kind: 'WEEKLY_CITIES_OPERATED', condition: 'distinct delivery origin/destination cities this week ≥ 2|3|4' },
];

export const CLIENT_REWARD_XP_AUDIT: readonly CanonicalClientRewardAuditRow[] = [
  ...CANONICAL_MISSION_REWARD_CATALOG.map(missionAuditRow),
  ...CANONICAL_MILESTONE_REWARD_CATALOG.map(milestoneAuditRow),
  ...WEEKLY_SLOT_AUDIT.map((row) => ({
    rewardId: `weekly_{cycle}_${row.slot}`,
    family: 'LOCAL_WEEKLY_OBJECTIVE' as const,
    xpAmount: row.xp,
    cashAmount: row.cash,
    otherReward: row.reputation,
    progressCondition: `${row.condition} → ${row.kind}`,
    progressSource: 'SERVER_RECEIPT_DERIVABLE' as const,
    resetCycle: 'ISO week (UTC), weekly_YYYY-Www; production uses the device clock',
    claimModel: 'manual claim (claimWeeklyObjectiveReward); disabled when backend weekly mode is on',
    clientOwnedToday: true,
    serverDerivable: true,
    canonicalStatus:
      row.kind === 'WEEKLY_TRADE_PROFIT'
        ? 'WEEKLY_OBJECTIVE_XP_CANONICAL_INTERNAL_TRUSTED_TRADE_ONLY'
        : 'WEEKLY_OBJECTIVE_XP_CANONICAL_INTERNAL',
  })),
  {
    rewardId: 'server-weekly-missions',
    family: 'SERVER_WEEKLY_MISSION',
    xpAmount: '0 (catalog validator rejects xp/reputation)',
    cashAmount: 'difficulty cash band',
    otherReward: 'none',
    progressCondition: 'server weekly mission progress',
    progressSource: 'SERVER_STATE_DERIVABLE',
    resetCycle: 'server week',
    claimModel: 'claimWeeklyMissionReward (server)',
    clientOwnedToday: false,
    serverDerivable: true,
    canonicalStatus: 'SERVER_WEEKLY_MISSION_NO_XP',
  },
  {
    rewardId: 'season-rewards',
    family: 'SEASON_REWARD',
    xpAmount: '0',
    cashAmount: 'server season cash',
    otherReward: 'none',
    progressCondition: 'season close snapshot',
    progressSource: 'SERVER_STATE_DERIVABLE',
    resetCycle: 'season',
    claimModel: 'claimSeasonReward (server)',
    clientOwnedToday: false,
    serverDerivable: true,
    canonicalStatus: 'SEASON_REWARD_NO_XP',
  },
  {
    rewardId: 'challenge-rewards',
    family: 'CHALLENGE_REWARD',
    xpAmount: '0',
    cashAmount: 'server challenge cash',
    otherReward: 'none',
    progressCondition: 'server challenge result',
    progressSource: 'SERVER_STATE_DERIVABLE',
    resetCycle: 'challenge window',
    claimModel: 'claimChallengeReward (server)',
    clientOwnedToday: false,
    serverDerivable: true,
    canonicalStatus: 'CHALLENGE_REWARD_NO_XP',
  },
  {
    rewardId: 'achievement-catalog',
    family: 'ACHIEVEMENT',
    xpAmount: '0',
    cashAmount: '0',
    otherReward: 'informational',
    progressCondition: 'progression foundation display',
    progressSource: 'NOT_A_PROGRESS_REWARD',
    resetCycle: 'none',
    claimModel: 'none',
    clientOwnedToday: false,
    serverDerivable: false,
    canonicalStatus: 'ACHIEVEMENT_CATALOG_NO_XP',
  },
  {
    rewardId: 'rewarded-ads',
    family: 'AD_REWARD',
    xpAmount: '0',
    cashAmount: 'daily ops cash / discount tokens',
    otherReward: 'non-cash slots',
    progressCondition: 'AdMob EARNED_REWARD callback (client)',
    progressSource: 'CLIENT_ONLY',
    resetCycle: 'daily caps',
    claimModel: 'applyAdReward (client)',
    clientOwnedToday: true,
    serverDerivable: false,
    canonicalStatus: 'AD_REWARD_NO_XP_AUTHORITY_BLOCKED_VERIFICATION',
  },
  {
    rewardId: 'operation-choice-xp',
    family: 'OPERATION_CHOICE',
    xpAmount: 'effects.playerXpDelta (no current option sets it)',
    cashAmount: 'choice effects',
    otherReward: 'reputation delta per option',
    progressCondition: 'incident operation choice',
    progressSource: 'CLIENT_ONLY',
    resetCycle: 'per incident',
    claimModel: 'automatic on choice',
    clientOwnedToday: true,
    serverDerivable: false,
    canonicalStatus: OPERATION_CHOICE_XP_CLIENT_OWNED_DORMANT,
  },
  {
    rewardId: 'debug-xp',
    family: 'DEBUG',
    xpAmount: '50|250',
    cashAmount: '0',
    otherReward: 'none',
    progressCondition: 'DebugSimulationScreen button (dev only)',
    progressSource: 'UNSUPPORTED',
    resetCycle: 'none',
    claimModel: 'dev button',
    clientOwnedToday: true,
    serverDerivable: false,
    canonicalStatus: 'DEBUG_XP_DEV_ONLY_NOT_CANONICAL',
  },
];

export function clientRewardAuditHasUnknown(): boolean {
  return CLIENT_REWARD_XP_AUDIT.some(
    (row) => /UNKNOWN/.test(row.canonicalStatus) || row.progressCondition.length === 0,
  );
}

export type CanonicalClientRewardCoverage = {
  total: number;
  xpBearing: number;
  canonical: number;
  conditional: number;
  blocked: number;
  unsupported: number;
};

function coverage(rows: readonly CanonicalClientRewardDefinition[]): CanonicalClientRewardCoverage {
  const xpBearing = rows.filter((row) => row.xpReward > 0);
  return {
    total: rows.length,
    xpBearing: xpBearing.length,
    canonical: xpBearing.filter((row) => row.metric !== null).length,
    conditional: xpBearing.filter(
      (row) => row.metric?.kind === 'TRADE_CASH_FLOW_PROFIT' || row.metric?.kind === 'WEEKLY_TRADE_PROFIT',
    ).length,
    blocked: xpBearing.filter((row) => row.blockedAuthority !== null && row.progressSource === 'CLIENT_ONLY').length,
    unsupported: xpBearing.filter((row) => row.blockedAuthority !== null && row.progressSource === 'UNSUPPORTED').length,
  };
}

export const CANONICAL_MISSION_REWARD_COVERAGE = coverage(CANONICAL_MISSION_REWARD_CATALOG);
export const CANONICAL_MILESTONE_REWARD_COVERAGE = coverage(CANONICAL_MILESTONE_REWARD_CATALOG);
/** Five slots per cycle; every slot is derivable (the trade slot only from trusted sale profit). */
export const CANONICAL_WEEKLY_REWARD_COVERAGE = coverage(
  buildCanonicalWeeklyObjectiveCatalog(getWeeklySeasonKey(new Date(Date.UTC(2026, 0, 5)))),
);

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

export type CanonicalClientRewardXpReadiness =
  | 'CLIENT_REWARD_XP_CANONICAL_READY'
  | 'CLIENT_REWARD_XP_INTERNAL_PARTIAL'
  | 'CLIENT_REWARD_XP_BLOCKED_CLIENT_PROGRESS'
  | 'CLIENT_REWARD_XP_BLOCKED_CASH_AUTHORITY'
  | 'CLIENT_REWARD_XP_BLOCKED_WEEKLY_CLOCK'
  | 'CLIENT_REWARD_XP_BLOCKED_INCIDENT_PARITY'
  | 'CLIENT_REWARD_XP_BLOCKED_LEGACY_HISTORY';

export type CanonicalClientRewardXpReadinessFacts = {
  scope: 'INTERNAL_NEW_CANONICAL_ACCOUNTS' | 'PUBLIC';
  legacyRewardProgressImported: boolean;
  weeklyCycleServerOwned: boolean;
  deliveryProgressNeedsIncidentParity: boolean;
  canonicalRewardCount: number;
  blockedByCashAuthority: number;
  blockedOther: number;
};

/** Precedence: legacy history (public) → weekly clock → incident parity → no progress → cash → partial → ready. */
export function classifyCanonicalClientRewardXpReadiness(
  facts: CanonicalClientRewardXpReadinessFacts,
): CanonicalClientRewardXpReadiness {
  if (facts.scope === 'PUBLIC' && !facts.legacyRewardProgressImported) return 'CLIENT_REWARD_XP_BLOCKED_LEGACY_HISTORY';
  if (!facts.weeklyCycleServerOwned) return 'CLIENT_REWARD_XP_BLOCKED_WEEKLY_CLOCK';
  if (facts.deliveryProgressNeedsIncidentParity) return 'CLIENT_REWARD_XP_BLOCKED_INCIDENT_PARITY';
  if (facts.canonicalRewardCount === 0) return 'CLIENT_REWARD_XP_BLOCKED_CLIENT_PROGRESS';
  if (facts.blockedByCashAuthority > 0 && facts.blockedOther === 0) return 'CLIENT_REWARD_XP_BLOCKED_CASH_AUTHORITY';
  if (facts.blockedByCashAuthority + facts.blockedOther > 0) return 'CLIENT_REWARD_XP_INTERNAL_PARTIAL';
  return 'CLIENT_REWARD_XP_CANONICAL_READY';
}

const STATIC_REWARDS = [...CANONICAL_MISSION_REWARD_CATALOG, ...CANONICAL_MILESTONE_REWARD_CATALOG];

export const CURRENT_CLIENT_REWARD_XP_READINESS_FACTS: Omit<CanonicalClientRewardXpReadinessFacts, 'scope'> = {
  legacyRewardProgressImported: false,
  weeklyCycleServerOwned: true,
  deliveryProgressNeedsIncidentParity: false,
  canonicalRewardCount: STATIC_REWARDS.filter((row) => row.metric !== null).length + 5,
  blockedByCashAuthority: STATIC_REWARDS.filter((row) => row.blockedAuthority === CLIENT_REWARD_XP_BLOCKED_CASH_AUTHORITY)
    .length,
  blockedOther: STATIC_REWARDS.filter(
    (row) => row.blockedAuthority !== null && row.blockedAuthority !== CLIENT_REWARD_XP_BLOCKED_CASH_AUTHORITY,
  ).length,
};

export const CANONICAL_CLIENT_REWARD_XP_INTERNAL_READINESS = classifyCanonicalClientRewardXpReadiness({
  scope: 'INTERNAL_NEW_CANONICAL_ACCOUNTS',
  ...CURRENT_CLIENT_REWARD_XP_READINESS_FACTS,
});

export const CANONICAL_CLIENT_REWARD_XP_PUBLIC_READINESS = classifyCanonicalClientRewardXpReadiness({
  scope: 'PUBLIC',
  ...CURRENT_CLIENT_REWARD_XP_READINESS_FACTS,
});

/** Static rewards that stay client-owned, by exact blocking authority. */
export const CANONICAL_CLIENT_REWARD_BLOCKED_REWARDS: ReadonlyArray<{
  rewardId: string;
  family: CanonicalClientRewardFamily;
  blockedAuthority: CanonicalClientRewardStaticBlock;
}> = STATIC_REWARDS.filter((row) => row.blockedAuthority !== null).map((row) => ({
  rewardId: row.rewardId,
  family: row.family,
  blockedAuthority: row.blockedAuthority!,
}));

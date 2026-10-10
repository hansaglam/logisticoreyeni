/**
 * Step 29AF — server-owned company progression and ROAD reputation for canonical accounts.
 * XP/level reuse production leveling (applyXpToPlayer, calculateDeliveryXp).
 * Reputation deltas reuse production reputation settlement (REPUTATION_RULES, classifier).
 * Public save progression (player.level / xp / reputation) is never read or written here.
 */

import { reputationBalance } from '../config/balance';
import { calculateXpToNextLevel, levelConfig } from '../config/levelConfig';
import { REPUTATION_MAX, REPUTATION_MIN, REPUTATION_RULES } from '../config/reputationRules';
import { applyXpToPlayer, calculateDeliveryXp, type DeliveryRiskTier } from '../simulation/leveling';
import {
  calculateDeliveryReputationResult,
  deliveryFailureReasonToReputationDelta,
  type DeliveryPunctuality,
} from '../simulation/reputationSettlement';
import type { Contract, Delivery, Player } from '../types/game';
import { clampReputation, type ReputationReason } from './reputationModel';
import type { CanonicalRoadCompletionBand } from './canonicalRoadExecutionEconomics';
import type {
  CanonicalCargoSaleXpBlockedAuthority,
  CanonicalNonDeliveryXpEvidence,
  CanonicalNonDeliveryXpSourceType,
} from './canonicalNonDeliveryCompanyXp';
import type {
  CanonicalClientRewardSourceType,
  CanonicalClientRewardXpEvidence,
} from './canonicalClientRewardXp';

export const CANONICAL_COMPANY_PROGRESSION_AUTHORITY_ENV =
  'CANONICAL_COMPANY_PROGRESSION_AUTHORITY' as const;

export const CANONICAL_COMPANY_PROGRESSION_POLICY_VERSION =
  'canonical-company-progression-v1' as const;

export const CANONICAL_ROAD_REPUTATION_POLICY_VERSION = 'canonical-road-reputation-v1' as const;

export const CANONICAL_COMPANY_PROGRESSION_SCHEMA_VERSION = 1 as const;

export const CANONICAL_COMPANY_PROGRESSION_COLLECTION = 'canonicalCompanyProgression' as const;

export const CANONICAL_COMPANY_PROGRESSION_DOC_ID = 'current' as const;

export const CANONICAL_PROGRESSION_RECEIPTS_COLLECTION = 'canonicalProgressionReceipts' as const;

export const CANONICAL_PROGRESSION_RECEIPT_SCHEMA_VERSION = 1 as const;

export const CANONICAL_COMPANY_PROGRESSION_AUTHORITY_STATUS =
  'CANONICAL_COMPANY_PROGRESSION_AUTHORITY_PASS_INTERNAL_ONLY' as const;

export const CANONICAL_ROAD_REPUTATION_AUTHORITY_STATUS =
  'CANONICAL_ROAD_REPUTATION_PASS_INTERNAL_ONLY' as const;

/**
 * Production completion XP adds a risk bonus from delivery.breakdownChance + accidentChance.
 * Only deliveries accepted with a trusted driver/risk snapshot (Step 29AG) can derive it;
 * deliveries without that snapshot keep XP 0.
 */
export const CANONICAL_ROAD_COMPLETION_XP_AUTHORITY =
  'PROGRESSION_XP_BLOCKED_RISK_SNAPSHOT_MISSING' as const;

export const PROGRESSION_XP_BLOCKED_RISK_POLICY_UNKNOWN =
  'PROGRESSION_XP_BLOCKED_RISK_POLICY_UNKNOWN' as const;

export const PROGRESSION_XP_BLOCKED_RISK_SNAPSHOT_INVALID =
  'PROGRESSION_XP_BLOCKED_RISK_SNAPSHOT_INVALID' as const;

export const PROGRESSION_XP_BLOCKED_NET_PROFIT_AUTHORITY =
  'PROGRESSION_XP_BLOCKED_NET_PROFIT_AUTHORITY' as const;

export const PROGRESSION_XP_BLOCKED_INCIDENT_ECONOMICS =
  'PROGRESSION_XP_BLOCKED_INCIDENT_ECONOMICS' as const;

export const PROGRESSION_BLOCKED_UNVERIFIED_FAILURE = 'PROGRESSION_BLOCKED_UNVERIFIED_FAILURE' as const;

export const CANONICAL_PROGRESSION_RECEIPT_CONFLICT = 'CANONICAL_PROGRESSION_RECEIPT_CONFLICT' as const;

export const CANONICAL_PROGRESSION_READINESS =
  'CANONICAL_PROGRESSION_BLOCKED_UNSUPPORTED_REWARD_PROGRESS' as const;

/**
 * Blockers between internal canonical progression and public progression (Step 29AJ).
 * Legacy migration has an internal attested-baseline path; its public rollout (client-authored
 * baseline acceptance, consent UI, device conflict visibility) is still open.
 */
export const CANONICAL_PROGRESSION_REMAINING_BLOCKERS = [
  'UNSUPPORTED_REWARD_PROGRESS',
  'CARGO_QUALITY_AUTHORITY',
  'LEGACY_PROGRESSION_MIGRATION_PUBLIC_ROLLOUT',
  'PUBLIC_PROGRESSION_UI',
] as const;

/** Step 29AJ migration policy. A migrated state or record with any other value fails closed. */
export const CANONICAL_PROGRESSION_MIGRATION_POLICY_VERSION = 'canonical-progression-migration-v1' as const;

/**
 * Provenance of a migrated starting point. Neither class means the baseline was earned through
 * server receipts: NEW_ACCOUNT_DEFAULTS_EQUIVALENT is a legacy save that still equals the new-account
 * defaults; SERVER_ATTESTED_LEGACY_BASELINE is a client-authored save the server pinned by hash and
 * validated structurally, once.
 */
export type CanonicalProgressionBaselineAttestationClass =
  | 'NEW_ACCOUNT_DEFAULTS_EQUIVALENT'
  | 'SERVER_ATTESTED_LEGACY_BASELINE';

export type CanonicalProgressionBaselineProvenance = {
  attestationClass: CanonicalProgressionBaselineAttestationClass;
  migrationPolicyVersion: typeof CANONICAL_PROGRESSION_MIGRATION_POLICY_VERSION;
  migrationId: string;
  baselineTotalXp: number;
  baselineReputation: number;
  sourceSnapshotHash: string;
  cutoverAtMs: number;
};

/**
 * Progression sources that remain client-owned (public save) after Step 29AI.
 * Truck purchase, driver hire, warehouse open/upgrade, zero-decay cargo sales and the
 * server-derivable missions/milestones/weekly objectives are server-derived for canonical
 * accounts. Vehicle recovery grants no production XP; it stays listed for its reputation effect.
 */
export const CANONICAL_PROGRESSION_REMAINING_CLIENT_XP_SOURCES = [
  'trade-sale-quality-decay',
  'missions-unsupported-progress',
  'milestones-unsupported-progress',
  'weekly-trade-untrusted-profit',
  'operation-choices',
  'vehicle-recovery',
] as const;

export type CanonicalCompanyProgressionAuthorityClass =
  | 'SERVER_CANONICAL_PROGRESSION'
  | 'INTERNAL_TEST_PROGRESSION_FIXTURE'
  | 'LEGACY_CLIENT_UNVERIFIED'
  | 'UNINITIALIZED'
  | 'UNSUPPORTED';

export const CANONICAL_COMPANY_PROGRESSION_AUTHORITY_CLASSES: readonly CanonicalCompanyProgressionAuthorityClass[] =
  [
    'SERVER_CANONICAL_PROGRESSION',
    'INTERNAL_TEST_PROGRESSION_FIXTURE',
    'LEGACY_CLIENT_UNVERIFIED',
    'UNINITIALIZED',
    'UNSUPPORTED',
  ];

export const CANONICAL_PROGRESSION_FORBIDDEN_CLIENT_KEYS = [
  'level',
  'xp',
  'experience',
  'reputation',
  'reputationDelta',
  'xpDelta',
  'newLevel',
  'companyLevel',
  'companyXp',
  'progressionRevision',
  'score',
  'companyScore',
  'totalXp',
  'xpToNextLevel',
  'authorityClass',
] as const;

export const CANONICAL_PROGRESSION_INIT_ALLOWED_KEYS = ['canonicalSchemaVersion'] as const;

export interface CanonicalCompanyProgressionState {
  schemaVersion: typeof CANONICAL_COMPANY_PROGRESSION_SCHEMA_VERSION;
  progressionPolicyVersion: typeof CANONICAL_COMPANY_PROGRESSION_POLICY_VERSION;
  reputationPolicyVersion: typeof CANONICAL_ROAD_REPUTATION_POLICY_VERSION;
  authorityClass: 'SERVER_CANONICAL_PROGRESSION';
  ownerUid: string;
  level: number;
  xp: number;
  xpToNextLevel: number;
  totalXp: number;
  reputation: number;
  progressionRevision: number;
  initializationSource: 'NEW_CANONICAL_ACCOUNT_DEFAULTS' | 'LEGACY_MIGRATION_BASELINE';
  /** Present only for LEGACY_MIGRATION_BASELINE. */
  baselineProvenance?: CanonicalProgressionBaselineProvenance;
  initializedAtMs: number;
  updatedAtMs: number;
}

export type CanonicalProgressionSourceType =
  | 'ROAD_DELIVERY_COMPLETION'
  | 'ROAD_DELIVERY_SERVER_FAILURE'
  | 'ROAD_DELIVERY_CANCEL'
  | CanonicalNonDeliveryXpSourceType
  | CanonicalClientRewardSourceType;

export type CanonicalProgressionXpBlockedAuthority =
  | typeof CANONICAL_ROAD_COMPLETION_XP_AUTHORITY
  | typeof PROGRESSION_XP_BLOCKED_RISK_POLICY_UNKNOWN
  | typeof PROGRESSION_XP_BLOCKED_RISK_SNAPSHOT_INVALID
  | typeof PROGRESSION_XP_BLOCKED_NET_PROFIT_AUTHORITY
  | typeof PROGRESSION_XP_BLOCKED_INCIDENT_ECONOMICS
  | CanonicalCargoSaleXpBlockedAuthority;

export type CanonicalProgressionXpAuthority =
  | 'PRODUCTION_NO_XP'
  | CanonicalProgressionXpBlockedAuthority
  | 'SERVER_DERIVED';

/** Server-derived inputs behind a completion XP grant (audit only). */
export type CanonicalDeliveryProgressionXpEvidence = {
  distanceKm: number;
  netProfit: number;
  riskTier: DeliveryRiskTier;
  riskBonus: number;
  riskPolicyVersion: string;
};

export type CanonicalProgressionXpEvidence =
  | CanonicalDeliveryProgressionXpEvidence
  | CanonicalNonDeliveryXpEvidence
  | CanonicalClientRewardXpEvidence;

export interface CanonicalProgressionReceipt {
  schemaVersion: typeof CANONICAL_PROGRESSION_RECEIPT_SCHEMA_VERSION;
  operationId: string;
  sourceType: CanonicalProgressionSourceType;
  sourceId: string;
  xpDelta: number;
  xpAuthority: CanonicalProgressionXpAuthority;
  requestedReputationDelta: number;
  reputationDelta: number;
  reputationReasons: ReputationReason[];
  xpBefore: number;
  xpAfter: number;
  totalXpBefore: number;
  totalXpAfter: number;
  levelBefore: number;
  levelAfter: number;
  reputationBefore: number;
  reputationAfter: number;
  progressionRevisionBefore: number;
  progressionRevisionAfter: number;
  policyVersion: typeof CANONICAL_COMPANY_PROGRESSION_POLICY_VERSION;
  reputationPolicyVersion: typeof CANONICAL_ROAD_REPUTATION_POLICY_VERSION;
  xpEvidence?: CanonicalProgressionXpEvidence | null;
  createdAtMs: number;
}

export function isCanonicalCompanyProgressionAllowed(input?: { envValue?: string | null }): boolean {
  const raw =
    input && 'envValue' in input
      ? input.envValue
      : typeof process !== 'undefined'
        ? process.env[CANONICAL_COMPANY_PROGRESSION_AUTHORITY_ENV]
        : undefined;
  return raw === 'INTERNAL_TEST';
}

export function canonicalCompanyProgressionPath(uid: string): string {
  return `users/${uid}/${CANONICAL_COMPANY_PROGRESSION_COLLECTION}/${CANONICAL_COMPANY_PROGRESSION_DOC_ID}`;
}

export function canonicalProgressionReceiptPath(uid: string, operationId: string): string {
  return `users/${uid}/${CANONICAL_PROGRESSION_RECEIPTS_COLLECTION}/${operationId}`;
}

export function progressionDeliveryCompletionOperationId(deliveryId: string): string {
  return `progression:delivery:${deliveryId}:completion`;
}

export function progressionDeliveryCancelOperationId(deliveryId: string): string {
  return `progression:delivery:${deliveryId}:cancel`;
}

export function progressionDeliveryFailureOperationId(deliveryId: string): string {
  return `progression:delivery:${deliveryId}:failure`;
}

export function containsForbiddenProgressionClientKeys(record: Record<string, unknown>): boolean {
  return CANONICAL_PROGRESSION_FORBIDDEN_CLIENT_KEYS.some((key) =>
    Object.prototype.hasOwnProperty.call(record, key),
  );
}

export function hasOnlyCanonicalProgressionInitKeys(record: Record<string, unknown>): boolean {
  const allowed = new Set<string>(CANONICAL_PROGRESSION_INIT_ALLOWED_KEYS);
  return Object.keys(record).every((key) => allowed.has(key));
}

/** Production createInitialGameState: level 1, xp 0, totalXp 0, reputationBalance.initial. */
export function createInitialCanonicalCompanyProgression(
  uid: string,
  nowMs: number,
): CanonicalCompanyProgressionState {
  return {
    schemaVersion: CANONICAL_COMPANY_PROGRESSION_SCHEMA_VERSION,
    progressionPolicyVersion: CANONICAL_COMPANY_PROGRESSION_POLICY_VERSION,
    reputationPolicyVersion: CANONICAL_ROAD_REPUTATION_POLICY_VERSION,
    authorityClass: 'SERVER_CANONICAL_PROGRESSION',
    ownerUid: uid,
    level: 1,
    xp: 0,
    xpToNextLevel: calculateXpToNextLevel(1),
    totalXp: 0,
    reputation: reputationBalance.initial,
    progressionRevision: 1,
    initializationSource: 'NEW_CANONICAL_ACCOUNT_DEFAULTS',
    initializedAtMs: nowMs,
    updatedAtMs: nowMs,
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateCanonicalProgressionBaselineProvenance(value: unknown, totalXp: number): string | null {
  if (!value || typeof value !== 'object') return 'CANONICAL_PROGRESSION_BASELINE_PROVENANCE_MISSING';
  const provenance = value as Record<string, unknown>;
  if (provenance.migrationPolicyVersion !== CANONICAL_PROGRESSION_MIGRATION_POLICY_VERSION) {
    return 'CANONICAL_PROGRESSION_MIGRATION_POLICY_UNKNOWN';
  }
  const valid =
    (provenance.attestationClass === 'NEW_ACCOUNT_DEFAULTS_EQUIVALENT' ||
      provenance.attestationClass === 'SERVER_ATTESTED_LEGACY_BASELINE') &&
    typeof provenance.migrationId === 'string' &&
    typeof provenance.sourceSnapshotHash === 'string' &&
    isFiniteNumber(provenance.baselineTotalXp) &&
    provenance.baselineTotalXp >= 0 &&
    provenance.baselineTotalXp <= totalXp &&
    isFiniteNumber(provenance.baselineReputation) &&
    provenance.baselineReputation >= REPUTATION_MIN &&
    provenance.baselineReputation <= REPUTATION_MAX &&
    isFiniteNumber(provenance.cutoverAtMs);
  return valid ? null : 'CANONICAL_PROGRESSION_BASELINE_PROVENANCE_INVALID';
}

/** XP earned through canonical receipts since the migration cutover (the baseline is not earned). */
export function canonicalEarnedXpSinceCutover(
  state: Pick<CanonicalCompanyProgressionState, 'totalXp' | 'baselineProvenance'>,
): number {
  return state.totalXp - (state.baselineProvenance?.baselineTotalXp ?? 0);
}

export type CanonicalProgressionClassification =
  | { authorityClass: 'SERVER_CANONICAL_PROGRESSION'; state: CanonicalCompanyProgressionState }
  | { authorityClass: 'INTERNAL_TEST_PROGRESSION_FIXTURE'; level: unknown; reputation: unknown }
  | { authorityClass: 'LEGACY_CLIENT_UNVERIFIED' | 'UNINITIALIZED'; reason: string }
  | { authorityClass: 'UNSUPPORTED'; reason: string };

export function classifyCanonicalCompanyProgression(
  data: Record<string, unknown> | undefined | null,
  uid: string,
): CanonicalProgressionClassification {
  if (data == null) {
    return { authorityClass: 'UNINITIALIZED', reason: 'CANONICAL_PROGRESSION_UNINITIALIZED' };
  }
  if (data.authorityClass === 'LEGACY_CLIENT_UNVERIFIED') {
    return { authorityClass: 'LEGACY_CLIENT_UNVERIFIED', reason: 'CANONICAL_PROGRESSION_LEGACY_UNVERIFIED' };
  }
  if (data.authorityClass === undefined && data.schemaVersion === undefined) {
    return {
      authorityClass: 'INTERNAL_TEST_PROGRESSION_FIXTURE',
      level: data.level,
      reputation: data.reputation,
    };
  }
  if (data.authorityClass !== 'SERVER_CANONICAL_PROGRESSION') {
    return { authorityClass: 'UNSUPPORTED', reason: 'CANONICAL_PROGRESSION_AUTHORITY_UNSUPPORTED' };
  }
  if (
    data.progressionPolicyVersion !== CANONICAL_COMPANY_PROGRESSION_POLICY_VERSION ||
    data.reputationPolicyVersion !== CANONICAL_ROAD_REPUTATION_POLICY_VERSION
  ) {
    return { authorityClass: 'UNSUPPORTED', reason: 'CANONICAL_PROGRESSION_POLICY_UNKNOWN' };
  }
  const level = data.level;
  const valid =
    data.schemaVersion === CANONICAL_COMPANY_PROGRESSION_SCHEMA_VERSION &&
    data.ownerUid === uid &&
    isFiniteNumber(level) &&
    Number.isInteger(level) &&
    level >= 1 &&
    level <= levelConfig.maxLevel &&
    isFiniteNumber(data.xp) &&
    data.xp >= 0 &&
    data.xpToNextLevel === calculateXpToNextLevel(level) &&
    isFiniteNumber(data.totalXp) &&
    data.totalXp >= data.xp &&
    isFiniteNumber(data.reputation) &&
    data.reputation >= REPUTATION_MIN &&
    data.reputation <= REPUTATION_MAX &&
    isFiniteNumber(data.progressionRevision) &&
    Number.isInteger(data.progressionRevision) &&
    data.progressionRevision >= 1 &&
    (level >= levelConfig.maxLevel || data.xp < data.xpToNextLevel);
  if (!valid) {
    return { authorityClass: 'UNSUPPORTED', reason: 'CANONICAL_PROGRESSION_STATE_INVALID' };
  }
  if (data.initializationSource === 'LEGACY_MIGRATION_BASELINE') {
    const baselineReason = validateCanonicalProgressionBaselineProvenance(
      data.baselineProvenance,
      data.totalXp as number,
    );
    if (baselineReason) return { authorityClass: 'UNSUPPORTED', reason: baselineReason };
  } else if (
    data.initializationSource !== undefined &&
    data.initializationSource !== 'NEW_CANONICAL_ACCOUNT_DEFAULTS'
  ) {
    return { authorityClass: 'UNSUPPORTED', reason: 'CANONICAL_PROGRESSION_INITIALIZATION_SOURCE_UNKNOWN' };
  }
  return {
    authorityClass: 'SERVER_CANONICAL_PROGRESSION',
    state: data as unknown as CanonicalCompanyProgressionState,
  };
}

export type CanonicalProgressionForIssuance =
  | {
      ok: true;
      level: number;
      reputation: number;
      authorityClass: 'SERVER_CANONICAL_PROGRESSION' | 'INTERNAL_TEST_PROGRESSION_FIXTURE';
    }
  | { ok: false; reason: string; authorityClass: CanonicalCompanyProgressionAuthorityClass };

/**
 * INTERNAL_TEST_PROGRESSION_FIXTURE docs (no schema/authority fields) predate 29AF and are
 * only accepted while the progression gate is OFF. With the gate ON, issuance needs a
 * SERVER_CANONICAL_PROGRESSION doc.
 */
export function resolveCanonicalProgressionForIssuance(
  data: Record<string, unknown> | undefined | null,
  uid: string,
  options: { progressionGateAllowed: boolean },
): CanonicalProgressionForIssuance {
  const classified = classifyCanonicalCompanyProgression(data, uid);
  switch (classified.authorityClass) {
    case 'SERVER_CANONICAL_PROGRESSION':
      return {
        ok: true,
        level: classified.state.level,
        reputation: classified.state.reputation,
        authorityClass: 'SERVER_CANONICAL_PROGRESSION',
      };
    case 'INTERNAL_TEST_PROGRESSION_FIXTURE':
      if (options.progressionGateAllowed) {
        return {
          ok: false,
          reason: 'CANONICAL_PROGRESSION_FIXTURE_NOT_TRUSTED',
          authorityClass: 'INTERNAL_TEST_PROGRESSION_FIXTURE',
        };
      }
      if (typeof classified.level !== 'number') {
        return {
          ok: false,
          reason: 'ROAD_CONTRACT_ISSUANCE_BLOCKED_PLAYER_PROGRESSION',
          authorityClass: 'INTERNAL_TEST_PROGRESSION_FIXTURE',
        };
      }
      if (typeof classified.reputation !== 'number') {
        return {
          ok: false,
          reason: 'ROAD_CONTRACT_ISSUANCE_BLOCKED_REPUTATION',
          authorityClass: 'INTERNAL_TEST_PROGRESSION_FIXTURE',
        };
      }
      return {
        ok: true,
        level: classified.level,
        reputation: classified.reputation,
        authorityClass: 'INTERNAL_TEST_PROGRESSION_FIXTURE',
      };
    case 'UNINITIALIZED':
      return {
        ok: false,
        reason: 'ROAD_CONTRACT_ISSUANCE_BLOCKED_PLAYER_PROGRESSION',
        authorityClass: 'UNINITIALIZED',
      };
    case 'LEGACY_CLIENT_UNVERIFIED':
      return {
        ok: false,
        reason: 'ROAD_CONTRACT_ISSUANCE_BLOCKED_LEGACY_PROGRESSION',
        authorityClass: 'LEGACY_CLIENT_UNVERIFIED',
      };
    default:
      return { ok: false, reason: classified.reason, authorityClass: 'UNSUPPORTED' };
  }
}

export type CanonicalXpApplication = {
  level: number;
  xp: number;
  xpToNextLevel: number;
  totalXp: number;
  newLevels: number[];
};

/** Production applyXpToPlayer: carry-over, multi-level, xp reset to 0 at max level. */
export function applyCanonicalCompanyXp(
  state: Pick<CanonicalCompanyProgressionState, 'level' | 'xp' | 'xpToNextLevel' | 'totalXp'>,
  amount: number,
): CanonicalXpApplication {
  const safeAmount = isFiniteNumber(amount) ? amount : 0;
  const result = applyXpToPlayer(
    {
      level: state.level,
      companyLevel: state.level,
      xp: state.xp,
      xpToNextLevel: state.xpToNextLevel,
      totalXp: state.totalXp,
    } as unknown as Player,
    safeAmount,
  );
  return {
    level: result.player.level,
    xp: result.player.xp,
    xpToNextLevel: result.player.xpToNextLevel,
    totalXp: result.player.totalXp,
    newLevels: result.newLevels,
  };
}

/** Production reputationService: clamp previous, clamp next, no rounding. */
export function applyCanonicalReputationDelta(
  previous: number,
  delta: number,
): { reputation: number; appliedDelta: number } {
  const prev = clampReputation(previous);
  const next = clampReputation(prev + delta);
  return { reputation: next, appliedDelta: next - prev };
}

/** Production settlement.netProfit = grossRevenue − (fuelCost + maintenanceCost + penaltyCost). */
export function deriveCanonicalRoadProductionNetProfit(settlement: {
  grossRevenue: number;
  fuelCost: number;
  maintenanceCost: number;
  penaltyCost: number;
}): number {
  return settlement.grossRevenue - (settlement.fuelCost + settlement.maintenanceCost + settlement.penaltyCost);
}

export type CanonicalRoadCompletionXpInputs = {
  distanceKm: number;
  netProfit: number;
  riskTier: DeliveryRiskTier | null;
};

export function deriveCanonicalRoadCompletionXp(
  input: CanonicalRoadCompletionXpInputs,
):
  | { ok: true; xp: number; xpAuthority: 'SERVER_DERIVED' }
  | { ok: false; xp: 0; xpAuthority: CanonicalProgressionXpBlockedAuthority } {
  if (input.riskTier == null) {
    return { ok: false, xp: 0, xpAuthority: CANONICAL_ROAD_COMPLETION_XP_AUTHORITY };
  }
  return {
    ok: true,
    xp: calculateDeliveryXp(input.distanceKm, input.netProfit, input.riskTier),
    xpAuthority: 'SERVER_DERIVED',
  };
}

const BAND_TO_PUNCTUALITY: Record<CanonicalRoadCompletionBand, DeliveryPunctuality> = {
  EARLY: 'early',
  ON_TIME: 'on-time',
  LATE_MINOR: 'late-minor',
  LATE_MAJOR: 'late-major',
  FAILED: 'failed',
};

export type CanonicalRoadReputationDerivation =
  | { ok: true; delta: number; reasons: ReputationReason[] }
  | { ok: false; reason: string };

/**
 * Completed canonical delivery: production calculateDeliveryReputationResult on frozen timing.
 * The server timing band must agree with the production classifier.
 */
export function deriveCanonicalRoadCompletionReputation(input: {
  band: CanonicalRoadCompletionBand;
  actualTravelHours: number;
  deadlineHours: number;
  plannedTravelGameHours: number;
  contractType: unknown;
}): CanonicalRoadReputationDerivation {
  if (input.band === 'FAILED') {
    return { ok: false, reason: 'CANONICAL_PROGRESSION_BAND_NOT_COMPLETION' };
  }
  const contractType = typeof input.contractType === 'string' ? input.contractType : 'standard';
  const result = calculateDeliveryReputationResult({
    contract: { deadlineHours: input.deadlineHours, contractType } as unknown as Contract,
    delivery: { travelHours: input.plannedTravelGameHours } as unknown as Delivery,
    actualTravelHours: input.actualTravelHours,
    failed: false,
  });
  if (result.punctuality !== BAND_TO_PUNCTUALITY[input.band]) {
    return { ok: false, reason: 'CANONICAL_PROGRESSION_TIMING_MISMATCH' };
  }
  return { ok: true, delta: result.delta, reasons: result.reasons };
}

/** Production too-late failure: failDeliveryById('too_late') → deliveryFailed. */
export function deriveCanonicalRoadServerFailureReputation(): {
  delta: number;
  reasons: ReputationReason[];
} {
  const mapped = deliveryFailureReasonToReputationDelta('too_late');
  return { delta: mapped.delta, reasons: [mapped.reason] };
}

/** Production failDeliveryById('cancelled') → contractCancelled. */
export function deriveCanonicalRoadCancelReputation(): {
  delta: number;
  reasons: ReputationReason[];
} {
  const mapped = deliveryFailureReasonToReputationDelta('cancelled');
  return { delta: mapped.delta, reasons: [mapped.reason] };
}

export const CANONICAL_ROAD_REPUTATION_DELTAS = {
  early: REPUTATION_RULES.deliveryEarly,
  onTime: REPUTATION_RULES.deliveryOnTime,
  highReputationContractBonus: REPUTATION_RULES.highRiskDeliverySuccess,
  lateMinor: REPUTATION_RULES.deliveryLateMinor,
  lateMajor: REPUTATION_RULES.deliveryLateMajor,
  cancelled: REPUTATION_RULES.contractCancelled,
  failed: REPUTATION_RULES.deliveryFailed,
} as const;

export type CanonicalProgressionMutationInput = {
  operationId: string;
  sourceType: CanonicalProgressionSourceType;
  sourceId: string;
  xpDelta: number;
  xpAuthority: CanonicalProgressionXpAuthority;
  reputationDelta: number;
  reputationReasons: ReputationReason[];
  xpEvidence?: CanonicalProgressionXpEvidence | null;
  nowMs: number;
};

export function planCanonicalProgressionMutation(
  state: CanonicalCompanyProgressionState,
  input: CanonicalProgressionMutationInput,
): { next: CanonicalCompanyProgressionState; receipt: CanonicalProgressionReceipt; changed: boolean } {
  const xp = applyCanonicalCompanyXp(state, input.xpDelta);
  const rep = applyCanonicalReputationDelta(state.reputation, input.reputationDelta);
  const changed =
    xp.level !== state.level ||
    xp.xp !== state.xp ||
    xp.totalXp !== state.totalXp ||
    rep.reputation !== state.reputation;
  const progressionRevision = changed ? state.progressionRevision + 1 : state.progressionRevision;
  const next: CanonicalCompanyProgressionState = {
    ...state,
    level: xp.level,
    xp: xp.xp,
    xpToNextLevel: xp.xpToNextLevel,
    totalXp: xp.totalXp,
    reputation: rep.reputation,
    progressionRevision,
    updatedAtMs: changed ? input.nowMs : state.updatedAtMs,
  };
  const receipt: CanonicalProgressionReceipt = {
    schemaVersion: CANONICAL_PROGRESSION_RECEIPT_SCHEMA_VERSION,
    operationId: input.operationId,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    xpDelta: input.xpDelta,
    xpAuthority: input.xpAuthority,
    requestedReputationDelta: input.reputationDelta,
    reputationDelta: rep.appliedDelta,
    reputationReasons: input.reputationReasons,
    xpBefore: state.xp,
    xpAfter: xp.xp,
    totalXpBefore: state.totalXp,
    totalXpAfter: xp.totalXp,
    levelBefore: state.level,
    levelAfter: xp.level,
    reputationBefore: state.reputation,
    reputationAfter: rep.reputation,
    progressionRevisionBefore: state.progressionRevision,
    progressionRevisionAfter: progressionRevision,
    policyVersion: CANONICAL_COMPANY_PROGRESSION_POLICY_VERSION,
    reputationPolicyVersion: CANONICAL_ROAD_REPUTATION_POLICY_VERSION,
    xpEvidence: input.xpEvidence ?? null,
    createdAtMs: input.nowMs,
  };
  return { next, receipt, changed };
}

/** Same operation with the same requested deltas is a replay; anything else conflicts. */
export function canonicalProgressionReceiptMatches(
  existing: Record<string, unknown>,
  input: Pick<
    CanonicalProgressionMutationInput,
    'operationId' | 'sourceType' | 'sourceId' | 'xpDelta' | 'reputationDelta'
  >,
): boolean {
  return (
    existing.operationId === input.operationId &&
    existing.sourceType === input.sourceType &&
    existing.sourceId === input.sourceId &&
    existing.xpDelta === input.xpDelta &&
    existing.requestedReputationDelta === input.reputationDelta &&
    existing.policyVersion === CANONICAL_COMPANY_PROGRESSION_POLICY_VERSION &&
    existing.reputationPolicyVersion === CANONICAL_ROAD_REPUTATION_POLICY_VERSION
  );
}

export type CanonicalProgressionApplication =
  | 'NOT_EVALUATED_GATE_OFF'
  | 'APPLIED'
  | 'ALREADY_APPLIED'
  | 'NOT_APPLIED_UNINITIALIZED'
  | 'NOT_APPLIED_NOT_SERVER_CANONICAL'
  | typeof PROGRESSION_BLOCKED_UNVERIFIED_FAILURE;

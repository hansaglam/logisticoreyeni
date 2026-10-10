/**
 * Step 29AJ — legacy progression & reward-history migration design / attestation foundation.
 *
 * Existing signed-in accounts keep progression in a client-authored save. Nothing on the server can
 * rebuild their historical XP, reputation or claim history, so this module never imports save values
 * as earned state. It classifies an account, validates the stored save structurally, and (INTERNAL_TEST
 * only, one time) pins one server-hashed snapshot as a provenance-tagged baseline with an explicit
 * reward-history cutover. No cash, no reward payout, no public save mutation.
 */

import { reputationBalance } from '../config/balance';
import { calculateXpToNextLevel, levelConfig } from '../config/levelConfig';
import { REPUTATION_MAX, REPUTATION_MIN } from '../config/reputationRules';
import { canonicalJsonStringify } from '../utils/canonicalJson';
import { migrateLegacyMissionId } from '../utils/missionProgress';
import {
  CANONICAL_COMPANY_PROGRESSION_POLICY_VERSION,
  CANONICAL_COMPANY_PROGRESSION_SCHEMA_VERSION,
  CANONICAL_PROGRESSION_MIGRATION_POLICY_VERSION,
  CANONICAL_PROGRESSION_RECEIPT_SCHEMA_VERSION,
  CANONICAL_ROAD_REPUTATION_POLICY_VERSION,
  classifyCanonicalCompanyProgression,
  type CanonicalCompanyProgressionState,
  type CanonicalProgressionBaselineAttestationClass,
} from './canonicalCompanyProgression';
import {
  CANONICAL_MILESTONE_REWARD_CATALOG,
  CANONICAL_MISSION_REWARD_CATALOG,
  buildCanonicalWeeklyObjectiveCatalog,
  resolveCanonicalWeeklyCycle,
  type CanonicalClientRewardDefinition,
} from './canonicalClientRewardXp';

export { CANONICAL_PROGRESSION_MIGRATION_POLICY_VERSION };

export const CANONICAL_PROGRESSION_MIGRATION_ENV = 'CANONICAL_PROGRESSION_MIGRATION' as const;
export const CANONICAL_PROGRESSION_MIGRATION_SCHEMA_VERSION = 1 as const;
export const CANONICAL_PROGRESSION_MIGRATION_COLLECTION = 'canonicalProgressionMigration' as const;
export const CANONICAL_PROGRESSION_MIGRATION_DOC_ID = 'current' as const;
export const CANONICAL_PROGRESSION_MIGRATION_RECEIPTS_COLLECTION = 'canonicalProgressionMigrationReceipts' as const;
export const PROGRESSION_MIGRATION_OPERATION_ID = 'progression:migration:v1' as const;
export const LEGACY_PROGRESSION_MIGRATION_SOURCE_HASH_ALGORITHM = 'sha256-canonical-json-v1' as const;

/** SAVE_GAME_VERSION 6 is the only audited layout; older and newer saves are not reinterpreted. */
export const LEGACY_PROGRESSION_MIGRATION_SUPPORTED_SAVE_VERSION = 6 as const;
/** `users/{uid}/saves/current` document envelope schema written by cloudSaveService. */
export const LEGACY_PROGRESSION_MIGRATION_SUPPORTED_CLOUD_DOC_SCHEMA = 1 as const;

export const LEGACY_PROGRESSION_REWARD_MIGRATION_STATUS =
  'LEGACY_PROGRESSION_REWARD_MIGRATION_PASS_INTERNAL_ATTESTED_BASELINE' as const;

export const LEGACY_REWARD_HISTORY_POLICY =
  'LEGACY_CLAIMS_CONSUMED_UNCLAIMED_REWARDS_POST_CUTOVER_ONLY' as const;
export const LEGACY_WEEKLY_CUTOVER_POLICY = 'PRE_CUTOVER_AND_CUTOVER_WEEK_CLOSED_NEXT_ISO_WEEK_CANONICAL' as const;

// ---------------------------------------------------------------------------
// Reasons
// ---------------------------------------------------------------------------

export const MIGRATION_OFF = 'CANONICAL_PROGRESSION_MIGRATION_OFF' as const;
export const MIGRATION_NOT_REQUIRED_NEW_ACCOUNT = 'MIGRATION_NOT_REQUIRED_NEW_ACCOUNT' as const;
export const MIGRATION_ALREADY_CANONICAL_ACTIVE = 'MIGRATION_ALREADY_CANONICAL_ACTIVE' as const;
export const MIGRATION_ALREADY_MIGRATED = 'MIGRATION_ALREADY_MIGRATED' as const;
export const MIGRATION_POLICY_UNKNOWN = 'CANONICAL_PROGRESSION_MIGRATION_POLICY_UNKNOWN' as const;
export const MIGRATION_RECORD_INCONSISTENT = 'MIGRATION_RECORD_INCONSISTENT' as const;
export const MIGRATION_BLOCKED_INTERNAL_FIXTURE = 'MIGRATION_BLOCKED_INTERNAL_FIXTURE' as const;
export const MIGRATION_BLOCKED_EXISTING_PROGRESSION_UNSUPPORTED =
  'MIGRATION_BLOCKED_EXISTING_PROGRESSION_UNSUPPORTED' as const;
export const MIGRATION_BLOCKED_NO_SOURCE_SAVE = 'MIGRATION_BLOCKED_NO_SOURCE_SAVE' as const;
export const MIGRATION_BLOCKED_SAVE_BODY_MISSING = 'MIGRATION_BLOCKED_SAVE_BODY_MISSING' as const;
export const MIGRATION_BLOCKED_SAVE_OWNER_MISMATCH = 'MIGRATION_BLOCKED_SAVE_OWNER_MISMATCH' as const;
export const MIGRATION_BLOCKED_SAVE_SCHEMA_UNSUPPORTED = 'MIGRATION_BLOCKED_SAVE_SCHEMA_UNSUPPORTED' as const;
export const MIGRATION_BLOCKED_SAVE_VERSION_FUTURE = 'MIGRATION_BLOCKED_SAVE_VERSION_FUTURE' as const;
export const MIGRATION_BLOCKED_SAVE_VERSION_STALE = 'MIGRATION_BLOCKED_SAVE_VERSION_STALE' as const;
export const MIGRATION_BLOCKED_SAVE_INTEGRITY = 'MIGRATION_BLOCKED_SAVE_INTEGRITY' as const;
export const MIGRATION_BLOCKED_SAVE_CONFLICT = 'MIGRATION_BLOCKED_SAVE_CONFLICT' as const;
export const MIGRATION_BLOCKED_XP_STRUCTURAL_CONFLICT = 'MIGRATION_BLOCKED_XP_STRUCTURAL_CONFLICT' as const;
export const MIGRATION_BLOCKED_REPUTATION_INVALID = 'MIGRATION_BLOCKED_REPUTATION_INVALID' as const;
export const MIGRATION_BLOCKED_REWARD_HISTORY_CONFLICT = 'MIGRATION_BLOCKED_REWARD_HISTORY_CONFLICT' as const;
export const MIGRATION_BLOCKED_RESET_REQUIRES_CONSENT = 'MIGRATION_BLOCKED_RESET_REQUIRES_CONSENT' as const;
export const LEGACY_PROGRESSION_META_PLAYER_CONFLICT = 'LEGACY_PROGRESSION_META_PLAYER_CONFLICT' as const;
export const MIGRATION_BLOCKED_ACTIVE_CANONICAL_HISTORY = 'MIGRATION_BLOCKED_ACTIVE_CANONICAL_HISTORY' as const;
export const MIGRATION_BLOCKED_MIGRATION_INELIGIBLE = 'MIGRATION_BLOCKED_MIGRATION_INELIGIBLE' as const;

/** 29AI claim outcomes for migrated accounts. */
export const CLIENT_REWARD_LEGACY_CLAIM_CONSUMED_BY_MIGRATION =
  'CLIENT_REWARD_LEGACY_CLAIM_CONSUMED_BY_MIGRATION' as const;
export const CLIENT_REWARD_LEGACY_CASH_HISTORY_UNVERIFIED = 'CLIENT_REWARD_LEGACY_CASH_HISTORY_UNVERIFIED' as const;
export const CLIENT_REWARD_MIGRATION_CUTOVER_WEEK_CLOSED = 'CLIENT_REWARD_MIGRATION_CUTOVER_WEEK_CLOSED' as const;

// ---------------------------------------------------------------------------
// Gate, paths, identity, request keys
// ---------------------------------------------------------------------------

export function isCanonicalProgressionMigrationAllowed(input?: { envValue?: string | null }): boolean {
  const raw =
    input && 'envValue' in input
      ? input.envValue
      : typeof process !== 'undefined'
        ? process.env[CANONICAL_PROGRESSION_MIGRATION_ENV]
        : undefined;
  return raw === 'INTERNAL_TEST';
}

export function canonicalProgressionMigrationPath(uid: string): string {
  return `users/${uid}/${CANONICAL_PROGRESSION_MIGRATION_COLLECTION}/${CANONICAL_PROGRESSION_MIGRATION_DOC_ID}`;
}

export function canonicalProgressionMigrationId(uid: string): string {
  return `progressionMigration:${uid}:v1`;
}

export function canonicalProgressionMigrationReceiptPath(uid: string): string {
  return `users/${uid}/${CANONICAL_PROGRESSION_MIGRATION_RECEIPTS_COLLECTION}/${canonicalProgressionMigrationId(uid)}`;
}

export const CANONICAL_PROGRESSION_MIGRATION_FORBIDDEN_CLIENT_KEYS = [
  'level',
  'companyLevel',
  'xp',
  'totalXp',
  'xpToNextLevel',
  'reputation',
  'claimedMissions',
  'claimedMilestones',
  'claimedMissionRewardIds',
  'weeklyClaims',
  'weeklyHistory',
  'rewardReceipts',
  'rewardHistory',
  'completedRewards',
  'migrationBaseline',
  'baseline',
  'attestationClass',
  'sourceHash',
  'sourceSnapshotHash',
  'sourceSave',
  'sourceSaveVersion',
  'snapshot',
  'hash',
  'freezeId',
  'saveRevision',
  'migrationSourceId',
  'expectedProgression',
  'gameState',
  'save',
  'player',
  'migrationStatus',
  'policyVersion',
] as const;

export const CANONICAL_PROGRESSION_MIGRATION_PREVIEW_ALLOWED_KEYS = ['canonicalSchemaVersion'] as const;
/**
 * Apply accepts only the schema selector. The snapshot hash is computed from the stored save
 * inside the apply transaction. A client hash is never an authority and is not a precondition.
 */
export const CANONICAL_PROGRESSION_MIGRATION_APPLY_ALLOWED_KEYS = ['canonicalSchemaVersion'] as const;
export const CANONICAL_PROGRESSION_MIGRATION_FREEZE_ALLOWED_KEYS = [
  'canonicalSchemaVersion',
  'migrationPolicyVersion',
] as const;
export const CANONICAL_PROGRESSION_IMMEDIATE_CUTOVER_ENV = 'CANONICAL_PROGRESSION_IMMEDIATE_CUTOVER' as const;
export const CANONICAL_PROGRESSION_IMMEDIATE_CUTOVER_POLICY_VERSION =
  'canonical-progression-immediate-cutover-v1' as const;
export const CANONICAL_PROGRESSION_IMMEDIATE_CUTOVER_ALLOWED_KEYS = [
  'canonicalSchemaVersion',
  'cutoverPolicyVersion',
] as const;
export const MIGRATION_SOURCE_FREEZE_STATUS_AT_CUTOVER = 'FROZEN_AT_CUTOVER' as const;
export const MIGRATION_SOURCE_PREEXISTING_FROZEN_REQUIRES_RESOLUTION =
  'MIGRATION_SOURCE_PREEXISTING_FROZEN_REQUIRES_RESOLUTION' as const;
export const NOT_PUBLIC_CUTOVER_PATH = 'NOT_PUBLIC_CUTOVER_PATH' as const;
export const INTERNAL_PRE_FROZEN_SOURCE_PATH = 'INTERNAL_PRE_FROZEN_SOURCE_PATH' as const;
export const CUTOVER_SOURCE_REVALIDATED_AT_COMMIT = 'CUTOVER_SOURCE_REVALIDATED_AT_COMMIT' as const;
export const POST_MIGRATION_SAVE_PROGRESSION_IGNORED_FOR_AUTHORITY =
  'POST_MIGRATION_SAVE_PROGRESSION_IGNORED_FOR_AUTHORITY' as const;
export const POST_MIGRATION_LOCAL_PROGRESSION_NON_AUTHORITATIVE =
  'POST_MIGRATION_LOCAL_PROGRESSION_NON_AUTHORITATIVE' as const;
export const PUBLIC_PROGRESSION_UI_SPLIT_BRAIN = 'PUBLIC_PROGRESSION_UI_SPLIT_BRAIN' as const;
export const LEGACY_PROGRESSION_IMMEDIATE_CUTOVER_STATUS =
  'LEGACY_PROGRESSION_IMMEDIATE_CUTOVER_PASS_INTERNAL_ONLY' as const;

export function isCanonicalProgressionImmediateCutoverAllowed(input?: { envValue?: string | null }): boolean {
  const raw =
    input && 'envValue' in input
      ? input.envValue
      : typeof process !== 'undefined'
        ? process.env[CANONICAL_PROGRESSION_IMMEDIATE_CUTOVER_ENV]
        : undefined;
  return raw === 'INTERNAL_TEST';
}

function onlyKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  const forbidden = new Set<string>(CANONICAL_PROGRESSION_MIGRATION_FORBIDDEN_CLIENT_KEYS);
  const permitted = new Set<string>(allowed);
  return Object.keys(record).every((key) => permitted.has(key) && !forbidden.has(key));
}

export function hasOnlyCanonicalProgressionMigrationPreviewKeys(record: Record<string, unknown>): boolean {
  return onlyKeys(record, CANONICAL_PROGRESSION_MIGRATION_PREVIEW_ALLOWED_KEYS);
}

export function hasOnlyCanonicalProgressionMigrationApplyKeys(record: Record<string, unknown>): boolean {
  return onlyKeys(record, CANONICAL_PROGRESSION_MIGRATION_APPLY_ALLOWED_KEYS);
}

export function hasOnlyCanonicalProgressionMigrationFreezeKeys(record: Record<string, unknown>): boolean {
  return onlyKeys(record, CANONICAL_PROGRESSION_MIGRATION_FREEZE_ALLOWED_KEYS);
}

export function hasOnlyCanonicalProgressionImmediateCutoverKeys(record: Record<string, unknown>): boolean {
  return onlyKeys(record, CANONICAL_PROGRESSION_IMMEDIATE_CUTOVER_ALLOWED_KEYS);
}

export function isSupportedImmediateCutoverPolicy(value: unknown): boolean {
  return value === undefined || value === CANONICAL_PROGRESSION_IMMEDIATE_CUTOVER_POLICY_VERSION;
}

export function isSourceSnapshotHash(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

/** Full gameState JSON for cloudSaveService payloadChecksum parity (integrity only). */
export function cloudSaveSnapshotHashInput(gameState: unknown): string {
  return canonicalJsonStringify(gameState);
}

/** Normalized migration snapshot — only fields that affect baseline / reward-history cutover. */
export type NormalizedLegacyMigrationSnapshot = {
  saveVersion: number;
  player: {
    level: number;
    companyLevel: number | null;
    xp: number;
    xpToNextLevel: number;
    totalXp: number;
    reputation: number;
  };
  meta: { level: number | null; xp: number | null; totalXp: number | null };
  rewardHistory: {
    claimedMissionRewardIds: string[];
    milestoneIdsClaimed: string[];
    weeklyClaims: Array<{ cycleId: string; objectiveId: string }>;
    rewardReceiptKeys: string[];
  };
};

function sortedStrings(values: Iterable<string>): string[] {
  return [...new Set([...values].filter((v) => typeof v === 'string' && v.length > 0))].sort();
}

/** Deterministic migration-relevant slice of SAVE_GAME_VERSION 6 gameState (no timestamps). */
export function buildNormalizedLegacyMigrationSnapshot(
  gameState: Record<string, unknown>,
): NormalizedLegacyMigrationSnapshot | null {
  const player = rec(gameState.player);
  if (!player || !finiteNumber(gameState.version)) return null;
  const level = finiteNumber(player.level) ? Math.floor(player.level) : NaN;
  const xp = finiteNumber(player.xp) ? Math.floor(player.xp) : NaN;
  const xpToNextLevel = finiteNumber(player.xpToNextLevel) ? Math.floor(player.xpToNextLevel) : NaN;
  const totalXp = finiteNumber(player.totalXp) ? Math.floor(player.totalXp) : NaN;
  const reputation = finiteNumber(player.reputation) ? player.reputation : NaN;
  if (![level, xp, xpToNextLevel, totalXp, reputation].every(Number.isFinite)) return null;

  const metaRec = rec(gameState.meta);
  const missions = rec(gameState.missions);
  const retention = rec(gameState.retention);
  const receipts = rec(gameState.rewardReceipts);

  const missionIds = sortedStrings(
    (Array.isArray(missions?.claimedMissionRewardIds) ? missions!.claimedMissionRewardIds : []).map((id) =>
      typeof id === 'string' ? migrateLegacyMissionId(id) : '',
    ),
  );
  const milestoneIds: string[] = [];
  const milestoneState = retention?.milestones === undefined ? {} : rec(retention?.milestones);
  for (const [id, entry] of Object.entries(milestoneState ?? {})) {
    if (rec(entry)?.isClaimed === true) milestoneIds.push(id);
  }
  milestoneIds.sort();

  const weeklyClaims: Array<{ cycleId: string; objectiveId: string }> = [];
  const weeklyState = retention?.weeklyObjectives === undefined ? {} : rec(retention?.weeklyObjectives);
  for (const [objectiveId, entry] of Object.entries(weeklyState ?? {})) {
    if (rec(entry)?.isClaimed !== true) continue;
    const match = WEEKLY_OBJECTIVE_ID.exec(objectiveId);
    if (match) weeklyClaims.push({ cycleId: match[1], objectiveId });
  }
  weeklyClaims.sort((a, b) => `${a.cycleId}:${a.objectiveId}`.localeCompare(`${b.cycleId}:${b.objectiveId}`));

  const receiptKeys = sortedStrings(Object.keys(receipts ?? {}));

  return {
    saveVersion: Math.floor(gameState.version as number),
    player: {
      level,
      companyLevel: finiteNumber(player.companyLevel) ? Math.floor(player.companyLevel) : null,
      xp,
      xpToNextLevel,
      totalXp,
      reputation,
    },
    meta: {
      level: metaRec && finiteNumber(metaRec.level) ? Math.floor(metaRec.level) : null,
      xp: metaRec && finiteNumber(metaRec.xp) ? Math.floor(metaRec.xp) : null,
      totalXp: metaRec && finiteNumber(metaRec.totalXp) ? Math.floor(metaRec.totalXp) : null,
    },
    rewardHistory: {
      claimedMissionRewardIds: missionIds,
      milestoneIdsClaimed: milestoneIds,
      weeklyClaims,
      rewardReceiptKeys: receiptKeys,
    },
  };
}

export function migrationNormalizedSnapshotJson(snapshot: NormalizedLegacyMigrationSnapshot): string {
  return canonicalJsonStringify(snapshot);
}

export function formatMigrationSnapshotHash(hex64: string): string {
  const raw = hex64.startsWith('sha256:') ? hex64.slice(7) : hex64;
  return `sha256:${raw}`;
}

export function normalizeMigrationSnapshotHash(value: string): string {
  return value.startsWith('sha256:') ? value.slice(7) : value;
}

/** Step 29AK — one immutable server copy of the migration-relevant save slice. */
export const CANONICAL_PROGRESSION_MIGRATION_SOURCE_POLICY_VERSION =
  'canonical-progression-migration-source-freeze-v1' as const;
export const CANONICAL_PROGRESSION_MIGRATION_SOURCE_SCHEMA_VERSION = 1 as const;
export const CANONICAL_PROGRESSION_MIGRATION_SOURCE_COLLECTION = 'canonicalProgressionMigrationSource' as const;
export const CANONICAL_PROGRESSION_MIGRATION_SOURCE_DOC_ID = 'current' as const;
export const CANONICAL_PROGRESSION_MIGRATION_SOURCE_RECEIPTS_COLLECTION =
  'canonicalProgressionMigrationSourceReceipts' as const;
export const SERVER_FROZEN_LEGACY_MIGRATION_SOURCE = 'SERVER_FROZEN_LEGACY_MIGRATION_SOURCE' as const;
export const MIGRATION_SOURCE_FREEZE_STATUS = 'FROZEN_FOR_MIGRATION' as const;
export const MIGRATION_SOURCE_REFREEZE_POLICY = 'REFREEZE_FORBIDDEN' as const;
export const MIGRATION_SOURCE_ABORT_POLICY = 'NO_CLIENT_ABORT' as const;

export const MIGRATION_SOURCE_NOT_FROZEN = 'MIGRATION_SOURCE_NOT_FROZEN' as const;
export const MIGRATION_SOURCE_ALREADY_FROZEN = 'MIGRATION_SOURCE_ALREADY_FROZEN' as const;
export const MIGRATION_SOURCE_HASH_INTEGRITY_ERROR = 'MIGRATION_SOURCE_HASH_INTEGRITY_ERROR' as const;
export const MIGRATION_SOURCE_BLOCKED_SAVE_CONFLICT = 'MIGRATION_SOURCE_BLOCKED_SAVE_CONFLICT' as const;
export const CANONICAL_PROGRESSION_ALREADY_ACTIVE = 'CANONICAL_PROGRESSION_ALREADY_ACTIVE' as const;
export const MIGRATION_SOURCE_POLICY_UNKNOWN = 'MIGRATION_SOURCE_POLICY_UNKNOWN' as const;

export const POST_FREEZE_SAVE_WRITE_CLASS = 'POST_FREEZE_SAVE_STILL_MUTABLE' as const;
export const LOCAL_PROGRESSION_AFTER_FREEZE_NOT_CAPTURED = 'LOCAL_PROGRESSION_AFTER_FREEZE_NOT_CAPTURED' as const;
export const CLAIM_AFTER_FREEZE_NOT_CAPTURED = 'CLAIM_AFTER_FREEZE_NOT_CAPTURED' as const;
export const CHOSEN_MIGRATION_CUTOVER_MODEL =
  'MODEL_B_TRANSITIONAL_FREEZE_PUBLIC_REQUIRES_IMMEDIATE_FREEZE_APPLY' as const;
export const LEGACY_SAVE_AUTHORITY_HARDENING_STATUS =
  'LEGACY_SAVE_AUTHORITY_HARDENING_PASS_PARTIAL' as const;
export const LEGACY_MIGRATION_SOURCE_PUBLIC_READINESS =
  'LEGACY_MIGRATION_SOURCE_PUBLIC_CUTOVER_BLOCKED' as const;

export type LegacyMigrationPreviewAuthorityClass = 'MUTABLE_SAVE_PREVIEW' | 'FROZEN_SOURCE_PREVIEW';

export function canonicalProgressionMigrationSourceId(uid: string): string {
  return `progressionMigrationSource:${uid}:v1`;
}

export function canonicalProgressionMigrationSourcePath(uid: string): string {
  return `users/${uid}/${CANONICAL_PROGRESSION_MIGRATION_SOURCE_COLLECTION}/${CANONICAL_PROGRESSION_MIGRATION_SOURCE_DOC_ID}`;
}

export function canonicalProgressionMigrationSourceReceiptPath(uid: string): string {
  return `users/${uid}/${CANONICAL_PROGRESSION_MIGRATION_SOURCE_RECEIPTS_COLLECTION}/${canonicalProgressionMigrationSourceId(uid)}`;
}

export function isSupportedMigrationSourcePolicy(value: unknown): boolean {
  return value === undefined || value === CANONICAL_PROGRESSION_MIGRATION_SOURCE_POLICY_VERSION;
}

/** Rebuild the migration-relevant gameState slice. Unrelated save fields are not restored. */
export function gameStateFromNormalizedMigrationSnapshot(
  snapshot: NormalizedLegacyMigrationSnapshot,
  uid: string,
): Record<string, unknown> {
  const milestones: Record<string, { isClaimed: true }> = {};
  for (const id of snapshot.rewardHistory.milestoneIdsClaimed) milestones[id] = { isClaimed: true };
  const weeklyObjectives: Record<string, { isClaimed: true }> = {};
  for (const claim of snapshot.rewardHistory.weeklyClaims) {
    weeklyObjectives[claim.objectiveId] = { isClaimed: true };
  }
  const rewardReceipts: Record<string, { source: 'FROZEN_MIGRATION_SNAPSHOT' }> = {};
  for (const key of snapshot.rewardHistory.rewardReceiptKeys) {
    rewardReceipts[key] = { source: 'FROZEN_MIGRATION_SNAPSHOT' };
  }
  return {
    version: snapshot.saveVersion,
    ownerUid: uid,
    player: { ...snapshot.player },
    meta: {
      level: snapshot.meta.level,
      xp: snapshot.meta.xp,
      totalXp: snapshot.meta.totalXp,
    },
    missions: { claimedMissionRewardIds: [...snapshot.rewardHistory.claimedMissionRewardIds] },
    retention: { milestones, weeklyObjectives },
    rewardReceipts,
  };
}

export function migrationSourceHashMatches(
  snapshot: NormalizedLegacyMigrationSnapshot,
  storedHash: string,
  sha256Hex: (input: string) => string,
): boolean {
  const recomputed = sha256Hex(migrationNormalizedSnapshotJson(snapshot));
  return recomputed === normalizeMigrationSnapshotHash(storedHash);
}

export type LegacyMigrationPreviewStatus =
  | 'NEW_CANONICAL_ACCOUNT_NO_MIGRATION'
  | 'LEGACY_STRUCTURALLY_VALID_ATTESTED_BASELINE_CANDIDATE'
  | 'LEGACY_STRUCTURALLY_INVALID'
  | 'LEGACY_SAVE_CONFLICT'
  | 'LEGACY_CANONICAL_STATE_CONFLICT'
  | 'LEGACY_REWARD_HISTORY_PARTIAL'
  | 'LEGACY_REWARD_HISTORY_UNVERIFIED'
  | 'ALREADY_MIGRATED';

export function mapLegacyMigrationPreviewStatus(
  evaluation: LegacyProgressionMigrationEvaluation,
): LegacyMigrationPreviewStatus {
  if (evaluation.accountClass === 'ALREADY_MIGRATED') return 'ALREADY_MIGRATED';
  if (evaluation.accountClass === 'NOT_LEGACY_NEW_ACCOUNT') return 'NEW_CANONICAL_ACCOUNT_NO_MIGRATION';
  if (
    evaluation.accountClass === 'ALREADY_CANONICAL_ACTIVE' ||
    evaluation.blockers.includes(MIGRATION_BLOCKED_EXISTING_PROGRESSION_UNSUPPORTED) ||
    evaluation.blockers.includes(MIGRATION_BLOCKED_ACTIVE_CANONICAL_HISTORY)
  ) {
    return 'LEGACY_CANONICAL_STATE_CONFLICT';
  }
  if (evaluation.blockers.includes(MIGRATION_BLOCKED_SAVE_CONFLICT)) return 'LEGACY_SAVE_CONFLICT';
  if (
    evaluation.blockers.includes(LEGACY_PROGRESSION_META_PLAYER_CONFLICT) ||
    evaluation.blockers.includes(MIGRATION_BLOCKED_XP_STRUCTURAL_CONFLICT) ||
    evaluation.blockers.includes(MIGRATION_BLOCKED_REPUTATION_INVALID) ||
    evaluation.blockers.includes(MIGRATION_BLOCKED_REWARD_HISTORY_CONFLICT) ||
    evaluation.accountClass === 'MANUAL_REVIEW_REQUIRED'
  ) {
    return 'LEGACY_STRUCTURALLY_INVALID';
  }
  if (evaluation.applyable) return 'LEGACY_STRUCTURALLY_VALID_ATTESTED_BASELINE_CANDIDATE';
  if (evaluation.structure.rewardHistory === 'STRUCTURALLY_VALID') return 'LEGACY_REWARD_HISTORY_PARTIAL';
  return 'LEGACY_REWARD_HISTORY_UNVERIFIED';
}

// ---------------------------------------------------------------------------
// XP curve: totalXp → level / xp (validation only; totalXp itself is not trusted)
// ---------------------------------------------------------------------------

/** Cumulative XP needed to reach `level` from level 1 with 0 XP. */
export function levelFloorTotalXp(level: number): number {
  let total = 0;
  for (let current = 1; current < level; current += 1) total += calculateXpToNextLevel(current);
  return total;
}

export type DerivedProgressionFromTotalXp =
  | { ok: true; level: number; xp: number; xpToNextLevel: number; levelFloorTotalXp: number }
  | { ok: false; reason: 'TOTAL_XP_INVALID' };

/**
 * Production applyXpToPlayer from (level 1, xp 0, totalXp 0) with non-negative grants keeps
 * xp = totalXp − floor(level) below max level and xp = 0 at max level, so totalXp maps to exactly
 * one (level, xp) pair.
 */
export function deriveProgressionFromTotalXp(totalXp: unknown): DerivedProgressionFromTotalXp {
  if (typeof totalXp !== 'number' || !Number.isFinite(totalXp) || totalXp < 0 || !Number.isInteger(totalXp)) {
    return { ok: false, reason: 'TOTAL_XP_INVALID' };
  }
  let level = 1;
  let floor = 0;
  while (level < levelConfig.maxLevel && totalXp - floor >= calculateXpToNextLevel(level)) {
    floor += calculateXpToNextLevel(level);
    level += 1;
  }
  return {
    ok: true,
    level,
    xp: level >= levelConfig.maxLevel ? 0 : totalXp - floor,
    xpToNextLevel: calculateXpToNextLevel(level),
    levelFloorTotalXp: floor,
  };
}

// ---------------------------------------------------------------------------
// Structural validation (STRUCTURALLY_VALID is never TRUSTED)
// ---------------------------------------------------------------------------

export type LegacyStructuralStatus = 'STRUCTURALLY_VALID' | 'STRUCTURALLY_INVALID';

export type LegacyProgressionValues = {
  level: number;
  xp: number;
  xpToNextLevel: number;
  totalXp: number;
  reputation: number;
};

export type LegacyProgressionStructure = {
  xpStatus: LegacyStructuralStatus;
  reputationStatus: LegacyStructuralStatus;
  xpIssues: string[];
  reputationIssues: string[];
  values: Partial<LegacyProgressionValues>;
  derived: DerivedProgressionFromTotalXp;
};

function rec(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function validateLegacyProgressionStructure(
  player: Record<string, unknown> | null,
  meta: Record<string, unknown> | null = null,
): LegacyProgressionStructure {
  const xpIssues: string[] = [];
  const reputationIssues: string[] = [];
  const p = player ?? {};
  const values: Partial<LegacyProgressionValues> = {};
  const derived = deriveProgressionFromTotalXp(p.totalXp);

  const fields = ['level', 'xp', 'xpToNextLevel', 'totalXp'] as const;
  for (const field of fields) {
    if (p[field] === undefined) xpIssues.push(`${field.toUpperCase()}_MISSING`);
    else if (!finiteNumber(p[field])) xpIssues.push(`${field.toUpperCase()}_NOT_FINITE`);
    else values[field] = p[field] as number;
  }
  const { level, xp, xpToNextLevel, totalXp } = values;
  if (level !== undefined && (!Number.isInteger(level) || level < 1 || level > levelConfig.maxLevel)) {
    xpIssues.push('LEVEL_OUT_OF_RANGE');
  }
  if (p.companyLevel !== undefined && p.companyLevel !== p.level) xpIssues.push('COMPANY_LEVEL_MISMATCH');
  if (xp !== undefined && (xp < 0 || !Number.isInteger(xp))) xpIssues.push('XP_INVALID');
  if (totalXp !== undefined && (totalXp < 0 || !Number.isInteger(totalXp))) xpIssues.push('TOTAL_XP_INVALID');
  const levelValid = level !== undefined && Number.isInteger(level) && level >= 1 && level <= levelConfig.maxLevel;
  if (levelValid && xpToNextLevel !== undefined && xpToNextLevel !== calculateXpToNextLevel(level)) {
    xpIssues.push('XP_TO_NEXT_LEVEL_MISMATCH');
  }
  if (levelValid && totalXp !== undefined && totalXp < levelFloorTotalXp(level) + (xp ?? 0)) {
    // Saves written before totalXp existed load with totalXp = xp (normalizePlayerProgress).
    xpIssues.push('TOTAL_XP_BELOW_LEVEL_FLOOR');
  }
  if (derived.ok && levelValid && xp !== undefined) {
    if (derived.level !== level) xpIssues.push('TOTAL_XP_LEVEL_MISMATCH');
    else if (derived.xp !== xp) xpIssues.push('XP_WITHIN_LEVEL_MISMATCH');
  }
  if (meta) {
    for (const field of ['level', 'xp', 'totalXp'] as const) {
      if (meta[field] !== undefined && meta[field] !== p[field]) xpIssues.push(`META_${field.toUpperCase()}_MISMATCH`);
    }
  }

  if (p.reputation === undefined) reputationIssues.push('REPUTATION_MISSING');
  else if (!finiteNumber(p.reputation)) reputationIssues.push('REPUTATION_NOT_FINITE');
  else if (p.reputation < REPUTATION_MIN || p.reputation > REPUTATION_MAX) reputationIssues.push('REPUTATION_OUT_OF_RANGE');
  else values.reputation = p.reputation;

  const uniqueXpIssues = [...new Set(xpIssues)];
  return {
    xpStatus: uniqueXpIssues.length === 0 ? 'STRUCTURALLY_VALID' : 'STRUCTURALLY_INVALID',
    reputationStatus: reputationIssues.length === 0 ? 'STRUCTURALLY_VALID' : 'STRUCTURALLY_INVALID',
    xpIssues: uniqueXpIssues,
    reputationIssues,
    values,
    derived,
  };
}

// ---------------------------------------------------------------------------
// Legacy reward history (never trusted as proof; used only to consume rewards)
// ---------------------------------------------------------------------------

const MISSION_IDS = new Set(CANONICAL_MISSION_REWARD_CATALOG.map((row) => row.rewardId));
const MILESTONE_IDS = new Set(CANONICAL_MILESTONE_REWARD_CATALOG.map((row) => row.rewardId));
const WEEKLY_CYCLE_ID = /^weekly_\d{4}-W\d{2}$/;
const WEEKLY_OBJECTIVE_ID = /^weekly_(weekly_\d{4}-W\d{2})_(delivery|trade|warehouse|reputation|bonus)$/;

export type LegacyRewardHistory = {
  status: LegacyStructuralStatus;
  issues: string[];
  legacyClaimedMissionIds: string[];
  legacyClaimedMilestoneIds: string[];
  legacyWeeklyClaims: Array<{ cycleId: string; objectiveId: string }>;
  claimedRewardXp: number;
};

function missionXp(id: string): number {
  return CANONICAL_MISSION_REWARD_CATALOG.find((row) => row.rewardId === id)?.xpReward ?? 0;
}
function milestoneXp(id: string): number {
  return CANONICAL_MILESTONE_REWARD_CATALOG.find((row) => row.rewardId === id)?.xpReward ?? 0;
}
function weeklyXp(cycleId: string, objectiveId: string): number {
  return buildCanonicalWeeklyObjectiveCatalog(cycleId).find((row) => row.rewardId === objectiveId)?.xpReward ?? 0;
}

export function classifyLegacyRewardHistory(
  gameState: Record<string, unknown> | null,
  currentCycleId: string,
  legacyTotalXp: number | undefined,
): LegacyRewardHistory {
  const issues: string[] = [];
  const missions = new Set<string>();
  const milestones = new Set<string>();
  const weekly = new Map<string, { cycleId: string; objectiveId: string }>();
  const gs = gameState ?? {};

  const addWeekly = (cycleId: string, objectiveId: string) => {
    const match = WEEKLY_OBJECTIVE_ID.exec(objectiveId);
    if (!WEEKLY_CYCLE_ID.test(cycleId) || !match || match[1] !== cycleId) {
      issues.push('IMPOSSIBLE_WEEKLY_CYCLE');
      return;
    }
    if (cycleId > currentCycleId) {
      issues.push('FUTURE_WEEKLY_CYCLE');
      return;
    }
    if (!buildCanonicalWeeklyObjectiveCatalog(cycleId).some((row) => row.rewardId === objectiveId)) {
      issues.push('UNKNOWN_WEEKLY_OBJECTIVE_ID');
      return;
    }
    weekly.set(`${cycleId}:${objectiveId}`, { cycleId, objectiveId });
  };

  const missionState = gs.missions === undefined ? {} : rec(gs.missions);
  if (!missionState) issues.push('MISSIONS_MALFORMED');
  const claimedList = missionState?.claimedMissionRewardIds;
  if (claimedList !== undefined) {
    if (!Array.isArray(claimedList) || claimedList.some((id) => typeof id !== 'string')) {
      issues.push('MISSION_CLAIMS_MALFORMED');
    } else {
      if (new Set(claimedList).size !== claimedList.length) issues.push('DUPLICATE_MISSION_CLAIM_ID');
      for (const raw of claimedList as string[]) {
        const id = migrateLegacyMissionId(raw);
        if (MISSION_IDS.has(id)) missions.add(id);
        else issues.push('UNKNOWN_MISSION_ID');
      }
    }
  }

  const retention = gs.retention === undefined ? {} : rec(gs.retention);
  if (!retention) issues.push('RETENTION_MALFORMED');
  const milestoneState = retention?.milestones === undefined ? {} : rec(retention?.milestones);
  if (!milestoneState) issues.push('MILESTONES_MALFORMED');
  for (const [id, entry] of Object.entries(milestoneState ?? {})) {
    if (rec(entry)?.isClaimed !== true) continue;
    if (MILESTONE_IDS.has(id)) milestones.add(id);
    else issues.push('UNKNOWN_MILESTONE_ID');
  }
  const seasonKey = retention?.currentWeeklySeasonKey;
  if (typeof seasonKey === 'string' && WEEKLY_CYCLE_ID.test(seasonKey) && seasonKey > currentCycleId) {
    issues.push('FUTURE_WEEKLY_CYCLE');
  }
  const weeklyState = retention?.weeklyObjectives === undefined ? {} : rec(retention?.weeklyObjectives);
  if (!weeklyState) issues.push('WEEKLY_OBJECTIVES_MALFORMED');
  for (const [objectiveId, entry] of Object.entries(weeklyState ?? {})) {
    if (rec(entry)?.isClaimed !== true) continue;
    const match = WEEKLY_OBJECTIVE_ID.exec(objectiveId);
    addWeekly(match ? match[1] : '', objectiveId);
  }

  const receipts = gs.rewardReceipts === undefined ? {} : rec(gs.rewardReceipts);
  if (!receipts) issues.push('REWARD_RECEIPTS_MALFORMED');
  for (const key of Object.keys(receipts ?? {})) {
    const parts = key.split(':');
    if (parts.length === 3 && parts[0] === 'mission' && parts[2] === 'reward') {
      const id = migrateLegacyMissionId(parts[1]);
      if (MISSION_IDS.has(id)) missions.add(id);
      else issues.push('UNKNOWN_MISSION_ID');
    } else if (parts.length === 3 && parts[0] === 'achievement' && parts[2] === 'reward') {
      if (MILESTONE_IDS.has(parts[1])) milestones.add(parts[1]);
      else issues.push('UNKNOWN_MILESTONE_ID');
    } else if (parts.length === 4 && parts[0] === 'weekly' && parts[3] === 'reward') {
      addWeekly(parts[1], parts[2]);
    } else {
      issues.push('UNKNOWN_REWARD_RECEIPT_KEY');
    }
  }

  const claimedRewardXp =
    [...missions].reduce((sum, id) => sum + missionXp(id), 0) +
    [...milestones].reduce((sum, id) => sum + milestoneXp(id), 0) +
    [...weekly.values()].reduce((sum, row) => sum + weeklyXp(row.cycleId, row.objectiveId), 0);
  if (legacyTotalXp !== undefined && claimedRewardXp > legacyTotalXp) issues.push('CLAIMED_REWARD_XP_EXCEEDS_TOTAL_XP');

  const unique = [...new Set(issues)];
  return {
    status: unique.length === 0 ? 'STRUCTURALLY_VALID' : 'STRUCTURALLY_INVALID',
    issues: unique,
    legacyClaimedMissionIds: [...missions].sort(),
    legacyClaimedMilestoneIds: [...milestones].sort(),
    legacyWeeklyClaims: [...weekly.values()].sort((a, b) =>
      `${a.cycleId}:${a.objectiveId}`.localeCompare(`${b.cycleId}:${b.objectiveId}`),
    ),
    claimedRewardXp,
  };
}

// ---------------------------------------------------------------------------
// Source save (INTEGRITY != AUTHORITY)
// ---------------------------------------------------------------------------

export type CloudSaveIntegrityStatus = 'PAYLOAD_CHECKSUM_VALID' | 'PAYLOAD_CHECKSUM_MISSING' | 'PAYLOAD_CHECKSUM_MISMATCH';

export type LegacySourceSave = {
  provenance: 'CLIENT_AUTHORED_CLOUD_SAVE';
  path: string;
  docSchemaVersion: number | null;
  sourceSaveVersion: number | null;
  sourceSyncId: string | null;
  sourceDeviceUpdatedAt: number | null;
  sourceSnapshotHash: string | null;
  hashAlgorithm: typeof LEGACY_PROGRESSION_MIGRATION_SOURCE_HASH_ALGORITHM;
  integrityStatus: CloudSaveIntegrityStatus;
};

// ---------------------------------------------------------------------------
// Account classification
// ---------------------------------------------------------------------------

export type LegacyAccountMigrationClass =
  | 'VERIFIED_MIGRATABLE'
  | 'PARTIALLY_ATTESTABLE'
  | 'CUTOVER_WITH_RESET_REQUIRED'
  | 'MANUAL_REVIEW_REQUIRED'
  | 'UNSUPPORTED'
  | 'NOT_LEGACY_NEW_ACCOUNT'
  | 'ALREADY_CANONICAL_ACTIVE'
  | 'ALREADY_MIGRATED';

export const APPLYABLE_LEGACY_ACCOUNT_CLASSES: readonly LegacyAccountMigrationClass[] = [
  'VERIFIED_MIGRATABLE',
  'PARTIALLY_ATTESTABLE',
];

export type LegacyRewardHistoryTreatment = {
  policy: typeof LEGACY_REWARD_HISTORY_POLICY;
  legacyConsumedRewardIds: string[];
  cashHistoryBlockedRewardIds: string[];
  trustedCanonicalClaimIds: string[];
  unclaimedOneTimeRewardCount: number;
  legacyWeeklyClaimsIgnored: number;
};

export type LegacyWeeklyCutover = {
  policy: typeof LEGACY_WEEKLY_CUTOVER_POLICY;
  cutoverCycleId: string;
  firstCanonicalCycleId: string;
};

export type LegacyProgressionMigrationInput = {
  uid: string;
  nowMs: number;
  progressionDoc: Record<string, unknown> | null;
  migrationRecordDoc: Record<string, unknown> | null;
  saveDoc: Record<string, unknown> | null;
  serverStateDoc: Record<string, unknown> | null;
  /** 64-char hex of sha256(migrationNormalizedSnapshotJson(...)). */
  serverMigrationSnapshotHash: string | null;
  /** 64-char hex of sha256(cloudSaveSnapshotHashInput(gameState)) for payloadChecksum parity. */
  serverFullPayloadHash: string | null;
  trustedCanonicalClaimIds: readonly string[];
  /** Non-empty when canonical progression receipts exist besides the migration baseline slot. */
  activeCanonicalGameplayReceiptCount?: number;
};

export type LegacyProgressionMigrationEvaluation = {
  policyVersion: typeof CANONICAL_PROGRESSION_MIGRATION_POLICY_VERSION;
  accountClass: LegacyAccountMigrationClass;
  applyable: boolean;
  attestationClass: CanonicalProgressionBaselineAttestationClass | null;
  blockers: string[];
  acceptedBecause: string[];
  flags: string[];
  source: LegacySourceSave | null;
  structure: {
    xp: LegacyStructuralStatus | 'NOT_EVALUATED';
    reputation: LegacyStructuralStatus | 'NOT_EVALUATED';
    rewardHistory: LegacyStructuralStatus | 'NOT_EVALUATED';
    xpIssues: string[];
    reputationIssues: string[];
    rewardHistoryIssues: string[];
  };
  legacyValues: Partial<LegacyProgressionValues> | null;
  proposedBaseline: LegacyProgressionValues | null;
  rewardHistoryTreatment: LegacyRewardHistoryTreatment | null;
  weeklyCutover: LegacyWeeklyCutover;
  trustedEvidence: {
    canonicalRewardClaimIds: string[];
    historicalXpReconstructable: false;
    historicalReputationReconstructable: false;
    legacyRewardHistoryReconstructable: false;
  };
};

/** 29W rewards that carry internal canonical cash; their legacy cash history cannot be proven. */
const CASH_BEARING_REWARD_IDS = [
  ...CANONICAL_MISSION_REWARD_CATALOG.filter((row) => row.cashAuthority === 'CANONICAL_29W_INTERNAL').map(
    (row) => `mission:${row.rewardId}`,
  ),
  ...CANONICAL_MILESTONE_REWARD_CATALOG.filter((row) => row.cashAuthority === 'CANONICAL_29W_INTERNAL').map(
    (row) => `milestone:${row.rewardId}`,
  ),
];

function trustedClaimRewardKey(claimId: string): string | null {
  if (claimId.startsWith('reward:mission:')) return `mission:${claimId.slice('reward:mission:'.length)}`;
  if (claimId.startsWith('reward:milestone:')) return `milestone:${claimId.slice('reward:milestone:'.length)}`;
  return null;
}

export function resolveLegacyWeeklyCutover(nowMs: number): LegacyWeeklyCutover {
  const cycle = resolveCanonicalWeeklyCycle(nowMs);
  return {
    policy: LEGACY_WEEKLY_CUTOVER_POLICY,
    cutoverCycleId: cycle.cycleId,
    firstCanonicalCycleId: resolveCanonicalWeeklyCycle(cycle.endMs).cycleId,
  };
}

export type CanonicalProgressionMigrationRecordClassification =
  | { kind: 'NONE' }
  | { kind: 'MIGRATED'; record: CanonicalProgressionMigrationRecord }
  | { kind: 'POLICY_UNKNOWN' }
  | { kind: 'INVALID' };

export function classifyCanonicalProgressionMigrationRecord(
  data: Record<string, unknown> | null | undefined,
  uid: string,
): CanonicalProgressionMigrationRecordClassification {
  if (data == null) return { kind: 'NONE' };
  if (data.policyVersion !== CANONICAL_PROGRESSION_MIGRATION_POLICY_VERSION) return { kind: 'POLICY_UNKNOWN' };
  const history = rec(data.rewardHistory);
  const weekly = rec(data.weeklyCutover);
  const valid =
    data.schemaVersion === CANONICAL_PROGRESSION_MIGRATION_SCHEMA_VERSION &&
    data.ownerUid === uid &&
    data.migrationId === canonicalProgressionMigrationId(uid) &&
    data.migrationStatus === 'MIGRATED' &&
    history !== null &&
    Array.isArray(history.legacyConsumedRewardIds) &&
    Array.isArray(history.cashHistoryBlockedRewardIds) &&
    weekly !== null &&
    typeof weekly.cutoverCycleId === 'string';
  return valid ? { kind: 'MIGRATED', record: data as unknown as CanonicalProgressionMigrationRecord } : { kind: 'INVALID' };
}

function serverStateUsed(serverState: Record<string, unknown> | null): boolean {
  if (!serverState) return false;
  return (
    serverState.migrationSource !== 'default' ||
    Number(serverState.completedDeliveries ?? 0) > 0 ||
    Number(serverState.failedDeliveries ?? 0) > 0 ||
    Number(serverState.lateDeliveries ?? 0) > 0
  );
}

export function evaluateLegacyProgressionMigration(
  input: LegacyProgressionMigrationInput,
): LegacyProgressionMigrationEvaluation {
  const weeklyCutover = resolveLegacyWeeklyCutover(input.nowMs);
  const trustedIds = [...input.trustedCanonicalClaimIds].sort();
  const result: LegacyProgressionMigrationEvaluation = {
    policyVersion: CANONICAL_PROGRESSION_MIGRATION_POLICY_VERSION,
    accountClass: 'UNSUPPORTED',
    applyable: false,
    attestationClass: null,
    blockers: [],
    acceptedBecause: [],
    flags: [],
    source: null,
    structure: {
      xp: 'NOT_EVALUATED',
      reputation: 'NOT_EVALUATED',
      rewardHistory: 'NOT_EVALUATED',
      xpIssues: [],
      reputationIssues: [],
      rewardHistoryIssues: [],
    },
    legacyValues: null,
    proposedBaseline: null,
    rewardHistoryTreatment: null,
    weeklyCutover,
    trustedEvidence: {
      canonicalRewardClaimIds: trustedIds,
      historicalXpReconstructable: false,
      historicalReputationReconstructable: false,
      legacyRewardHistoryReconstructable: false,
    },
  };
  const done = (accountClass: LegacyAccountMigrationClass, blocker?: string) => {
    result.accountClass = accountClass;
    if (blocker) result.blockers.push(blocker);
    result.applyable = APPLYABLE_LEGACY_ACCOUNT_CLASSES.includes(accountClass) && result.blockers.length === 0;
    return result;
  };

  const record = classifyCanonicalProgressionMigrationRecord(input.migrationRecordDoc, input.uid);
  if (record.kind === 'POLICY_UNKNOWN') return done('UNSUPPORTED', MIGRATION_POLICY_UNKNOWN);
  if (record.kind === 'INVALID') return done('MANUAL_REVIEW_REQUIRED', MIGRATION_RECORD_INCONSISTENT);

  if (input.progressionDoc) {
    const classified = classifyCanonicalCompanyProgression(input.progressionDoc, input.uid);
    if (classified.authorityClass === 'SERVER_CANONICAL_PROGRESSION') {
      if (classified.state.initializationSource === 'LEGACY_MIGRATION_BASELINE') {
        if (record.kind !== 'MIGRATED') return done('MANUAL_REVIEW_REQUIRED', MIGRATION_RECORD_INCONSISTENT);
        result.attestationClass = record.record.attestationClass;
        return done('ALREADY_MIGRATED', MIGRATION_ALREADY_MIGRATED);
      }
      if (record.kind === 'MIGRATED') return done('MANUAL_REVIEW_REQUIRED', MIGRATION_RECORD_INCONSISTENT);
      return done('ALREADY_CANONICAL_ACTIVE', MIGRATION_ALREADY_CANONICAL_ACTIVE);
    }
    if (classified.authorityClass === 'INTERNAL_TEST_PROGRESSION_FIXTURE') {
      return done('UNSUPPORTED', MIGRATION_BLOCKED_INTERNAL_FIXTURE);
    }
    if (classified.authorityClass === 'LEGACY_CLIENT_UNVERIFIED') {
      return done('MANUAL_REVIEW_REQUIRED', MIGRATION_BLOCKED_EXISTING_PROGRESSION_UNSUPPORTED);
    }
    return done('UNSUPPORTED', MIGRATION_BLOCKED_EXISTING_PROGRESSION_UNSUPPORTED);
  }
  if (record.kind === 'MIGRATED') return done('MANUAL_REVIEW_REQUIRED', MIGRATION_RECORD_INCONSISTENT);

  if ((input.activeCanonicalGameplayReceiptCount ?? 0) > 0) {
    return done('MANUAL_REVIEW_REQUIRED', MIGRATION_BLOCKED_ACTIVE_CANONICAL_HISTORY);
  }

  if (!input.saveDoc) {
    if (serverStateUsed(input.serverStateDoc)) return done('CUTOVER_WITH_RESET_REQUIRED', MIGRATION_BLOCKED_NO_SOURCE_SAVE);
    return done('NOT_LEGACY_NEW_ACCOUNT', MIGRATION_NOT_REQUIRED_NEW_ACCOUNT);
  }

  const doc = input.saveDoc;
  const gameState = rec(doc.gameState);
  const docSchema = finiteNumber(doc.schemaVersion) ? doc.schemaVersion : null;
  const gsVersion = gameState && finiteNumber(gameState.version) ? gameState.version : null;
  const checksum = typeof doc.payloadChecksum === 'string' ? doc.payloadChecksum : null;
  result.source = {
    provenance: 'CLIENT_AUTHORED_CLOUD_SAVE',
    path: `users/${input.uid}/saves/current`,
    docSchemaVersion: docSchema,
    sourceSaveVersion: gsVersion,
    sourceSyncId: typeof doc.syncId === 'string' ? doc.syncId : null,
    sourceDeviceUpdatedAt: finiteNumber(doc.deviceUpdatedAt) ? doc.deviceUpdatedAt : null,
    sourceSnapshotHash: gameState && input.serverMigrationSnapshotHash
      ? formatMigrationSnapshotHash(input.serverMigrationSnapshotHash)
      : null,
    hashAlgorithm: LEGACY_PROGRESSION_MIGRATION_SOURCE_HASH_ALGORITHM,
    integrityStatus:
      checksum === null
        ? 'PAYLOAD_CHECKSUM_MISSING'
        : checksum === input.serverFullPayloadHash
          ? 'PAYLOAD_CHECKSUM_VALID'
          : 'PAYLOAD_CHECKSUM_MISMATCH',
  };

  const ownerMismatch =
    (typeof doc.ownerUid === 'string' && doc.ownerUid !== input.uid) ||
    (gameState !== null && typeof gameState.ownerUid === 'string' && gameState.ownerUid !== input.uid);
  if (ownerMismatch) return done('MANUAL_REVIEW_REQUIRED', MIGRATION_BLOCKED_SAVE_OWNER_MISMATCH);
  if (!gameState || !input.serverMigrationSnapshotHash) {
    return done('CUTOVER_WITH_RESET_REQUIRED', MIGRATION_BLOCKED_SAVE_BODY_MISSING);
  }
  if (docSchema !== null && docSchema !== LEGACY_PROGRESSION_MIGRATION_SUPPORTED_CLOUD_DOC_SCHEMA) {
    return done('UNSUPPORTED', MIGRATION_BLOCKED_SAVE_SCHEMA_UNSUPPORTED);
  }
  if (gsVersion === null || !Number.isInteger(gsVersion)) return done('UNSUPPORTED', MIGRATION_BLOCKED_SAVE_SCHEMA_UNSUPPORTED);
  if (finiteNumber(doc.saveVersion) && doc.saveVersion !== gsVersion) {
    return done('UNSUPPORTED', MIGRATION_BLOCKED_SAVE_SCHEMA_UNSUPPORTED);
  }
  if (gsVersion > LEGACY_PROGRESSION_MIGRATION_SUPPORTED_SAVE_VERSION) return done('UNSUPPORTED', MIGRATION_BLOCKED_SAVE_VERSION_FUTURE);
  if (gsVersion < LEGACY_PROGRESSION_MIGRATION_SUPPORTED_SAVE_VERSION) return done('UNSUPPORTED', MIGRATION_BLOCKED_SAVE_VERSION_STALE);
  if (result.source.integrityStatus === 'PAYLOAD_CHECKSUM_MISMATCH') {
    return done('MANUAL_REVIEW_REQUIRED', MIGRATION_BLOCKED_SAVE_INTEGRITY);
  }
  if (result.source.integrityStatus === 'PAYLOAD_CHECKSUM_MISSING') result.flags.push('SOURCE_PAYLOAD_CHECKSUM_MISSING');

  const structure = validateLegacyProgressionStructure(rec(gameState.player), rec(gameState.meta));
  const history = classifyLegacyRewardHistory(gameState, weeklyCutover.cutoverCycleId, structure.values.totalXp);
  result.structure = {
    xp: structure.xpStatus,
    reputation: structure.reputationStatus,
    rewardHistory: history.status,
    xpIssues: structure.xpIssues,
    reputationIssues: structure.reputationIssues,
    rewardHistoryIssues: history.issues,
  };
  result.legacyValues = structure.values;
  const metaPlayerConflict = structure.xpIssues.some((issue) => issue.startsWith('META_'));
  if (metaPlayerConflict) result.blockers.push(LEGACY_PROGRESSION_META_PLAYER_CONFLICT);
  if (structure.xpStatus === 'STRUCTURALLY_INVALID' && !metaPlayerConflict) {
    result.blockers.push(MIGRATION_BLOCKED_XP_STRUCTURAL_CONFLICT);
  }
  if (structure.reputationStatus === 'STRUCTURALLY_INVALID') result.blockers.push(MIGRATION_BLOCKED_REPUTATION_INVALID);
  if (history.status === 'STRUCTURALLY_INVALID') result.blockers.push(MIGRATION_BLOCKED_REWARD_HISTORY_CONFLICT);
  if (result.blockers.length > 0 || !structure.derived.ok) return done('MANUAL_REVIEW_REQUIRED');

  const values = structure.values as LegacyProgressionValues;
  result.proposedBaseline = {
    level: structure.derived.level,
    xp: structure.derived.xp,
    xpToNextLevel: structure.derived.xpToNextLevel,
    totalXp: values.totalXp,
    reputation: values.reputation,
  };
  const trustedKeys = new Set(trustedIds.map(trustedClaimRewardKey).filter((key): key is string => key !== null));
  const consumed = [
    ...history.legacyClaimedMissionIds.map((id) => `mission:${id}`),
    ...history.legacyClaimedMilestoneIds.map((id) => `milestone:${id}`),
  ].sort();
  const oneTimeTotal = CANONICAL_MISSION_REWARD_CATALOG.length + CANONICAL_MILESTONE_REWARD_CATALOG.length;
  result.rewardHistoryTreatment = {
    policy: LEGACY_REWARD_HISTORY_POLICY,
    legacyConsumedRewardIds: consumed,
    cashHistoryBlockedRewardIds: CASH_BEARING_REWARD_IDS.filter((key) => !trustedKeys.has(key)).sort(),
    trustedCanonicalClaimIds: trustedIds,
    unclaimedOneTimeRewardCount: oneTimeTotal - new Set([...consumed, ...trustedKeys]).size,
    legacyWeeklyClaimsIgnored: history.legacyWeeklyClaims.length,
  };

  const defaultsEquivalent =
    values.totalXp === 0 &&
    values.reputation === reputationBalance.initial &&
    consumed.length === 0 &&
    history.legacyWeeklyClaims.length === 0;
  if (defaultsEquivalent) {
    result.attestationClass = 'NEW_ACCOUNT_DEFAULTS_EQUIVALENT';
    result.acceptedBecause.push('LEGACY_SAVE_EQUALS_NEW_ACCOUNT_DEFAULTS', 'NO_LEGACY_REWARD_CLAIMS');
    return done('VERIFIED_MIGRATABLE');
  }
  result.attestationClass = 'SERVER_ATTESTED_LEGACY_BASELINE';
  result.acceptedBecause.push(
    'SOURCE_SAVE_OWNER_MATCH',
    'SOURCE_SAVE_VERSION_6',
    'SERVER_SNAPSHOT_HASH_PINNED',
    'XP_CURVE_STRUCTURALLY_VALID',
    'REPUTATION_IN_RANGE',
    'REWARD_HISTORY_STRUCTURALLY_VALID',
  );
  return done('PARTIALLY_ATTESTABLE');
}

// ---------------------------------------------------------------------------
// Migration artifacts (one transaction, create-only)
// ---------------------------------------------------------------------------

export type CanonicalProgressionMigrationRecord = {
  schemaVersion: typeof CANONICAL_PROGRESSION_MIGRATION_SCHEMA_VERSION;
  policyVersion: typeof CANONICAL_PROGRESSION_MIGRATION_POLICY_VERSION;
  migrationId: string;
  ownerUid: string;
  migrationStatus: 'MIGRATED';
  accountClass: LegacyAccountMigrationClass;
  attestationClass: CanonicalProgressionBaselineAttestationClass;
  acceptedBecause: string[];
  flags: string[];
  source: LegacySourceSave;
  legacyValues: LegacyProgressionValues;
  structure: LegacyProgressionMigrationEvaluation['structure'];
  baseline: LegacyProgressionValues;
  rewardHistory: LegacyRewardHistoryTreatment;
  weeklyCutover: LegacyWeeklyCutover;
  cashEffect: 'NONE';
  rewardPayout: 'NONE';
  historicalReceiptsFabricated: false;
  cutoverAtServerMs: number;
  migrationRevision: 1;
};

export type CanonicalProgressionMigrationReceipt = {
  schemaVersion: typeof CANONICAL_PROGRESSION_MIGRATION_SCHEMA_VERSION;
  policyVersion: typeof CANONICAL_PROGRESSION_MIGRATION_POLICY_VERSION;
  migrationId: string;
  ownerUid: string;
  attestationClass: CanonicalProgressionBaselineAttestationClass;
  source: LegacySourceSave;
  beforeCanonicalState: null;
  afterCanonicalState: Pick<
    CanonicalCompanyProgressionState,
    'level' | 'xp' | 'xpToNextLevel' | 'totalXp' | 'reputation' | 'progressionRevision'
  >;
  rewardHistoryPolicy: typeof LEGACY_REWARD_HISTORY_POLICY;
  weeklyCutover: LegacyWeeklyCutover;
  cashEffect: 'NONE';
  createdAtMs: number;
};

export type CanonicalProgressionMigrationBaselineReceipt = {
  schemaVersion: typeof CANONICAL_PROGRESSION_RECEIPT_SCHEMA_VERSION;
  operationId: typeof PROGRESSION_MIGRATION_OPERATION_ID;
  sourceType: 'LEGACY_PROGRESSION_MIGRATION_BASELINE';
  sourceId: string;
  xpAuthority: 'LEGACY_BASELINE_ATTESTED_NOT_EARNED';
  attestationClass: CanonicalProgressionBaselineAttestationClass;
  baselineTotalXp: number;
  baselineReputation: number;
  levelAfter: number;
  xpAfter: number;
  progressionRevisionAfter: 1;
  sourceSnapshotHash: string;
  sourceSaveVersion: number;
  migrationPolicyVersion: typeof CANONICAL_PROGRESSION_MIGRATION_POLICY_VERSION;
  policyVersion: typeof CANONICAL_COMPANY_PROGRESSION_POLICY_VERSION;
  createdAtMs: number;
};

export type CanonicalProgressionMigrationArtifacts = {
  state: CanonicalCompanyProgressionState;
  record: CanonicalProgressionMigrationRecord;
  receipt: CanonicalProgressionMigrationReceipt;
  baselineReceipt: CanonicalProgressionMigrationBaselineReceipt;
};

export function buildCanonicalProgressionMigrationArtifacts(
  evaluation: LegacyProgressionMigrationEvaluation,
  uid: string,
  nowMs: number,
): CanonicalProgressionMigrationArtifacts | null {
  if (
    !evaluation.applyable ||
    !evaluation.attestationClass ||
    !evaluation.source?.sourceSnapshotHash ||
    evaluation.source.sourceSaveVersion === null ||
    !evaluation.proposedBaseline ||
    !evaluation.rewardHistoryTreatment ||
    !evaluation.legacyValues
  ) {
    return null;
  }
  const migrationId = canonicalProgressionMigrationId(uid);
  const baseline = evaluation.proposedBaseline;
  const state: CanonicalCompanyProgressionState = {
    schemaVersion: CANONICAL_COMPANY_PROGRESSION_SCHEMA_VERSION,
    progressionPolicyVersion: CANONICAL_COMPANY_PROGRESSION_POLICY_VERSION,
    reputationPolicyVersion: CANONICAL_ROAD_REPUTATION_POLICY_VERSION,
    authorityClass: 'SERVER_CANONICAL_PROGRESSION',
    ownerUid: uid,
    level: baseline.level,
    xp: baseline.xp,
    xpToNextLevel: baseline.xpToNextLevel,
    totalXp: baseline.totalXp,
    reputation: baseline.reputation,
    progressionRevision: 1,
    initializationSource: 'LEGACY_MIGRATION_BASELINE',
    baselineProvenance: {
      attestationClass: evaluation.attestationClass,
      migrationPolicyVersion: CANONICAL_PROGRESSION_MIGRATION_POLICY_VERSION,
      migrationId,
      baselineTotalXp: baseline.totalXp,
      baselineReputation: baseline.reputation,
      sourceSnapshotHash: evaluation.source.sourceSnapshotHash,
      cutoverAtMs: nowMs,
    },
    initializedAtMs: nowMs,
    updatedAtMs: nowMs,
  };
  const record: CanonicalProgressionMigrationRecord = {
    schemaVersion: CANONICAL_PROGRESSION_MIGRATION_SCHEMA_VERSION,
    policyVersion: CANONICAL_PROGRESSION_MIGRATION_POLICY_VERSION,
    migrationId,
    ownerUid: uid,
    migrationStatus: 'MIGRATED',
    accountClass: evaluation.accountClass,
    attestationClass: evaluation.attestationClass,
    acceptedBecause: evaluation.acceptedBecause,
    flags: evaluation.flags,
    source: evaluation.source,
    legacyValues: evaluation.legacyValues as LegacyProgressionValues,
    structure: evaluation.structure,
    baseline,
    rewardHistory: evaluation.rewardHistoryTreatment,
    weeklyCutover: evaluation.weeklyCutover,
    cashEffect: 'NONE',
    rewardPayout: 'NONE',
    historicalReceiptsFabricated: false,
    cutoverAtServerMs: nowMs,
    migrationRevision: 1,
  };
  const receipt: CanonicalProgressionMigrationReceipt = {
    schemaVersion: CANONICAL_PROGRESSION_MIGRATION_SCHEMA_VERSION,
    policyVersion: CANONICAL_PROGRESSION_MIGRATION_POLICY_VERSION,
    migrationId,
    ownerUid: uid,
    attestationClass: evaluation.attestationClass,
    source: evaluation.source,
    beforeCanonicalState: null,
    afterCanonicalState: {
      level: state.level,
      xp: state.xp,
      xpToNextLevel: state.xpToNextLevel,
      totalXp: state.totalXp,
      reputation: state.reputation,
      progressionRevision: state.progressionRevision,
    },
    rewardHistoryPolicy: LEGACY_REWARD_HISTORY_POLICY,
    weeklyCutover: evaluation.weeklyCutover,
    cashEffect: 'NONE',
    createdAtMs: nowMs,
  };
  const baselineReceipt: CanonicalProgressionMigrationBaselineReceipt = {
    schemaVersion: CANONICAL_PROGRESSION_RECEIPT_SCHEMA_VERSION,
    operationId: PROGRESSION_MIGRATION_OPERATION_ID,
    sourceType: 'LEGACY_PROGRESSION_MIGRATION_BASELINE',
    sourceId: migrationId,
    xpAuthority: 'LEGACY_BASELINE_ATTESTED_NOT_EARNED',
    attestationClass: evaluation.attestationClass,
    baselineTotalXp: baseline.totalXp,
    baselineReputation: baseline.reputation,
    levelAfter: state.level,
    xpAfter: state.xp,
    progressionRevisionAfter: 1,
    sourceSnapshotHash: evaluation.source.sourceSnapshotHash,
    sourceSaveVersion: evaluation.source.sourceSaveVersion,
    migrationPolicyVersion: CANONICAL_PROGRESSION_MIGRATION_POLICY_VERSION,
    policyVersion: CANONICAL_COMPANY_PROGRESSION_POLICY_VERSION,
    createdAtMs: nowMs,
  };
  return { state, record, receipt, baselineReceipt };
}

// ---------------------------------------------------------------------------
// 29AI claim treatment for migrated accounts
// ---------------------------------------------------------------------------

/**
 * Legacy claimed one-time rewards are consumed (their XP is inside the baseline). The two 29W cash
 * rewards are blocked because legacy cash history cannot be proven. The cutover week is closed.
 * Unclaimed rewards stay claimable through normal 29AI trusted-progress rules.
 */
export function resolveMigratedClientRewardTreatment(
  record: CanonicalProgressionMigrationRecord,
  def: Pick<CanonicalClientRewardDefinition, 'family' | 'rewardId' | 'cycleId'>,
): string | null {
  if (def.family === 'WEEKLY_OBJECTIVE') {
    return def.cycleId !== null && def.cycleId <= record.weeklyCutover.cutoverCycleId
      ? CLIENT_REWARD_MIGRATION_CUTOVER_WEEK_CLOSED
      : null;
  }
  const key = `${def.family === 'MISSION' ? 'mission' : 'milestone'}:${def.rewardId}`;
  if (record.rewardHistory.legacyConsumedRewardIds.includes(key)) return CLIENT_REWARD_LEGACY_CLAIM_CONSUMED_BY_MIGRATION;
  if (record.rewardHistory.cashHistoryBlockedRewardIds.includes(key)) return CLIENT_REWARD_LEGACY_CASH_HISTORY_UNVERIFIED;
  return null;
}

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

export type LegacyProgressionMigrationReadiness =
  | 'LEGACY_PROGRESSION_MIGRATION_FULLY_RECONSTRUCTABLE'
  | 'LEGACY_PROGRESSION_MIGRATION_ATTESTED_BASELINE'
  | 'LEGACY_PROGRESSION_MIGRATION_PARTIAL'
  | 'LEGACY_PROGRESSION_MIGRATION_RESET_REQUIRED'
  | 'LEGACY_PROGRESSION_MIGRATION_BLOCKED_CONFLICT'
  | 'LEGACY_PROGRESSION_MIGRATION_UNSUPPORTED';

export type LegacyProgressionMigrationReadinessFacts = {
  sourceSchemaSupported: boolean;
  serverVisibleConflictsHandled: boolean;
  historicalXpReconstructable: boolean;
  historicalReputationReconstructable: boolean;
  attestedBaselineImplemented: boolean;
  anyLegacyValuePreservable: boolean;
};

export function classifyLegacyProgressionMigrationReadiness(
  facts: LegacyProgressionMigrationReadinessFacts,
): LegacyProgressionMigrationReadiness {
  if (!facts.sourceSchemaSupported) return 'LEGACY_PROGRESSION_MIGRATION_UNSUPPORTED';
  if (!facts.serverVisibleConflictsHandled) return 'LEGACY_PROGRESSION_MIGRATION_BLOCKED_CONFLICT';
  if (facts.historicalXpReconstructable && facts.historicalReputationReconstructable) {
    return 'LEGACY_PROGRESSION_MIGRATION_FULLY_RECONSTRUCTABLE';
  }
  if (facts.attestedBaselineImplemented) return 'LEGACY_PROGRESSION_MIGRATION_ATTESTED_BASELINE';
  if (facts.historicalXpReconstructable || facts.historicalReputationReconstructable) {
    return 'LEGACY_PROGRESSION_MIGRATION_PARTIAL';
  }
  return facts.anyLegacyValuePreservable
    ? 'LEGACY_PROGRESSION_MIGRATION_PARTIAL'
    : 'LEGACY_PROGRESSION_MIGRATION_RESET_REQUIRED';
}

export const CURRENT_LEGACY_PROGRESSION_MIGRATION_FACTS: LegacyProgressionMigrationReadinessFacts = {
  sourceSchemaSupported: true,
  serverVisibleConflictsHandled: true,
  historicalXpReconstructable: false,
  historicalReputationReconstructable: false,
  attestedBaselineImplemented: true,
  anyLegacyValuePreservable: true,
};

export const LEGACY_PROGRESSION_MIGRATION_READINESS = classifyLegacyProgressionMigrationReadiness(
  CURRENT_LEGACY_PROGRESSION_MIGRATION_FACTS,
);

export type LegacyRewardHistoryMigrationReadiness =
  | 'LEGACY_REWARD_HISTORY_VERIFIABLE'
  | 'LEGACY_REWARD_HISTORY_PARTIAL'
  | 'LEGACY_REWARD_HISTORY_GRANDFATHER_REQUIRED'
  | 'LEGACY_REWARD_HISTORY_RESET_REQUIRED'
  | 'LEGACY_REWARD_HISTORY_UNSUPPORTED';

export type LegacyRewardHistoryReadinessFacts = {
  historySchemaParseable: boolean;
  localClaimsServerVerifiable: boolean;
  grandfatherPolicyDefined: boolean;
  serverClaimsTrusted: boolean;
};

export function classifyLegacyRewardHistoryMigrationReadiness(
  facts: LegacyRewardHistoryReadinessFacts,
): LegacyRewardHistoryMigrationReadiness {
  if (!facts.historySchemaParseable) return 'LEGACY_REWARD_HISTORY_UNSUPPORTED';
  if (facts.localClaimsServerVerifiable) return 'LEGACY_REWARD_HISTORY_VERIFIABLE';
  if (facts.grandfatherPolicyDefined) return 'LEGACY_REWARD_HISTORY_GRANDFATHER_REQUIRED';
  if (facts.serverClaimsTrusted) return 'LEGACY_REWARD_HISTORY_PARTIAL';
  return 'LEGACY_REWARD_HISTORY_RESET_REQUIRED';
}

export const CURRENT_LEGACY_REWARD_HISTORY_FACTS: LegacyRewardHistoryReadinessFacts = {
  historySchemaParseable: true,
  localClaimsServerVerifiable: false,
  grandfatherPolicyDefined: true,
  serverClaimsTrusted: true,
};

export const LEGACY_REWARD_HISTORY_MIGRATION_READINESS = classifyLegacyRewardHistoryMigrationReadiness(
  CURRENT_LEGACY_REWARD_HISTORY_FACTS,
);

/** Section 118 criteria. Any unmet criterion keeps the migration internal / design-only. */
export const LEGACY_MIGRATION_PUBLIC_READY_CRITERIA: ReadonlyArray<{ id: string; met: boolean; note: string }> = [
  { id: 'SOURCE_SAVE_PROVENANCE_DEFINED', met: true, note: 'CLIENT_AUTHORED_CLOUD_SAVE pinned by server sha256' },
  { id: 'CONFLICTING_SAVES_HANDLED', met: false, note: 'server sees one LWW doc; device-local divergence relies on the client resolver and a migration UI that does not exist' },
  { id: 'BASELINE_NOT_CLIENT_FORGEABLE', met: false, note: 'the owner can write any structurally valid save before the first migration' },
  { id: 'REWARD_DUPLICATE_PREVENTION', met: true, note: 'legacy claims consumed; canonical claims preserved; 29W cash rewards blocked' },
  { id: 'EXISTING_CANONICAL_CLAIMS_PRESERVED', met: true, note: 'canonicalRewardClaims are never written by migration' },
  { id: 'CURRENT_WEEKLY_CUTOVER_DEFINED', met: true, note: LEGACY_WEEKLY_CUTOVER_POLICY },
  { id: 'MIGRATION_EXACTLY_ONCE', met: true, note: 'deterministic id, create-only in one transaction' },
  { id: 'NO_OVERWRITE_OF_CANONICAL_PROGRESSION', met: true, note: 'any existing progression doc blocks migration' },
  { id: 'NO_CASH_OR_REWARD_DUPLICATION', met: true, note: 'migration writes no cash and pays no reward' },
  { id: 'STABLE_TRUSTED_STARTING_STATE', met: false, note: 'baseline is attested (pinned + structural), not server-earned' },
];

export const LEGACY_MIGRATION_PUBLIC_READY = LEGACY_MIGRATION_PUBLIC_READY_CRITERIA.every((row) => row.met);

// ---------------------------------------------------------------------------
// Audit tables (no UNKNOWN rows)
// ---------------------------------------------------------------------------

export type LegacyMigrationClass =
  | 'DERIVED_FROM_BASELINE_TOTAL_XP'
  | 'GRANDFATHERED_BASELINE_ATTESTED'
  | 'STRUCTURAL_CHECK_ONLY'
  | 'LEGACY_CLAIM_CONSUMPTION_ONLY'
  | 'WEEKLY_CUTOVER_CLOSED'
  | 'DISCARDED_NOT_EVIDENCE'
  | 'SERVER_MIRROR_OF_CLIENT_VALUE'
  | 'TRUSTED_CANONICAL_PRESERVED'
  | 'NOT_PROGRESSION_XP';

export type LegacyProgressionStorageAuditRow = {
  field: string;
  path: string;
  sourceOfTruthToday: string;
  clientWritable: boolean;
  cloudSaved: boolean;
  serverMirror: string;
  historical: boolean;
  recomputable: string;
  verifiable: boolean;
  migrationClass: LegacyMigrationClass;
};

const SAVE = 'users/{uid}/saves/current gameState';

export const LEGACY_PROGRESSION_STORAGE_AUDIT: readonly LegacyProgressionStorageAuditRow[] = [
  { field: 'player.level', path: `${SAVE}.player.level`, sourceOfTruthToday: 'device save (AsyncStorage) → LWW cloud blob', clientWritable: true, cloudSaved: true, serverMirror: 'serverState.companyLevel (bounded one-time copy of the save); users/{uid}.level (client profile)', historical: false, recomputable: 'from totalXp via the production curve', verifiable: false, migrationClass: 'DERIVED_FROM_BASELINE_TOTAL_XP' },
  { field: 'player.companyLevel', path: `${SAVE}.player.companyLevel`, sourceOfTruthToday: 'alias of player.level', clientWritable: true, cloudSaved: true, serverMirror: 'none', historical: false, recomputable: 'equals level', verifiable: false, migrationClass: 'DERIVED_FROM_BASELINE_TOTAL_XP' },
  { field: 'player.xp', path: `${SAVE}.player.xp`, sourceOfTruthToday: 'device save', clientWritable: true, cloudSaved: true, serverMirror: 'summary.xp (client)', historical: false, recomputable: 'from totalXp via the production curve', verifiable: false, migrationClass: 'DERIVED_FROM_BASELINE_TOTAL_XP' },
  { field: 'player.xpToNextLevel', path: `${SAVE}.player.xpToNextLevel`, sourceOfTruthToday: 'device save', clientWritable: true, cloudSaved: true, serverMirror: 'none', historical: false, recomputable: 'calculateXpToNextLevel(level)', verifiable: false, migrationClass: 'DERIVED_FROM_BASELINE_TOTAL_XP' },
  { field: 'player.totalXp', path: `${SAVE}.player.totalXp`, sourceOfTruthToday: 'device save (backfilled = xp for pre-totalXp saves)', clientWritable: true, cloudSaved: true, serverMirror: 'none', historical: true, recomputable: 'no: needs every historical XP grant', verifiable: false, migrationClass: 'GRANDFATHERED_BASELINE_ATTESTED' },
  { field: 'player.reputation', path: `${SAVE}.player.reputation`, sourceOfTruthToday: 'device save', clientWritable: true, cloudSaved: true, serverMirror: 'serverState.reputation (bounded one-time copy of the save)', historical: true, recomputable: 'no: needs every historical outcome and punctuality', verifiable: false, migrationClass: 'GRANDFATHERED_BASELINE_ATTESTED' },
  { field: 'meta.level / meta.xp / meta.totalXp', path: `${SAVE}.meta`, sourceOfTruthToday: 'copied from player at serialize time', clientWritable: true, cloudSaved: true, serverMirror: 'none', historical: false, recomputable: 'equals player fields', verifiable: false, migrationClass: 'STRUCTURAL_CHECK_ONLY' },
  { field: 'summary.level / summary.xp; users/{uid}.level / companyScore', path: 'users/{uid}/saves/current summary; users/{uid}', sourceOfTruthToday: 'client display summary', clientWritable: true, cloudSaved: true, serverMirror: 'none', historical: false, recomputable: 'display only', verifiable: false, migrationClass: 'DISCARDED_NOT_EVIDENCE' },
  { field: 'player.completedContracts / failedDeliveries / lateDeliveries', path: `${SAVE}.player`, sourceOfTruthToday: 'device save', clientWritable: true, cloudSaved: true, serverMirror: 'serverState.completedDeliveries via client-submitted canonicalDeliveryCompletions ids', historical: true, recomputable: 'no', verifiable: false, migrationClass: 'DISCARDED_NOT_EVIDENCE' },
  { field: 'reputationHistory', path: `${SAVE}.reputationHistory`, sourceOfTruthToday: 'device log', clientWritable: true, cloudSaved: true, serverMirror: 'none', historical: true, recomputable: 'no', verifiable: false, migrationClass: 'DISCARDED_NOT_EVIDENCE' },
  { field: 'deliverySettlementHistory', path: `${SAVE}.deliverySettlementHistory`, sourceOfTruthToday: 'device log (bounded)', clientWritable: true, cloudSaved: true, serverMirror: 'none', historical: true, recomputable: 'no', verifiable: false, migrationClass: 'DISCARDED_NOT_EVIDENCE' },
  { field: 'missions.claimedMissionRewardIds', path: `${SAVE}.missions.claimedMissionRewardIds`, sourceOfTruthToday: 'device save', clientWritable: true, cloudSaved: true, serverMirror: 'none', historical: true, recomputable: 'no', verifiable: false, migrationClass: 'LEGACY_CLAIM_CONSUMPTION_ONLY' },
  { field: 'missions.completedMissionIds / activeMissionIds / completedAtByMissionId / flags', path: `${SAVE}.missions`, sourceOfTruthToday: 'device save (game-time stamps)', clientWritable: true, cloudSaved: true, serverMirror: 'none', historical: true, recomputable: 'no', verifiable: false, migrationClass: 'DISCARDED_NOT_EVIDENCE' },
  { field: 'retention.milestones[id].isClaimed', path: `${SAVE}.retention.milestones`, sourceOfTruthToday: 'device save', clientWritable: true, cloudSaved: true, serverMirror: 'none', historical: true, recomputable: 'no', verifiable: false, migrationClass: 'LEGACY_CLAIM_CONSUMPTION_ONLY' },
  { field: 'retention.milestones[id].progress / completedAt', path: `${SAVE}.retention.milestones`, sourceOfTruthToday: 'device save', clientWritable: true, cloudSaved: true, serverMirror: 'none', historical: true, recomputable: 'no', verifiable: false, migrationClass: 'DISCARDED_NOT_EVIDENCE' },
  { field: 'retention.weeklyObjectives[id] (progress / isClaimed)', path: `${SAVE}.retention.weeklyObjectives`, sourceOfTruthToday: 'device save, current device week only', clientWritable: true, cloudSaved: true, serverMirror: 'none', historical: false, recomputable: 'no', verifiable: false, migrationClass: 'WEEKLY_CUTOVER_CLOSED' },
  { field: 'retention.currentWeeklySeasonKey (last weekly reset)', path: `${SAVE}.retention.currentWeeklySeasonKey`, sourceOfTruthToday: 'device clock', clientWritable: true, cloudSaved: true, serverMirror: 'none', historical: false, recomputable: 'server clock gives the real week', verifiable: false, migrationClass: 'STRUCTURAL_CHECK_ONLY' },
  { field: 'retention.weeklyStats / lifetimeStats', path: `${SAVE}.retention`, sourceOfTruthToday: 'device counters', clientWritable: true, cloudSaved: true, serverMirror: 'none', historical: true, recomputable: 'no', verifiable: false, migrationClass: 'DISCARDED_NOT_EVIDENCE' },
  { field: 'retention.claimedBadges (achievement cosmetics)', path: `${SAVE}.retention.claimedBadges`, sourceOfTruthToday: 'device save', clientWritable: true, cloudSaved: true, serverMirror: 'none', historical: true, recomputable: 'no', verifiable: false, migrationClass: 'DISCARDED_NOT_EVIDENCE' },
  { field: 'rewardReceipts (mission:/achievement:/weekly: keys, claimedAt game time)', path: `${SAVE}.rewardReceipts`, sourceOfTruthToday: 'device save, monotonic union on cloud merge', clientWritable: true, cloudSaved: true, serverMirror: 'none', historical: true, recomputable: 'no', verifiable: false, migrationClass: 'LEGACY_CLAIM_CONSUMPTION_ONLY' },
  { field: 'financeLedger / financeTotals', path: `${SAVE}.financeLedger`, sourceOfTruthToday: 'device ledger (200-entry window)', clientWritable: true, cloudSaved: true, serverMirror: 'none', historical: true, recomputable: 'no', verifiable: false, migrationClass: 'DISCARDED_NOT_EVIDENCE' },
  { field: 'progressionFoundation / companyStats', path: `${SAVE}.progressionFoundation`, sourceOfTruthToday: 'device save', clientWritable: true, cloudSaved: true, serverMirror: 'none', historical: true, recomputable: 'no', verifiable: false, migrationClass: 'DISCARDED_NOT_EVIDENCE' },
  { field: 'serverState.companyLevel / reputation', path: 'users/{uid}/serverState/current', sourceOfTruthToday: 'Admin-written, sourced from the save (legacy-save migration)', clientWritable: false, cloudSaved: false, serverMirror: 'is the mirror', historical: false, recomputable: 'no', verifiable: false, migrationClass: 'SERVER_MIRROR_OF_CLIENT_VALUE' },
  { field: 'serverState.completedDeliveries + canonicalDeliveryCompletions', path: 'users/{uid}/serverState/current; users/{uid}/canonicalDeliveryCompletions', sourceOfTruthToday: 'Admin-written, client-submitted delivery ids only', clientWritable: false, cloudSaved: false, serverMirror: 'is the mirror', historical: true, recomputable: 'no', verifiable: false, migrationClass: 'SERVER_MIRROR_OF_CLIENT_VALUE' },
  { field: 'canonicalCompanyProgression/current', path: 'users/{uid}/canonicalCompanyProgression/current', sourceOfTruthToday: 'server', clientWritable: false, cloudSaved: false, serverMirror: 'n/a (canonical)', historical: false, recomputable: 'from receipts', verifiable: true, migrationClass: 'TRUSTED_CANONICAL_PRESERVED' },
  { field: 'canonicalProgressionReceipts', path: 'users/{uid}/canonicalProgressionReceipts', sourceOfTruthToday: 'server', clientWritable: false, cloudSaved: false, serverMirror: 'n/a (canonical)', historical: true, recomputable: 'n/a', verifiable: true, migrationClass: 'TRUSTED_CANONICAL_PRESERVED' },
  { field: 'canonicalRewardClaims (29W / 29AI)', path: 'users/{uid}/canonicalRewardClaims', sourceOfTruthToday: 'server', clientWritable: false, cloudSaved: false, serverMirror: 'n/a (canonical)', historical: true, recomputable: 'n/a', verifiable: true, migrationClass: 'TRUSTED_CANONICAL_PRESERVED' },
  { field: 'weeklyMissionClaims / weeklyMissionBaselines (server weekly missions)', path: 'users/{uid}/weeklyMissionClaims', sourceOfTruthToday: 'server', clientWritable: false, cloudSaved: false, serverMirror: 'n/a', historical: true, recomputable: 'n/a', verifiable: true, migrationClass: 'NOT_PROGRESSION_XP' },
  { field: 'challengeClaims / seasonProgress / seasons rewardClaims', path: 'users/{uid}/challengeClaims; seasons/*', sourceOfTruthToday: 'server', clientWritable: false, cloudSaved: false, serverMirror: 'n/a', historical: true, recomputable: 'n/a', verifiable: true, migrationClass: 'NOT_PROGRESSION_XP' },
];

export type LegacyServerEvidenceRow = {
  evidence: string;
  path: string;
  integrity: 'SERVER_WRITTEN_TRUSTED' | 'SERVER_WRITTEN_CLIENT_SOURCED' | 'CLIENT_WRITTEN' | 'NOT_USED';
  provesXp: boolean;
  provesReputation: boolean;
  provesClaimHistory: boolean;
  note: string;
};

export const LEGACY_SERVER_EVIDENCE_AUDIT: readonly LegacyServerEvidenceRow[] = [
  { evidence: 'canonicalRewardClaims', path: 'users/{uid}/canonicalRewardClaims', integrity: 'SERVER_WRITTEN_TRUSTED', provesXp: false, provesReputation: false, provesClaimHistory: true, note: '29W/29AI claims only; preserved and never duplicated' },
  { evidence: 'canonical receipts (deliveries, purchases, hires, warehouses, cargo, progression)', path: 'users/{uid}/canonical*', integrity: 'SERVER_WRITTEN_TRUSTED', provesXp: false, provesReputation: false, provesClaimHistory: false, note: 'exist only for canonical operations; legacy save operations were never recorded' },
  { evidence: 'vehicle marketplace transactions', path: 'vehicleMarketplaceTransactions; users/{uid}/marketplaceHistory|marketplaceLedger', integrity: 'SERVER_WRITTEN_TRUSTED', provesXp: false, provesReputation: false, provesClaimHistory: false, note: 'player-to-player trades; production grants no XP for them' },
  { evidence: 'serverState cash / fleet / companyLevel / reputation', path: 'users/{uid}/serverState/current', integrity: 'SERVER_WRITTEN_CLIENT_SOURCED', provesXp: false, provesReputation: false, provesClaimHistory: false, note: 'bounded copy of the client save (migrationSource legacy-save)' },
  { evidence: 'canonicalDeliveryCompletions', path: 'users/{uid}/canonicalDeliveryCompletions', integrity: 'SERVER_WRITTEN_CLIENT_SOURCED', provesXp: false, provesReputation: false, provesClaimHistory: false, note: 'client-submitted delivery id only: no type, distance, payment, deadline, outcome or risk' },
  { evidence: 'weeklyMissionClaims', path: 'users/{uid}/weeklyMissionClaims', integrity: 'SERVER_WRITTEN_TRUSTED', provesXp: false, provesReputation: false, provesClaimHistory: false, note: 'server weekly missions grant no XP; unrelated to local weekly objectives' },
  { evidence: 'challenge / season claims', path: 'users/{uid}/challengeClaims; seasons/*/rewardClaims', integrity: 'SERVER_WRITTEN_TRUSTED', provesXp: false, provesReputation: false, provesClaimHistory: false, note: 'no XP rewards' },
  { evidence: 'leaderboard entries', path: 'leaderboards/*/entries', integrity: 'SERVER_WRITTEN_CLIENT_SOURCED', provesXp: false, provesReputation: false, provesClaimHistory: false, note: 'derived from serverState' },
  { evidence: 'global economy records', path: 'globalEconomy; canonicalWorldMarkets', integrity: 'SERVER_WRITTEN_TRUSTED', provesXp: false, provesReputation: false, provesClaimHistory: false, note: 'world state, not per-player history' },
  { evidence: 'cloud-save metadata (updatedAt, deviceUpdatedAt, syncId, payloadChecksum)', path: 'users/{uid}/saves/current', integrity: 'CLIENT_WRITTEN', provesXp: false, provesReputation: false, provesClaimHistory: false, note: 'integrity against corruption only; rules let the owner set every field' },
  { evidence: 'profile / sync meta (createdAt, level, money, lastSyncStatus)', path: 'users/{uid}; users/{uid}/meta/status', integrity: 'CLIENT_WRITTEN', provesXp: false, provesReputation: false, provesClaimHistory: false, note: 'owner-writable' },
  { evidence: 'Firebase Auth account creation time', path: 'Auth user metadata', integrity: 'SERVER_WRITTEN_TRUSTED', provesXp: false, provesReputation: false, provesClaimHistory: false, note: 'proves account age only (candidate manual-review signal)' },
  { evidence: 'analytics events', path: 'client analytics', integrity: 'NOT_USED', provesXp: false, provesReputation: false, provesClaimHistory: false, note: 'not integrity-grade' },
];

export const MIGRATION_DECISION_MATRIX: ReadonlyArray<{
  case: string;
  trustedServerEvidence: string;
  saveStructuralValidity: string;
  rewardHistory: string;
  proposedAction: LegacyAccountMigrationClass;
  securityRisk: string;
  playerImpact: string;
}> = [
  { case: 'new account (no save, unused serverState)', trustedServerEvidence: 'none needed', saveStructuralValidity: 'n/a', rewardHistory: 'none', proposedAction: 'NOT_LEGACY_NEW_ACCOUNT', securityRisk: 'none', playerImpact: 'normal 29AF initialization' },
  { case: 'clean legacy account (save equals new-account defaults)', trustedServerEvidence: 'none needed', saveStructuralValidity: 'valid', rewardHistory: 'no claims', proposedAction: 'VERIFIED_MIGRATABLE', securityRisk: 'none (nothing is accepted beyond defaults)', playerImpact: 'none' },
  { case: 'progressed legacy account', trustedServerEvidence: 'none for XP/reputation', saveStructuralValidity: 'valid', rewardHistory: 'local flags only', proposedAction: 'PARTIALLY_ATTESTABLE', securityRisk: 'baseline is client-authored before first migration', playerImpact: 'level/reputation kept; claimed rewards consumed; cutover week closed' },
  { case: 'legacy account with canonical claims', trustedServerEvidence: 'canonicalRewardClaims', saveStructuralValidity: 'valid', rewardHistory: 'trusted + local', proposedAction: 'PARTIALLY_ATTESTABLE', securityRisk: 'as above; canonical claims preserved', playerImpact: 'canonical claims keep their existing replay result' },
  { case: 'conflicting save (stored save changed after preview)', trustedServerEvidence: 'server hash', saveStructuralValidity: 'any', rewardHistory: 'any', proposedAction: 'PARTIALLY_ATTESTABLE', securityRisk: 'none: apply fails MIGRATION_BLOCKED_SAVE_CONFLICT', playerImpact: 'preview again after the device conflict is resolved' },
  { case: 'invalid progression (level/xp/totalXp or reputation)', trustedServerEvidence: 'none', saveStructuralValidity: 'invalid', rewardHistory: 'any', proposedAction: 'MANUAL_REVIEW_REQUIRED', securityRisk: 'none (blocked)', playerImpact: 'stays legacy until reviewed' },
  { case: 'unknown / duplicate / future reward claims', trustedServerEvidence: 'none', saveStructuralValidity: 'valid', rewardHistory: 'malformed', proposedAction: 'MANUAL_REVIEW_REQUIRED', securityRisk: 'none (blocked)', playerImpact: 'stays legacy until reviewed' },
  { case: 'canonical progression already active', trustedServerEvidence: 'canonical progression doc', saveStructuralValidity: 'ignored', rewardHistory: 'ignored', proposedAction: 'ALREADY_CANONICAL_ACTIVE', securityRisk: 'none', playerImpact: 'no migration needed' },
  { case: 'legacy serverState but no save', trustedServerEvidence: 'none', saveStructuralValidity: 'no source', rewardHistory: 'none', proposedAction: 'CUTOVER_WITH_RESET_REQUIRED', securityRisk: 'none', playerImpact: 'reset needs explicit consent (not implemented)' },
  { case: 'future / stale save version or unknown doc schema', trustedServerEvidence: 'none', saveStructuralValidity: 'not interpreted', rewardHistory: 'not interpreted', proposedAction: 'UNSUPPORTED', securityRisk: 'none', playerImpact: 'stale saves can migrate after the app re-saves as v6' },
  { case: 'internal test fixture progression', trustedServerEvidence: 'fixture', saveStructuralValidity: 'ignored', rewardHistory: 'ignored', proposedAction: 'UNSUPPORTED', securityRisk: 'none', playerImpact: 'fixtures never become production authority' },
];

export const MIGRATION_POLICY_COMPARISON: ReadonlyArray<{
  model: 'FULL_RECONSTRUCTION' | 'GRANDFATHERED_BASELINE' | 'RESET' | 'MANUAL_REVIEW';
  security: string;
  accuracy: string;
  playerFairness: string;
  duplicateRewardRisk: string;
  engineeringComplexity: string;
  recoverability: string;
  feasible: boolean;
}> = [
  { model: 'FULL_RECONSTRUCTION', security: 'highest', accuracy: 'exact', playerFairness: 'exact', duplicateRewardRisk: 'none', engineeringComplexity: 'n/a', recoverability: 'n/a', feasible: false },
  { model: 'GRANDFATHERED_BASELINE', security: 'bounded: one client-authored snapshot, pinned once, structurally validated', accuracy: 'as good as the save', playerFairness: 'continuity kept; claimed rewards consumed; one weekly cycle closed', duplicateRewardRisk: 'XP only if the owner forges unclaimed flags (same trust as forging totalXp); no cash', engineeringComplexity: 'medium', recoverability: 'record + receipt keep source hash and before/after', feasible: true },
  { model: 'RESET', security: 'high (defaults only)', accuracy: 'discards history', playerFairness: 'poor: all progress lost', duplicateRewardRisk: 'reward re-claims possible unless history is also consumed', engineeringComplexity: 'low', recoverability: 'irreversible for the player', feasible: true },
  { model: 'MANUAL_REVIEW', security: 'high per case', accuracy: 'reviewer-dependent', playerFairness: 'slow', duplicateRewardRisk: 'reviewer-dependent', engineeringComplexity: 'operational tooling needed', recoverability: 'good', feasible: true },
];

export const HISTORICAL_REWARD_POLICY_OPTIONS: ReadonlyArray<{
  option: 'A' | 'B' | 'C' | 'D' | 'A_VARIANT';
  description: string;
  duplicateRewards: string;
  lostRewards: string;
  chosen: boolean;
}> = [
  { option: 'A', description: 'baseline + mark every legacy one-time reward consumed', duplicateRewards: 'none', lostRewards: 'every unclaimed and not-yet-reached reward, forever', chosen: false },
  { option: 'B', description: 'baseline + keep only server-verifiable claims, block uncertain one-time rewards forever', duplicateRewards: 'none', lostRewards: 'every reward without a canonical claim (almost all)', chosen: false },
  { option: 'C', description: 'reset progression and rewards from cutover', duplicateRewards: 'possible unless history is consumed', lostRewards: 'all progression', chosen: false },
  { option: 'D', description: 'manual migration/review for everyone', duplicateRewards: 'reviewer-dependent', lostRewards: 'none, but slow', chosen: false },
  { option: 'A_VARIANT', description: 'baseline + consume only rewards the pinned save marks claimed; unclaimed rewards claimable later from trusted post-cutover progress; 29W cash rewards blocked; manual review for malformed history', duplicateRewards: 'bounded XP if unclaimed flags are forged; no cash', lostRewards: 'progress toward unclaimed rewards restarts from trusted evidence; cutover-week weeklies', chosen: true },
];

export const RECOMMENDED_LEGACY_MIGRATION_POLICY = {
  name: 'GRANDFATHERED_ATTESTED_BASELINE_WITH_LEGACY_CLAIM_CONSUMPTION',
  trusted: [
    'canonicalRewardClaims (29W / 29AI)',
    'canonical receipts written after canonical authority',
    'server clock for the weekly cycle',
    'server-computed sha256 of the stored save',
  ],
  grandfathered: [
    'totalXp (level / xp / xpToNextLevel derived from it)',
    'reputation',
  ],
  consumed: ['every mission and milestone the pinned save marks claimed'],
  discarded: [
    'local level / xp / xpToNextLevel as separate values',
    'local mission / milestone / weekly progress counters',
    'local claim timestamps',
    'reputation history, delivery settlement history, finance ledger',
    'completedContracts and delivery counters',
  ],
  blocked: [
    '29W cash rewards (own_2_trucks, ms_second_truck) for migrated accounts',
    'cutover-week weekly objectives',
    'the 5 missions and 11 milestones blocked in 29AI',
    'malformed saves (manual review)',
    'accounts with no source save (reset needs consent)',
  ],
  freshAfterCutover: [
    'all XP and reputation changes through normal canonical receipts',
    'unclaimed rewards from trusted canonical progress',
    'weekly objectives from the next ISO week',
  ],
} as const;

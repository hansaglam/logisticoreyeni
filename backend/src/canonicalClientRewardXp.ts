/**
 * Step 29AI — INTERNAL_TEST mission / milestone / local weekly objective claims with XP.
 * The client sends only rewardId. Catalog, cycle and progress are resolved on the server;
 * XP and production reputation go through one canonical progression receipt; cash is only
 * granted for rewards that already had 29W cash authority. All reads precede all writes.
 */

import type { Firestore } from 'firebase-admin/firestore';

import { CANONICAL_ROAD_DELIVERIES_COLLECTION } from '../../src/domain/canonicalRoadDelivery';
import { CANONICAL_FLEET_ASSETS_COLLECTION, type CanonicalFleetAssetDocument } from '../../src/domain/canonicalRoadFleet';
import {
  CANONICAL_CARGO_INVENTORY_COLLECTION,
  CANONICAL_CARGO_MARKET_RECEIPTS_COLLECTION,
} from '../../src/domain/canonicalCargoMarketWorldState';
import { CANONICAL_WAREHOUSES_COLLECTION } from '../../src/domain/canonicalWarehouseState';
import { CANONICAL_FLEET_MUTATION_RECEIPTS_COLLECTION } from '../../src/domain/canonicalFleetConditionWear';
import {
  CANONICAL_COMPANY_PROGRESSION_AUTHORITY_ENV,
  CANONICAL_PROGRESSION_RECEIPTS_COLLECTION,
} from '../../src/domain/canonicalCompanyProgression';
import {
  CANONICAL_LOCAL_REWARD_ENV,
  createCanonicalRewardClaimId,
  findCanonicalLocalReward,
  isCanonicalLocalRewardAllowed,
} from '../../src/domain/canonicalLocalRewardClaim';
import {
  CANONICAL_CLIENT_REWARD_CLAIM_SCHEMA_VERSION,
  CANONICAL_CLIENT_REWARD_XP_AUTHORITY_ENV,
  CANONICAL_CLIENT_REWARD_XP_POLICY_VERSION,
  CLIENT_REWARD_CASH_AUTHORITY_REQUIRED,
  CLIENT_REWARD_XP_CLAIM_CONFLICT,
  CLIENT_REWARD_XP_HISTORICAL_CLAIM_UNAPPLIED,
  CLIENT_REWARD_XP_POLICY_UNKNOWN,
  CLIENT_REWARD_XP_PROGRESSION_NOT_SERVER_CANONICAL,
  CLIENT_REWARD_XP_PROGRESSION_RECEIPT_CONFLICT,
  CLIENT_REWARD_XP_PROGRESSION_UNINITIALIZED,
  LOCAL_WEEKLY_OBJECTIVE_DISABLED_BACKEND_WEEKLY_MODE,
  REWARD_NOT_ELIGIBLE,
  buildCanonicalClientRewardProgressionInput,
  canonicalClientRewardClaimId,
  classifyCanonicalClientRewardReplay,
  deriveCanonicalRewardProgress,
  isBackendWeeklyMissionModeEnabled,
  isCanonicalClientRewardXpAllowed,
  progressionClientRewardOperationId,
  requiredEvidenceForMetric,
  resolveCanonicalClientReward,
  WEEKLY_MISSIONS_BACKEND_ENV,
  type CanonicalClientRewardClaimReceipt,
  type CanonicalClientRewardDefinition,
  type CanonicalRewardEvidence,
  type CanonicalRewardEvidenceKind,
} from '../../src/domain/canonicalClientRewardXp';
import {
  canonicalProgressionMigrationPath,
  classifyCanonicalProgressionMigrationRecord,
  resolveMigratedClientRewardTreatment,
} from '../../src/domain/canonicalLegacyProgressionMigration';
import { isAuthenticatedUid } from './canonicalCashTransaction';
import {
  commitCanonicalProgressionWrite,
  planCanonicalProgressionWrite,
  readCanonicalProgressionContext,
} from './canonicalCompanyProgression';
import {
  applyCanonicalLocalRewardCashInTransaction,
  canonicalRewardClaimPath,
  listCollectionDocs,
} from './canonicalLocalReward';

export type CanonicalClientRewardOptions = {
  clientRewardXpEnvValue?: string | null;
  progressionEnvValue?: string | null;
  localRewardEnvValue?: string | null;
  weeklyBackendEnvValue?: string | null;
};

export type ClaimCanonicalClientRewardResult =
  | {
      ok: true;
      alreadyApplied: boolean;
      application: 'APPLIED' | 'ALREADY_APPLIED' | typeof CLIENT_REWARD_XP_HISTORICAL_CLAIM_UNAPPLIED;
      receipt: Record<string, unknown>;
      progressionReceipt: Record<string, unknown> | null;
    }
  | { ok: false; reason: string; progress?: number; target?: number };

function option<K extends keyof CanonicalClientRewardOptions>(
  options: CanonicalClientRewardOptions | undefined,
  key: K,
  env: string,
): string | null | undefined {
  return options && key in options ? options[key] : process.env[env];
}

async function readEvidence(
  transaction: Parameters<Parameters<Firestore['runTransaction']>[0]>[0],
  firestore: Firestore,
  uid: string,
  kinds: readonly CanonicalRewardEvidenceKind[],
): Promise<Partial<CanonicalRewardEvidence>> {
  const base = `users/${uid}`;
  const need = new Set(kinds);
  const evidence: Partial<CanonicalRewardEvidence> = {};
  if (need.has('DELIVERIES')) {
    evidence.deliveries = await listCollectionDocs(transaction, firestore, `${base}/${CANONICAL_ROAD_DELIVERIES_COLLECTION}`);
  }
  if (need.has('CARGO_RECEIPTS')) {
    evidence.cargoReceipts = await listCollectionDocs(
      transaction,
      firestore,
      `${base}/${CANONICAL_CARGO_MARKET_RECEIPTS_COLLECTION}`,
    );
  }
  if (need.has('CARGO_SALE_PROGRESSION')) {
    const rows = await listCollectionDocs(transaction, firestore, `${base}/${CANONICAL_PROGRESSION_RECEIPTS_COLLECTION}`);
    evidence.cargoSaleProgression = new Map(
      rows
        .filter((row) => row.sourceType === 'COMPANY_CARGO_SALE' && typeof row.operationId === 'string')
        .map((row) => [row.operationId as string, row]),
    );
  }
  if (need.has('INVENTORY')) {
    evidence.inventory = await listCollectionDocs(transaction, firestore, `${base}/${CANONICAL_CARGO_INVENTORY_COLLECTION}`);
  }
  if (need.has('WAREHOUSES')) {
    evidence.warehouses = await listCollectionDocs(transaction, firestore, `${base}/${CANONICAL_WAREHOUSES_COLLECTION}`);
  }
  if (need.has('FLEET')) {
    evidence.fleet = (await listCollectionDocs(
      transaction,
      firestore,
      `${base}/${CANONICAL_FLEET_ASSETS_COLLECTION}`,
    )) as unknown as CanonicalFleetAssetDocument[];
  }
  if (need.has('FLEET_MUTATIONS')) {
    evidence.fleetMutations = await listCollectionDocs(
      transaction,
      firestore,
      `${base}/${CANONICAL_FLEET_MUTATION_RECEIPTS_COLLECTION}`,
    );
  }
  return evidence;
}

export async function claimCanonicalClientRewardTransaction(
  firestore: Firestore,
  uid: string,
  rewardId: unknown,
  nowMs: number,
  options?: CanonicalClientRewardOptions,
): Promise<ClaimCanonicalClientRewardResult> {
  if (!isAuthenticatedUid(uid)) return { ok: false, reason: 'UNAUTHENTICATED' };
  if (!isCanonicalClientRewardXpAllowed({ envValue: option(options, 'clientRewardXpEnvValue', CANONICAL_CLIENT_REWARD_XP_AUTHORITY_ENV) })) {
    return { ok: false, reason: 'CANONICAL_CLIENT_REWARD_XP_AUTHORITY_OFF' };
  }
  const progressionEnvValue = option(options, 'progressionEnvValue', CANONICAL_COMPANY_PROGRESSION_AUTHORITY_ENV);
  const resolved = resolveCanonicalClientReward(rewardId, nowMs);
  if (!resolved.ok) return { ok: false, reason: resolved.reason };
  const def: CanonicalClientRewardDefinition = resolved.definition;
  if (
    def.family === 'WEEKLY_OBJECTIVE' &&
    isBackendWeeklyMissionModeEnabled({ envValue: option(options, 'weeklyBackendEnvValue', WEEKLY_MISSIONS_BACKEND_ENV) })
  ) {
    return { ok: false, reason: LOCAL_WEEKLY_OBJECTIVE_DISABLED_BACKEND_WEEKLY_MODE };
  }
  if (def.blockedAuthority) return { ok: false, reason: def.blockedAuthority };
  const localReward = def.cashAuthority === 'CANONICAL_29W_INTERNAL' ? findCanonicalLocalReward(def.rewardId) : null;
  if (localReward) {
    if (createCanonicalRewardClaimId(localReward) !== canonicalClientRewardClaimId(def)) {
      return { ok: false, reason: CLIENT_REWARD_XP_CLAIM_CONFLICT };
    }
    if (!isCanonicalLocalRewardAllowed({ envValue: option(options, 'localRewardEnvValue', CANONICAL_LOCAL_REWARD_ENV) })) {
      return { ok: false, reason: CLIENT_REWARD_CASH_AUTHORITY_REQUIRED };
    }
  }
  const claimId = canonicalClientRewardClaimId(def);
  const operationId = progressionClientRewardOperationId(def);

  return firestore.runTransaction(async (transaction) => {
    const claimRef = firestore.doc(canonicalRewardClaimPath(uid, claimId));
    const migrationRef = firestore.doc(canonicalProgressionMigrationPath(uid));
    const [claimSnap, migrationSnap] = await Promise.all([
      transaction.get(claimRef),
      transaction.get(migrationRef),
    ]);
    const migrationClass = classifyCanonicalProgressionMigrationRecord(
      migrationSnap.exists ? (migrationSnap.data() as Record<string, unknown>) : null,
      uid,
    );
    if (migrationClass.kind === 'MIGRATED') {
      const migrationTreatment = resolveMigratedClientRewardTreatment(migrationClass.record, def);
      if (migrationTreatment) return { ok: false as const, reason: migrationTreatment };
    }
    const context = await readCanonicalProgressionContext(transaction, firestore, uid, [operationId], progressionEnvValue);
    const evidence = await readEvidence(transaction, firestore, uid, requiredEvidenceForMetric(def.metric!));

    if (claimSnap.exists) {
      const existing = claimSnap.data() as Record<string, unknown>;
      const replay = classifyCanonicalClientRewardReplay(existing, def, uid);
      if (replay.kind === 'HISTORICAL_CASH_ONLY') {
        return {
          ok: true as const,
          alreadyApplied: true,
          application: CLIENT_REWARD_XP_HISTORICAL_CLAIM_UNAPPLIED,
          receipt: existing,
          progressionReceipt: null,
        };
      }
      if (replay.kind === 'POLICY_UNKNOWN') return { ok: false as const, reason: CLIENT_REWARD_XP_POLICY_UNKNOWN };
      if (replay.kind === 'CONFLICT') return { ok: false as const, reason: CLIENT_REWARD_XP_CLAIM_CONFLICT };
      const progressionReceipt = context.enabled ? context.receipts.get(operationId) ?? null : null;
      if (!progressionReceipt) return { ok: false as const, reason: CLIENT_REWARD_XP_PROGRESSION_RECEIPT_CONFLICT };
      return {
        ok: true as const,
        alreadyApplied: true,
        application: 'ALREADY_APPLIED' as const,
        receipt: existing,
        progressionReceipt,
      };
    }

    if (!context.enabled) return { ok: false as const, reason: 'CANONICAL_COMPANY_PROGRESSION_AUTHORITY_OFF' };
    if (!context.state) {
      return {
        ok: false as const,
        reason:
          context.authorityClass === 'UNINITIALIZED'
            ? CLIENT_REWARD_XP_PROGRESSION_UNINITIALIZED
            : CLIENT_REWARD_XP_PROGRESSION_NOT_SERVER_CANONICAL,
      };
    }
    if (context.receipts.get(operationId)) {
      return { ok: false as const, reason: CLIENT_REWARD_XP_PROGRESSION_RECEIPT_CONFLICT };
    }

    const derivation = deriveCanonicalRewardProgress(def, {
      ...evidence,
      uid,
      nowMs,
      cycle: resolved.cycle,
      progression: context.state,
    });
    if (!derivation.ok) {
      return { ok: false as const, reason: derivation.reason, progress: derivation.progress, target: derivation.target };
    }
    if (!derivation.eligible) {
      return { ok: false as const, reason: REWARD_NOT_ELIGIBLE, progress: derivation.progress, target: derivation.target };
    }

    const input = buildCanonicalClientRewardProgressionInput(def, derivation, nowMs);
    const plan = planCanonicalProgressionWrite(context, input);
    if (!plan.ok || plan.application !== 'APPLIED') {
      return { ok: false as const, reason: CLIENT_REWARD_XP_PROGRESSION_RECEIPT_CONFLICT };
    }

    let cashFields: Record<string, unknown> = {};
    let cashGranted = false;
    if (localReward) {
      const cash = await applyCanonicalLocalRewardCashInTransaction(
        transaction,
        firestore,
        uid,
        localReward,
        localReward.amount,
        nowMs,
      );
      if (!cash.ok) return { ok: false as const, reason: cash.reason };
      cashFields = { ...cash.fields };
      cashGranted = true;
    }

    const receipt: CanonicalClientRewardClaimReceipt & Record<string, unknown> = {
      ...cashFields,
      claimSchemaVersion: CANONICAL_CLIENT_REWARD_CLAIM_SCHEMA_VERSION,
      claimId,
      rewardId: def.rewardId,
      rewardFamily: def.family,
      cycleId: def.cycleId,
      cyclePolicyVersion: resolved.cycle ? resolved.cycle.policyVersion : null,
      rewardXpPolicyVersion: CANONICAL_CLIENT_REWARD_XP_POLICY_VERSION,
      metric: def.metric!.kind,
      progress: derivation.progress,
      target: def.target,
      evidenceClass: derivation.evidenceClass,
      xpReward: def.xpReward,
      reputationReward: def.reputationReward,
      cash: {
        productionCashReward: def.productionCashReward,
        authority: def.cashAuthority,
        granted: cashGranted,
        cashTransactionId: cashGranted ? claimId : null,
      },
      progressionOperationId: operationId,
      claimedAtMs: nowMs,
      ownerUid: uid,
      multiplicity: def.family === 'WEEKLY_OBJECTIVE' ? 'ONE_PER_CYCLE' : 'ONE_TIME',
      authoritySource: 'INTERNAL_CANONICAL_RECEIPTS',
    };
    transaction.create(claimRef, receipt);
    commitCanonicalProgressionWrite(transaction, firestore, uid, plan);
    return {
      ok: true as const,
      alreadyApplied: false,
      application: 'APPLIED' as const,
      receipt,
      progressionReceipt: { ...plan.receipt! },
    };
  });
}

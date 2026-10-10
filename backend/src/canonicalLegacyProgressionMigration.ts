/**
 * Step 29AJ — legacy progression migration preview (read-only) and INTERNAL_TEST apply (create-only).
 */

import { createHash } from 'node:crypto';

import type { Firestore } from 'firebase-admin/firestore';

import {
  CANONICAL_PROGRESSION_RECEIPTS_COLLECTION,
  canonicalCompanyProgressionPath,
  canonicalProgressionReceiptPath,
} from '../../src/domain/canonicalCompanyProgression';
import {
  CANONICAL_REWARD_CLAIMS_COLLECTION,
} from '../../src/domain/canonicalLocalRewardClaim';
import {
  MIGRATION_ALREADY_CANONICAL_ACTIVE,
  MIGRATION_BLOCKED_ACTIVE_CANONICAL_HISTORY,
  MIGRATION_BLOCKED_MIGRATION_INELIGIBLE,
  CANONICAL_PROGRESSION_ALREADY_ACTIVE,
  CANONICAL_PROGRESSION_IMMEDIATE_CUTOVER_POLICY_VERSION,
  CANONICAL_PROGRESSION_MIGRATION_SOURCE_POLICY_VERSION,
  LEGACY_PROGRESSION_META_PLAYER_CONFLICT,
  MIGRATION_ALREADY_MIGRATED,
  MIGRATION_OFF,
  MIGRATION_RECORD_INCONSISTENT,
  MIGRATION_SOURCE_ABORT_POLICY,
  MIGRATION_SOURCE_ALREADY_FROZEN,
  MIGRATION_SOURCE_BLOCKED_SAVE_CONFLICT,
  MIGRATION_SOURCE_FREEZE_STATUS,
  MIGRATION_SOURCE_HASH_INTEGRITY_ERROR,
  MIGRATION_SOURCE_NOT_FROZEN,
  MIGRATION_SOURCE_POLICY_UNKNOWN,
  MIGRATION_SOURCE_REFREEZE_POLICY,
  PROGRESSION_MIGRATION_OPERATION_ID,
  RECOMMENDED_LEGACY_MIGRATION_POLICY,
  SERVER_FROZEN_LEGACY_MIGRATION_SOURCE,
  buildCanonicalProgressionMigrationArtifacts,
  buildNormalizedLegacyMigrationSnapshot,
  canonicalProgressionMigrationPath,
  canonicalProgressionMigrationReceiptPath,
  canonicalProgressionMigrationSourceId,
  canonicalProgressionMigrationSourcePath,
  canonicalProgressionMigrationSourceReceiptPath,
  gameStateFromNormalizedMigrationSnapshot,
  isSupportedMigrationSourcePolicy,
  migrationSourceHashMatches,
  classifyCanonicalProgressionMigrationRecord,
  cloudSaveSnapshotHashInput,
  evaluateLegacyProgressionMigration,
  MIGRATION_SOURCE_FREEZE_STATUS_AT_CUTOVER,
  MIGRATION_SOURCE_PREEXISTING_FROZEN_REQUIRES_RESOLUTION,
  isCanonicalProgressionImmediateCutoverAllowed,
  isCanonicalProgressionMigrationAllowed,
  isSupportedImmediateCutoverPolicy,
  mapLegacyMigrationPreviewStatus,
  migrationNormalizedSnapshotJson,
  type LegacyMigrationPreviewAuthorityClass,
  type LegacyProgressionMigrationEvaluation,
  type LegacyProgressionValues,
  type LegacyMigrationPreviewStatus,
  type NormalizedLegacyMigrationSnapshot,
} from '../../src/domain/canonicalLegacyProgressionMigration';
import { isAuthenticatedUid } from './canonicalCashTransaction';
import { listCollectionDocs } from './canonicalLocalReward';

function rec(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function sha256HexUtf8(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export function computeServerMigrationHashes(gameState: Record<string, unknown>): {
  migrationSnapshotHash: string | null;
  fullPayloadHash: string | null;
} {
  const normalized = buildNormalizedLegacyMigrationSnapshot(gameState);
  const migrationSnapshotHash = normalized ? sha256HexUtf8(migrationNormalizedSnapshotJson(normalized)) : null;
  const fullPayloadHash = sha256HexUtf8(cloudSaveSnapshotHashInput(gameState));
  return { migrationSnapshotHash, fullPayloadHash };
}

function normalizeStoredHash(value: unknown): string | null {
  return typeof value === 'string' ? value.replace(/^sha256:/, '') : null;
}

function asNormalizedSnapshot(value: unknown): NormalizedLegacyMigrationSnapshot | null {
  const row = rec(value);
  const player = rec(row?.player);
  const meta = rec(row?.meta);
  const rewardHistory = rec(row?.rewardHistory);
  if (!row || !player || !meta || !rewardHistory || typeof row.saveVersion !== 'number') return null;
  return row as unknown as NormalizedLegacyMigrationSnapshot;
}

export function readFrozenMigrationSource(doc: Record<string, unknown> | null):
  | { ok: true; integrityError: false; source: Record<string, unknown>; snapshot: NormalizedLegacyMigrationSnapshot }
  | { ok: false; integrityError: boolean } {
  if (!doc) return { ok: false, integrityError: false };
  if (doc.policyVersion !== CANONICAL_PROGRESSION_MIGRATION_SOURCE_POLICY_VERSION) {
    return { ok: false, integrityError: true };
  }
  const snapshot = asNormalizedSnapshot(doc.normalizedSnapshot);
  const stored = normalizeStoredHash(doc.sourceSnapshotHash);
  if (!snapshot || !stored || !migrationSourceHashMatches(snapshot, stored, sha256HexUtf8)) {
    return { ok: false, integrityError: true };
  }
  return { ok: true, integrityError: false, source: doc, snapshot };
}

function syntheticSaveFromFrozen(uid: string, source: Record<string, unknown>): Record<string, unknown> {
  const snapshot = asNormalizedSnapshot(source.normalizedSnapshot);
  if (!snapshot) return { ownerUid: uid, schemaVersion: 1, gameState: null };
  return {
    ownerUid: uid,
    schemaVersion: 1,
    saveVersion: snapshot.saveVersion,
    syncId: typeof source.sourceSaveRevision === 'string' ? source.sourceSaveRevision : null,
    deviceUpdatedAt: source.frozenAtServerMs,
    gameState: gameStateFromNormalizedMigrationSnapshot(snapshot, uid),
  };
}

export type LegacyMigrationLoadContext = {
  saveDoc: Record<string, unknown> | null;
  progressionDoc: Record<string, unknown> | null;
  migrationRecordDoc: Record<string, unknown> | null;
  migrationSourceDoc: Record<string, unknown> | null;
  serverStateDoc: Record<string, unknown> | null;
  trustedCanonicalClaimIds: string[];
  activeCanonicalGameplayReceiptCount: number;
  migrationSnapshotHash: string | null;
  fullPayloadHash: string | null;
};

export async function loadLegacyMigrationContext(
  firestore: Firestore,
  uid: string,
): Promise<LegacyMigrationLoadContext> {
  const [saveSnap, progressionSnap, migrationSnap, sourceSnap, serverStateSnap] = await Promise.all([
    firestore.doc(`users/${uid}/saves/current`).get(),
    firestore.doc(canonicalCompanyProgressionPath(uid)).get(),
    firestore.doc(canonicalProgressionMigrationPath(uid)).get(),
    firestore.doc(canonicalProgressionMigrationSourcePath(uid)).get(),
    firestore.doc(`users/${uid}/serverState/current`).get(),
  ]);

  const claimSnap = await firestore.collection(`users/${uid}/${CANONICAL_REWARD_CLAIMS_COLLECTION}`).get();
  const receiptSnap = await firestore.collection(`users/${uid}/${CANONICAL_PROGRESSION_RECEIPTS_COLLECTION}`).get();
  const claimRows = claimSnap.docs.map((doc) => doc.data() as Record<string, unknown>);
  const receiptRows = receiptSnap.docs.map((doc) => doc.data() as Record<string, unknown>);

  const gameState = saveSnap.exists ? rec(saveSnap.data()?.gameState) : null;
  const hashes = gameState ? computeServerMigrationHashes(gameState) : { migrationSnapshotHash: null, fullPayloadHash: null };

  const trustedCanonicalClaimIds = claimRows
    .map((row) => (typeof row.claimId === 'string' ? row.claimId : null))
    .filter((id): id is string => Boolean(id))
    .sort();

  const activeCanonicalGameplayReceiptCount = receiptRows.filter(
    (row) => row.operationId !== PROGRESSION_MIGRATION_OPERATION_ID,
  ).length;

  return {
    saveDoc: saveSnap.exists ? (saveSnap.data() as Record<string, unknown>) : null,
    progressionDoc: progressionSnap.exists ? (progressionSnap.data() as Record<string, unknown>) : null,
    migrationRecordDoc: migrationSnap.exists ? (migrationSnap.data() as Record<string, unknown>) : null,
    migrationSourceDoc: sourceSnap.exists ? (sourceSnap.data() as Record<string, unknown>) : null,
    serverStateDoc: serverStateSnap.exists ? (serverStateSnap.data() as Record<string, unknown>) : null,
    trustedCanonicalClaimIds,
    activeCanonicalGameplayReceiptCount,
    migrationSnapshotHash: hashes.migrationSnapshotHash,
    fullPayloadHash: hashes.fullPayloadHash,
  };
}

export function evaluateLegacyMigrationFromContext(
  uid: string,
  nowMs: number,
  ctx: LegacyMigrationLoadContext,
): LegacyProgressionMigrationEvaluation {
  return evaluateLegacyProgressionMigration({
    uid,
    nowMs,
    progressionDoc: ctx.progressionDoc,
    migrationRecordDoc: ctx.migrationRecordDoc,
    saveDoc: ctx.saveDoc,
    serverStateDoc: ctx.serverStateDoc,
    serverMigrationSnapshotHash: ctx.migrationSnapshotHash,
    serverFullPayloadHash: ctx.fullPayloadHash,
    trustedCanonicalClaimIds: ctx.trustedCanonicalClaimIds,
    activeCanonicalGameplayReceiptCount: ctx.activeCanonicalGameplayReceiptCount,
  });
}

export type PreviewCanonicalLegacyProgressionMigrationResult =
  | {
      ok: true;
      eligible: boolean;
      migrationStatus: LegacyMigrationPreviewStatus;
      previewAuthorityClass: LegacyMigrationPreviewAuthorityClass;
      policyVersion: string;
      attestationClass: string | null;
      sourceSaveVersion: number | null;
      sourceSaveRevision: string | null;
      sourceSnapshotHash: string | null;
      structuralValidation: LegacyProgressionMigrationEvaluation['structure'];
      canonicalStateConflict: boolean;
      rewardHistoryClassification: LegacyMigrationPreviewStatus;
      proposedBaseline: LegacyProgressionValues | null;
      blockers: string[];
      warnings: string[];
      recommendedPolicy: typeof RECOMMENDED_LEGACY_MIGRATION_POLICY;
      evaluation: LegacyProgressionMigrationEvaluation;
    }
  | { ok: false; reason: string };

export async function previewCanonicalLegacyProgressionMigration(
  firestore: Firestore,
  uid: string,
  nowMs: number,
  options?: { envValue?: string | null },
): Promise<PreviewCanonicalLegacyProgressionMigrationResult> {
  if (!isAuthenticatedUid(uid)) return { ok: false, reason: 'UNAUTHENTICATED' };
  if (!isCanonicalProgressionMigrationAllowed({ envValue: options?.envValue })) {
    return { ok: false, reason: MIGRATION_OFF };
  }

  const ctx = await loadLegacyMigrationContext(firestore, uid);
  const frozen = readFrozenMigrationSource(ctx.migrationSourceDoc);
  const evaluation = frozen.ok
    ? evaluateLegacyMigrationFromContext(uid, nowMs, {
        ...ctx,
        saveDoc: syntheticSaveFromFrozen(uid, frozen.source),
        migrationSnapshotHash: normalizeStoredHash(frozen.source.sourceSnapshotHash),
        fullPayloadHash: null,
      })
    : evaluateLegacyMigrationFromContext(uid, nowMs, ctx);
  const migrationStatus = frozen.integrityError
    ? 'LEGACY_SAVE_CONFLICT'
    : mapLegacyMigrationPreviewStatus(evaluation);
  const warnings = [...evaluation.flags];
  if (!frozen.ok) {
    warnings.push('SOURCE_MUTABLE', 'NOT_MIGRATION_LOCKED', 'CUTOVER_SOURCE_REVALIDATED_AT_COMMIT');
  }
  if (frozen.ok && ctx.migrationSnapshotHash && normalizeStoredHash(frozen.source.sourceSnapshotHash) !== ctx.migrationSnapshotHash) {
    warnings.push('SAVE_DIVERGED_FROM_FROZEN_SOURCE');
  }
  if (frozen.integrityError) evaluation.blockers.unshift(MIGRATION_SOURCE_HASH_INTEGRITY_ERROR);
  if (evaluation.source?.integrityStatus === 'PAYLOAD_CHECKSUM_MISSING') {
    warnings.push('SOURCE_PAYLOAD_CHECKSUM_MISSING');
  }

  return {
    ok: true,
    eligible: frozen.integrityError ? false : evaluation.applyable,
    migrationStatus,
    previewAuthorityClass: frozen.ok ? 'FROZEN_SOURCE_PREVIEW' : 'MUTABLE_SAVE_PREVIEW',
    policyVersion: evaluation.policyVersion,
    attestationClass: evaluation.attestationClass,
    sourceSaveVersion: evaluation.source?.sourceSaveVersion ?? null,
    sourceSaveRevision: evaluation.source?.sourceSyncId ?? null,
    sourceSnapshotHash: evaluation.source?.sourceSnapshotHash ?? null,
    structuralValidation: evaluation.structure,
    canonicalStateConflict:
      migrationStatus === 'LEGACY_CANONICAL_STATE_CONFLICT' ||
      evaluation.blockers.includes(MIGRATION_ALREADY_CANONICAL_ACTIVE),
      rewardHistoryClassification:
        evaluation.structure.rewardHistory === 'STRUCTURALLY_INVALID'
          ? 'LEGACY_STRUCTURALLY_INVALID'
          : evaluation.trustedEvidence.canonicalRewardClaimIds.length > 0
            ? 'LEGACY_REWARD_HISTORY_PARTIAL'
            : 'LEGACY_REWARD_HISTORY_UNVERIFIED',
    proposedBaseline: evaluation.proposedBaseline,
    blockers: evaluation.blockers,
    warnings,
    recommendedPolicy: RECOMMENDED_LEGACY_MIGRATION_POLICY,
    evaluation,
  };
}

export type ApplyCanonicalLegacyProgressionMigrationResult =
  | {
      ok: true;
      alreadyMigrated: boolean;
      migrationStatus: LegacyMigrationPreviewStatus;
      sourceSnapshotHash: string | null;
      progressionRevision: number;
    }
  | { ok: false; reason: string };

export async function applyCanonicalLegacyProgressionMigration(
  firestore: Firestore,
  uid: string,
  nowMs: number,
  options?: { envValue?: string | null },
): Promise<ApplyCanonicalLegacyProgressionMigrationResult> {
  if (!isAuthenticatedUid(uid)) return { ok: false, reason: 'UNAUTHENTICATED' };
  if (!isCanonicalProgressionMigrationAllowed({ envValue: options?.envValue })) {
    return { ok: false, reason: MIGRATION_OFF };
  }

  return firestore.runTransaction(async (transaction) => {
    const progressionRef = firestore.doc(canonicalCompanyProgressionPath(uid));
    const migrationRef = firestore.doc(canonicalProgressionMigrationPath(uid));
    const migrationReceiptRef = firestore.doc(canonicalProgressionMigrationReceiptPath(uid));
    const sourceRef = firestore.doc(canonicalProgressionMigrationSourcePath(uid));
    const baselineReceiptRef = firestore.doc(
      canonicalProgressionReceiptPath(uid, PROGRESSION_MIGRATION_OPERATION_ID),
    );

    const [progressionSnap, migrationSnap, migrationReceiptSnap, sourceSnap, baselineReceiptSnap, serverStateSnap] =
      await Promise.all([
        transaction.get(progressionRef),
        transaction.get(migrationRef),
        transaction.get(migrationReceiptRef),
        transaction.get(sourceRef),
        transaction.get(baselineReceiptRef),
        transaction.get(firestore.doc(`users/${uid}/serverState/current`)),
      ]);

    const claimRows = await listCollectionDocs(
      transaction,
      firestore,
      `users/${uid}/${CANONICAL_REWARD_CLAIMS_COLLECTION}`,
    );
    const receiptRows = await listCollectionDocs(
      transaction,
      firestore,
      `users/${uid}/${CANONICAL_PROGRESSION_RECEIPTS_COLLECTION}`,
    );

    const migrationRecordDoc = migrationSnap.exists ? (migrationSnap.data() as Record<string, unknown>) : null;
    const progressionDoc = progressionSnap.exists ? (progressionSnap.data() as Record<string, unknown>) : null;
    const sourceDoc = sourceSnap.exists ? (sourceSnap.data() as Record<string, unknown>) : null;
    const frozen = readFrozenMigrationSource(sourceDoc);

    const trustedCanonicalClaimIds = claimRows
      .map((row) => (typeof row.claimId === 'string' ? row.claimId : null))
      .filter((id): id is string => Boolean(id))
      .sort();

    const activeCanonicalGameplayReceiptCount = receiptRows.filter(
      (row) => row.operationId !== PROGRESSION_MIGRATION_OPERATION_ID,
    ).length;

    const evaluation = evaluateLegacyProgressionMigration({
      uid,
      nowMs,
      progressionDoc,
      migrationRecordDoc,
      saveDoc: frozen.ok ? syntheticSaveFromFrozen(uid, frozen.source) : null,
      serverStateDoc: serverStateSnap.exists ? (serverStateSnap.data() as Record<string, unknown>) : null,
      serverMigrationSnapshotHash: frozen.ok ? normalizeStoredHash(frozen.source.sourceSnapshotHash) : null,
      serverFullPayloadHash: null,
      trustedCanonicalClaimIds,
      activeCanonicalGameplayReceiptCount,
    });

    const recordClass = classifyCanonicalProgressionMigrationRecord(migrationRecordDoc, uid);
    if (recordClass.kind === 'MIGRATED' && migrationReceiptSnap.exists && progressionSnap.exists) {
      const state = progressionDoc;
      return {
        ok: true as const,
        alreadyMigrated: true,
        migrationStatus: 'ALREADY_MIGRATED',
        sourceSnapshotHash: recordClass.record.source.sourceSnapshotHash,
        progressionRevision: typeof state?.progressionRevision === 'number' ? state.progressionRevision : 1,
      };
    }

    if (migrationSnap.exists || migrationReceiptSnap.exists) {
      if (recordClass.kind !== 'MIGRATED') return { ok: false as const, reason: MIGRATION_RECORD_INCONSISTENT };
      return { ok: false as const, reason: MIGRATION_ALREADY_MIGRATED };
    }

    if (progressionSnap.exists) {
      if (evaluation.accountClass === 'ALREADY_MIGRATED') {
        return { ok: false as const, reason: MIGRATION_RECORD_INCONSISTENT };
      }
      return { ok: false as const, reason: MIGRATION_ALREADY_CANONICAL_ACTIVE };
    }

    if (baselineReceiptSnap.exists || activeCanonicalGameplayReceiptCount > 0) {
      return { ok: false as const, reason: MIGRATION_BLOCKED_ACTIVE_CANONICAL_HISTORY };
    }

    if (!frozen.ok) {
      return {
        ok: false as const,
        reason: frozen.integrityError ? MIGRATION_SOURCE_HASH_INTEGRITY_ERROR : MIGRATION_SOURCE_NOT_FROZEN,
      };
    }

    if (!evaluation.applyable) {
      const reason = evaluation.blockers[0] ?? MIGRATION_BLOCKED_MIGRATION_INELIGIBLE;
      return { ok: false as const, reason };
    }

    const artifacts = buildCanonicalProgressionMigrationArtifacts(evaluation, uid, nowMs);
    if (!artifacts) return { ok: false as const, reason: MIGRATION_BLOCKED_MIGRATION_INELIGIBLE };

    transaction.create(migrationRef, {
      ...artifacts.record,
      authorityClass: artifacts.record.attestationClass,
      baselineTotalXp: artifacts.record.baseline.totalXp,
      baselineLevelDerived: artifacts.record.baseline.level,
      baselineXpDerived: artifacts.record.baseline.xp,
      baselineReputation: artifacts.record.baseline.reputation,
      rewardHistoryPolicy: artifacts.record.rewardHistory.policy,
      sourceSaveVersion: artifacts.record.source.sourceSaveVersion,
      sourceSaveRevision: artifacts.record.source.sourceSyncId,
      sourceSnapshotHash: artifacts.record.source.sourceSnapshotHash,
      migrationSourceId: frozen.source.freezeId,
      migrationSourcePolicyVersion: frozen.source.policyVersion,
      frozenAtServerMs: frozen.source.frozenAtServerMs,
    });
    transaction.create(migrationReceiptRef, {
      ...artifacts.receipt,
      createdAtServerMs: artifacts.receipt.createdAtMs,
      sourceSaveVersion: artifacts.receipt.source.sourceSaveVersion,
      sourceSaveRevision: artifacts.receipt.source.sourceSyncId,
      sourceSnapshotHash: artifacts.receipt.source.sourceSnapshotHash,
      migrationSourceId: frozen.source.freezeId,
      migrationSourcePolicyVersion: frozen.source.policyVersion,
      frozenAtServerMs: frozen.source.frozenAtServerMs,
    });
    transaction.create(progressionRef, { ...artifacts.state });
    transaction.create(baselineReceiptRef, { ...artifacts.baselineReceipt });

    return {
      ok: true as const,
      alreadyMigrated: false,
      migrationStatus: mapLegacyMigrationPreviewStatus(evaluation),
      sourceSnapshotHash: evaluation.source?.sourceSnapshotHash ?? null,
      progressionRevision: artifacts.state.progressionRevision,
    };
  });
}

export type FreezeCanonicalProgressionMigrationSourceResult =
  | {
      ok: true;
      alreadyFrozen: boolean;
      reason: typeof MIGRATION_SOURCE_ALREADY_FROZEN | null;
      freezeId: string;
      sourceSnapshotHash: string;
      freezeStatus: typeof MIGRATION_SOURCE_FREEZE_STATUS;
      authorityClass: typeof SERVER_FROZEN_LEGACY_MIGRATION_SOURCE;
      refreezePolicy: typeof MIGRATION_SOURCE_REFREEZE_POLICY;
      abortPolicy: typeof MIGRATION_SOURCE_ABORT_POLICY;
      normalizedSnapshotBytes: number;
    }
  | { ok: false; reason: string };

export async function freezeCanonicalProgressionMigrationSource(
  firestore: Firestore,
  uid: string,
  nowMs: number,
  options?: { envValue?: string | null; migrationPolicyVersion?: string | null },
): Promise<FreezeCanonicalProgressionMigrationSourceResult> {
  if (!isAuthenticatedUid(uid)) return { ok: false, reason: 'UNAUTHENTICATED' };
  if (!isCanonicalProgressionMigrationAllowed({ envValue: options?.envValue })) {
    return { ok: false, reason: MIGRATION_OFF };
  }
  if (!isSupportedMigrationSourcePolicy(options?.migrationPolicyVersion ?? undefined)) {
    return { ok: false, reason: MIGRATION_SOURCE_POLICY_UNKNOWN };
  }

  return firestore.runTransaction(async (transaction) => {
    const saveRef = firestore.doc(`users/${uid}/saves/current`);
    const sourceRef = firestore.doc(canonicalProgressionMigrationSourcePath(uid));
    const sourceReceiptRef = firestore.doc(canonicalProgressionMigrationSourceReceiptPath(uid));
    const [saveSnap, progressionSnap, migrationSnap, sourceSnap, serverStateSnap] = await Promise.all([
      transaction.get(saveRef),
      transaction.get(firestore.doc(canonicalCompanyProgressionPath(uid))),
      transaction.get(firestore.doc(canonicalProgressionMigrationPath(uid))),
      transaction.get(sourceRef),
      transaction.get(firestore.doc(`users/${uid}/serverState/current`)),
    ]);

    const existing = sourceSnap.exists ? (sourceSnap.data() as Record<string, unknown>) : null;
    const frozen = readFrozenMigrationSource(existing);
    if (frozen.ok) {
      const snapshotJson = migrationNormalizedSnapshotJson(frozen.snapshot);
      return {
        ok: true as const,
        alreadyFrozen: true,
        reason: MIGRATION_SOURCE_ALREADY_FROZEN,
        freezeId: canonicalProgressionMigrationSourceId(uid),
        sourceSnapshotHash: String(frozen.source.sourceSnapshotHash),
        freezeStatus: MIGRATION_SOURCE_FREEZE_STATUS,
        authorityClass: SERVER_FROZEN_LEGACY_MIGRATION_SOURCE,
        refreezePolicy: MIGRATION_SOURCE_REFREEZE_POLICY,
        abortPolicy: MIGRATION_SOURCE_ABORT_POLICY,
        normalizedSnapshotBytes: Buffer.byteLength(snapshotJson, 'utf8'),
      };
    }
    if (existing) return { ok: false as const, reason: MIGRATION_SOURCE_HASH_INTEGRITY_ERROR };

    const migrationRecordDoc = migrationSnap.exists ? (migrationSnap.data() as Record<string, unknown>) : null;
    if (classifyCanonicalProgressionMigrationRecord(migrationRecordDoc, uid).kind === 'MIGRATED') {
      return { ok: false as const, reason: MIGRATION_ALREADY_MIGRATED };
    }
    if (progressionSnap.exists) {
      return { ok: false as const, reason: CANONICAL_PROGRESSION_ALREADY_ACTIVE };
    }

    const claimRows = await listCollectionDocs(transaction, firestore, `users/${uid}/${CANONICAL_REWARD_CLAIMS_COLLECTION}`);
    const receiptRows = await listCollectionDocs(
      transaction,
      firestore,
      `users/${uid}/${CANONICAL_PROGRESSION_RECEIPTS_COLLECTION}`,
    );
    const saveDoc = saveSnap.exists ? (saveSnap.data() as Record<string, unknown>) : null;
    const gameState = saveDoc ? rec(saveDoc.gameState) : null;
    const hashes = gameState ? computeServerMigrationHashes(gameState) : { migrationSnapshotHash: null, fullPayloadHash: null };
    const evaluation = evaluateLegacyProgressionMigration({
      uid,
      nowMs,
      progressionDoc: progressionSnap.exists ? (progressionSnap.data() as Record<string, unknown>) : null,
      migrationRecordDoc,
      saveDoc,
      serverStateDoc: serverStateSnap.exists ? (serverStateSnap.data() as Record<string, unknown>) : null,
      serverMigrationSnapshotHash: hashes.migrationSnapshotHash,
      serverFullPayloadHash: hashes.fullPayloadHash,
      trustedCanonicalClaimIds: claimRows
        .map((row) => (typeof row.claimId === 'string' ? row.claimId : null))
        .filter((id): id is string => Boolean(id)),
      activeCanonicalGameplayReceiptCount: receiptRows.filter((row) => row.operationId !== PROGRESSION_MIGRATION_OPERATION_ID)
        .length,
    });

    if (evaluation.accountClass === 'ALREADY_CANONICAL_ACTIVE') {
      return { ok: false as const, reason: CANONICAL_PROGRESSION_ALREADY_ACTIVE };
    }
    if (
      evaluation.blockers.includes('MIGRATION_BLOCKED_SAVE_INTEGRITY') ||
      evaluation.blockers.includes('MIGRATION_BLOCKED_SAVE_OWNER_MISMATCH')
    ) {
      return { ok: false as const, reason: MIGRATION_SOURCE_BLOCKED_SAVE_CONFLICT };
    }
    if (evaluation.blockers.includes(LEGACY_PROGRESSION_META_PLAYER_CONFLICT)) {
      return { ok: false as const, reason: LEGACY_PROGRESSION_META_PLAYER_CONFLICT };
    }
    if (!evaluation.applyable || !gameState || !hashes.migrationSnapshotHash) {
      return { ok: false as const, reason: evaluation.blockers[0] ?? MIGRATION_BLOCKED_MIGRATION_INELIGIBLE };
    }

    const snapshot = buildNormalizedLegacyMigrationSnapshot(gameState);
    if (!snapshot) return { ok: false as const, reason: MIGRATION_BLOCKED_MIGRATION_INELIGIBLE };
    const snapshotJson = migrationNormalizedSnapshotJson(snapshot);
    const freezeId = canonicalProgressionMigrationSourceId(uid);
    const sourceSnapshotHash = `sha256:${hashes.migrationSnapshotHash}`;
    transaction.create(sourceRef, {
      schemaVersion: 1,
      policyVersion: CANONICAL_PROGRESSION_MIGRATION_SOURCE_POLICY_VERSION,
      freezeId,
      ownerUid: uid,
      sourceSaveVersion: evaluation.source?.sourceSaveVersion ?? null,
      sourceSaveRevision: evaluation.source?.sourceSyncId ?? null,
      sourceSnapshotHash,
      normalizedSnapshot: snapshot,
      authorityClass: SERVER_FROZEN_LEGACY_MIGRATION_SOURCE,
      attestationClass: evaluation.attestationClass,
      freezeStatus: MIGRATION_SOURCE_FREEZE_STATUS,
      frozenAtServerMs: nowMs,
      refreezePolicy: MIGRATION_SOURCE_REFREEZE_POLICY,
      abortPolicy: MIGRATION_SOURCE_ABORT_POLICY,
      gameplayAuthority: 'NOT_RECONSTRUCTED_LEGACY_HISTORY',
    });
    transaction.create(sourceReceiptRef, {
      sourceId: freezeId,
      policyVersion: CANONICAL_PROGRESSION_MIGRATION_SOURCE_POLICY_VERSION,
      saveVersion: evaluation.source?.sourceSaveVersion ?? null,
      saveRevision: evaluation.source?.sourceSyncId ?? null,
      snapshotHash: sourceSnapshotHash,
      frozenAtServerMs: nowMs,
      ownerUid: uid,
    });
    return {
      ok: true as const,
      alreadyFrozen: false,
      reason: null,
      freezeId,
      sourceSnapshotHash,
      freezeStatus: MIGRATION_SOURCE_FREEZE_STATUS,
      authorityClass: SERVER_FROZEN_LEGACY_MIGRATION_SOURCE,
      refreezePolicy: MIGRATION_SOURCE_REFREEZE_POLICY,
      abortPolicy: MIGRATION_SOURCE_ABORT_POLICY,
      normalizedSnapshotBytes: Buffer.byteLength(snapshotJson, 'utf8'),
    };
  });
}

/**
 * Step 29AL — freeze the migration source and create the canonical baseline in one transaction.
 * Firestore retries the transaction when a document read here (including saves/current) changes
 * before commit. A retry re-reads that committed save and normalizes it again. This harness does
 * not simulate that retry. A save written after commit is not progression authority.
 * The separate freeze API remains NOT_PUBLIC_CUTOVER_PATH. Apply remains INTERNAL_PRE_FROZEN_SOURCE_PATH.
 */
export type CutoverCanonicalLegacyProgressionMigrationResult =
  | {
      ok: true;
      alreadyMigrated: boolean;
      migrationStatus: 'MIGRATED' | 'ALREADY_MIGRATED';
      sourceSnapshotHash: string | null;
      migrationId: string;
      progressionRevision: number;
      cutoverPolicyVersion: typeof CANONICAL_PROGRESSION_IMMEDIATE_CUTOVER_POLICY_VERSION;
    }
  | { ok: false; reason: string };

export async function cutoverCanonicalLegacyProgressionMigration(
  firestore: Firestore,
  uid: string,
  nowMs: number,
  options?: { envValue?: string | null; cutoverPolicyVersion?: string | null },
): Promise<CutoverCanonicalLegacyProgressionMigrationResult> {
  if (!isAuthenticatedUid(uid)) return { ok: false, reason: 'UNAUTHENTICATED' };
  if (!isCanonicalProgressionImmediateCutoverAllowed({ envValue: options?.envValue })) {
    return { ok: false, reason: 'CANONICAL_PROGRESSION_IMMEDIATE_CUTOVER_OFF' };
  }
  if (!isSupportedImmediateCutoverPolicy(options?.cutoverPolicyVersion ?? undefined)) {
    return { ok: false, reason: MIGRATION_SOURCE_POLICY_UNKNOWN };
  }

  return firestore.runTransaction(async (transaction) => {
    const saveRef = firestore.doc(`users/${uid}/saves/current`);
    const progressionRef = firestore.doc(canonicalCompanyProgressionPath(uid));
    const migrationRef = firestore.doc(canonicalProgressionMigrationPath(uid));
    const migrationReceiptRef = firestore.doc(canonicalProgressionMigrationReceiptPath(uid));
    const sourceRef = firestore.doc(canonicalProgressionMigrationSourcePath(uid));
    const sourceReceiptRef = firestore.doc(canonicalProgressionMigrationSourceReceiptPath(uid));
    const baselineReceiptRef = firestore.doc(canonicalProgressionReceiptPath(uid, PROGRESSION_MIGRATION_OPERATION_ID));

    const [saveSnap, progressionSnap, migrationSnap, migrationReceiptSnap, sourceSnap, baselineReceiptSnap, serverStateSnap] =
      await Promise.all([
        transaction.get(saveRef),
        transaction.get(progressionRef),
        transaction.get(migrationRef),
        transaction.get(migrationReceiptRef),
        transaction.get(sourceRef),
        transaction.get(baselineReceiptRef),
        transaction.get(firestore.doc(`users/${uid}/serverState/current`)),
      ]);

    const claimRows = await listCollectionDocs(transaction, firestore, `users/${uid}/${CANONICAL_REWARD_CLAIMS_COLLECTION}`);
    const receiptRows = await listCollectionDocs(
      transaction,
      firestore,
      `users/${uid}/${CANONICAL_PROGRESSION_RECEIPTS_COLLECTION}`,
    );
    const migrationRecordDoc = migrationSnap.exists ? (migrationSnap.data() as Record<string, unknown>) : null;
    const progressionDoc = progressionSnap.exists ? (progressionSnap.data() as Record<string, unknown>) : null;
    const recordClass = classifyCanonicalProgressionMigrationRecord(migrationRecordDoc, uid);
    if (recordClass.kind === 'MIGRATED' && migrationReceiptSnap.exists && progressionSnap.exists) {
      return {
        ok: true as const,
        alreadyMigrated: true,
        migrationStatus: 'ALREADY_MIGRATED' as const,
        sourceSnapshotHash: recordClass.record.source.sourceSnapshotHash,
        migrationId: recordClass.record.migrationId,
        progressionRevision: typeof progressionDoc?.progressionRevision === 'number' ? progressionDoc.progressionRevision : 1,
        cutoverPolicyVersion: CANONICAL_PROGRESSION_IMMEDIATE_CUTOVER_POLICY_VERSION,
      };
    }
    if (sourceSnap.exists && recordClass.kind !== 'MIGRATED') {
      return { ok: false as const, reason: MIGRATION_SOURCE_PREEXISTING_FROZEN_REQUIRES_RESOLUTION };
    }
    if (progressionSnap.exists) return { ok: false as const, reason: MIGRATION_ALREADY_CANONICAL_ACTIVE };
    const activeCanonicalGameplayReceiptCount = receiptRows.filter(
      (row) => row.operationId !== PROGRESSION_MIGRATION_OPERATION_ID,
    ).length;
    if (baselineReceiptSnap.exists || activeCanonicalGameplayReceiptCount > 0) {
      return { ok: false as const, reason: MIGRATION_BLOCKED_ACTIVE_CANONICAL_HISTORY };
    }

    const saveDoc = saveSnap.exists ? (saveSnap.data() as Record<string, unknown>) : null;
    const gameState = saveDoc ? rec(saveDoc.gameState) : null;
    const hashes = gameState ? computeServerMigrationHashes(gameState) : { migrationSnapshotHash: null, fullPayloadHash: null };
    const evaluation = evaluateLegacyProgressionMigration({
      uid,
      nowMs,
      progressionDoc,
      migrationRecordDoc,
      saveDoc,
      serverStateDoc: serverStateSnap.exists ? (serverStateSnap.data() as Record<string, unknown>) : null,
      serverMigrationSnapshotHash: hashes.migrationSnapshotHash,
      serverFullPayloadHash: hashes.fullPayloadHash,
      trustedCanonicalClaimIds: claimRows
        .map((row) => (typeof row.claimId === 'string' ? row.claimId : null))
        .filter((id): id is string => Boolean(id)),
      activeCanonicalGameplayReceiptCount,
    });
    if (
      evaluation.blockers.includes('MIGRATION_BLOCKED_SAVE_INTEGRITY') ||
      evaluation.blockers.includes('MIGRATION_BLOCKED_SAVE_OWNER_MISMATCH')
    ) {
      return { ok: false as const, reason: MIGRATION_SOURCE_BLOCKED_SAVE_CONFLICT };
    }
    if (!evaluation.applyable || !gameState || !hashes.migrationSnapshotHash) {
      return { ok: false as const, reason: evaluation.blockers[0] ?? MIGRATION_BLOCKED_MIGRATION_INELIGIBLE };
    }
    const snapshot = buildNormalizedLegacyMigrationSnapshot(gameState);
    const artifacts = buildCanonicalProgressionMigrationArtifacts(evaluation, uid, nowMs);
    if (!snapshot || !artifacts) return { ok: false as const, reason: MIGRATION_BLOCKED_MIGRATION_INELIGIBLE };

    const sourceSnapshotHash = `sha256:${hashes.migrationSnapshotHash}`;
    const freezeId = canonicalProgressionMigrationSourceId(uid);
    const frozenAtServerMs = nowMs;
    transaction.create(sourceRef, {
      schemaVersion: 1,
      policyVersion: CANONICAL_PROGRESSION_MIGRATION_SOURCE_POLICY_VERSION,
      cutoverPolicyVersion: CANONICAL_PROGRESSION_IMMEDIATE_CUTOVER_POLICY_VERSION,
      freezeId,
      ownerUid: uid,
      sourceSaveVersion: evaluation.source?.sourceSaveVersion ?? null,
      sourceSaveRevision: evaluation.source?.sourceSyncId ?? null,
      sourceSnapshotHash,
      normalizedSnapshot: snapshot,
      authorityClass: SERVER_FROZEN_LEGACY_MIGRATION_SOURCE,
      attestationClass: evaluation.attestationClass,
      freezeStatus: MIGRATION_SOURCE_FREEZE_STATUS_AT_CUTOVER,
      frozenAtServerMs,
      refreezePolicy: MIGRATION_SOURCE_REFREEZE_POLICY,
      abortPolicy: MIGRATION_SOURCE_ABORT_POLICY,
      gameplayAuthority: 'NOT_RECONSTRUCTED_LEGACY_HISTORY',
      publicCutoverPath: false,
    });
    transaction.create(sourceReceiptRef, {
      sourceId: freezeId,
      policyVersion: CANONICAL_PROGRESSION_MIGRATION_SOURCE_POLICY_VERSION,
      cutoverPolicyVersion: CANONICAL_PROGRESSION_IMMEDIATE_CUTOVER_POLICY_VERSION,
      saveVersion: evaluation.source?.sourceSaveVersion ?? null,
      saveRevision: evaluation.source?.sourceSyncId ?? null,
      snapshotHash: sourceSnapshotHash,
      frozenAtServerMs,
      ownerUid: uid,
    });
    transaction.create(migrationRef, {
      ...artifacts.record,
      cutoverPolicyVersion: CANONICAL_PROGRESSION_IMMEDIATE_CUTOVER_POLICY_VERSION,
      authorityClass: artifacts.record.attestationClass,
      baselineTotalXp: artifacts.record.baseline.totalXp,
      baselineLevelDerived: artifacts.record.baseline.level,
      baselineXpDerived: artifacts.record.baseline.xp,
      baselineReputation: artifacts.record.baseline.reputation,
      rewardHistoryPolicy: artifacts.record.rewardHistory.policy,
      sourceSaveVersion: artifacts.record.source.sourceSaveVersion,
      sourceSaveRevision: artifacts.record.source.sourceSyncId,
      sourceSnapshotHash,
      migrationSourceId: freezeId,
      migrationSourcePolicyVersion: CANONICAL_PROGRESSION_MIGRATION_SOURCE_POLICY_VERSION,
      frozenAtServerMs,
    });
    transaction.create(migrationReceiptRef, {
      ...artifacts.receipt,
      createdAtServerMs: frozenAtServerMs,
      cutoverPolicyVersion: CANONICAL_PROGRESSION_IMMEDIATE_CUTOVER_POLICY_VERSION,
      sourceSnapshotHash,
      migrationSourceId: freezeId,
      migrationSourcePolicyVersion: CANONICAL_PROGRESSION_MIGRATION_SOURCE_POLICY_VERSION,
      frozenAtServerMs,
    });
    transaction.create(progressionRef, { ...artifacts.state });
    transaction.create(baselineReceiptRef, { ...artifacts.baselineReceipt, sourceSnapshotHash });

    return {
      ok: true as const,
      alreadyMigrated: false,
      migrationStatus: 'MIGRATED' as const,
      sourceSnapshotHash,
      migrationId: artifacts.record.migrationId,
      progressionRevision: artifacts.state.progressionRevision,
      cutoverPolicyVersion: CANONICAL_PROGRESSION_IMMEDIATE_CUTOVER_POLICY_VERSION,
    };
  });
}

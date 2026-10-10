/**
 * Step 29AJ — legacy progression migration preview/apply (in-memory Firestore).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';

import {
  applyCanonicalLegacyProgressionMigration,
  computeServerMigrationHashes,
  cutoverCanonicalLegacyProgressionMigration,
  freezeCanonicalProgressionMigrationSource,
  previewCanonicalLegacyProgressionMigration,
  sha256HexUtf8,
} from '../src/canonicalLegacyProgressionMigration';
import { claimCanonicalClientRewardTransaction } from '../src/canonicalClientRewardXp';
import { readCanonicalProgressionContext, planCanonicalProgressionWrite } from '../src/canonicalCompanyProgression';
import { generateCanonicalProductionRoadBatchTransaction } from '../src/canonicalProductionRoadContractIssuance';
import { serverStateCurrentRef } from '../src/canonicalCashTransaction';
import {
  canonicalCompanyProgressionPath,
  canonicalProgressionReceiptPath,
} from '../../src/domain/canonicalCompanyProgression';
import {
  LEGACY_PROGRESSION_META_PLAYER_CONFLICT,
  LEGACY_PROGRESSION_MIGRATION_SUPPORTED_SAVE_VERSION,
  CANONICAL_PROGRESSION_ALREADY_ACTIVE,
  MIGRATION_ALREADY_CANONICAL_ACTIVE,
  MIGRATION_ALREADY_MIGRATED,
  MIGRATION_BLOCKED_ACTIVE_CANONICAL_HISTORY,
  MIGRATION_OFF,
  MIGRATION_SOURCE_ALREADY_FROZEN,
  MIGRATION_SOURCE_BLOCKED_SAVE_CONFLICT,
  MIGRATION_SOURCE_HASH_INTEGRITY_ERROR,
  MIGRATION_SOURCE_NOT_FROZEN,
  MIGRATION_SOURCE_PREEXISTING_FROZEN_REQUIRES_RESOLUTION,
  MIGRATION_SOURCE_FREEZE_STATUS_AT_CUTOVER,
  hasOnlyCanonicalProgressionImmediateCutoverKeys,
  PROGRESSION_MIGRATION_OPERATION_ID,
  buildNormalizedLegacyMigrationSnapshot,
  canonicalProgressionMigrationPath,
  canonicalProgressionMigrationReceiptPath,
  canonicalProgressionMigrationSourcePath,
  hasOnlyCanonicalProgressionMigrationApplyKeys,
  hasOnlyCanonicalProgressionMigrationFreezeKeys,
  hasOnlyCanonicalProgressionMigrationPreviewKeys,
  deriveProgressionFromTotalXp,
  formatMigrationSnapshotHash,
  migrationNormalizedSnapshotJson,
  validateLegacyProgressionStructure,
  CLIENT_REWARD_LEGACY_CLAIM_CONSUMED_BY_MIGRATION,
  cloudSaveSnapshotHashInput,
} from '../../src/domain/canonicalLegacyProgressionMigration';
import { reputationBalance } from '../../src/config/balance';
import { calculateXpToNextLevel, levelConfig } from '../../src/config/levelConfig';
import { resolveCanonicalWeeklyCycle } from '../../src/domain/canonicalClientRewardXp';

type Dump = Map<string, Record<string, unknown>>;

function createMemoryFirestore(): Firestore & { dump: Dump } {
  const dump: Dump = new Map();
  let chain: Promise<unknown> = Promise.resolve();
  const firestore = {
    dump,
    doc(path: string) {
      return {
        path,
        _col: false as const,
        async get() {
          const data = dump.get(path);
          return {
            exists: Boolean(data),
            data: () => (data ? { ...data } : undefined),
          };
        },
      };
    },
    collection(path: string) {
      return {
        path,
        _col: true as const,
        async get() {
          const prefix = `${path.replace(/\/$/, '')}/`;
          const docs = [...dump.entries()]
            .filter(([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
            .map(([key, data]) => ({
              id: key.slice(prefix.length),
              data: () => ({ ...data }),
            }));
          return { docs, empty: docs.length === 0 };
        },
      };
    },
    runTransaction<T>(operation: (transaction: {
      get: (ref: { path: string; _col?: boolean }) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined; docs: Array<{ id: string; data: () => Record<string, unknown> }> }>;
      create: (ref: { path: string }, data: Record<string, unknown>) => void;
    }) => Promise<T>): Promise<T> {
      const run = chain.then(async () => {
        const writes: Array<() => void> = [];
        const result = await operation({
          async get(ref) {
            if (ref._col) {
              const prefix = `${ref.path.replace(/\/$/, '')}/`;
              const docs = [...dump.entries()]
                .filter(([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
                .map(([key, data]) => ({ id: key.slice(prefix.length), data: () => ({ ...data }) }));
              return { exists: docs.length > 0, data: () => undefined, docs };
            }
            const data = dump.get(ref.path);
            return { exists: Boolean(data), data: () => (data ? { ...data } : undefined), docs: [] };
          },
          create(ref, data) {
            writes.push(() => {
              if (dump.has(ref.path)) throw new Error('already-exists');
              dump.set(ref.path, { ...data });
            });
          },
        });
        for (const write of writes) write();
        return result;
      });
      chain = run.catch(() => undefined);
      return run;
    },
  };
  return firestore as unknown as Firestore & { dump: Dump };
}

const ON = { envValue: 'INTERNAL_TEST' as const };
const NOW = 1_700_100_000_000;

function legacySave(uid: string, player: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const totalXp = Number(player.totalXp ?? player.xp ?? 0);
  const derived = deriveProgressionFromTotalXp(totalXp);
  assert.equal(derived.ok, true);
  const level = derived.ok ? derived.level : 1;
  const xp = derived.ok ? derived.xp : 0;
  const reputation = Number(player.reputation ?? reputationBalance.initial);
  const gameState = {
    version: LEGACY_PROGRESSION_MIGRATION_SUPPORTED_SAVE_VERSION,
    ownerUid: uid,
    player: {
      companyLevel: level,
      xpToNextLevel: calculateXpToNextLevel(level),
      ...player,
      level,
      xp,
      totalXp,
      reputation,
    },
    meta: {
      level,
      xp,
      totalXp,
      saveVersion: LEGACY_PROGRESSION_MIGRATION_SUPPORTED_SAVE_VERSION,
    },
    missions: { claimedMissionRewardIds: [] },
    retention: {
      milestones: {},
      weeklyObjectives: {},
      currentWeeklySeasonKey: resolveCanonicalWeeklyCycle(NOW).cycleId,
    },
    rewardReceipts: {},
    ...extra,
  };
  const payloadChecksum = sha256HexUtf8(cloudSaveSnapshotHashInput(gameState));
  return {
    ownerUid: uid,
    schemaVersion: 1,
    saveVersion: LEGACY_PROGRESSION_MIGRATION_SUPPORTED_SAVE_VERSION,
    gameState,
    payloadChecksum,
    syncId: `${uid}:6:1000`,
    deviceUpdatedAt: 1000,
  };
}

test('deriveProgressionFromTotalXp and structural validation', () => {
  const mid = deriveProgressionFromTotalXp(500);
  assert.equal(mid.ok, true);
  if (!mid.ok) return;
  assert.ok(mid.level >= 1);
  let total = 0;
  for (let l = 1; l < levelConfig.maxLevel; l += 1) total += calculateXpToNextLevel(l);
  const max = deriveProgressionFromTotalXp(total + 999);
  assert.equal(max.ok, true);
  if (!max.ok) return;
  assert.equal(max.level, levelConfig.maxLevel);
  assert.equal(max.xp, 0);

  const valid = validateLegacyProgressionStructure(
    { level: mid.level, xp: mid.xp, xpToNextLevel: mid.xpToNextLevel, totalXp: 500, reputation: 50 },
    { level: mid.level, xp: mid.xp, totalXp: 500 },
  );
  assert.equal(valid.xpStatus, 'STRUCTURALLY_VALID');

  const conflict = validateLegacyProgressionStructure(
    { level: 5, xp: 10, xpToNextLevel: calculateXpToNextLevel(5), totalXp: 500, reputation: 50 },
    { level: 6, xp: 10, totalXp: 500 },
  );
  assert.equal(conflict.xpStatus, 'STRUCTURALLY_INVALID');
  assert.ok(conflict.xpIssues.includes('META_LEVEL_MISMATCH'));

  const repBad = validateLegacyProgressionStructure({ level: 1, xp: 0, xpToNextLevel: 100, totalXp: 0, reputation: 150 }, null);
  assert.equal(repBad.reputationStatus, 'STRUCTURALLY_INVALID');
  const repGood = validateLegacyProgressionStructure(
    { level: 1, xp: 0, xpToNextLevel: calculateXpToNextLevel(1), totalXp: 0, reputation: 40 },
    { level: 1, xp: 0, totalXp: 0 },
  );
  assert.equal(repGood.reputationStatus, 'STRUCTURALLY_VALID');
  const xpBad = validateLegacyProgressionStructure(
    { level: 2, xp: -1, xpToNextLevel: calculateXpToNextLevel(2), totalXp: 10, reputation: 40 },
    null,
  );
  assert.equal(xpBad.xpStatus, 'STRUCTURALLY_INVALID');
});

test('normalized migration hash stability and sensitivity', () => {
  const gs = legacySave('u1', { level: 3, xp: 40, totalXp: 450, reputation: 55 }).gameState as Record<string, unknown>;
  const norm = buildNormalizedLegacyMigrationSnapshot(gs);
  assert.ok(norm);
  const h1 = sha256HexUtf8(migrationNormalizedSnapshotJson(norm!));
  const h2 = sha256HexUtf8(migrationNormalizedSnapshotJson(norm!));
  assert.equal(h1, h2);
  assert.equal(formatMigrationSnapshotHash(h1), `sha256:${h1}`);

  const changed = {
    ...gs,
    player: { ...(gs.player as Record<string, unknown>), totalXp: 451 },
    meta: { ...(gs.meta as Record<string, unknown>), totalXp: 451 },
  };
  const h3 = computeServerMigrationHashes(changed as Record<string, unknown>).migrationSnapshotHash;
  assert.notEqual(h1, h3);

  const unrelated = { ...gs, player: { ...(gs.player as Record<string, unknown>), money: 999_999 } };
  const h4 = computeServerMigrationHashes(unrelated as Record<string, unknown>).migrationSnapshotHash;
  assert.equal(h1, h4, 'player.money excluded from migration hash');

  const repChanged = {
    ...gs,
    player: { ...(gs.player as Record<string, unknown>), reputation: 56 },
  };
  assert.notEqual(h1, computeServerMigrationHashes(repChanged as Record<string, unknown>).migrationSnapshotHash);

  const claimChanged = {
    ...gs,
    missions: { claimedMissionRewardIds: ['first_delivery'] },
  };
  assert.notEqual(h1, computeServerMigrationHashes(claimChanged as Record<string, unknown>).migrationSnapshotHash);

  assert.equal(hasOnlyCanonicalProgressionMigrationPreviewKeys({ canonicalSchemaVersion: 1 }), true);
  assert.equal(hasOnlyCanonicalProgressionMigrationPreviewKeys({ level: 9, sourceHash: 'abc' }), false);
  assert.equal(hasOnlyCanonicalProgressionMigrationApplyKeys({ canonicalSchemaVersion: 1 }), true);
  assert.equal(
    hasOnlyCanonicalProgressionMigrationApplyKeys({ canonicalSchemaVersion: 1, expectedSourceSnapshotHash: h1 }),
    false,
  );
  assert.equal(hasOnlyCanonicalProgressionMigrationFreezeKeys({ canonicalSchemaVersion: 1, totalXp: 1 }), false);
});

test('preview is read-only; apply is create-only', async () => {
  const uid = 'legacy-prev';
  const db = createMemoryFirestore();
  db.dump.set(`users/${uid}/saves/current`, legacySave(uid, { level: 2, xp: 30, totalXp: 200, reputation: 52 }));

  const preview = await previewCanonicalLegacyProgressionMigration(db, uid, NOW, ON);
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  assert.equal(preview.eligible, true);
  assert.equal(preview.previewAuthorityClass, 'MUTABLE_SAVE_PREVIEW');
  assert.ok(preview.warnings.includes('SOURCE_MUTABLE'));
  assert.equal(preview.migrationStatus, 'LEGACY_STRUCTURALLY_VALID_ATTESTED_BASELINE_CANDIDATE');
  assert.ok(preview.sourceSnapshotHash?.startsWith('sha256:'));
  assert.equal(db.dump.has(canonicalProgressionMigrationPath(uid)), false);
  assert.equal(db.dump.has(canonicalCompanyProgressionPath(uid)), false);

  const off = await previewCanonicalLegacyProgressionMigration(db, uid, NOW, { envValue: null });
  assert.equal(off.ok, false);
  if (off.ok) return;
  assert.equal(off.reason, MIGRATION_OFF);

  const unfrozen = await applyCanonicalLegacyProgressionMigration(db, uid, NOW, ON);
  assert.equal(unfrozen.ok, false);
  if (unfrozen.ok) return;
  assert.equal(unfrozen.reason, MIGRATION_SOURCE_NOT_FROZEN);
  const frozen = await freezeCanonicalProgressionMigrationSource(db, uid, NOW, ON);
  assert.equal(frozen.ok, true);
  const locked = await previewCanonicalLegacyProgressionMigration(db, uid, NOW, ON);
  assert.equal(locked.ok, true);
  if (!locked.ok) return;
  assert.equal(locked.previewAuthorityClass, 'FROZEN_SOURCE_PREVIEW');

  const apply = await applyCanonicalLegacyProgressionMigration(db, uid, NOW, ON);
  assert.equal(apply.ok, true);
  if (!apply.ok) return;
  assert.equal(apply.alreadyMigrated, false);
  assert.equal(db.dump.has(canonicalProgressionMigrationPath(uid)), true);
  assert.equal(db.dump.has(canonicalCompanyProgressionPath(uid)), true);
  assert.equal(db.dump.has(canonicalProgressionMigrationReceiptPath(uid)), true);
  assert.equal(
    db.dump.has(canonicalProgressionReceiptPath(uid, PROGRESSION_MIGRATION_OPERATION_ID)),
    true,
  );
  assert.equal(db.dump.get(`users/${uid}/saves/current`)?.gameState && (db.dump.get(`users/${uid}/saves/current`)!.gameState as { player: { totalXp: number } }).player.totalXp, 200);

  const retry = await applyCanonicalLegacyProgressionMigration(db, uid, NOW, ON);
  assert.equal(retry.ok, true);
  if (!retry.ok) return;
  assert.equal(retry.alreadyMigrated, true);

  const cashBefore = db.dump.get(serverStateCurrentRef(uid))?.cash;
  db.dump.set(serverStateCurrentRef(uid), { cash: 50_000, ownerUid: uid });
  await applyCanonicalLegacyProgressionMigration(db, 'other', NOW, ON);
  assert.equal(db.dump.get(serverStateCurrentRef(uid))?.cash, 50_000);
  void cashBefore;
});

test('meta/player conflict blocks apply; apply re-reads the stored save', async () => {
  const uid = 'legacy-bad';
  const db = createMemoryFirestore();
  const save = legacySave(uid, { totalXp: 200, reputation: 52 });
  (save.gameState as { meta: { level: number } }).meta.level = 9;
  save.payloadChecksum = sha256HexUtf8(cloudSaveSnapshotHashInput(save.gameState));
  db.dump.set(`users/${uid}/saves/current`, save);

  const preview = await previewCanonicalLegacyProgressionMigration(db, uid, NOW, ON);
  assert.equal(preview.ok, true, !preview.ok ? preview.reason : '');
  if (!preview.ok) return;
  assert.equal(preview.structuralValidation?.xp, 'STRUCTURALLY_INVALID');
  assert.ok(preview.structuralValidation.xpIssues.some((issue) => issue.startsWith('META_')));
  assert.ok(preview.blockers.includes(LEGACY_PROGRESSION_META_PLAYER_CONFLICT));

  const apply = await freezeCanonicalProgressionMigrationSource(db, uid, NOW, ON);
  assert.equal(apply.ok, false);
  if (apply.ok) return;
  assert.equal(apply.reason, LEGACY_PROGRESSION_META_PLAYER_CONFLICT);
  assert.equal(db.dump.has(canonicalProgressionMigrationSourcePath(uid)), false);

  const uid2 = 'legacy-reread';
  db.dump.set(`users/${uid2}/saves/current`, legacySave(uid2, { totalXp: 0, reputation: reputationBalance.initial }));
  const before = await previewCanonicalLegacyProgressionMigration(db, uid2, NOW, ON);
  assert.equal(before.ok, true);
  if (!before.ok) return;
  const nextSave = legacySave(uid2, { totalXp: 800, reputation: 60 });
  const frozenFirst = await freezeCanonicalProgressionMigrationSource(db, uid2, NOW, ON);
  assert.equal(frozenFirst.ok, true);
  if (!frozenFirst.ok) return;
  db.dump.set(`users/${uid2}/saves/current`, nextSave);
  const repeat = await freezeCanonicalProgressionMigrationSource(db, uid2, NOW + 5, ON);
  assert.equal(repeat.ok, true);
  if (!repeat.ok) return;
  assert.equal(repeat.alreadyFrozen, true);
  assert.equal(repeat.reason, MIGRATION_SOURCE_ALREADY_FROZEN);
  assert.equal(repeat.sourceSnapshotHash, frozenFirst.sourceSnapshotHash);
  const applied = await applyCanonicalLegacyProgressionMigration(db, uid2, NOW, ON);
  assert.equal(applied.ok, true);
  if (!applied.ok) return;
  assert.equal(applied.sourceSnapshotHash, before.sourceSnapshotHash);
  const progression = db.dump.get(canonicalCompanyProgressionPath(uid2));
  assert.equal(progression?.totalXp, 0);
  assert.equal(progression?.initializationSource, 'LEGACY_MIGRATION_BASELINE');
  assert.notEqual(progression?.authorityClass, 'LEGACY_CLIENT_UNVERIFIED');
});

test('consumed legacy mission blocked after migration; two-device apply', async () => {
  const uid = 'legacy-claim';
  const db = createMemoryFirestore();
  db.dump.set(serverStateCurrentRef(uid), { cash: 1_000_000, ownerUid: uid });
  db.dump.set(
    `users/${uid}/saves/current`,
    legacySave(uid, { level: 2, xp: 30, totalXp: 200, reputation: 52 }, {
      missions: { claimedMissionRewardIds: ['first_delivery'] },
    }),
  );
  assert.equal((await freezeCanonicalProgressionMigrationSource(db, uid, NOW, ON)).ok, true);
  const applied = await applyCanonicalLegacyProgressionMigration(db, uid, NOW, ON);
  assert.equal(applied.ok, true);

  const claim = await claimCanonicalClientRewardTransaction(db, uid, 'first_delivery', NOW + 1, {
    clientRewardXpEnvValue: 'INTERNAL_TEST',
    progressionEnvValue: 'INTERNAL_TEST',
  });
  assert.equal(claim.ok, false);
  if (claim.ok) return;
  assert.equal(claim.reason, CLIENT_REWARD_LEGACY_CLAIM_CONSUMED_BY_MIGRATION);

  const uid2 = 'legacy-2dev';
  db.dump.set(`users/${uid2}/saves/current`, legacySave(uid2, { level: 1, xp: 0, totalXp: 0, reputation: reputationBalance.initial }));
  const freezes = await Promise.all([
    freezeCanonicalProgressionMigrationSource(db, uid2, NOW, ON),
    freezeCanonicalProgressionMigrationSource(db, uid2, NOW + 1, ON),
  ]);
  assert.equal(freezes.filter((row) => row.ok && !row.alreadyFrozen).length, 1);
  assert.equal(freezes.filter((row) => row.ok && row.alreadyFrozen).length, 1);
  const results = await Promise.all([
    applyCanonicalLegacyProgressionMigration(db, uid2, NOW, ON),
    applyCanonicalLegacyProgressionMigration(db, uid2, NOW + 1, ON),
  ]);
  const okCount = results.filter((row) => row.ok && !row.alreadyMigrated).length;
  const migratedCount = results.filter((row) => row.ok && row.alreadyMigrated).length;
  assert.equal(okCount, 1);
  assert.equal(migratedCount, 1);
});

test('existing canonical progression or receipts block create-only apply', async () => {
  const earned = 'legacy-earned';
  const db = createMemoryFirestore();
  db.dump.set(`users/${earned}/saves/current`, legacySave(earned, { totalXp: 200, reputation: 52 }));
  db.dump.set(canonicalCompanyProgressionPath(earned), {
    authorityClass: 'SERVER_CANONICAL_PROGRESSION',
    initializationSource: 'NEW_CANONICAL_ACCOUNT_DEFAULTS',
    ownerUid: earned,
    schemaVersion: 1,
    level: 1,
    xp: 0,
    totalXp: 0,
    reputation: 50,
    progressionRevision: 2,
  });
  const blocked = await applyCanonicalLegacyProgressionMigration(db, earned, NOW, ON);
  assert.equal(blocked.ok, false);
  if (blocked.ok) return;
  assert.equal(blocked.reason, MIGRATION_ALREADY_CANONICAL_ACTIVE);
  assert.equal(db.dump.get(canonicalCompanyProgressionPath(earned))?.progressionRevision, 2);

  const delivery = 'legacy-delivery-xp';
  db.dump.set(`users/${delivery}/saves/current`, legacySave(delivery, { totalXp: 200, reputation: 52 }));
  db.dump.set(canonicalProgressionReceiptPath(delivery, 'progression:delivery:1'), {
    operationId: 'progression:delivery:1',
    sourceType: 'ROAD_DELIVERY',
  });
  const deliveryRace = await applyCanonicalLegacyProgressionMigration(db, delivery, NOW, ON);
  assert.equal(deliveryRace.ok, false);
  if (deliveryRace.ok) return;
  assert.equal(deliveryRace.reason, MIGRATION_BLOCKED_ACTIVE_CANONICAL_HISTORY);
  assert.equal(db.dump.has(canonicalProgressionMigrationPath(delivery)), false);

  const purchase = 'legacy-nondelivery-xp';
  db.dump.set(`users/${purchase}/saves/current`, legacySave(purchase, { totalXp: 200, reputation: 52 }));
  db.dump.set(canonicalProgressionReceiptPath(purchase, 'progression:truck:1'), {
    operationId: 'progression:truck:1',
    sourceType: 'TRUCK_PURCHASE',
  });
  const purchaseRace = await applyCanonicalLegacyProgressionMigration(db, purchase, NOW, ON);
  assert.equal(purchaseRace.ok, false);
  if (purchaseRace.ok) return;
  assert.equal(purchaseRace.reason, MIGRATION_BLOCKED_ACTIVE_CANONICAL_HISTORY);

  const migrated = 'legacy-existing-migration';
  db.dump.set(`users/${migrated}/saves/current`, legacySave(migrated, { totalXp: 0, reputation: reputationBalance.initial }));
  db.dump.set(canonicalProgressionMigrationPath(migrated), { migrationStatus: 'MIGRATED', ownerUid: 'someone-else' });
  const existing = await applyCanonicalLegacyProgressionMigration(db, migrated, NOW, ON);
  assert.equal(existing.ok, false);
  if (existing.ok) return;
  assert.notEqual(existing.reason, 'ok');
  assert.equal(db.dump.has(canonicalCompanyProgressionPath(migrated)), false);

  const active = 'legacy-active-freeze';
  db.dump.set(`users/${active}/saves/current`, legacySave(active, { totalXp: 200, reputation: 52 }));
  db.dump.set(canonicalCompanyProgressionPath(active), {
    authorityClass: 'SERVER_CANONICAL_PROGRESSION',
    initializationSource: 'NEW_CANONICAL_ACCOUNT_DEFAULTS',
    ownerUid: active,
    schemaVersion: 1,
    progressionPolicyVersion: 'canonical-company-progression-v1',
    level: 1,
    xp: 0,
    xpToNextLevel: 100,
    totalXp: 0,
    reputation: 50,
    progressionRevision: 1,
  });
  const freezeActive = await freezeCanonicalProgressionMigrationSource(db, active, NOW, ON);
  assert.equal(freezeActive.ok, false);
  if (freezeActive.ok) return;
  assert.equal(freezeActive.reason, CANONICAL_PROGRESSION_ALREADY_ACTIVE);

  const conflictUid = 'legacy-conflict';
  const conflictSave = legacySave(conflictUid, { totalXp: 200, reputation: 52 });
  conflictSave.payloadChecksum = '0'.repeat(64);
  db.dump.set(`users/${conflictUid}/saves/current`, conflictSave);
  const freezeConflict = await freezeCanonicalProgressionMigrationSource(db, conflictUid, NOW, ON);
  assert.equal(freezeConflict.ok, false);
  if (freezeConflict.ok) return;
  assert.equal(freezeConflict.reason, MIGRATION_SOURCE_BLOCKED_SAVE_CONFLICT);
  assert.equal(db.dump.has(canonicalProgressionMigrationSourcePath(conflictUid)), false);

  const corrupt = 'legacy-corrupt-source';
  db.dump.set(`users/${corrupt}/saves/current`, legacySave(corrupt, { totalXp: 0, reputation: reputationBalance.initial }));
  const created = await freezeCanonicalProgressionMigrationSource(db, corrupt, NOW, ON);
  assert.equal(created.ok, true);
  const source = db.dump.get(canonicalProgressionMigrationSourcePath(corrupt));
  assert.ok(source);
  source!.sourceSnapshotHash = 'sha256:' + 'ab'.repeat(32);
  const corruptApply = await applyCanonicalLegacyProgressionMigration(db, corrupt, NOW, ON);
  assert.equal(corruptApply.ok, false);
  if (corruptApply.ok) return;
  assert.equal(corruptApply.reason, MIGRATION_SOURCE_HASH_INTEGRITY_ERROR);
  assert.equal(db.dump.get(`users/${corrupt}/saves/current`) && (db.dump.get(serverStateCurrentRef(corrupt))?.cash ?? null), null);
});

const CUTOVER = { envValue: 'INTERNAL_TEST' as const };

test('immediate cutover freezes and migrates in one transaction', async () => {
  assert.equal(hasOnlyCanonicalProgressionImmediateCutoverKeys({ canonicalSchemaVersion: 1, level: 3 }), false);
  const uid = 'cutover-1';
  const db = createMemoryFirestore();
  db.dump.set(serverStateCurrentRef(uid), { cash: 10, ownerUid: uid });
  db.dump.set(`users/${uid}/saves/current`, legacySave(uid, { totalXp: 200, reputation: 52 }));
  const off = await cutoverCanonicalLegacyProgressionMigration(db, uid, NOW, { envValue: null });
  assert.equal(off.ok, false);

  const cutover = await cutoverCanonicalLegacyProgressionMigration(db, uid, NOW, CUTOVER);
  assert.equal(cutover.ok, true);
  if (!cutover.ok) return;
  assert.equal(cutover.alreadyMigrated, false);
  assert.equal(cutover.migrationStatus, 'MIGRATED');
  const source = db.dump.get(canonicalProgressionMigrationSourcePath(uid));
  const migration = db.dump.get(canonicalProgressionMigrationPath(uid));
  const progression = db.dump.get(canonicalCompanyProgressionPath(uid));
  assert.equal(source?.freezeStatus, MIGRATION_SOURCE_FREEZE_STATUS_AT_CUTOVER);
  assert.equal(source?.sourceSnapshotHash, migration?.sourceSnapshotHash);
  assert.equal(source?.sourceSnapshotHash, cutover.sourceSnapshotHash);
  assert.equal(progression?.initializationSource, 'LEGACY_MIGRATION_BASELINE');
  assert.equal(progression?.totalXp, 200);
  assert.equal((db.dump.get(`users/${uid}/saves/current`) as { gameState: { player: { totalXp: number } } }).gameState.player.totalXp, 200);
  assert.equal(db.dump.get(serverStateCurrentRef(uid))?.cash, 10);

  const save = db.dump.get(`users/${uid}/saves/current`) as { gameState: { player: { totalXp: number; level: number } } };
  save.gameState.player.totalXp = 9000;
  save.gameState.player.level = 20;
  const retry = await cutoverCanonicalLegacyProgressionMigration(db, uid, NOW + 1, CUTOVER);
  assert.equal(retry.ok, true);
  if (!retry.ok) return;
  assert.equal(retry.alreadyMigrated, true);
  assert.equal(retry.sourceSnapshotHash, cutover.sourceSnapshotHash);
  assert.equal(db.dump.get(canonicalCompanyProgressionPath(uid))?.totalXp, 200);

  const ctx = await db.runTransaction(async (transaction) =>
    readCanonicalProgressionContext(transaction, db, uid, ['progression:delivery:test'], 'INTERNAL_TEST'),
  );
  assert.equal(ctx.enabled, true);
  if (!ctx.enabled || !ctx.state) return;
  assert.equal(ctx.state.totalXp, 200);
  const plan = planCanonicalProgressionWrite(ctx, {
    operationId: 'progression:delivery:test',
    sourceType: 'ROAD_DELIVERY_COMPLETION',
    sourceId: 'delivery-1',
    xpDelta: 15,
    xpAuthority: 'SERVER_DERIVED',
    reputationDelta: 0,
    reputationReasons: [],
    nowMs: NOW + 2,
  });
  assert.equal(plan.ok, true);
  if (!plan.ok || !plan.next) return;
  assert.equal(plan.application, 'APPLIED');
  assert.equal(plan.next.totalXp, 215);

  const issued = await generateCanonicalProductionRoadBatchTransaction(db, uid, NOW + 3, {
    progressionEnvValue: 'INTERNAL_TEST',
    envValue: 'INTERNAL_TEST',
  });
  if (!issued.ok) {
    assert.notEqual(issued.reason, 'ROAD_CONTRACT_ISSUANCE_BLOCKED_PLAYER_PROGRESSION');
    assert.notEqual(issued.reason, 'ROAD_CONTRACT_ISSUANCE_BLOCKED_LEGACY_PROGRESSION');
  }
});

test('cutover refuses a pre-existing freeze and conflicting saves', async () => {
  const uid = 'cutover-frozen';
  const db = createMemoryFirestore();
  db.dump.set(`users/${uid}/saves/current`, legacySave(uid, { totalXp: 200, reputation: 52 }));
  assert.equal((await freezeCanonicalProgressionMigrationSource(db, uid, NOW, ON)).ok, true);
  const refused = await cutoverCanonicalLegacyProgressionMigration(db, uid, NOW, CUTOVER);
  assert.equal(refused.ok, false);
  if (refused.ok) return;
  assert.equal(refused.reason, MIGRATION_SOURCE_PREEXISTING_FROZEN_REQUIRES_RESOLUTION);
  assert.equal(db.dump.has(canonicalProgressionMigrationPath(uid)), false);

  const bad = 'cutover-meta';
  const save = legacySave(bad, { totalXp: 200, reputation: 52 });
  (save.gameState as { meta: { level: number } }).meta.level = 9;
  save.payloadChecksum = sha256HexUtf8(cloudSaveSnapshotHashInput(save.gameState));
  db.dump.set(`users/${bad}/saves/current`, save);
  const meta = await cutoverCanonicalLegacyProgressionMigration(db, bad, NOW, CUTOVER);
  assert.equal(meta.ok, false);
  assert.equal(db.dump.has(canonicalProgressionMigrationSourcePath(bad)), false);

  const checksum = 'cutover-checksum';
  const broken = legacySave(checksum, { totalXp: 200, reputation: 52 });
  broken.payloadChecksum = '0'.repeat(64);
  db.dump.set(`users/${checksum}/saves/current`, broken);
  const conflict = await cutoverCanonicalLegacyProgressionMigration(db, checksum, NOW, CUTOVER);
  assert.equal(conflict.ok, false);
  if (conflict.ok) return;
  assert.equal(conflict.reason, MIGRATION_SOURCE_BLOCKED_SAVE_CONFLICT);

  const pair = 'cutover-two';
  db.dump.set(`users/${pair}/saves/current`, legacySave(pair, { totalXp: 0, reputation: reputationBalance.initial }));
  const results = await Promise.all([
    cutoverCanonicalLegacyProgressionMigration(db, pair, NOW, CUTOVER),
    cutoverCanonicalLegacyProgressionMigration(db, pair, NOW + 1, CUTOVER),
  ]);
  assert.equal(results.filter((row) => row.ok && !row.alreadyMigrated).length, 1);
  assert.equal(results.filter((row) => row.ok && row.alreadyMigrated).length, 1);
});

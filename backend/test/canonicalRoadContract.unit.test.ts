/**
 * Canonical ROAD contract issuance (Step 29G) — memory Firestore tests.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';

import { getOrIssueCanonicalRoadContractsTransaction } from '../src/canonicalRoadContract';
import { bootstrapInternalCanonicalFleetFixturesTransaction } from '../src/canonicalFleet';
import {
  acceptCanonicalRoadDeliveryTransaction,
  reportCanonicalRoadDeliveryCompletedTransaction,
} from '../src/canonicalRoadDelivery';
import {
  CANONICAL_ROAD_ISSUANCE_OFFER_COUNT,
  CANONICAL_ROAD_ISSUANCE_POLICY_VERSION,
  hasOnlyCanonicalRoadIssuanceKeys,
  prepareCanonicalRoadContractBatch,
} from '../../src/domain/canonicalRoadContract';
import { toRuntimeRoadContract } from '../../src/domain/canonicalRoadContractPresentation';
import {
  compareRoadSettlementShadow,
  localProductionSettlementFromSnapshot,
  prepareCanonicalRoadDeliverySettlement,
} from '../../src/domain/canonicalRoadEconomics';
import { createCanonicalRoadDeliveryId } from '../../src/domain/canonicalRoadDelivery';

function createMemoryFirestore(): Firestore & { dump: Map<string, Record<string, unknown>> } {
  const dump = new Map<string, Record<string, unknown>>();
  const firestore = {
    dump,
    doc(path: string) {
      return { path };
    },
    async runTransaction<T>(
      operation: (transaction: {
        get: (ref: { path: string }) => Promise<{
          exists: boolean;
          data: () => Record<string, unknown> | undefined;
        }>;
        create: (ref: { path: string }, data: Record<string, unknown>) => void;
        update: (ref: { path: string }, data: Record<string, unknown>) => void;
      }) => Promise<T>,
    ) {
      return operation({
        async get(ref) {
          const data = dump.get(ref.path);
          return { exists: Boolean(data), data: () => data };
        },
        create(ref, data) {
          if (dump.has(ref.path)) throw new Error('already-exists');
          dump.set(ref.path, { ...data });
        },
        update(ref, data) {
          const current = dump.get(ref.path);
          if (!current) throw new Error('missing');
          dump.set(ref.path, { ...current, ...data });
        },
      });
    },
  };
  return firestore as unknown as Firestore & { dump: Map<string, Record<string, unknown>> };
}

async function seedFleet(db: Firestore, uid: string): Promise<void> {
  const result = await bootstrapInternalCanonicalFleetFixturesTransaction(db, uid, 1, {
    envValue: 'INTERNAL_TEST',
  });
  assert.equal(result.ok, true);
}

test('issuance request cannot carry economics', () => {
  assert.equal(hasOnlyCanonicalRoadIssuanceKeys({ canonicalSchemaVersion: 1, payment: 9 }), false);
  assert.equal(hasOnlyCanonicalRoadIssuanceKeys({ canonicalSchemaVersion: 1, amount: 25 }), false);
  assert.equal(hasOnlyCanonicalRoadIssuanceKeys({ canonicalSchemaVersion: 1 }), true);
});

test('unauthenticated issuance rejected', async () => {
  const db = createMemoryFirestore();
  const result = await getOrIssueCanonicalRoadContractsTransaction(db, '', 1_700_000_000_000);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'UNAUTHENTICATED');
});

test('batch issuance is deterministic, bounded, retry-idempotent, no cash', async () => {
  const db = createMemoryFirestore();
  db.dump.set('users/uid-a/serverState/current', { cash: 20_000 });
  db.dump.set('users/uid-a', { money: 77_000 });
  db.dump.set('users/uid-a/saves/current', { gameState: { player: { money: 55_000 } } });
  db.dump.set('users/uid-a/canonicalDeliveryCompletions/x', { count: 4 });

  const now = 1_700_000_000_000;
  const first = await getOrIssueCanonicalRoadContractsTransaction(db, 'uid-a', now, 1.72);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.contracts.length, CANONICAL_ROAD_ISSUANCE_OFFER_COUNT);
  assert.equal(first.alreadyIssued, false);
  const second = await getOrIssueCanonicalRoadContractsTransaction(db, 'uid-a', now + 1000, 1.72);
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.alreadyIssued, true);
  assert.equal(second.batchId, first.batchId);
  assert.deepEqual(
    second.contracts.map((c) => c.contractId),
    first.contracts.map((c) => c.contractId),
  );
  assert.equal(db.dump.get('users/uid-a/serverState/current')?.cash, 20_000);
  assert.equal(db.dump.get('users/uid-a')?.money, 77_000);

  const replay = prepareCanonicalRoadContractBatch({ uid: 'uid-a', nowMs: now, fuelPricePerLiter: 1.72 });
  assert.ok(!('ok' in replay));
  if ('ok' in replay) return;
  assert.equal(replay.policyVersion, CANONICAL_ROAD_ISSUANCE_POLICY_VERSION);
  assert.equal(replay.contracts[0]?.payment, first.contracts[0]?.payment);
});

test('accept uses server contract economics; second delivery blocked; expiry', async () => {
  const db = createMemoryFirestore();
  const now = 1_700_000_000_000;
  const issued = await getOrIssueCanonicalRoadContractsTransaction(db, 'uid-a', now, 1.72);
  assert.equal(issued.ok, true);
  if (!issued.ok) return;
  await seedFleet(db, 'uid-a');
  const contract = issued.contracts[0]!;
  const accept = await acceptCanonicalRoadDeliveryTransaction(
    db,
    'uid-a',
    { contractId: contract.contractId, canonicalSchemaVersion: 1 },
    now + 10,
  );
  assert.equal(accept.ok, true);
  if (!accept.ok) return;
  assert.equal(accept.receipt.alreadyAccepted, false);
  assert.equal(accept.receipt.payment, contract.payment);
  assert.equal(accept.receipt.deliveryId, createCanonicalRoadDeliveryId(contract.contractId));

  const dup = await acceptCanonicalRoadDeliveryTransaction(
    db,
    'uid-a',
    { contractId: contract.contractId, canonicalSchemaVersion: 1 },
    now + 20,
  );
  assert.equal(dup.ok, true);
  if (!dup.ok) return;
  assert.equal(dup.receipt.alreadyAccepted, true);

  const other = await acceptCanonicalRoadDeliveryTransaction(
    db,
    'uid-b',
    { contractId: contract.contractId, canonicalSchemaVersion: 1 },
    now + 30,
  );
  assert.equal(other.ok, false);

  const path = `users/uid-a/canonicalRoadContracts/${contract.contractId}`;
  const stored = db.dump.get(path)!;
  assert.equal(stored.status, 'ACCEPTED');
  assert.equal(stored.payment, contract.payment);

  const expiredId = issued.contracts[1]!.contractId;
  const expiredPath = `users/uid-a/canonicalRoadContracts/${expiredId}`;
  db.dump.set(expiredPath, { ...db.dump.get(expiredPath)!, expiresAtMs: now - 1, status: 'AVAILABLE' });
  const expired = await acceptCanonicalRoadDeliveryTransaction(
    db,
    'uid-a',
    { contractId: expiredId, canonicalSchemaVersion: 1 },
    now,
  );
  assert.equal(expired.ok, false);
  if (!expired.ok) assert.equal(expired.reason, 'CONTRACT_EXPIRED');
});

test('shadow settlement MATCH for issued contracts; adapter builds Contract', async () => {
  const prepared = prepareCanonicalRoadContractBatch({
    uid: 'uid-vec',
    nowMs: 1_800_000_000_000,
    fuelPricePerLiter: 1.72,
  });
  assert.ok(!('ok' in prepared));
  if ('ok' in prepared) return;
  for (const snapshot of prepared.contracts) {
    const view = toRuntimeRoadContract(snapshot);
    assert.equal(view.authority, 'SERVER_CANONICAL');
    assert.equal(view.contract.payment, snapshot.payment);
    const hours = snapshot.deadlineHours * 0.85;
    const local = localProductionSettlementFromSnapshot(snapshot, 'COMPLETED', hours);
    const server = prepareCanonicalRoadDeliverySettlement({
      snapshot,
      deliveryId: createCanonicalRoadDeliveryId(snapshot.contractId),
      outcome: 'COMPLETED',
      actualTravelHours: hours,
    });
    assert.equal(compareRoadSettlementShadow({ local, server }), 'MATCH');
    assert.equal(server.fuelChargedOnCompletion, 0);
  }
});

test('report completion after batch accept does not move cash', async () => {
  const db = createMemoryFirestore();
  db.dump.set('users/uid-a/serverState/current', { cash: 11_000 });
  const issued = await getOrIssueCanonicalRoadContractsTransaction(db, 'uid-a', 2_000_000_000_000, 1.72);
  if (!issued.ok) return;
  await seedFleet(db, 'uid-a');
  const contractId = issued.contracts[0]!.contractId;
  const accepted = await acceptCanonicalRoadDeliveryTransaction(
    db,
    'uid-a',
    { contractId, canonicalSchemaVersion: 1 },
    2_000_000_000_010,
  );
  assert.equal(accepted.ok, true);
  if (!accepted.ok) return;
  const reported = await reportCanonicalRoadDeliveryCompletedTransaction(
    db,
    'uid-a',
    accepted.receipt.deliveryId,
    'COMPLETED',
    2_000_000_000_020,
    accepted.receipt.deadlineHours * 0.5,
  );
  assert.equal(reported.ok, true);
  assert.equal(db.dump.get('users/uid-a/serverState/current')?.cash, 11_000);
});

test('index exposes issuance callable without generic cash delta', () => {
  const index = readFileSync(resolve(__dirname, '../src/index.ts'), 'utf8');
  assert.equal(index.includes('export const getOrIssueCanonicalRoadContracts'), true);
  assert.equal(index.includes('export const applyCashDelta'), false);
  assert.equal(index.includes('export const settleCanonicalMultimodalShipment'), false);
});

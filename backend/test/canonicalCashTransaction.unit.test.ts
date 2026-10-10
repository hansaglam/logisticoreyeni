/**
 * Canonical cash transaction helper — in-memory Firestore unit tests (Step 29E).
 * No generic client delta callable. INTERNAL_TEST_* operations only.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';

import {
  applyCanonicalCashMutationInTransaction,
  canonicalCashTransactionRef,
  runCanonicalCashMutation,
  serverStateCurrentRef,
} from '../src/canonicalCashTransaction';

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
          if (dump.has(ref.path)) {
            throw new Error('already-exists');
          }
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

function seedUser(
  db: ReturnType<typeof createMemoryFirestore>,
  uid: string,
  cash: number,
) {
  db.dump.set(serverStateCurrentRef(uid), {
    cash,
    ownerUid: uid,
    sourceVersion: 1,
  });
  db.dump.set(`users/${uid}`, { money: 99_999, displayName: 'profile' });
  db.dump.set(`users/${uid}/saves/current`, {
    gameState: { player: { money: 88_888 } },
  });
  db.dump.set(`users/${uid}/canonicalDeliveryCompletions/del-keep`, {
    deliveryId: 'del-keep',
    count: 3,
  });
}

test('A unauthenticated uid rejected', async () => {
  const db = createMemoryFirestore();
  const result = await runCanonicalCashMutation(db, {
    uid: '',
    transactionId: 'test-credit:1',
    operationType: 'INTERNAL_TEST_CREDIT',
    sourceId: 'harness',
    amountDelta: 500,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'UNAUTHENTICATED');
});

test('B authenticated user only mutates own serverState.cash', async () => {
  const db = createMemoryFirestore();
  seedUser(db, 'uid-a', 20_000);
  seedUser(db, 'uid-b', 10_000);
  const result = await runCanonicalCashMutation(db, {
    uid: 'uid-a',
    transactionId: 'test-credit:own',
    operationType: 'INTERNAL_TEST_CREDIT',
    sourceId: 'harness',
    amountDelta: 100,
  });
  assert.equal(result.ok, true);
  assert.equal(db.dump.get(serverStateCurrentRef('uid-a'))?.cash, 20_100);
  assert.equal(db.dump.get(serverStateCurrentRef('uid-b'))?.cash, 10_000);
});

test('C–H credit/debit read cash inside transaction; IDs once', async () => {
  const db = createMemoryFirestore();
  seedUser(db, 'uid-a', 20_000);
  const credit = await runCanonicalCashMutation(db, {
    uid: 'uid-a',
    transactionId: 'test-credit:safe',
    operationType: 'INTERNAL_TEST_CREDIT',
    sourceId: 'harness',
    amountDelta: 500,
    nowMs: 1_700_000_000_000,
  });
  assert.equal(credit.ok, true);
  if (!credit.ok) return;
  assert.equal(credit.receipt.applied, true);
  assert.equal(credit.receipt.alreadyApplied, false);
  assert.equal(credit.receipt.cashBefore, 20_000);
  assert.equal(credit.receipt.cashDelta, 500);
  assert.equal(credit.receipt.cashAfter, 20_500);
  assert.equal(credit.receipt.currency, 'USD_GAME_INTEGER');
  assert.equal(credit.receipt.createdAt, 1_700_000_000_000);

  const debit = await runCanonicalCashMutation(db, {
    uid: 'uid-a',
    transactionId: 'test-debit:safe',
    operationType: 'INTERNAL_TEST_DEBIT',
    sourceId: 'harness',
    amountDelta: -200,
  });
  assert.equal(debit.ok, true);
  if (!debit.ok) return;
  assert.equal(debit.receipt.cashAfter, 20_300);
});

test('E duplicate same operation is ALREADY_APPLIED with no second movement', async () => {
  const db = createMemoryFirestore();
  seedUser(db, 'uid-a', 20_000);
  const first = await runCanonicalCashMutation(db, {
    uid: 'uid-a',
    transactionId: 'delivery:demo:revenue',
    operationType: 'INTERNAL_TEST_CREDIT',
    sourceId: 'demo',
    amountDelta: 400,
  });
  const second = await runCanonicalCashMutation(db, {
    uid: 'uid-a',
    transactionId: 'delivery:demo:revenue',
    operationType: 'INTERNAL_TEST_CREDIT',
    sourceId: 'demo',
    amountDelta: 400,
  });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.receipt.alreadyApplied, true);
  assert.equal(second.receipt.applied, false);
  assert.equal(db.dump.get(serverStateCurrentRef('uid-a'))?.cash, 20_400);
  const txnPath = canonicalCashTransactionRef('uid-a', 'delivery:demo:revenue');
  assert.equal(db.dump.get(txnPath)?.amountDelta, 400);
});

test('F conflicting duplicate rejected and original preserved', async () => {
  const db = createMemoryFirestore();
  seedUser(db, 'uid-a', 20_000);
  await runCanonicalCashMutation(db, {
    uid: 'uid-a',
    transactionId: 'conflict-id',
    operationType: 'INTERNAL_TEST_CREDIT',
    sourceId: 'a',
    amountDelta: 50,
  });
  const conflict = await runCanonicalCashMutation(db, {
    uid: 'uid-a',
    transactionId: 'conflict-id',
    operationType: 'INTERNAL_TEST_CREDIT',
    sourceId: 'a',
    amountDelta: 9999,
  });
  assert.equal(conflict.ok, false);
  if (!conflict.ok) assert.equal(conflict.reason, 'CANONICAL_CASH_TRANSACTION_CONFLICT');
  assert.equal(db.dump.get(serverStateCurrentRef('uid-a'))?.cash, 20_050);
});

test('I insufficient cash debit rejected', async () => {
  const db = createMemoryFirestore();
  seedUser(db, 'uid-a', 100);
  const result = await runCanonicalCashMutation(db, {
    uid: 'uid-a',
    transactionId: 'debit-nsf',
    operationType: 'INTERNAL_TEST_DEBIT',
    sourceId: 'harness',
    amountDelta: -101,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'INSUFFICIENT_CASH');
  assert.equal(db.dump.get(serverStateCurrentRef('uid-a'))?.cash, 100);
  assert.equal(db.dump.has(canonicalCashTransactionRef('uid-a', 'debit-nsf')), false);
});

test('J K L NaN Infinity fractional delta rejected', async () => {
  const db = createMemoryFirestore();
  seedUser(db, 'uid-a', 20_000);
  for (const amountDelta of [Number.NaN, Number.POSITIVE_INFINITY, 1.5, 0]) {
    const result = await runCanonicalCashMutation(db, {
      uid: 'uid-a',
      transactionId: `bad-${String(amountDelta)}`,
      operationType: 'INTERNAL_TEST_CREDIT',
      sourceId: 'harness',
      amountDelta,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'INVALID_AMOUNT');
  }
  assert.equal(db.dump.get(serverStateCurrentRef('uid-a'))?.cash, 20_000);
});

test('M cash + transaction doc atomic on success', async () => {
  const db = createMemoryFirestore();
  seedUser(db, 'uid-a', 1_000);
  const result = await runCanonicalCashMutation(db, {
    uid: 'uid-a',
    transactionId: 'atomic-1',
    operationType: 'INTERNAL_TEST_CREDIT',
    sourceId: 'harness',
    amountDelta: 7,
  });
  assert.equal(result.ok, true);
  assert.equal(db.dump.get(serverStateCurrentRef('uid-a'))?.cash, 1_007);
  const doc = db.dump.get(canonicalCashTransactionRef('uid-a', 'atomic-1'));
  assert.equal(doc?.amountDelta, 7);
  assert.equal(doc?.cashAuthorityVersion, 1);
  assert.equal(doc?.accountCashAuthorityMigrationVersion, 0);
});

test('N simulated failure after validate writes nothing', async () => {
  const db = createMemoryFirestore();
  seedUser(db, 'uid-a', 1_000);
  const result = await runCanonicalCashMutation(db, {
    uid: 'uid-a',
    transactionId: 'fail-sim',
    operationType: 'INTERNAL_TEST_CREDIT',
    sourceId: 'harness',
    amountDelta: 50,
    simulateFailureAfterValidate: true,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'SIMULATED_FAILURE');
  assert.equal(db.dump.get(serverStateCurrentRef('uid-a'))?.cash, 1_000);
  assert.equal(db.dump.has(canonicalCashTransactionRef('uid-a', 'fail-sim')), false);
});

test('P Q R profile money, save blob, canonicalDeliveryCompletions untouched', async () => {
  const db = createMemoryFirestore();
  seedUser(db, 'uid-a', 5_000);
  await runCanonicalCashMutation(db, {
    uid: 'uid-a',
    transactionId: 'untouched-check',
    operationType: 'INTERNAL_TEST_DEBIT',
    sourceId: 'harness',
    amountDelta: -10,
  });
  assert.equal(db.dump.get('users/uid-a')?.money, 99_999);
  assert.equal(
    (db.dump.get('users/uid-a/saves/current')?.gameState as { player: { money: number } }).player
      .money,
    88_888,
  );
  assert.equal(db.dump.get('users/uid-a/canonicalDeliveryCompletions/del-keep')?.count, 3);
});

test('helper refuses fuel/multimodal operation types; ROAD settlement allowed internally', async () => {
  const db = createMemoryFirestore();
  seedUser(db, 'uid-a', 20_000);
  const multimodal = await runCanonicalCashMutation(db, {
    uid: 'uid-a',
    transactionId: 'mm-not-ready',
    operationType: 'MULTIMODAL_SETTLEMENT',
    sourceId: 'shipment-1',
    amountDelta: 1_000,
  });
  assert.equal(multimodal.ok, false);
  if (!multimodal.ok) assert.equal(multimodal.reason, 'INVALID_OPERATION');
  const road = await runCanonicalCashMutation(db, {
    uid: 'uid-a',
    transactionId: 'delivery:test:revenue',
    operationType: 'ROAD_DELIVERY_SETTLEMENT',
    sourceId: 'roadDelivery:test:settlement',
    amountDelta: 1_000,
  });
  assert.equal(road.ok, true);
  assert.equal(db.dump.get(serverStateCurrentRef('uid-a'))?.cash, 21_000);
});

test('O no generic delta callable in backend index; rules deny client writes', () => {
  const index = readFileSync(resolve(__dirname, '../src/index.ts'), 'utf8');
  assert.equal(index.includes('export const applyCashDelta'), false);
  assert.equal(index.includes('export const updateMoney'), false);
  assert.equal(index.includes('export const setCash'), false);
  assert.equal(index.includes('export const applyCanonicalCashTransaction'), false);
  assert.equal(index.includes('export const settleCanonicalMultimodalShipment'), false);
  assert.equal(index.includes('runCanonicalCashMutation'), false);

  const rules = readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8');
  assert.match(
    rules,
    /match \/canonicalCashTransactions\/\{transactionId\}[\s\S]*?allow write: if false/,
  );
  assert.match(rules, /match \/serverState\/\{documentId\}[\s\S]*?allow write: if false/);
});

test('in-transaction helper is the only mutation entry', async () => {
  const db = createMemoryFirestore();
  seedUser(db, 'uid-a', 2_000);
  const result = await db.runTransaction((transaction) =>
    applyCanonicalCashMutationInTransaction(transaction, db, {
      uid: 'uid-a',
      transactionId: 'via-tx',
      operationType: 'INTERNAL_TEST_CREDIT',
      sourceId: 'harness',
      amountDelta: 1,
    }),
  );
  assert.equal(result.ok, true);
});

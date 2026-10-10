/**
 * Canonical warehouse state — in-memory tests (Step 29T).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';

import { settleCanonicalDailyOpexInternalTransaction } from '../src/canonicalDailyOpex';
import {
  openCanonicalWarehouseTransaction,
  upgradeCanonicalWarehouseTransaction,
} from '../src/canonicalWarehouse';
import {
  CANONICAL_CASH_TRANSACTIONS_COLLECTION,
  serverStateCurrentRef,
} from '../src/canonicalCashTransaction';
import { CITIES_BY_ID } from '../../src/data/cities';
import {
  estimateWarehouseOpenCost,
  estimateWarehouseUpgradeCost,
  resolveWarehouseDailyOperatingCost,
} from '../../src/utils/warehouseCalculations';
import {
  CANONICAL_WAREHOUSE_INTERNAL_COMPANY_LEVEL,
  CANONICAL_WAREHOUSE_OPEN_POLICY_VERSION,
  CANONICAL_WAREHOUSE_RECEIPTS_COLLECTION,
  CANONICAL_WAREHOUSE_UPGRADE_POLICY_VERSION,
  CANONICAL_WAREHOUSES_COLLECTION,
  WAREHOUSE_CLOSE_STATUS,
  WAREHOUSE_COMPANY_LEVEL_CLASS,
  WAREHOUSE_READINESS_STATUS,
  createCanonicalWarehouseId,
  deriveCanonicalWarehouseOpenQuote,
  hasOnlyCanonicalWarehouseOpenKeys,
  hasOnlyCanonicalWarehouseUpgradeKeys,
  isCanonicalWarehouseAllowed,
} from '../../src/domain/canonicalWarehouseState';
import { CANONICAL_OPEX_PERIOD_DURATION_MS } from '../../src/domain/canonicalDailyOpexStaffState';
import { tradingBalance } from '../../src/config/balance';

function createMemoryFirestore(): Firestore & { dump: Map<string, Record<string, unknown>> } {
  const dump = new Map<string, Record<string, unknown>>();
  const firestore = {
    dump,
    doc(path: string) {
      return { path, _col: false };
    },
    collection(path: string) {
      return { path, _col: true };
    },
    async runTransaction<T>(
      operation: (transaction: {
        get: (ref: { path: string; _col?: boolean }) => Promise<{
          exists: boolean;
          data: () => Record<string, unknown> | undefined;
          docs: Array<{ data: () => Record<string, unknown> | undefined }>;
        }>;
        create: (ref: { path: string }, data: Record<string, unknown>) => void;
        update: (ref: { path: string }, data: Record<string, unknown>) => void;
      }) => Promise<T>,
    ) {
      return operation({
        async get(ref) {
          if (ref._col) {
            const prefix = `${ref.path.replace(/\/$/, '')}/`;
            const docs = [...dump.entries()]
              .filter(([key]) => {
                if (!key.startsWith(prefix)) return false;
                const rest = key.slice(prefix.length);
                return rest.length > 0 && !rest.includes('/');
              })
              .map(([, data]) => ({ data: () => data }));
            return { exists: docs.length > 0, data: () => undefined, docs };
          }
          const data = dump.get(ref.path);
          return { exists: Boolean(data), data: () => data, docs: [] };
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

const GATE = { envValue: 'INTERNAL_TEST' as const };
const OPEX = { envValue: 'INTERNAL_TEST' as const };
const NOW = 1_700_000_000_000;
const DAY = CANONICAL_OPEX_PERIOD_DURATION_MS;

function seedCash(db: ReturnType<typeof createMemoryFirestore>, cash = 200_000) {
  db.dump.set(serverStateCurrentRef('uid-a'), { cash, ownerUid: 'uid-a', sourceVersion: 1 });
  db.dump.set('users/uid-a', { money: 33_000 });
}

test('gate, keys, city/type, open formula parity, classifiers', () => {
  assert.equal(isCanonicalWarehouseAllowed({ envValue: null }), false);
  assert.equal(isCanonicalWarehouseAllowed(GATE), true);
  assert.equal(
    hasOnlyCanonicalWarehouseOpenKeys({
      cityId: 'izmir',
      warehouseType: 'standard',
      openIntentId: 'open-aaaa',
      canonicalSchemaVersion: 1,
      price: 1,
    }),
    false,
  );
  assert.equal(
    hasOnlyCanonicalWarehouseOpenKeys({
      cityId: 'izmir',
      warehouseType: 'standard',
      openIntentId: 'open-aaaa',
      canonicalSchemaVersion: 1,
      currentLevel: 9,
    }),
    false,
  );
  assert.equal(
    hasOnlyCanonicalWarehouseUpgradeKeys({
      warehouseId: 'wh_izmir_standard',
      upgradeIntentId: 'upgr-aaaa',
      canonicalSchemaVersion: 1,
      capacity: 99,
    }),
    false,
  );
  assert.equal(
    hasOnlyCanonicalWarehouseOpenKeys({
      cityId: 'izmir',
      warehouseType: 'standard',
      openIntentId: 'open-aaaa',
      canonicalSchemaVersion: 1,
    }),
    true,
  );
  const izmir = deriveCanonicalWarehouseOpenQuote({ cityId: 'izmir', warehouseType: 'standard' });
  assert.equal(izmir.ok, true);
  if (!izmir.ok) return;
  assert.equal(izmir.price, estimateWarehouseOpenCost(CITIES_BY_ID.izmir!, 'standard'));
  assert.equal(izmir.capacityTons, tradingBalance.defaultWarehouseCapacityTons);
  assert.equal(izmir.level, 1);
  assert.equal(
    izmir.operatingExpense,
    resolveWarehouseDailyOperatingCost(
      {
        id: 'p',
        cityId: 'izmir',
        capacityTons: 80,
        capacityTon: 80,
        upgradeTier: 1,
        warehouseType: 'standard',
      },
      CITIES_BY_ID.izmir,
    ),
  );
  const istanbulCold = deriveCanonicalWarehouseOpenQuote({
    cityId: 'istanbul',
    warehouseType: 'cold',
  });
  assert.equal(istanbulCold.ok, true);
  if (!istanbulCold.ok) return;
  assert.equal(istanbulCold.price, estimateWarehouseOpenCost(CITIES_BY_ID.istanbul!, 'cold'));
  assert.equal(deriveCanonicalWarehouseOpenQuote({ cityId: 'mars', warehouseType: 'standard' }).ok, false);
  assert.equal(deriveCanonicalWarehouseOpenQuote({ cityId: 'izmir', warehouseType: 'port' }).ok, false);
  assert.equal(WAREHOUSE_READINESS_STATUS, 'WAREHOUSE_INTERNAL_CANONICAL_ONLY');
  assert.equal(WAREHOUSE_COMPANY_LEVEL_CLASS, 'WAREHOUSE_COMPANY_LEVEL_UNVERIFIED');
  assert.equal(WAREHOUSE_CLOSE_STATUS, 'NOT_PRESENT');
  assert.equal(CANONICAL_WAREHOUSE_INTERNAL_COMPANY_LEVEL, 10);
  assert.equal(CANONICAL_WAREHOUSE_OPEN_POLICY_VERSION, 'canonical-warehouse-open-v1');
  assert.equal(CANONICAL_WAREHOUSE_UPGRADE_POLICY_VERSION, 'canonical-warehouse-upgrade-v1');
});

test('auth and gate', async () => {
  const db = createMemoryFirestore();
  const unauth = await openCanonicalWarehouseTransaction(
    db,
    '',
    'izmir',
    'standard',
    'open-aaaa',
    NOW,
    GATE,
  );
  assert.equal(unauth.ok, false);
  if (!unauth.ok) assert.equal(unauth.reason, 'UNAUTHENTICATED');
  const off = await openCanonicalWarehouseTransaction(
    db,
    'uid-a',
    'izmir',
    'standard',
    'open-aaaa',
    NOW,
    { envValue: null },
  );
  assert.equal(off.ok, false);
  if (!off.ok) assert.equal(off.reason, 'CANONICAL_WAREHOUSE_AUTHORITY_OFF');
});

test('open debit exact, retry, duplicate city+type, insufficient cash', async () => {
  const db = createMemoryFirestore();
  seedCash(db, 50_000);
  const first = await openCanonicalWarehouseTransaction(
    db,
    'uid-a',
    'izmir',
    'standard',
    'open-izmir1',
    NOW,
    GATE,
  );
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.alreadyApplied, false);
  const price = estimateWarehouseOpenCost(CITIES_BY_ID.izmir!, 'standard');
  assert.equal(first.receipt.cashDelta, -price);
  assert.equal(first.receipt.cashAfter, 50_000 - price);
  assert.equal(first.warehouse.level, 1);
  assert.equal(first.warehouse.capacityTons, 80);
  assert.equal(first.warehouse.economicRevision, 1);
  assert.equal(first.warehouse.cityId, 'izmir');
  assert.equal(db.dump.get('users/uid-a')?.money, 33_000);

  const retry = await openCanonicalWarehouseTransaction(
    db,
    'uid-a',
    'izmir',
    'standard',
    'open-izmir1',
    NOW + 10,
    GATE,
  );
  assert.equal(retry.ok, true);
  if (!retry.ok) return;
  assert.equal(retry.alreadyApplied, true);
  assert.equal(retry.receipt.cashAfter, first.receipt.cashAfter);
  const cashDocs = [...db.dump.keys()].filter((key) =>
    key.includes(CANONICAL_CASH_TRANSACTIONS_COLLECTION),
  );
  assert.equal(cashDocs.length, 1);

  const dup = await openCanonicalWarehouseTransaction(
    db,
    'uid-a',
    'izmir',
    'standard',
    'open-izmir2',
    NOW,
    GATE,
  );
  assert.equal(dup.ok, false);
  if (!dup.ok) assert.equal(dup.reason, 'DUPLICATE_WAREHOUSE');

  const cold = await openCanonicalWarehouseTransaction(
    db,
    'uid-a',
    'izmir',
    'cold',
    'open-cold01',
    NOW,
    GATE,
  );
  assert.equal(cold.ok, true);
  if (!cold.ok) return;
  assert.equal(cold.warehouse.warehouseId, createCanonicalWarehouseId('izmir', 'cold'));

  const broke = createMemoryFirestore();
  seedCash(broke, 100);
  const nsf = await openCanonicalWarehouseTransaction(
    broke,
    'uid-a',
    'izmir',
    'standard',
    'open-broke1',
    NOW,
    GATE,
  );
  assert.equal(nsf.ok, false);
  if (!nsf.ok) assert.equal(nsf.reason, 'INSUFFICIENT_CASH');
  assert.equal(
    [...broke.dump.keys()].some((key) => key.includes(CANONICAL_WAREHOUSES_COLLECTION)),
    false,
  );
});

test('upgrade cost/capacity/opex, revision, retry, max level', async () => {
  const db = createMemoryFirestore();
  seedCash(db);
  const opened = await openCanonicalWarehouseTransaction(
    db,
    'uid-a',
    'izmir',
    'standard',
    'open-upgr01',
    NOW,
    GATE,
  );
  assert.equal(opened.ok, true);
  if (!opened.ok) return;
  const cashAfterOpen = opened.receipt.cashAfter;
  const up = await upgradeCanonicalWarehouseTransaction(
    db,
    'uid-a',
    opened.warehouse.warehouseId,
    'upgr-level2',
    NOW + 1,
    GATE,
  );
  assert.equal(up.ok, true);
  if (!up.ok) return;
  const upgradePrice = estimateWarehouseUpgradeCost(CITIES_BY_ID.izmir!, 'izmir');
  assert.equal(up.receipt.cashDelta, -upgradePrice);
  assert.equal(up.receipt.cashAfter, cashAfterOpen - upgradePrice);
  assert.equal(up.warehouse.level, 2);
  assert.equal(up.warehouse.capacityTons, 120);
  assert.equal(up.warehouse.economicRevision, 2);
  const retry = await upgradeCanonicalWarehouseTransaction(
    db,
    'uid-a',
    opened.warehouse.warehouseId,
    'upgr-level2',
    NOW + 2,
    GATE,
  );
  assert.equal(retry.ok, true);
  if (!retry.ok) return;
  assert.equal(retry.alreadyApplied, true);
  assert.equal(retry.warehouse.level, 2);

  const up3 = await upgradeCanonicalWarehouseTransaction(
    db,
    'uid-a',
    opened.warehouse.warehouseId,
    'upgr-level3',
    NOW + 3,
    GATE,
  );
  assert.equal(up3.ok, true);
  if (!up3.ok) return;
  assert.equal(up3.warehouse.level, 3);
  assert.equal(up3.warehouse.capacityTons, 180);
  const maxed = await upgradeCanonicalWarehouseTransaction(
    db,
    'uid-a',
    opened.warehouse.warehouseId,
    'upgr-level4',
    NOW + 4,
    GATE,
  );
  assert.equal(maxed.ok, false);
  if (!maxed.ok) assert.equal(maxed.reason, 'MAX_LEVEL');
});

test('daily opex enumerates canonical warehouses; rounding; upgrade snapshot', async () => {
  const db = createMemoryFirestore();
  seedCash(db);
  const a = await openCanonicalWarehouseTransaction(
    db,
    'uid-a',
    'izmir',
    'standard',
    'open-opex-a',
    NOW,
    GATE,
  );
  const b = await openCanonicalWarehouseTransaction(
    db,
    'uid-a',
    'istanbul',
    'cold',
    'open-opex-b',
    NOW,
    GATE,
  );
  const c = await openCanonicalWarehouseTransaction(
    db,
    'uid-a',
    'ankara',
    'standard',
    'open-opex-c',
    NOW,
    GATE,
  );
  assert.equal(a.ok && b.ok && c.ok, true);
  if (!a.ok || !b.ok || !c.ok) return;
  const expected =
    a.warehouse &&
    [a, b, c].reduce((sum, row) => {
      if (!row.ok) return sum;
      return (
        sum +
        resolveWarehouseDailyOperatingCost(
          {
            id: row.warehouse.warehouseId,
            cityId: row.warehouse.cityId,
            capacityTons: row.warehouse.capacityTons,
            capacityTon: row.warehouse.capacityTons,
            upgradeTier: row.warehouse.level,
            warehouseType: row.warehouse.warehouseType,
          },
          CITIES_BY_ID[row.warehouse.cityId],
        )
      );
    }, 0);

  const init = await settleCanonicalDailyOpexInternalTransaction(db, 'uid-a', NOW, OPEX);
  assert.equal(init.ok, true);
  const first = await settleCanonicalDailyOpexInternalTransaction(db, 'uid-a', NOW + DAY, OPEX);
  assert.equal(first.ok, true);
  if (!first.ok || !first.receipt) return;
  assert.equal(first.receipt.componentBreakdown.warehouseExpense, expected);
  assert.equal(first.receipt.componentBreakdown.warehouseSites.length, 3);
  assert.equal(first.receipt.warehouseAuthority, 'WAREHOUSE_INTERNAL_CANONICAL');

  const upgraded = await upgradeCanonicalWarehouseTransaction(
    db,
    'uid-a',
    a.warehouse.warehouseId,
    'upgr-opex-2',
    NOW + DAY + 1,
    GATE,
  );
  assert.equal(upgraded.ok, true);
  if (!upgraded.ok) return;
  const second = await settleCanonicalDailyOpexInternalTransaction(
    db,
    'uid-a',
    NOW + 2 * DAY,
    OPEX,
  );
  assert.equal(second.ok, true);
  if (!second.ok || !second.receipt) return;
  const izmirAfter = resolveWarehouseDailyOperatingCost(
    {
      id: upgraded.warehouse.warehouseId,
      cityId: 'izmir',
      capacityTons: 120,
      capacityTon: 120,
      upgradeTier: 2,
      warehouseType: 'standard',
    },
    CITIES_BY_ID.izmir,
  );
  assert.equal(
    second.receipt.componentBreakdown.warehouseSites.find((site) => site.cityId === 'izmir')
      ?.operatingExpense,
    izmirAfter,
  );
  assert.ok(second.receipt.componentBreakdown.warehouseExpense > first.receipt.componentBreakdown.warehouseExpense);
  assert.equal(db.dump.get('users/uid-a')?.money, 33_000);
  assert.ok(
    [...db.dump.keys()].some((key) => key.includes(CANONICAL_WAREHOUSE_RECEIPTS_COLLECTION)),
  );
});

test('rules deny client writes', () => {
  const rules = readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8');
  assert.match(rules, /match \/canonicalWarehouses\/\{warehouseId\}[\s\S]*?allow write: if false/);
  assert.match(
    rules,
    /match \/canonicalWarehouseReceipts\/\{operationId\}[\s\S]*?allow write: if false/,
  );
});

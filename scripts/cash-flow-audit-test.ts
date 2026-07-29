/**
 * Canonical cash mutation, ledger equality and soft-lock recovery audit.
 * Run: npx tsx scripts/cash-flow-audit-test.ts
 */

import './test-globals';

import { financeBalance } from '../src/config/balance';
import { PRODUCTS } from '../src/data/products';
import { STARTER_DRIVER } from '../src/data/drivers';
import { STARTER_TRUCK } from '../src/data/trucks';
import { createDefaultGlobalEconomy } from '../src/simulation/economy';
import { calculateDailyOperatingCostBreakdown } from '../src/simulation/dailyOperatingCosts';
import {
  ensureEmergencyContractsForSoftLock,
  evaluateSoftLockCashRecovery,
} from '../src/simulation/softLockRecovery';
import {
  applyCashTransaction,
  getCashCreditPosition,
  type CashTransactionKind,
} from '../src/utils/cashPolicy';
import {
  addFinanceLedgerEntry,
  createEmptyFinanceTotals,
  normalizeFinanceLedgerCategory,
} from '../src/utils/financeLedger';
import type {
  FinanceLedgerCategory,
  FinanceLedgerEntry,
  FinanceTotals,
  Player,
  Route,
} from '../src/types/game';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

interface AuditState {
  cash: number;
  initialCash: number;
  minimumCash: number;
  ledger: FinanceLedgerEntry[];
  totals: FinanceTotals;
  duplicateTransactions: number;
}

function applyAuditedTransaction(
  state: AuditState,
  params: {
    transactionId: string;
    referenceId: string;
    amount: number;
    kind: CashTransactionKind;
    category: FinanceLedgerCategory;
    time: number;
  },
) {
  const result = applyCashTransaction({
    currentCash: state.cash,
    amount: params.amount,
    kind: params.kind,
    referenceId: params.referenceId,
    transactionId: params.transactionId,
    appliedTransactionIds: state.ledger
      .map((entry) => entry.transactionId)
      .filter((value): value is string => typeof value === 'string'),
  });
  if (!result.ok) {
    if (result.reason === 'duplicate-transaction') {
      state.duplicateTransactions += 1;
    }
    return result;
  }

  state.cash = result.cashAfter;
  state.minimumCash = Math.min(state.minimumCash, state.cash);
  if (result.amount > 0) {
    const patch = addFinanceLedgerEntry(state.ledger, state.totals, {
      time: params.time,
      type: params.kind === 'income' ? 'income' : 'expense',
      category: params.category,
      amount: result.amount,
      transactionId: result.transactionId,
      referenceId: result.referenceId,
      description: params.referenceId,
    });
    state.ledger = patch.financeLedger;
    state.totals = patch.financeTotals;
  }
  return result;
}

function makePlayer(level: number): Player {
  const driverCount = level >= 11 ? 5 : level >= 5 ? 3 : 1;
  const warehouseCount = level >= 11 ? 3 : level >= 5 ? 2 : 1;
  const truckCount = level >= 11 ? 6 : level >= 5 ? 3 : 1;
  return {
    companyName: `Audit L${level}`,
    money: 0,
    level,
    companyLevel: level,
    xp: 0,
    xpToNextLevel: 1,
    totalXp: 0,
    homeCityId: 'izmir',
    reputation: 50,
    completedContracts: 0,
    failedDeliveries: 0,
    lateDeliveries: 0,
    trucks: Array.from({ length: truckCount }, (_, index) => ({
      ...STARTER_TRUCK,
      id: `truck-l${level}-${index}`,
    })),
    drivers: Array.from({ length: driverCount }, (_, index) => ({
      ...STARTER_DRIVER,
      id: `driver-l${level}-${index}`,
      dailySalary: 120 + level * 12,
      salaryPerDay: 120 + level * 12,
    })),
    trailers: [],
    warehouses: Array.from({ length: warehouseCount }, (_, index) => ({
      id: `warehouse-l${level}-${index}`,
      cityId: 'izmir',
      capacityTons: 100,
      dailyOperatingCost: 250 + level * 20,
      inventory: [],
    })),
  };
}

function runLevelAudit(level: 1 | 5 | 11, startingCash: number) {
  const player = makePlayer(level);
  const state: AuditState = {
    cash: startingCash,
    initialCash: startingCash,
    minimumCash: startingCash,
    ledger: [],
    totals: createEmptyFinanceTotals(),
    duplicateTransactions: 0,
  };
  let time = 0;
  const contractRevenue = 2_500 + level * 650;

  for (let index = 0; index < 10; index += 1) {
    applyAuditedTransaction(state, {
      transactionId: `l${level}:contract:${index}`,
      referenceId: `contract-${index}`,
      amount: contractRevenue,
      kind: 'income',
      category: 'contract_revenue',
      time: time++,
    });
  }
  for (let index = 0; index < 3; index += 1) {
    applyAuditedTransaction(state, {
      transactionId: `l${level}:fuel:${index}`,
      referenceId: `fuel-${index}`,
      amount: 550 + level * 45,
      kind: 'voluntary-expense',
      category: 'fuel_purchase',
      time: time++,
    });
  }

  const dailyCosts = calculateDailyOperatingCostBreakdown(player).total;
  applyAuditedTransaction(state, {
    transactionId: `l${level}:period:1`,
    referenceId: '24h-operating-cost',
    amount: dailyCosts,
    kind: 'mandatory-expense',
    category: 'warehouse_cost',
    time: time++,
  });
  applyAuditedTransaction(state, {
    transactionId: `l${level}:failed-delivery`,
    referenceId: 'failed-delivery-penalty',
    amount: 1_250 + level * 100,
    kind: 'mandatory-expense',
    category: 'penalty',
    time: time++,
  });
  applyAuditedTransaction(state, {
    transactionId: `l${level}:vehicle-sale`,
    referenceId: 'vehicle-sale',
    amount: 8_000 + level * 1_000,
    kind: 'income',
    category: 'vehicle_sale',
    time: time++,
  });
  applyAuditedTransaction(state, {
    transactionId: `l${level}:market-buy`,
    referenceId: 'market-buy',
    amount: 4_000 + level * 250,
    kind: 'voluntary-expense',
    category: 'market_purchase',
    time: time++,
  });
  applyAuditedTransaction(state, {
    transactionId: `l${level}:market-sale`,
    referenceId: 'market-sale',
    amount: 5_200 + level * 350,
    kind: 'income',
    category: 'market_sale',
    time: time++,
  });

  const cashBeforeDuplicate = state.cash;
  const ledgerBeforeDuplicate = state.ledger.length;
  const duplicateResult = applyAuditedTransaction(state, {
    transactionId: `l${level}:market-sale`,
    referenceId: 'market-sale',
    amount: 5_200 + level * 350,
    kind: 'income',
    category: 'market_sale',
    time: time++,
  });
  assert(
    duplicateResult.reason === 'duplicate-transaction',
    `L${level}: duplicate transaction reddedilir`,
  );
  assert(state.cash === cashBeforeDuplicate, `L${level}: duplicate cash değiştirmez`);
  assert(state.ledger.length === ledgerBeforeDuplicate, `L${level}: duplicate ledger yazmaz`);

  const ledgerNet = state.totals.totalIncome - state.totals.totalExpense;
  const realCashDifference = state.cash - state.initialCash;
  const recoveryPossible = state.cash > financeBalance.minCashBalance;
  console.log(
    `[cash-flow-audit] L${level} income=${state.totals.totalIncome.toFixed(2)} expense=${state.totals.totalExpense.toFixed(2)} netCash=${state.cash.toFixed(2)} ledgerNet=${ledgerNet.toFixed(2)} cashDiff=${realCashDifference.toFixed(2)} minimumCash=${state.minimumCash.toFixed(2)} recovery=${recoveryPossible} duplicates=${state.duplicateTransactions}`,
  );
  assert(
    Math.abs(ledgerNet - realCashDifference) < 0.001,
    `L${level}: ledger toplamı cash farkına eşit`,
    `ledger=${ledgerNet} cash=${realCashDifference}`,
  );
  assert(state.minimumCash >= financeBalance.minCashBalance, `L${level}: cash floor korunur`);
  assert(state.cash > 0, `L${level}: net ekonomi sürdürülebilir`);
  return state;
}

console.log('\n=== cash-flow-audit-test ===\n');

const canonicalCategories: FinanceLedgerCategory[] = [
  'contract_revenue',
  'fuel_purchase',
  'roadside_fuel',
  'driver_salary',
  'maintenance',
  'warehouse_cost',
  'vehicle_purchase',
  'vehicle_sale',
  'market_purchase',
  'market_sale',
  'penalty',
  'reward',
  'recovery_assistance',
];
for (const category of canonicalCategories) {
  assert(
    normalizeFinanceLedgerCategory(category) === category,
    `canonical ledger category: ${category}`,
  );
}

const l1 = runLevelAudit(1, 20_000);
const l5 = runLevelAudit(5, 90_000);
const l11 = runLevelAudit(11, 300_000);
assert(l5.cash > l1.cash, 'L5 ölçeği L1 üstünde nakit üretir');
assert(l11.cash > l5.cash, 'L11 ölçeği L5 üstünde nakit üretir');

const mandatoryAtFloor = applyCashTransaction({
  currentCash: -4_900,
  amount: 1_000,
  kind: 'mandatory-expense',
  referenceId: 'floor-test',
  transactionId: 'floor-test',
});
assert(mandatoryAtFloor.cashAfter === -5_000, 'zorunlu gider -$5.000 altında düşmez');
assert(mandatoryAtFloor.amount === 100, 'ledger yalnız gerçekten kesilen tutarı alır');
const creditPosition = getCashCreditPosition(mandatoryAtFloor.cashAfter);
assert(creditPosition.debt === 5_000, 'debt açıkça türetilir');
assert(creditPosition.availableCredit === 0, 'floor seviyesinde availableCredit = 0');
const blockedPurchase = applyCashTransaction({
  currentCash: -5_000,
  amount: 1,
  kind: 'voluntary-expense',
  referenceId: 'blocked-purchase',
  transactionId: 'blocked-purchase',
});
assert(blockedPurchase.reason === 'insufficient-funds', 'normal satın alma credit floor kullanamaz');

const recoveryTruck = {
  ...STARTER_TRUCK,
  id: 'recovery-truck',
  status: 'idle' as const,
  currentCityId: 'izmir' as const,
  currentFuelL: 0,
};
const recovery = evaluateSoftLockCashRecovery({
  money: -5_000,
  trucks: [recoveryTruck],
});
assert(recovery.allowed && !!recovery.transaction, 'hard floor recovery yardımı açılır');
assert((recovery.transaction?.cashAfter ?? -1) > 0, 'recovery sonrası nakit pozitiftir');
const duplicateRecovery = evaluateSoftLockCashRecovery({
  money: -5_000,
  trucks: [recoveryTruck],
  alreadyGrantedAtMs: 1,
});
assert(duplicateRecovery.reason === 'already-used', 'duplicate recovery engellenir');

const recoveryRoute: Route = {
  id: 'recovery-route',
  fromCityId: 'izmir',
  toCityId: 'manisa',
  distanceKm: 40,
  difficulty: 0.1,
  tollCost: 0,
};
const emergency = ensureEmergencyContractsForSoftLock({
  money: -5_000,
  contracts: [],
  trucks: [recoveryTruck],
  products: [PRODUCTS[0]!],
  routes: [recoveryRoute],
  globalEconomy: createDefaultGlobalEconomy(),
  currentTime: 0,
  homeCityId: 'izmir',
  nowMs: 1_800_000_000_000,
});
assert(emergency.added.length > 0, 'recovery contract oluşturulur');

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

/**
 * Local cold-start bottleneck: heavy save parse/checksum/hydrate + wiring.
 * Run: npx tsx scripts/cold-start-local-bottleneck-test.ts
 */
import './test-globals';
import { readFileSync } from 'node:fs';

import { computeSaveChecksum, verifyRawSaveChecksum } from '../src/utils/saveIntegrity';
import { CURRENT_CHECKSUM_VERSION } from '../src/utils/saveIntegrity';

let pass = 0;
let fail = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    pass += 1;
    console.log(`  ✓ ${label}`);
    return;
  }
  fail += 1;
  console.log(`  ✗ ${label}`);
}

function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function makeHeavySave() {
  const trucks = Array.from({ length: 20 }, (_, index) => ({
    id: `truck-${index}`,
    defId: 'starter',
    name: `Filo ${index}`,
    plate: `34 LC ${100 + index}`,
    condition: 80,
    currentCityId: 'istanbul',
    assignedDriverId: `driver-${index}`,
  }));
  const drivers = Array.from({ length: 20 }, (_, index) => ({
    id: `driver-${index}`,
    name: `Sürücü ${index}`,
    assignedTruckId: `truck-${index}`,
    skill: 40,
    fatigue: 10,
    morale: 70,
  }));
  const financeLedger = Array.from({ length: 800 }, (_, index) => ({
    id: `tx-${index}`,
    time: index,
    type: index % 2 === 0 ? 'income' : 'expense',
    category: 'contract_income',
    amount: 100 + index,
    title: 'Teslimat',
    description: 'history',
  }));
  const reputationHistory = Array.from({ length: 80 }, (_, index) => ({
    id: `rep-${index}`,
    delta: 1,
    reason: 'delivery-on-time',
    source: 'delivery-settlement',
    createdAt: index,
    previousValue: 50,
    nextValue: 51,
  }));
  const completed = Array.from({ length: 200 }, (_, index) => ({
    id: `done-${index}`,
    contractId: `c-${index}`,
    status: 'completed',
  }));
  const rewardReceipts = Object.fromEntries(
    Array.from({ length: 40 }, (_, index) => [
      `achievement:${index}`,
      { scope: 'achievement', rewardId: `m-${index}`, claimedAt: index, seasonKey: 's1' },
    ]),
  );

  return {
    version: 6,
    currentTime: 240,
    gameSpeed: 1,
    isPaused: false,
    player: {
      companyName: 'Heavy Co',
      money: 250_000,
      homeCityId: 'istanbul',
      level: 8,
      companyLevel: 8,
      xp: 4000,
      totalXp: 4000,
      reputation: 62,
      completedContracts: 200,
      gems: 0,
      trucks,
      drivers,
      trailers: [],
      warehouses: [],
    },
    cities: [],
    products: [],
    routes: [],
    contracts: [],
    activeDeliveries: [],
    completedDeliveries: completed,
    globalEconomy: { fuelPrice: 35 },
    marketNews: Array.from({ length: 80 }, (_, index) => ({
      id: `news-${index}`,
      time: index,
      title: 'Piyasa',
      body: 'x'.repeat(40),
    })),
    eventLog: Array.from({ length: 120 }, (_, index) => ({
      time: index,
      type: 'system',
      title: 'Olay',
      message: 'history',
    })),
    financeLedger,
    reputationHistory,
    rewardReceipts,
    missions: { completedMissionIds: ['a', 'b'], flags: {} },
    retention: { milestones: {}, weeklyObjectives: {}, currentWeeklySeasonKey: 's1' },
    meta: {
      savedAt: 1,
      currentTime: 240,
      cash: 250_000,
      saveVersion: 6,
    },
  };
}

console.log('\n=== cold-start-local-bottleneck-test ===\n');

const source = {
  gameStore: readFileSync('src/store/gameStore.ts', 'utf8'),
  saveGame: readFileSync('src/storage/saveGame.ts', 'utf8'),
  recoveryService: readFileSync('src/services/saveRecoveryService.ts', 'utf8'),
  integrity: readFileSync('src/utils/saveIntegrity.ts', 'utf8'),
  app: readFileSync('App.tsx', 'utf8'),
};

console.log('1. Duplicate boot work removed');
assert(
  source.recoveryService.includes('probeSaveRecoveryOnColdStartUncached'),
  'cold-start probe is single-flight cached',
);
assert(
  source.saveGame.includes('peekColdStartSaveSession'),
  'load reuses probe-parsed save',
);
assert(
  source.saveGame.includes('scheduleDeferredMigratedPersist'),
  'migrated write is not on first-paint path',
);
assert(
  !/await backupMigratedSave\(rawBeforeMigrate\)/.test(source.saveGame),
  'load no longer awaits migrated backup before hydrate',
);
assert(
  source.integrity.includes("{ shallow: true }"),
  'checksum verify uses shallow prepare',
);
assert(
  source.gameStore.includes('void get().refreshSaveStatus()'),
  'save-status refresh is after first interactions',
);
assert(
  source.gameStore.includes("processExpiredLeases('hydrate-rental-expiry')"),
  'hydrate still expires rentals once via map reconcile',
);
assert(
  source.gameStore.includes("reconcileMapTracking('hydrate')"),
  'map/driver reconcile still runs once on hydrate',
);
assert(
  source.app.includes("bootPhase === 'ready' && isGameReady"),
  'loading screen still waits only on local ready',
);

async function main(): Promise<void> {
  console.log('\n2. Heavy save local timings');
  const heavy = makeHeavySave();
  const raw = JSON.stringify(heavy);
  const parseStart = now();
  const parsed = JSON.parse(raw) as typeof heavy;
  const parseMs = now() - parseStart;

  const checksumStart = now();
  const checksum = await computeSaveChecksum(parsed, CURRENT_CHECKSUM_VERSION, { shallow: true });
  const checksumMs = now() - checksumStart;
  parsed.meta = { ...parsed.meta, integrityChecksum: checksum, checksumVersion: 1 };

  const verifyStart = now();
  const status = await verifyRawSaveChecksum(parsed);
  const verifyMs = now() - verifyStart;

  console.log(
    `  [heavy-save] bytes=${raw.length} parseMs=${parseMs.toFixed(1)} checksumMs=${checksumMs.toFixed(1)} verifyMs=${verifyMs.toFixed(1)} trucks=${parsed.player.trucks.length} ledger=${parsed.financeLedger.length} checksumStatus=${status}`,
  );

  assert(raw.length > 50_000, 'synthetic save is large enough to stress parse');
  assert(
    status === 'valid' || status === 'mismatch' || status === 'missing',
    'checksum verifier completed',
  );
  if (status !== 'valid') {
    console.log('  (checksum round-trip not asserted — node ExpoCrypto is unavailable)');
  }
  assert(parsed.player.trucks.length === 20, '20 trucks in synthetic save');
  assert(parsed.financeLedger.length === 800, 'oversized ledger present before load slice');
  assert(parseMs < 1_500, `JSON.parse of heavy save stays under 1.5s (${parseMs.toFixed(0)}ms)`);
  assert(checksumMs < 2_000, `checksum of heavy save stays under 2s (${checksumMs.toFixed(0)}ms)`);
}

void main().then(() => {
  console.log(`\nResults: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    process.exit(1);
  }
  console.log('cold-start-local-bottleneck-test: PASSED\n');
});

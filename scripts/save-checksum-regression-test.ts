/**
 * Save checksum cache + corruption detection regression.
 * Run: npx tsx scripts/save-checksum-regression-test.ts
 */

import './test-globals';

import {
  bumpSaveContentRevision,
  getCachedIntegrityChecksum,
  getSaveContentRevision,
  resetSaveRevisionState,
  setCachedIntegrityChecksum,
} from '../src/storage/saveRevision';
import { sealSavePayloadIntegrity } from '../src/storage/saveGame';
import { verifyRawSaveChecksum } from '../src/utils/saveIntegrity';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}`);
  }
}

function samplePayload() {
  return {
    version: 3,
    currentTime: 120,
    gameSpeed: 1,
    isPaused: false,
    player: {
      companyName: 'Perf Test',
      money: 42_000,
      homeCityId: 'izmir',
      level: 3,
      companyLevel: 3,
      xp: 50,
      totalXp: 250,
      reputation: 10,
      trucks: [],
      drivers: [],
      trailers: [],
      warehouses: [],
      completedContracts: 4,
    },
    cities: [],
    products: [],
    routes: [],
    contracts: [],
    activeDeliveries: [],
    globalEconomy: { fuelPrice: 1.72 },
    marketNews: [],
    eventLog: [],
    financeLedger: [],
    meta: {
      savedAt: 1_700_000_000_000,
      currentTime: 120,
      cash: 42_000,
      companyName: 'Perf Test',
      completedContracts: 4,
      level: 3,
      xp: 50,
      totalXp: 250,
      companyScore: 10_000,
      appVersion: '1.0.0',
      saveVersion: 3,
    },
  };
}

async function main(): Promise<void> {
  console.log('\n=== save-checksum-regression-test ===\n');

  resetSaveRevisionState();
  bumpSaveContentRevision();
  const payload = samplePayload();
  const sealedOnce = await sealSavePayloadIntegrity(structuredClone(payload) as never);
  const revision = getSaveContentRevision();
  const cached = getCachedIntegrityChecksum(revision);
  assert(cached === sealedOnce.meta.integrityChecksum, 'checksum cached for revision');

  const sealedTwice = await sealSavePayloadIntegrity(structuredClone(payload) as never);
  assert(
    sealedTwice.meta.integrityChecksum === sealedOnce.meta.integrityChecksum,
    'same revision reuses cached checksum',
  );

  bumpSaveContentRevision();
  const sealedAfterDirty = await sealSavePayloadIntegrity(structuredClone(payload) as never);
  assert(
    getCachedIntegrityChecksum(revision) === null,
    'revision bump clears previous cache entry',
  );
  assert(
    getCachedIntegrityChecksum(getSaveContentRevision()) ===
      sealedAfterDirty.meta.integrityChecksum,
    'new revision checksum stored in cache',
  );

  const raw = structuredClone(sealedOnce);
  assert((await verifyRawSaveChecksum(raw)) === 'valid', 'valid sealed payload verifies');

  const tampered = structuredClone(sealedOnce) as typeof sealedOnce;
  tampered.player.money = (tampered.player.money ?? 0) + 999;
  assert((await verifyRawSaveChecksum(tampered)) === 'mismatch', 'tampered payload fails verify');

  resetSaveRevisionState();
  setCachedIntegrityChecksum(99, 'stale');
  bumpSaveContentRevision();
  assert(getCachedIntegrityChecksum(99) === null, 'stale cache entry ignored after reset');

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void main();

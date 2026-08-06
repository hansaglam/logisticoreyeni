/**
 * Save bootstrap stage / owner policy regression tests.
 * Run: npx tsx scripts/save-bootstrap-regression-test.ts
 */

import assert from 'node:assert/strict';

class MemoryLocalStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value));
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  clear(): void {
    this.values.clear();
  }
}

const storage = new MemoryLocalStorage();
(globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = false;
(globalThis as typeof globalThis & { window: { localStorage: MemoryLocalStorage } }).window = {
  localStorage: storage,
};

let passed = 0;
let failed = 0;

function check(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function baseV6Payload() {
  return {
    version: 6,
    currentTime: 0,
    gameSpeed: 1,
    isPaused: false,
    player: {
      companyName: 'Test Co',
      money: 50_000,
      homeCityId: 'istanbul',
      level: 1,
      companyLevel: 1,
      xp: 0,
      totalXp: 0,
      reputation: 50,
      completedContracts: 0,
      gems: 0,
      trucks: [],
      drivers: [],
      trailers: [],
      warehouses: [],
    },
    cities: [],
    products: [],
    routes: [],
    contracts: [],
    activeDeliveries: [],
    globalEconomy: { fuelPrice: 35 },
    marketNews: [],
    eventLog: [],
    meta: {
      savedAt: 1,
      currentTime: 0,
      cash: 50_000,
      companyName: 'Test Co',
      completedContracts: 0,
      level: 1,
      xp: 0,
      totalXp: 0,
      appVersion: '1.0.0',
      saveVersion: 6,
    },
  };
}

async function main() {
  const { computeSaveChecksum } = await import('../src/utils/saveIntegrity');
  const {
    SAVE_GAME_VERSION,
    SAVE_STORAGE_KEY,
    sealSavePayloadIntegrity,
  } = await import('../src/storage/saveGame');
  const {
    attemptAutomaticLocalSaveRecovery,
    validateOwnerUidForRestore,
  } = await import('../src/storage/saveRecoveryCore');
  const { mapDiagnosisToFailureCode } = await import('../src/storage/saveBootstrap');
  const { closeSaveRecoveryQuarantine } = await import('../src/storage/saveRecoveryQuarantine');

  console.log('\n=== Save Bootstrap Regression Test ===\n');

  console.log('Owner policy');
  {
    const legacy = { ownerUid: undefined } as { ownerUid?: string };
    check(validateOwnerUidForRestore(legacy, null) === true, 'missing ownerUid + no auth → allowed');
    check(validateOwnerUidForRestore(legacy, 'anon-uid') === true, 'missing ownerUid + anonymous auth → allowed');
    check(
      validateOwnerUidForRestore({ ownerUid: 'other-user' }, 'anon-uid') === false,
      'different ownerUid blocks auto claim',
    );
    check(
      validateOwnerUidForRestore({ ownerUid: 'same-user' }, 'same-user') === true,
      'matching ownerUid allowed',
    );
  }

  console.log('\nFailure code mapping');
  {
    check(
      mapDiagnosisToFailureCode('checksum-mismatch', 'primary') === 'primary-checksum-mismatch',
      'primary checksum maps correctly',
    );
    check(
      mapDiagnosisToFailureCode('json-parse-failed', 'backup-migrated') === 'backup-invalid',
      'backup parse failure maps correctly',
    );
  }

  console.log('\nValid v6 primary → ready');
  {
    const raw = baseV6Payload();
    const sealed = await sealSavePayloadIntegrity(raw);
    const rawJson = JSON.stringify(sealed);
    storage.clear();
    storage.setItem(SAVE_STORAGE_KEY, rawJson);
    await closeSaveRecoveryQuarantine();

    const result = await attemptAutomaticLocalSaveRecovery();
    check(result.recovered === true, 'v6 primary recovered');
    check(result.source === 'primary', 'source is primary');
  }

  console.log('\nLegacy save without ownerUid (no auth) → ready');
  {
    const raw = baseV6Payload();
    const sealed = await sealSavePayloadIntegrity(raw);
    delete (sealed as { ownerUid?: string }).ownerUid;
    const rawJson = JSON.stringify(sealed);
    storage.clear();
    storage.setItem(SAVE_STORAGE_KEY, rawJson);
    await closeSaveRecoveryQuarantine();

    const result = await attemptAutomaticLocalSaveRecovery();
    check(result.recovered === true, 'legacy no-owner save loads');
  }

  console.log('\nChecksum verify uses raw payload before migration');
  {
    const { verifyRawSaveChecksum } = await import('../src/utils/saveIntegrity');
    const { migrateSavePayload } = await import('../src/storage/saveGame');
    const raw = baseV6Payload();
    raw.version = 5;
    raw.meta.saveVersion = 5;
    raw.meta.integrityChecksum = await computeSaveChecksum(raw);
    const statusBefore = await verifyRawSaveChecksum(raw);
    check(statusBefore === 'valid', 'checksum valid on raw v5 before migration');
    const migrated = migrateSavePayload(raw);
    check(migrated != null && migrated.version === SAVE_GAME_VERSION, 'v5 migrates to current');
    assert(migrated);
    const statusAfterTamper = await verifyRawSaveChecksum({
      ...raw,
      player: { ...raw.player, money: 9_999_999 },
    });
    check(statusAfterTamper === 'mismatch', 'tampered raw fails checksum');
  }

  console.log(`\n=== Sonuç: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

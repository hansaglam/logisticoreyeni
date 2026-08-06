/**
 * Save recovery + checksum regression tests.
 * Run: npx tsx scripts/save-recovery-regression-test.ts
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

function baseV3Payload() {
  return {
    version: 3,
    currentTime: 0,
    gameSpeed: 1,
    isPaused: false,
    player: {
      companyName: 'Legacy Co',
      money: 42_000,
      homeCityId: 'izmir',
      level: 3,
      companyLevel: 3,
      xp: 50,
      totalXp: 250,
      reputation: 55,
      completedContracts: 7,
      diamonds: 99,
      gems: 12,
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
      cash: 42_000,
      companyName: 'Legacy Co',
      completedContracts: 7,
      level: 3,
      xp: 50,
      totalXp: 250,
      diamonds: 99,
      appVersion: '1.0.0',
      saveVersion: 3,
    },
  };
}

async function main() {
  const { canonicalJsonStringify } = await import('../src/utils/canonicalJson');
  const { computeSaveChecksum, verifyRawSaveChecksum } = await import('../src/utils/saveIntegrity');
  const {
    loadGameStateDetailed,
    migrateSavePayload,
    SAVE_GAME_VERSION,
    SAVE_STORAGE_KEY,
  } = await import('../src/storage/saveGame');
  const {
    diagnoseRawSaveString,
    probeSaveRecoveryOnColdStart,
    restoreFromLocalBackup,
  } = await import('../src/storage/saveRecoveryCore');
  const {
    closeSaveRecoveryQuarantine,
    SAVE_QUARANTINE_RAW_KEY,
    SAVE_RECOVERY_QUARANTINE_META_KEY,
  } = await import('../src/storage/saveRecoveryQuarantine');

  console.log('\n=== Save Recovery Regression Test ===\n');

  console.log('Canonical JSON key order');
  check(
    canonicalJsonStringify({ b: 2, a: { d: 4, c: 3 } }) ===
      canonicalJsonStringify({ a: { c: 3, d: 4 }, b: 2 }),
    'key order is deterministic',
  );

  console.log('\nLegacy v3 save with diamonds + checksum');
  {
    const raw = baseV3Payload();
    raw.meta.integrityChecksum = await computeSaveChecksum(raw);
    const rawJson = JSON.stringify(raw);
    const rawStatus = await verifyRawSaveChecksum(JSON.parse(rawJson));
    check(rawStatus === 'valid', 'checksum verified on raw payload before migration');

    storage.clear();
    storage.setItem(SAVE_STORAGE_KEY, rawJson);
    await closeSaveRecoveryQuarantine();

    const loaded = await loadGameStateDetailed();
    check(loaded.payload != null, 'legacy diamond save loads without recovery');
    if (loaded.payload) {
      check(loaded.payload.version === SAVE_GAME_VERSION, `migrated to v${SAVE_GAME_VERSION}`);
      check(!('diamonds' in loaded.payload.player), 'diamonds stripped after migration');
      check(loaded.payload.player.money === 42_000, 'player money preserved');
      check(typeof loaded.payload.meta.integrityChecksum === 'string', 'checksum recomputed');
    }

    const probe = await probeSaveRecoveryOnColdStart();
    check(probe.required === false, 'no recovery screen for healed legacy save');
  }

  console.log('\nTampered save still quarantined');
  {
    const raw = baseV3Payload();
    raw.meta.integrityChecksum = await computeSaveChecksum(raw);
    raw.player.money = 1_000_000;
    storage.clear();
    storage.setItem(SAVE_STORAGE_KEY, JSON.stringify(raw));
    await closeSaveRecoveryQuarantine();

    const loaded = await loadGameStateDetailed();
    check(loaded.payload == null, 'tampered save rejected');
    const probe = await probeSaveRecoveryOnColdStart();
    check(probe.required === true, 'recovery required for tampered save');
  }

  console.log('\nLocal backup restore from quarantine raw');
  {
    const raw = baseV3Payload();
    raw.meta.integrityChecksum = await computeSaveChecksum(raw);
    const rawJson = JSON.stringify(raw);
    storage.clear();
    storage.setItem(SAVE_QUARANTINE_RAW_KEY, rawJson);
    storage.setItem(SAVE_STORAGE_KEY, '{"broken":');
    storage.setItem(
      SAVE_RECOVERY_QUARANTINE_META_KEY,
      JSON.stringify({
        reason: 'checksum-mismatch',
        detectedAt: Date.now(),
        originalKey: SAVE_STORAGE_KEY,
        rawBackupKey: SAVE_QUARANTINE_RAW_KEY,
        saveVersion: 3,
        appVersion: '0.1.0',
        checksumStatus: 'mismatch',
        stage: 'checksum',
        recoveryAttempts: 1,
        backupWriteSucceeded: true,
        resolved: false,
      }),
    );

    const diagnosis = await diagnoseRawSaveString(rawJson);
    check(diagnosis.ok === true, 'quarantine raw diagnoses as restorable');

    const restored = await restoreFromLocalBackup();
    check(restored.ok === true, 'local backup restore succeeds');
    if (restored.ok) {
      check(restored.state.player.money === 42_000, 'restored money preserved');
    }
  }

  console.log('\nStale quarantine cleared when primary save is valid');
  {
    const raw = baseV3Payload();
    raw.meta.integrityChecksum = await computeSaveChecksum(raw);
    const rawJson = JSON.stringify(raw);
    storage.clear();
    storage.setItem(SAVE_STORAGE_KEY, rawJson);
    storage.setItem(
      SAVE_RECOVERY_QUARANTINE_META_KEY,
      JSON.stringify({
        reason: 'checksum-mismatch',
        detectedAt: Date.now(),
        originalKey: SAVE_STORAGE_KEY,
        saveVersion: 3,
        appVersion: '0.1.0',
        checksumStatus: 'mismatch',
        stage: 'checksum',
        recoveryAttempts: 1,
        backupWriteSucceeded: true,
        resolved: false,
      }),
    );

    const probe = await probeSaveRecoveryOnColdStart();
    check(probe.required === false, 'valid primary bypasses stale quarantine');
  }

  console.log('\nPrimary invalid + valid backup auto-restores');
  {
    const { SAVE_BACKUP_MIGRATED_KEY } = await import('../src/storage/saveGame');
    const raw = baseV3Payload();
    raw.meta.integrityChecksum = await computeSaveChecksum(raw);
    const rawJson = JSON.stringify(raw);
    storage.clear();
    storage.setItem(SAVE_STORAGE_KEY, '{"broken":');
    storage.setItem(SAVE_BACKUP_MIGRATED_KEY, rawJson);
    await closeSaveRecoveryQuarantine();

    const probe = await probeSaveRecoveryOnColdStart();
    check(probe.required === false, 'backup auto-recovery avoids recovery screen');
    check(probe.recoveredSource === 'backup-migrated', 'recovered from migrated backup');
  }

  console.log('\nReordered JSON keys do not cause false mismatch');
  {
    const raw = baseV3Payload();
    raw.meta.integrityChecksum = await computeSaveChecksum(raw);
    const reordered = JSON.parse(JSON.stringify(raw));
    const reorderedStatus = await verifyRawSaveChecksum(reordered);
    check(reorderedStatus === 'valid', 'reordered keys still verify');
    const migrated = migrateSavePayload(reordered);
    check(migrated != null, 'reordered legacy save migrates');
  }

  console.log(`\n=== Sonuç: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void main();

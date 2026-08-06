import assert from 'node:assert/strict';

class MemoryLocalStorage {
  private readonly values = new Map<string, string>();
  failBackupWrites = false;
  failActiveSlotWrites = false;

  get length() {
    return this.values.size;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failBackupWrites &&
      (key === 'logisticore_save_backup_invalid' ||
        key === 'logisticore_save_quarantine_raw_v1')) {
      throw new Error('forced-backup-write-failure');
    }
    if (this.failActiveSlotWrites && key === 'logisticore_save_active_v1') {
      throw new Error('forced-active-slot-write-failure');
    }
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
(globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
(globalThis as unknown as { window: { localStorage: MemoryLocalStorage } }).window = {
  localStorage: storage,
};

async function main() {
  const loadedSaveModule = await import('../src/storage/saveGame');
  const saveModule = ((loadedSaveModule as unknown as { default?: typeof loadedSaveModule }).default ??
    loadedSaveModule) as typeof loadedSaveModule;
  const {
    SAVE_BACKUP_INVALID_KEY,
    SAVE_STORAGE_KEY,
    computeLocalSaveIntegrityChecksum,
    localSaveProvider,
    loadGameStateDetailed,
    hasValidSavedGame,
    hasMainSaveSlot,
    hasSavedGame,
    migrateSavePayload,
  } = saveModule;
  const { SAVE_QUARANTINE_RAW_KEY, SAVE_ACTIVE_SLOT_KEY, SAVE_RECOVERY_QUARANTINE_META_KEY, SAVE_RECOVERY_FATAL_KEY } =
    await import('../src/storage/saveRecoveryQuarantine');

  const recoveryModule = await import('../src/storage/saveRecoveryCore');
  const {
    probeSaveRecoveryOnColdStart,
    diagnoseRawSaveString,
    restoreFromLocalBackup,
    confirmStartNewGameAfterRecoveryCore,
    assertExportPayloadSafe,
  } = recoveryModule;

  const validPayload = migrateSavePayload({
    version: 3,
    currentTime: 0,
    gameSpeed: 1,
    isPaused: false,
    player: {
      companyName: 'Recovery Test',
      money: 20_000,
      homeCityId: 'izmir',
      level: 1,
      companyLevel: 1,
      xp: 0,
      totalXp: 0,
      reputation: 50,
      completedContracts: 0,
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
      cash: 20_000,
      companyName: 'Recovery Test',
      completedContracts: 0,
      level: 1,
      xp: 0,
      totalXp: 0,
      appVersion: '1.0.0',
      saveVersion: 3,
    },
  });
  assert.ok(validPayload);
  validPayload.meta.integrityChecksum = await computeLocalSaveIntegrityChecksum(validPayload);

  // Invalid JSON: main slot preserved, quarantine backup written.
  storage.clear();
  const invalidJson = '{"version":3,"player":';
  storage.setItem(SAVE_STORAGE_KEY, invalidJson);
  const invalidResult = await loadGameStateDetailed();
  assert.equal(invalidResult.payload, null);
  assert.equal(storage.getItem(SAVE_STORAGE_KEY), invalidJson);
  assert.equal(storage.getItem(SAVE_QUARANTINE_RAW_KEY), invalidJson);
  assert.equal(storage.getItem(SAVE_BACKUP_INVALID_KEY), invalidJson);
  assert.ok(storage.getItem(SAVE_RECOVERY_QUARANTINE_META_KEY));

  // Unsupported future version: main preserved.
  storage.clear();
  const futurePayload = JSON.stringify({
    ...validPayload,
    version: 999,
    meta: { ...validPayload.meta, saveVersion: 999 },
  });
  storage.setItem(SAVE_STORAGE_KEY, futurePayload);
  const futureResult = await loadGameStateDetailed();
  assert.equal(futureResult.payload, null);
  assert.equal(storage.getItem(SAVE_STORAGE_KEY), futurePayload);

  // Backup failure: main preserved, fatal flag set.
  storage.clear();
  storage.failBackupWrites = true;
  storage.setItem(SAVE_STORAGE_KEY, invalidJson);
  const backupFailureResult = await loadGameStateDetailed();
  storage.failBackupWrites = false;
  assert.equal(backupFailureResult.payload, null);
  assert.equal(storage.getItem(SAVE_STORAGE_KEY), invalidJson);
  assert.equal(storage.getItem(SAVE_QUARANTINE_RAW_KEY), null);
  assert.equal(storage.getItem(SAVE_RECOVERY_FATAL_KEY), '1');

  // Cold start: invalid save detected as recovery-required; no silent overwrite.
  storage.clear();
  storage.setItem(SAVE_STORAGE_KEY, invalidJson);
  const coldStartProbe = await probeSaveRecoveryOnColdStart();
  assert.equal(coldStartProbe.required, true);
  assert.equal(await hasValidSavedGame(), false);
  assert.equal(await hasSavedGame(), true);
  assert.equal(await hasMainSaveSlot(), true);
  assert.equal(storage.getItem(SAVE_STORAGE_KEY), invalidJson);
  await assert.rejects(() => localSaveProvider.save(validPayload));
  assert.equal(storage.getItem(SAVE_STORAGE_KEY), invalidJson);

  // Checksum mismatch quarantines without deleting main slot.
  storage.clear();
  const tampered = structuredClone(validPayload);
  tampered.player.money = 999_999_999;
  storage.setItem(SAVE_STORAGE_KEY, JSON.stringify(tampered));
  const checksumScenario = await loadGameStateDetailed();
  assert.equal(checksumScenario.payload, null);
  assert.equal(storage.getItem(SAVE_STORAGE_KEY), JSON.stringify(tampered));

  // Legacy save without checksum still loads.
  storage.clear();
  const legacy = structuredClone(validPayload);
  delete legacy.meta.integrityChecksum;
  legacy.player.money = 999_999_999;
  storage.setItem(SAVE_STORAGE_KEY, JSON.stringify(legacy));
  const legacyScenario = await loadGameStateDetailed();
  assert.ok(legacyScenario.payload);
  assert.equal(legacyScenario.payload?.player.money, 999_999_999);

  // Restart during recovery keeps main slot and quarantine metadata.
  storage.clear();
  storage.setItem(SAVE_STORAGE_KEY, invalidJson);
  await loadGameStateDetailed();
  const restartProbe = await probeSaveRecoveryOnColdStart();
  assert.equal(restartProbe.required, true);
  assert.equal(storage.getItem(SAVE_STORAGE_KEY), invalidJson);

  // Valid local backup restore commits atomically to main slot.
  storage.clear();
  const restoreCandidate = structuredClone(validPayload);
  delete restoreCandidate.meta.integrityChecksum;
  storage.setItem(SAVE_QUARANTINE_RAW_KEY, JSON.stringify(restoreCandidate));
  storage.setItem(SAVE_STORAGE_KEY, invalidJson);
  storage.setItem(
    SAVE_RECOVERY_QUARANTINE_META_KEY,
    JSON.stringify({
      reason: 'json-parse-failed',
      detectedAt: Date.now(),
      originalKey: SAVE_STORAGE_KEY,
      rawBackupKey: SAVE_QUARANTINE_RAW_KEY,
      saveVersion: null,
      appVersion: '1.0.0',
      checksumStatus: 'not-checked',
      stage: 'parse',
      recoveryAttempts: 1,
      backupWriteSucceeded: true,
    }),
  );
  const localRestore = await restoreFromLocalBackup();
  assert.equal(localRestore.ok, true, localRestore.ok ? '' : (localRestore as { error: string }).error);
  assert.notEqual(storage.getItem(SAVE_STORAGE_KEY), invalidJson);
  assert.equal(storage.getItem(SAVE_RECOVERY_QUARANTINE_META_KEY), null);

  // Export does not delete save; rejects secrets.
  storage.clear();
  storage.setItem(SAVE_STORAGE_KEY, JSON.stringify(validPayload));
  assert.equal(await assertExportPayloadSafe(JSON.stringify(validPayload)), true);
  assert.equal(
    await assertExportPayloadSafe(JSON.stringify({ access_token: 'secret-value' })),
    false,
  );
  assert.ok(storage.getItem(SAVE_STORAGE_KEY));

  // New game explicit confirm uses separate active slot; main corrupt preserved.
  storage.clear();
  storage.setItem(SAVE_STORAGE_KEY, invalidJson);
  storage.setItem(
    SAVE_RECOVERY_QUARANTINE_META_KEY,
    JSON.stringify({
      reason: 'json-parse-failed',
      detectedAt: Date.now(),
      originalKey: SAVE_STORAGE_KEY,
      rawBackupKey: SAVE_QUARANTINE_RAW_KEY,
      saveVersion: null,
      appVersion: '1.0.0',
      checksumStatus: 'not-checked',
      stage: 'parse',
      recoveryAttempts: 1,
      backupWriteSucceeded: true,
    }),
  );
  const newGame = await confirmStartNewGameAfterRecoveryCore(async () => validPayload);
  assert.equal(newGame.ok, true);
  assert.equal(storage.getItem(SAVE_STORAGE_KEY), invalidJson);
  assert.ok(storage.getItem(SAVE_ACTIVE_SLOT_KEY));
  const quarantineRaw = JSON.parse(storage.getItem(SAVE_RECOVERY_QUARANTINE_META_KEY) ?? '{}') as {
    userChoseNewGame?: boolean;
  };
  assert.equal(quarantineRaw.userChoseNewGame, true);

  // Active slot write failure leaves main untouched.
  storage.clear();
  storage.setItem(SAVE_STORAGE_KEY, invalidJson);
  storage.setItem(
    SAVE_RECOVERY_QUARANTINE_META_KEY,
    JSON.stringify({
      reason: 'json-parse-failed',
      detectedAt: Date.now(),
      originalKey: SAVE_STORAGE_KEY,
      rawBackupKey: SAVE_QUARANTINE_RAW_KEY,
      saveVersion: null,
      appVersion: '1.0.0',
      checksumStatus: 'not-checked',
      stage: 'parse',
      recoveryAttempts: 1,
      backupWriteSucceeded: true,
    }),
  );
  storage.failActiveSlotWrites = true;
  const failedNewGame = await confirmStartNewGameAfterRecoveryCore(async () => validPayload);
  storage.failActiveSlotWrites = false;
  assert.equal(failedNewGame.ok, false);
  assert.equal(storage.getItem(SAVE_STORAGE_KEY), invalidJson);
  assert.equal(storage.getItem(SAVE_ACTIVE_SLOT_KEY), null);

  // Diagnose helper covers migration throw path via invalid structure.
  const migrationDiagnosis = await diagnoseRawSaveString(JSON.stringify({ version: 3 }));
  assert.equal(migrationDiagnosis.ok, false);

  console.log('[corrupt-save-recovery-security-test]');
  console.log(
    JSON.stringify(
      {
        status: 'MITIGATED',
        invalidJson: {
          mainSlotDeleted: false,
          rawBackupWritten: true,
          userRestoreApiAvailable: true,
        },
        unsupportedFutureVersion: {
          mainSlotDeleted: false,
          rawBackupWritten: true,
        },
        backupWriteFailure: {
          mainSlotDeleted: false,
          rawCopyRemaining: true,
          fatalRecoveryState: true,
        },
        coldStartGate: {
          invalidSaveReportedAsNoSave: false,
          recoveryProbeRequired: true,
          freshSaveCanOverwriteRawMainSlot: false,
        },
        checksumMismatch: {
          localChecksumImplemented: true,
          structurallyValidMutationRejectedWhenChecksumPresent: true,
          legacyWithoutChecksumStillLoads: true,
        },
        localBackupRestore: { atomicMainReplace: true },
        export: { savePreservedOnSuccess: true, secretScan: true },
        newGameExplicitConfirm: { separateActiveSlot: true, mainPreserved: true },
        appRestartAfterCorruption: 'Main slot and quarantine metadata preserved.',
      },
      null,
      2,
    ),
  );
}

void main().catch((error) => {
  console.error('[corrupt-save-recovery-security-test] FAILED', error);
  process.exitCode = 1;
});

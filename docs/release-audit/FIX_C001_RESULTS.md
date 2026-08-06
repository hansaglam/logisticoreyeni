# FIX C-001 Results — Corrupt Save Recovery

**Date:** 2026-08-06  
**Blocker:** C-001 — Local corrupt save auto-deleted; backup failure still cleared main slot; cold start could overwrite raw save  
**Status:** MITIGATED (client-ready; new build required)

---

## 1. Old Data Loss Path

| Trigger | Old behavior | Data loss |
|---------|--------------|-----------|
| JSON parse failure | `backupCorruptedSave` → **`clearMainSaveSlot()`** | Main slot deleted |
| Unsupported / migration failure | `backupInvalidSave` → **`clearMainSaveSlot()`** | Main slot deleted |
| Backup write failure | Backup throws; **clear still ran** | Only copy lost |
| Cold start (`hasValidSavedGame() === false`) | `initializeGame` → fresh state → **`saveGame()`** | Raw main overwritten |
| No recovery UI | User could not restore, export, or explicitly choose new game | Silent loss |

PoC invariants (pre-fix): invalid JSON / v999 → main slot `null`; backup failure → main slot `null`; cold start autosave overwrites corrupt raw.

---

## 2. Quarantine System

**New modules:**

- `src/storage/saveRecoveryQuarantine.ts` — metadata + raw backup keys
- `src/storage/saveRecoveryJournal.ts` — restore journal (idempotent receipts)
- `src/storage/saveRecoveryCore.ts` — headless-safe probe/restore/export logic
- `src/services/saveRecoveryService.ts` — cloud restore + Share export wrapper

**Keys:**

| Key | Purpose |
|-----|---------|
| `logisticore_save_v1` | Main slot — **never deleted on corruption** |
| `logisticore_save_quarantine_raw_v1` | Raw quarantine backup |
| `logisticore_save_active_v1` | New game after explicit user confirm |
| `logisticore_save_restore_staging_v1` | Atomic restore staging |
| `@logisticore/save-recovery/quarantine-v1` | Quarantine metadata |
| `@logisticore/save-recovery/fatal-v1` | Backup-write-failure fatal flag |
| `@logisticore/save-recovery/journal-*` | Pending restore + receipts |

**Quarantine metadata:** `reason`, `detectedAt`, `originalKey`, `rawBackupKey`, `saveVersion`, `appVersion`, `checksumStatus`, `stage`, `recoveryAttempts`, `backupWriteSucceeded`, `userChoseNewGame`.

**Backup failure:** Main slot preserved; fatal flag set; no cleanup; autosave/cloud sync blocked.

---

## 3. Recovery UI

**Screen:** `src/screens/SaveRecoveryScreen.tsx`  
**Cold start gate:** `App.tsx` → `probeSaveRecoveryOnColdStart()` before `initializeGame()`.

**Title:** Kayıt Kurtarma Gerekli

| Action | Behavior |
|--------|----------|
| Bulut Kaydını Geri Yükle | Cloud load + ownerUid + checksum + journal + atomic main replace |
| Yerel Yedeği Dene | Quarantine/main raw → parse → migrate → checksum → schema → ownerUid → journal → atomic replace |
| Kayıt Dosyasını Dışa Aktar | Share sheet; secret key scan; **save never deleted on failure** |
| Yeni Oyuna Başla | Double confirm; main corrupt preserved; new save on **`logisticore_save_active_v1`** |

---

## 4. Restore Validation Pipeline

Order (local + cloud):

1. Candidate read  
2. JSON parse  
3. Migration (`SAVE_GAME_VERSION` cap)  
4. `meta.integrityChecksum` verify (if present)  
5. Schema validation (`validateMigratedPayload`)  
6. `ownerUid` vs auth UID  
7. Journal `begin`  
8. Staging write → main replace → active slot clear  
9. Quarantine close + journal `complete`  

Failed restore **does not modify main slot**.

Cloud path reuses `executeAtomicCloudSaveRestore` + Firestore checksum from `cloudSaveService`.

---

## 5. Export Behavior

- Reads main slot or quarantine raw  
- Rejects payloads containing `token`, `secret`, `password`, `credential`, `access_token`, etc.  
- `ownerUid` in export is user gameplay data (not a secret)  
- Share failure returns error; **no slot deletion**

---

## 6. Local Save Schema Change

**`SaveGameMeta.integrityChecksum`** (optional SHA-256 of canonical payload, excluding checksum field).

- Stamped on every `saveGameState`  
- Legacy saves without checksum: load unchanged  
- Tampered saves with checksum: quarantine (`checksum-mismatch`) without main delete  

---

## 7. Migration Behavior

- Parse/migration/checksum failure → quarantine only (no `clearMainSaveSlot`)  
- Successful migration still auto-persists upgraded saves as before  
- `hasSavedGame()` returns true if main slot has **any** raw bytes (corrupt included)  
- `hasValidSavedGame()` false for corrupt → triggers recovery probe, not silent new game  
- `initializeGame` aborts load-failure → new-game path when main slot invalid  
- Cloud sync blocked via `isCloudSyncBlockedBySaveRecovery()` until recovery resolved or explicit new game on active slot  

---

## 8. Test Results

```text
npx tsx scripts/corrupt-save-recovery-security-test.ts → status: MITIGATED
npm run typecheck → pass
npm run verify → pass
npx expo export --platform android → pass
npx expo export --platform ios → pass
git diff --check → pass (line-ending warnings only)
```

**Scenarios covered:**

- invalid JSON  
- unsupported future version  
- checksum mismatch  
- migration failure  
- backup write failure  
- cold start recovery probe (no silent overwrite)  
- valid local backup restore (atomic)  
- export secret scan + save preserved  
- new game explicit confirm (active slot)  
- app restart during recovery (quarantine + main preserved)  
- recovery journal idempotency (via receipt dedup)  
- old slot never silently deleted  

---

## 9. Final Build Requirement

**New Android AAB and iOS build required** — C-001 is client-only (save load, recovery UI, local integrity, boot gate). No Firebase Functions or rules deploy needed for this fix alone.

**Not produced in this task:** AAB, APK, IPA, Xcode Archive (per release audit scope).

---

## Acceptance Criteria

| Criterion | Status |
|-----------|--------|
| Corrupt save not auto-deleted | ✅ Main slot preserved |
| Backup failure does not cause data loss | ✅ Fatal state; no cleanup |
| New game only on explicit user choice | ✅ Double confirm + active slot |
| Restore validated and atomic | ✅ Journal + staging |
| Recovery survives app restart | ✅ Quarantine metadata persisted |

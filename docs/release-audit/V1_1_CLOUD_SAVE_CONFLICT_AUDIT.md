# V1.1 — Cloud Save Conflict Failure Audit

**Date:** 2026-08-28  
**Scope:** Read-only audit of `backend:verify` failure in `scripts/cloud-save-conflict-test.ts`  
**Final status:** `TEST_STALE`

---

## Executive summary

`backend:verify` fails on the **first** assertion in `cloud-save-conflict-test.ts` (line 40–46). The test expects `validateCloudSaveRestorePayload({ ...validPayload, gameState: null }, 3)` to return `'cloud-save-corrupted'`. Runtime returns `'body-missing'`.

This is **not** a production regression. Commit `20085e9` (2026-08-13, *feat: simplify account cloud restore and harden save/perf flows*) intentionally split the former monolithic `'cloud-save-corrupted'` bucket into granular reasons (`body-missing`, `deserialize-failed`, `checksum-invalid`, etc.). `cloudSaveService.parseCloudSaveDocument` and `accountCloudLogin.mapCloudLoadFailure` were updated at the same time. **`cloud-save-conflict-test.ts` was not updated** and still encodes pre-`20085e9` expectations.

`'cloud-save-corrupted'` is **never returned** by any current runtime path — it remains only as a union member and message-mapping alias (mapped to `cloud-save-invalid` in `mapCloudLoadFailure`).

---

## 1. Failure trace

### Reproduction

```bash
npx tsx scripts/cloud-save-conflict-test.ts
```

```
AssertionError: Expected values to be strictly equal:
+ actual - expected

+ 'body-missing'
- 'cloud-save-corrupted'

    at main (scripts/cloud-save-conflict-test.ts:40:8)
```

Test exits before later assertions (atomic restore, duplicate guard, etc.). Those paths were not exercised in this run.

### Failing assertion

```40:46:scripts/cloud-save-conflict-test.ts
assert.equal(
  validateCloudSaveRestorePayload(
    { ...validPayload, gameState: null },
    3,
  ),
  'cloud-save-corrupted',
);
```

### Fixture

```ts
const validPayload = {
  schemaVersion: 1,
  saveVersion: 3,
  gameState: {
    player: { money: 62_000, trucks: [], drivers: [], trailers: [], warehouses: [] },
  },
};
// Mutated: gameState: null
```

The fixture is **valid as a corruption scenario** (metadata shell with null body). It is not malformed test data.

### Code path

```
cloud-save-conflict-test.ts
  → validateCloudSaveRestorePayload(payload, 3)
      → cloudSaveConflict.ts:109–145
```

Step-by-step for `{ schemaVersion: 1, saveVersion: 3, gameState: null }`:

| Step | Condition | Result |
|------|-----------|--------|
| 1 | `payload` is object | pass |
| 2 | `schemaVersion === 1` | pass |
| 3 | `saveVersion = 3` (finite, ≤ 3) | pass |
| 4 | `gameState = null` → `gameState && typeof gameState === 'object' && !Array.isArray(...)` | **falsy** → `gameStateRecord = null` |
| 5 | `if (!gameStateRecord)` | **return `'body-missing'`** ← first divergence |

### Expected branch (test)

Pre-`20085e9` implementation (`304536e`):

```ts
if (!gameState || typeof gameState !== 'object' || Array.isArray(gameState)) {
  return 'cloud-save-corrupted';
}
```

### Actual branch (production)

```118:130:src/utils/cloudSaveConflict.ts
  const gameState = record.gameState;
  const gameStateRecord =
    gameState && typeof gameState === 'object' && !Array.isArray(gameState)
      ? (gameState as Record<string, unknown>)
      : null;
  // ...
  if (!gameStateRecord) return 'body-missing';
```

### Production load path (consistent)

If the same document were loaded via Firestore:

```
loadGameFromCloudDetailed(uid)
  → getDoc(users/{uid}/saves/current)
  → parseCloudSaveDocument(data, uid)
      → if (!gameState || typeof gameState !== 'object')
           return { ok: false, reason: 'body-missing' }   // cloudSaveService.ts:273–274
```

Both validation layers agree: **absent `gameState` body → `body-missing`**, not `cloud-save-corrupted`.

---

## 2. Error precedence audit

### `validateCloudSaveRestorePayload` order

1. Non-object / null top-level payload → `deserialize-failed`
2. `schemaVersion` present and ≠ 1 → `unsupported-save-version`
3. Unparseable / negative `saveVersion` → `deserialize-failed`
4. `saveVersion > supportedSaveVersion` → `unsupported-save-version`
5. **Missing / null / non-object `gameState`** → **`body-missing`**
6. Missing / non-object `player` → `deserialize-failed`
7. Non-finite `money`/`cash` → `deserialize-failed`
8. Non-array fleet collections → `deserialize-failed`
9. Valid → `null`

### `parseCloudSaveDocument` order (Firestore load)

1. Missing / non-object `gameState` → `body-missing`
2. Build / default `summary`
3. `ownerUid` mismatch → `owner-mismatch`
4. Checksum (`verifyRawSaveChecksum` + `payloadChecksum`) → `checksum-invalid`
5. Success

### Precedence question: `body-missing` vs `cloud-save-corrupted`?

For `{ gameState: null }` with valid-looking metadata (`schemaVersion`, `saveVersion`):

| Interpretation | Verdict |
|----------------|---------|
| Body is literally absent (`null`) | **`body-missing` is correct** — document exists but playable payload is missing |
| Metadata implies corruption | Not sufficient to override — checksum step never runs without a body; treating as corruption would mis-route UX (see §3) |

**Conclusion:** `body-missing` is technically and semantically correct. The test expectation reflects **superseded** classification from before the granular split. This is not a validation-ordering bug.

### Other reclassifications in `20085e9` (same commit, same intent)

| Condition (old) | Old reason | Current reason |
|-----------------|------------|----------------|
| `!payload` | `cloud-save-corrupted` | `deserialize-failed` |
| Invalid `saveVersion` | `cloud-save-corrupted` | `deserialize-failed` |
| `gameState` null/missing | `cloud-save-corrupted` | **`body-missing`** |
| Invalid `player` / `money` | `cloud-save-corrupted` | `deserialize-failed` |

---

## 3. Product semantics

### Error reference

| Reason | When returned | User-facing message (TR) | Caller branching | Recovery behavior |
|--------|---------------|--------------------------|------------------|-------------------|
| **`body-missing`** | Firestore doc exists but `gameState` absent/null/non-object; or restore validator finds no object body | *"Bu hesapta kullanılabilir bir bulut kaydı bulunamadı."* (grouped with `metadata-missing`, `cloud-save-not-found`) | `isCorruptCloudReason` → **false** → `cloud_load_failed`, `corrupt: false` | Retry dialog; may conflict with local if local meaningful; **not** permanent corrupt path |
| **`cloud-save-corrupted`** | **Never emitted at runtime** (legacy union member) | *"Bulut kaydı doğrulanamadı."* (via `cloud-save-invalid` mapping) | `isCorruptCloudReason` → true if ever received | Would be `cloud_corrupt`, `corrupt: true` |
| **`cloud-save-invalid`** | Mapped from legacy `cloud-save-corrupted` in `mapCloudLoadFailure` only | Same corrupt message group | Permanent corrupt group | Corrupt recovery UI |
| **`deserialize-failed`** | Top-level non-object, bad player shape, bad money, bad arrays | Corrupt message group | `isCorruptCloudReason` → **true** | `cloud_corrupt` |
| **`checksum-invalid`** | Body checksum mismatch after raw-first verify | *"Bulut kaydı bütünlük doğrulamasından geçemedi."* | `isCorruptCloudReason` → **true** | `cloud_corrupt`, no retry |
| **`metadata-missing`** | Snapshot `data()` not an object | No usable save message group | Not corrupt | `cloud_load_failed` |
| **`cloud-save-not-found`** | No `users/{uid}/saves/current` doc | No usable save / conflict if local meaningful | Special: may open conflict with `cloudSaveMissing` | Bind local or starter |
| **`unsupported-save-version`** | `saveVersion` or `schemaVersion` too new | Unsupported version message | `isCorruptCloudReason` → **true** | Permanent |
| **`owner-mismatch`** | `ownerUid` ≠ authenticated uid | Owner mismatch message | `isCorruptCloudReason` → **true** | Permanent |
| **`save-conflict`** | Local + cloud both meaningful and different | Conflict picker | Conflict modal | User chooses cloud/local/fresh |
| **`auth-user-mismatch`** | UID drift during restore | Auth mismatch message | Permanent | No restore |

### Callers that branch differently

```433:450:src/services/accountCloudLogin.ts
    if (isCorruptCloudReason(cloud.reason)) {
      return { type: 'cloud_corrupt', ... };
    }
    return { type: 'cloud_load_failed', ..., retryable: isRetryableCloudSaveConflictReason(...) };
```

`body-missing` **excluded** from `isCorruptCloudReason` → different UI path in `useAccountCenter.ts` (`corrupt: false` vs `corrupt: true`).

Reverting to `cloud-save-corrupted` for null `gameState` would **misclassify** “empty shell document” as permanent corruption and change recovery UX without security benefit.

---

## 4. Security / recovery safety

| Invariant | Status |
|-----------|--------|
| Save integrity (checksum) | Unchanged — still enforced in `parseCloudSaveDocument` before success |
| Corruption detection | **Stronger** — structural issues → `deserialize-failed` / `checksum-invalid`, not lumped |
| Atomic restore (`executeAtomicCloudSaveRestore`) | Unchanged — validate metadata + payload before migrate/persist/commit |
| Backup/recovery | Unchanged — `saveRecoveryService` uses same `validateCloudSaveRestorePayload` |
| Conflict resolution | Unchanged — `save-conflict` orthogonal to body validation |

**Safest classification for null body:** `body-missing` — blocks restore, does not commit guest state, does not falsely mark checksum-corrupt, allows retry / local-bind conflict path when appropriate.

No evidence that current behavior weakens integrity. The failure is a **stale test assertion**, not unsafe production code.

---

## 5. Test matrix

Canonical expected errors for current implementation:

| # | Scenario | Layer | Expected error | Notes |
|---|----------|-------|----------------|-------|
| 1 | Truly missing body (`gameState` absent / `null` / `undefined`) | `parseCloudSaveDocument` / `validateCloudSaveRestorePayload` | **`body-missing`** | Test expects wrong code |
| 2 | Corrupted body (`gameState` string / number / array) | Both | **`body-missing`** (non-object or array filtered out) | Array hits `!Array.isArray` guard → null record |
| 3 | Invalid checksum | `parseCloudSaveDocument` only | **`checksum-invalid`** | Not checked in `validateCloudSaveRestorePayload` alone |
| 4 | Malformed metadata (snapshot `data()` null) | `loadGameFromCloudDetailed` | **`metadata-missing`** | Before body parse |
| 5 | Valid payload, stale revision (older `deviceUpdatedAt`) | Comparison / conflict UX | **`null` validate** → conflict if local newer | Not a validation error |
| 6 | Valid payload, local/cloud differ | `areLocalAndCloudSavesDifferent` | **`save-conflict`** (outcome type) | After successful load |
| 7 | Empty document (no snapshot) | `loadGameFromCloudDetailed` | **`cloud-save-not-found`** | |
| 8 | Legacy save shape (no `ownerUid`, valid body) | `parseCloudSaveDocument` | **`null`** (success) | `ownerUid` falls back to path uid |
| 9 | Truncated save (missing `player` or bad `money`) | `validateCloudSaveRestorePayload` | **`deserialize-failed`** | Was `cloud-save-corrupted` pre-20085e9 |

### Gap in `cloud-save-conflict-test.ts`

Only case #1 is asserted — with the **obsolete** expected code. Cases #2–#9 are not covered in this script (partially covered elsewhere: `cloud-save-production-audit-test.ts`, `account-cloud-conflict-regression-test.ts`, emulator tests).

---

## 6. Classification verdict

| Option | Verdict | Rationale |
|--------|---------|-----------|
| **A) TEST_STALE** | **YES — primary** | Test encodes pre-`20085e9` `cloud-save-corrupted` for null `gameState`; implementation and sibling services intentionally changed |
| B) IMPLEMENTATION_BUG | No | Current behavior is consistent across `cloudSaveConflict.ts` and `cloudSaveService.ts`; callers updated |
| C) ERROR_CLASSIFICATION_DRIFT | Partial (historical) | Drift occurred in `20085e9` by design; production aligned; **only test left behind** |
| D) FIXTURE_BUG | No | `{ gameState: null }` correctly models missing body |
| E) VALIDATION_ORDERING_BUG | No | `body-missing` correctly precedes player/checksum checks |

---

## 7. Recommended fix (report only — not applied)

When code changes are allowed:

1. Update `cloud-save-conflict-test.ts` line 45: expect `'body-missing'` for `{ gameState: null }`.
2. Optionally add matrix rows for `deserialize-failed` (bad player) and document that `cloud-save-corrupted` is legacy/non-emitted.
3. Consider a comment in `CloudSaveConflictReason` that `cloud-save-corrupted` is retained for mapping only.

**Do not** re-collapse errors into `cloud-save-corrupted` without revisiting `isCorruptCloudReason` and account-center recovery UX.

---

## 8. Validation snapshot

| Command | Result |
|---------|--------|
| `npx tsx scripts/cloud-save-conflict-test.ts` | **FAIL** (assertion line 40) |
| `npx tsx scripts/cloud-save-production-audit-test.ts` | Not blocked by this assertion (no null-body case) |
| `npx tsx scripts/account-cloud-conflict-regression-test.ts` | Passes (no null-body assertion) |
| `npm run firebase:emulators:test` | Passes (backend tests unrelated) |

---

## Final status

**`TEST_STALE`**

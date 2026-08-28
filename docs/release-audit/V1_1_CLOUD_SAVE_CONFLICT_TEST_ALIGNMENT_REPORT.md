# V1.1 — Cloud Save Conflict Test Alignment Report

**Date:** 2026-08-28  
**Final status:** `CLOUD_SAVE_CONFLICT_TEST_ALIGNED`

---

## Summary

Aligned `scripts/cloud-save-conflict-test.ts` with the canonical granular error model introduced in commit `20085e9`. The stale `cloud-save-corrupted` expectation for `{ gameState: null }` is now `body-missing`. Production validation logic is unchanged.

---

## Stale assertion changed

| Before | After |
|--------|-------|
| `validateCloudSaveRestorePayload({ ...validPayload, gameState: null }, 3)` → `'cloud-save-corrupted'` | → `'body-missing'` |

---

## New granular cases

Added focused assertions in `scripts/cloud-save-conflict-test.ts`:

| Case | Input | Expected |
|------|-------|----------|
| A | `gameState: null` | `body-missing` |
| B | `gameState` omitted | `body-missing` |
| C | `gameState: 'truncated'` (non-object) | `body-missing` |
| C | `gameState: []` (array) | `body-missing` |
| D | `gameState` object without `player` | `deserialize-failed` |
| E | `player.money: NaN` | `deserialize-failed` |
| F | `schemaVersion: 99` | `unsupported-save-version` |
| F | `saveVersion: 99` | `unsupported-save-version` |

Checksum validation was not duplicated — it remains owned by `parseCloudSaveDocument` in `cloudSaveService.ts`.

Existing atomic-restore, duplicate-guard, guest-preservation, and auth-mismatch tests were left intact.

---

## Runtime code changed?

**No validation behavior changed.**

One documentation-only addition in `src/utils/cloudSaveConflict.ts`:

```ts
/** Legacy alias — not emitted by validateCloudSaveRestorePayload or parseCloudSaveDocument; retained for mapCloudLoadFailure / message compatibility. */
| 'cloud-save-corrupted'
```

Unchanged by this pass:

- `validateCloudSaveRestorePayload` logic
- `isCorruptCloudReason`
- `accountCloudLogin` mapping
- Account center recovery UX
- Retryability rules
- Atomic restore / backup / recovery paths

---

## Validation results

| Command | Result |
|---------|--------|
| `npx tsx scripts/cloud-save-conflict-test.ts` | **PASS** |
| `npx tsc --noEmit` | **PASS** |
| `git diff --check` | **PASS** |
| `npm run backend:verify` | **PARTIAL** — `cloud-save-conflict-test.ts` PASS; fails later on unrelated `cloud-save-production-audit-test.ts` |
| `npm run verify` | **PARTIAL** — fails on unrelated `apple-auth-audit-test.ts` (4 UI wiring assertions) |

### `backend:verify` detail

1. `backend:typecheck` — PASS  
2. `backend:build` — PASS  
3. `backend-function-consistency-test` — PASS  
4. `check-require-cycles` — PASS  
5. `firebase:emulators:test` — PASS (64/64)  
6. **`cloud-save-conflict-test.ts` — PASS** (previously blocked `backend:verify`)  
7. `cloud-save-production-audit-test.ts` — **FAIL** — `assert.match(account, /Bulut Kaydı/)` not found in `useAccountCenter.ts` (UI copy drift, unrelated)

### Remaining unrelated failures

| Script | Failure |
|--------|---------|
| `cloud-save-production-audit-test.ts` | Account center source no longer contains literal `Bulut Kaydı` |
| `apple-auth-audit-test.ts` | 4 failures: AuthProviderButton / iOS Apple button wiring |

---

## Final status

**`CLOUD_SAVE_CONFLICT_TEST_ALIGNED`**

The original `backend:verify` blocker (`body-missing` vs `cloud-save-corrupted`) is resolved. Remaining suite failures are outside this alignment scope.

# V1.1 — Cloud Save Production Audit Failure Audit

**Date:** 2026-08-28  
**Scope:** Read-only audit of `cloud-save-production-audit-test.ts` failure on `/Bulut Kaydı/` in `useAccountCenter.ts`  
**Final status:** `TEST_STALE`

---

## Executive summary

`backend:verify` fails because `cloud-save-production-audit-test.ts` line 147 requires the literal string `Bulut Kaydı` (title-case **K**) inside `src/hooks/useAccountCenter.ts`. That exact literal was **intentionally replaced** with `Buluttan Yükle` on the primary conflict-dialog CTA in commit `adb7c9e` (2026-08-21). Cloud-save conflict UI, restore flow, and `accountCloudLogin` mapping remain intact. Sibling regression `account-cloud-conflict-regression-test.ts` already asserts the new label.

This is **stale copy-based test drift**, not a missing cloud-save feature.

---

## 1. Failure reproduction

```bash
npx tsx scripts/cloud-save-production-audit-test.ts
```

```
AssertionError: The input did not match the regular expression /Bulut Kaydı/
    at scripts/cloud-save-production-audit-test.ts:147:8
```

**Failing assertion:**

```146:149:scripts/cloud-save-production-audit-test.ts
assert.match(account, /Bu Cihazdaki Kayıt/);
assert.match(account, /Bulut Kaydı/);
assert.match(account, /Detayları Karşılaştır/);
assert.match(account, /Vazgeç/);
```

Earlier assertions in the same script (atomic restore, owner isolation, checksum canonicalization, `cloudSaveService` paths) **pass**. Only the `/Bulut Kaydı/` source scan fails.

---

## 2. What behavior was the test protecting?

The four `assert.match(account, …)` lines (added in `6890a76`, 2026-08-04) guard the **account save conflict dialog** — the three-way resolution UX when local and cloud saves differ after Google/Apple sign-in:

| Intended invariant | Test proxy (literal) |
|--------------------|----------------------|
| User can restore from cloud | `/Bulut Kaydı/` |
| User can keep device save | `/Bu Cihazdaki Kayıt/` |
| User can compare summaries | `/Detayları Karşılaştır/` |
| User can cancel without auto-upload | `/Vazgeç/` |

The **behavioral** invariant is: `showAccountConflictDialog` exposes cloud / local / compare / cancel actions wired to `handleResolveAccountSaveConflict('cloud' | 'local' | 'fresh')` and session guards.

Literal Turkish button text was used as a cheap structural proxy — not as a product copy contract.

---

## 3. Is literal `Bulut Kaydı` part of the actual invariant?

**No.** The invariant is the **cloud-restore CTA**, not a specific string.

Current primary CTA in `useAccountCenter.ts`:

```576:582:src/hooks/useAccountCenter.ts
        {
          label: 'Buluttan Yükle',
          variant: 'primary',
          disabled: cloudDisabled,
          onPress: () => {
            void handleResolveAccountSaveConflict('cloud', provider, authenticatedUid);
          },
```

### Git history

| Commit | Change |
|--------|--------|
| `6890a76` | Added `cloud-save-production-audit-test.ts` with `/Bulut Kaydı/` |
| `adb7c9e` | Renamed conflict CTA `'Bulut Kaydı'` → `'Buluttan Yükle'`; updated restore success copy and loading states |
| `20085e9` | `account-cloud-conflict-regression-test.ts` updated to `assert(hook.includes('Buluttan Yükle'))` |

**`cloud-save-production-audit-test.ts` was never updated** after the label change.

### Lowercase variants still in `useAccountCenter.ts`

The hook still contains many **lowercase** `bulut kaydı` strings (comments, loading/success messages, error titles), e.g.:

- `'Bulut kaydı doğrulanamadı'` / `'Bulut kaydı yüklenemedi'`
- `'Bulut kaydı yüklendi'`
- `'Bulut kaydı doğrulanıyor...'`

These do **not** match `/Bulut Kaydı/` (regex requires capital **K** in `Kaydı`). The test was scoped to the **exact old button label**, not general cloud-save wording.

---

## 4. Does cloud-save status/error UI still exist?

**Yes.** Full conflict and recovery surface remains in `useAccountCenter.ts`:

| Feature | Status | Location |
|---------|--------|----------|
| Conflict dialog (cloud / local / compare / cancel) | Present | `showAccountConflictDialog` (~460–603) |
| Empty-cloud conflict (fresh / local / cancel) | Present | `cloudSaveMissing` branch |
| Cloud load failure / corrupt recovery | Present | `showCloudRecoveryDialog` (~385–457) |
| Post-sign-in outcome routing | Present | `applyProviderSaveOutcome` → `accountCloudLogin` outcomes |
| Restore loading + success modal | Present | `handleResolveAccountSaveConflict`, `presentRestoreSuccess` |
| Cloud status subscription | Present | `subscribeCloudSaveStatus`, `refreshCloudStatus` |
| Account conflict session / double-tap guard | Present | `accountSaveConflictSession` integration |

`accountCloudLogin.ts` mapping unchanged in spirit:

- `conflict` → `showAccountConflictDialog`
- `cloud_load_failed` → `showCloudRecoveryDialog` (`corrupt: false`)
- `cloud_corrupt` → `showCloudRecoveryDialog` (`corrupt: true`)
- `completed` (cloud restore) → success alert / navigation

### Related UI (not in hook source scan)

| Component / util | Role |
|------------------|------|
| `accountCenterCloudStatus.ts` | Status badge; conflict CTA `'Bulut Kaydını Görüntüle'` (different string, status card context) |
| `accountLinkErrors.ts` | Conflict title/message helpers (`İki farklı kayıt bulundu.`, etc.) |
| `AccountConnectionTab.tsx` | “Bulut kaydı doğrulanıyor” during account switch |
| `CloudSaveSection.tsx` | **Deprecated** — player-facing technical panel removed; cloud runs via `AccountSection` |
| `SaveRecoveryScreen.tsx` | Separate recovery path with `'Bulut Kaydını Geri Yükle'` |

---

## 5. Did text move to another component/string file?

**Partially — intentional in-place rename, not relocation.**

- **Conflict primary button:** stayed in `useAccountCenter.ts`; label changed to `'Buluttan Yükle'`.
- **Conflict title/message:** moved to `accountLinkErrors.ts` helpers (`getAccountLinkConflictTitle`, `getAccountLinkConflictMessage`) — test does not assert these.
- **Status-card CTA:** `'Bulut Kaydını Görüntüle'` in `accountCenterCloudStatus.ts` — different UI surface than conflict dialog.
- **No i18n/constants file** owns the conflict button label; it remains an inline string in the hook.

The production audit test still scans **only** `useAccountCenter.ts` for all four literals. Three of four still match; only the cloud-restore button literal is stale.

---

## 6. Is this only source-text drift?

**Yes.**

| Check | Result |
|-------|--------|
| `handleResolveAccountSaveConflict('cloud', …)` wired | ✓ |
| `resolveSaveConflict` / `executeAtomicCloudSaveRestore` path | ✓ |
| `Bu Cihazdaki Kayıt` still in hook | ✓ (test would pass) |
| `Detayları Karşılaştır` still in hook | ✓ |
| `Vazgeç` still in hook | ✓ |
| Updated regression covers new label | ✓ `account-cloud-conflict-regression-test.ts` line 118 |
| Missing user-facing cloud state | ✗ Not observed |

---

## 7. Classification matrix

| Option | Verdict | Rationale |
|--------|---------|-----------|
| **A) Stale copy-based test** | **YES** | Test encodes obsolete button literal; behavior covered elsewhere |
| B) Real cloud-save UI regression | **No** | All conflict actions and restore pipeline present |
| C) Localization/refactor drift | Partial | Copy refactor in `adb7c9e`; symptom is stale test, not missing i18n layer |
| D) Missing user-facing cloud save state | **No** | Status, conflict, error, and recovery UI all exist |

Sub-classification note: `LOCALIZATION_DRIFT` describes the underlying copy change, but the **actionable failure class** for this audit script is **`TEST_STALE`** — the implementation is correct; the source-text guard was not updated.

---

## 8. Recommended fix (report only — not applied)

When code changes are allowed:

1. Replace `assert.match(account, /Bulut Kaydı/)` with `assert.match(account, /Buluttan Yükle/)` in `cloud-save-production-audit-test.ts`.
2. Optionally assert conflict helpers in `accountLinkErrors.ts` or reuse the pattern from `account-cloud-conflict-regression-test.ts` instead of duplicating brittle copy scans.
3. Do **not** revert UI copy to `Bulut Kaydı` — `Buluttan Yükle` is clearer action wording and already shipped in conflict regression coverage.

---

## 9. Validation snapshot

| Script | Result |
|--------|--------|
| `cloud-save-production-audit-test.ts` | **FAIL** at line 147 only |
| `account-cloud-conflict-regression-test.ts` | Passes (`Buluttan Yükle` asserted) |
| `account-center-ui-regression-test.ts` | Uses `resolveCloudSaveDisplayInfo` behavior checks, not this literal |
| `cloud-save-conflict-test.ts` | Passes (after prior alignment) |

---

## Final status

**`TEST_STALE`**

The cloud-save conflict dialog and restore behavior are present and correctly wired. The production audit failure is caused by an outdated literal string expectation (`Bulut Kaydı`) after an intentional CTA rename to `Buluttan Yükle`.

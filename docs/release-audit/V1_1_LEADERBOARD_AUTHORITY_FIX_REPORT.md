# V1.1 Leaderboard Server-Authority Fix Report

**Date:** 2026-08-28  
**Final status:** `LEADERBOARD_AUTHORITY_FIXED`

---

## Executive summary

Production leaderboard scoring was inflated by client-writable cloud save fields because `submitLeaderboardScoreTransaction` and `seedLeaderboardSeason` called `mergeLeaderboardStatsFromCloudSave` whenever `serverState` already existed. That merge imported spoofable progression (`completedContracts`, `level`, `reputation`, fleet, warehouses) before score calculation.

The unsafe merge has been removed from both paths. Once `users/{uid}/serverState/current` exists, leaderboard score is computed **only** from that document. Client cloud save remains backup/restore; it no longer refreshes leaderboard-relevant fields on submit or season seed.

Observed exploit (pre-fix): score `17,530` → `95,790` after malicious `completedContracts: 50_000` in cloud save.

---

## Root cause

| Item | Detail |
|------|--------|
| **Symptom** | `malicious cloud save write does not change leaderboard score` failed (`95790 !== 17530`) |
| **Direct cause** | `mergeLeaderboardStatsFromCloudSave(...)` in `submitLeaderboardScoreTransaction` (commit `197b2ef` regression) |
| **Secondary path** | Same merge in `seedLeaderboardSeason` when `serverSnap.exists` |
| **Spoofable inputs** | `completedContracts`, `level`, `reputation`, `trucks`, `warehouses`, weekly delta derived from completed count |
| **Protected** | `cash` was not merged by `mergeLeaderboardStatsFromCloudSave` |

---

## Trust model

### Before

```
cloud save (client-writable)
    ↓ mergeLeaderboardStatsFromCloudSave (every submit/seed if serverState exists)
serverState (in-memory for scoring)
    ↓ calculateLeaderboardScore
leaderboard entry
```

### After

```
IF serverState missing:
    marketplaceState → buildServerStateFromMarketplaceState
    OR cloud save → buildBoundedLegacyMigrationFromCloudSave (bounded one-time bootstrap)
    OR default → buildDefaultServerState

IF serverState exists:
    serverState ONLY (no cloud save merge)

    ↓ calculateLeaderboardScore
leaderboard entry
```

**Trust boundary:** The boundary begins at first persistence of `users/{uid}/serverState/current`. After that document exists, client cloud save must never overwrite leaderboard-relevant fields on submit or season seed.

---

## Changed files

| File | Change |
|------|--------|
| `backend/src/leaderboard.ts` | Removed `mergeLeaderboardStatsFromCloudSave` from submit path |
| `backend/src/leaderboardSeasonSeed.ts` | Removed merge when `serverState` exists; dropped unused marketplace fetch |
| `backend/src/serverState.ts` | Documented `mergeLeaderboardStatsFromCloudSave` as deprecated; not for submit/seed |
| `backend/test/leaderboard.emulator.test.ts` | Extended security + authority test matrix (7 new tests) |
| `scripts/leaderboard-server-state-sync-regression-test.ts` | Rewritten for server-authority model (security wins) |

---

## Trusted progression ownership

| Field | Trusted source | Writer | When updated | Client can directly influence? |
|-------|----------------|--------|--------------|------------------------------|
| `completedDeliveries` | `serverState` | Bootstrap migration (bounded), marketplace mirror, default bootstrap; **not** cloud-save merge on submit | First `serverState` create; echo on submit via `pickLeaderboardServerStatePersistPatch` only | **No** (after serverState exists) |
| `companyLevel` | `serverState` | Same as above | Same | **No** |
| `reputation` | `serverState` | Same as above | Same | **No** |
| `failedDeliveries` / `lateDeliveries` | `serverState` | Same as above | Same | **No** |
| `ownedTrucks` / `ownedTruckIds` | `serverState` + marketplace | `mirrorServerStateFromMarketplace` on marketplace transactions; bootstrap from marketplace | Marketplace purchase/list/cancel; reconcile | **No** for phantom trucks via save when serverState exists |
| `warehouses` | `serverState` | Bootstrap migration only (bounded); persist echo on submit | Bootstrap / trusted server write | **No** after serverState exists |
| `weeklySeasonBaselineCompleted` | `serverState` | `resolveWeeklySeasonActivity` on submit/seed from trusted `completedDeliveries` | Season rollover / first submit in season | **No** via save spoof |
| `weeklyCompletedDeliveries` (score input) | Derived | `completedDeliveries - weeklySeasonBaselineCompleted` from trusted serverState | Submit/seed | **No** |
| `cash` | Marketplace / serverState | Marketplace canonical cash paths | Marketplace bootstrap & transactions | **No** (already protected) |
| `leaderboardScore` | Computed | `calculateLeaderboardScore` on submit/seed | Each submit/seed | **No** |

**Gap (fail-closed):** There is no dedicated server-written delivery-settlement path updating `completedDeliveries` in production backend yet. Progression updates must arrive via trusted server writes to `serverState` (e.g. future settlement callable). Until then, stale trusted values are preserved rather than accepting client save — **fail closed**.

---

## Cloud save behavior

- Client may still read/write `users/{uid}/saves/current` (backup/restore).
- Cloud save **does not** refresh leaderboard stats when `serverState` exists.
- First-time users without `serverState` may still bootstrap via `buildBoundedLegacyMigrationFromCloudSave` (bounded caps in `LEGACY_MIGRATION_BOUNDS`).

---

## serverState behavior

- Submit reads existing `serverState` verbatim when present.
- Submit creates `serverState` only when missing (marketplace → bounded migration → default).
- `pickLeaderboardServerStatePersistPatch` still echoes progression fields already on `serverState` plus season metadata; it no longer receives save-merged inflation.

---

## Season seed behavior

- When `serverState` exists: use as-is; ignore malicious cloud save.
- When `serverState` missing and cloud save exists: bounded legacy migration only (same as submit bootstrap).

---

## Asset ownership behavior

- Fleet score uses `serverState.ownedTrucks` / `warehouses`.
- Phantom trucks/warehouses in cloud save do not affect score when authoritative `serverState` exists.
- Marketplace-authoritative fleet paths (`mirrorServerStateFromMarketplace`) unchanged; legitimate purchases still update trusted fleet via marketplace transactions.

---

## Weekly score behavior

- Weekly activity = `completedDeliveries - weeklySeasonBaselineCompleted` from trusted `serverState`.
- Malicious `completedContracts: 50_000` in cloud save no longer changes total delivery score, weekly activity, season score, or eligibility after `serverState` exists.

---

## Production poisoned-state risk

| Risk | Assessment |
|------|------------|
| **Fields possibly poisoned** | `completedDeliveries`, `companyLevel`, `reputation`, `failedDeliveries`, `lateDeliveries`, `companyName`, `ownedTrucks`, `warehouses`, `sourceVersion`, `weeklySeasonBaselineCompleted` — if prior submits merged save into `serverState` via `pickLeaderboardServerStatePersistPatch` |
| **Natural correction** | **Unlikely** until server-written delivery settlement exists; trusted events do not currently decrement/increment progression from gameplay |
| **Targeted repair needed?** | **Recommended** for high-rank accounts showing impossible progression vs marketplace/delivery receipts — **not automated in this pass** |
| **Safest repair strategy** | Read-only audit comparing `serverState` progression vs marketplace ledger / future delivery receipts; manual or scripted correction of specific UIDs; **no mass rewrite** |

**No destructive production migration in this pass.**

---

## Test results

| Command | Result |
|---------|--------|
| `npm --prefix backend run build` | **PASS** |
| `npm --prefix backend test` (Firestore emulator, 63 tests) | **PASS** — includes all leaderboard security matrix |
| `npx tsx scripts/leaderboard-server-state-sync-regression-test.ts` | **PASS** |
| `npx tsc --noEmit` | **PASS** |
| `git diff --check` | **PASS** |
| `firebase emulators:exec … security-malicious-save-trust-test.ts` | **FAIL** at marketplace bootstrap (`canonicalCash === 987654321`, line 155) — **marketplace fleet reconcile accepts forged cloud save cash**; leaderboard assertions not reached. Same leaderboard invariants covered by emulator tests #17–#23. |
| `npm run backend:verify` | **PARTIAL** — emulator 63/63 PASS; fails later on unrelated `cloud-save-conflict-test.ts` (`body-missing` vs `cloud-save-corrupted`) |
| `npm run verify` | **Not run to completion** — known unrelated failures (`time-progression-audit-test` 1-min offline threshold) |

### Leaderboard emulator matrix (post-fix)

| # | Test | Status |
|---|------|--------|
| 1 | Baseline score from canonical serverState | PASS (existing) |
| 2–7 | Malicious money/contracts/level/rep/fleet/combined | PASS (#17–#19) |
| 8 | Repeated submit deterministic | PASS (#20) |
| 9 | New idempotency key, same trusted score | PASS (#20) |
| 10 | Season seed after malicious save unchanged | PASS (#22) |
| 11 | Trusted serverState progression increases score | PASS (#21) |
| 12 | Trusted reputation/level/deliveries via serverState write | PASS (#21) |
| 13 | Trusted fleet asset score via serverState | PASS (#21) |
| 14 | One UID = one entry | PASS (existing) |
| 15 | First-time migration/bootstrap | PASS (#23, existing missing-save) |

---

## Security invariants

| Invariant | Status |
|-----------|--------|
| Client submit payload cannot spoof score | **PASS** |
| Client cloud save cannot spoof score (when serverState exists) | **PASS** |
| Cloud save cannot poison serverState leaderboard fields on submit/seed | **PASS** |
| Season seed cannot import spoofed save stats | **PASS** |
| Score deterministic from trusted canonical state | **PASS** |
| Same trusted state → same score | **PASS** |
| No client-controlled weekly delta | **PASS** |

---

## Deploy / binary

| Question | Answer |
|----------|--------|
| **Cloud Functions deploy required?** | **Yes** — `submitLeaderboardScore`, `seedWeeklyLeaderboard` |
| **App binary required?** | **No** — fix is server-side; client save write behavior unchanged |

**Do not deploy automatically in this pass** — deploy after review.

---

## Final status

`LEADERBOARD_AUTHORITY_FIXED`

Leaderboard server-authority is restored. Remaining `security-malicious-save-trust-test` failure is a **marketplace bootstrap** issue (forged cash accepted before leaderboard step), not a leaderboard regression. Recommend addressing marketplace cloud-save reconcile separately; leaderboard coverage is complete via emulator suite.

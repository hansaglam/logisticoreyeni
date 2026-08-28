# V1.1 — Leaderboard Emulator Failure Audit

**Date:** 2026-08-28  
**Final status:** `LEADERBOARD_IMPLEMENTATION_BUG`  
**Scope:** Read-only audit. No code or test changes.

---

## Executive summary

| Field | Value |
|-------|-------|
| Failing test | `malicious cloud save write does not change leaderboard score` |
| Assertion | `assert.equal(second.score, first.score)` |
| **First submit score** | **17,530** (expected baseline) |
| **Second submit score** | **95,790** (actual — after malicious cloud save) |
| Delta | **+78,260** (+446%) |
| Root cause | `submitLeaderboardScoreTransaction` calls `mergeLeaderboardStatsFromCloudSave` on every submit when `serverState` already exists, merging **client-writable** cloud-save progress fields into server state before score calculation |
| Marketplace / periodic economy | **Not involved** — reproduced with pure leaderboard + serverState path |
| Fixture isolation | **OK** — `beforeEach` clears emulator; deterministic reproduction |

**Verdict:** This is a **server-authoritative trust regression** introduced by intentional cloud-save sync (`197b2ef`, 2026-08-18). The emulator test is **correct**; it encodes B-001 security invariants documented as PASS in prior release audits. The implementation currently **allows client-controlled cloud save to inflate leaderboard score** for progression stats (and weekly activity).

---

## Failure reproduction

```bash
npm --prefix backend test
# ...
# not ok 17 - malicious cloud save write does not change leaderboard score
# Expected values to be strictly equal: 95790 !== 17530
```

Deterministic local reproduction (same formulas as production):

```
FIRST  totalScore = 17,530
SECOND totalScore = 95,790   (after mergeLeaderboardStatsFromCloudSave + weekly season delta)
```

---

## Test path (malicious cloud save)

```323:355:backend/test/leaderboard.emulator.test.ts
test('malicious cloud save write does not change leaderboard score', async () => {
  await seedServerState('secure-player', {
    cash: 50_000,
    companyLevel: 3,
    reputation: 55,
    completedDeliveries: 4,
  });
  const first = await submitLeaderboardScoreTransaction(...);  // score from serverState

  await adminFirestore.doc('users/secure-player/saves/current').set(
    buildSave('secure-player', {
      player: {
        money: 987_654_321,
        level: 100,
        reputation: 100,
        completedContracts: 50_000,
      },
    }),
  );

  const second = await submitLeaderboardScoreTransaction(...);
  assert.equal(second.score, first.score);  // FAILS: 95790 !== 17530
});
```

### Emulator fixture notes

- `beforeEach` → `rulesEnvironment.clearFirestore()` — no cross-test leakage
- `seedServerState` writes trusted `users/{uid}/serverState/current` + user profile
- Malicious write targets **client-owned** `users/{uid}/saves/current` (allowed by rules as backup)
- Second submit uses **new** idempotency key (`idem-secure-2`) — not a duplicate-replay issue

---

## Exact score breakdown

### First submit — score **17,530** (from `serverState` only)

| Component | Points | Inputs |
|-----------|--------|--------|
| **Delivery** | 5,421 | `completedDeliveries=4` |
| **Progression** | 1,977 | `companyLevel=3` |
| **Reputation** | 720 | `reputation=55` (above baseline 50) |
| **Assets (fleet + warehouse)** | 7,847 | Default starter truck + default warehouses from `buildDefaultServerState` |
| **Finance (cash)** | 1,565 | `cash=50,000` (serverState) |
| **Weekly activity** | 0 | First season submit; baseline not yet inflated |
| **Penalties** | 0 | No failed/late deliveries |
| **Total** | **17,530** | |

Money/fleet on first submit come from **serverState** seeded values, not cloud save.

### Second submit — score **95,790** (after malicious merge)

| Component | Points | Change vs first | Source of inflation |
|-----------|--------|-----------------|---------------------|
| **Delivery** | 45,000 (cap) | +39,579 | `completedContracts: 50_000` from cloud save |
| **Progression** | 22,000 (cap) | +20,023 | `level: 100` from cloud save |
| **Reputation** | 7,200 (cap) | +6,480 | `reputation: 100` from cloud save |
| **Assets** | 8,025 | +178 | Trucks/warehouses re-parsed from cloud save `buildSave` |
| **Finance (cash)** | 1,565 | **0** | `cash` **not** merged — still `50,000` serverState |
| **Weekly activity** | 12,000 (cap) | +12,000 | `weeklyCompletedDeliveries=49,996` (50,000 − baseline 4 from first persist) |
| **Total** | **95,790** | **+78,260** | |

### Spoofed fields — what merged vs ignored

| Cloud-save field | Merged into serverState? | Affects score? |
|------------------|--------------------------|----------------|
| `money: 987_654_321` | **No** (`cash` stays server-owned) | No direct finance spike |
| `completedContracts: 50_000` | **Yes** | Yes — delivery + weekly |
| `level: 100` | **Yes** | Yes — progression cap |
| `reputation: 100` | **Yes** | Yes — reputation cap |
| `trucks` / `warehouses` | **Yes** (no marketplace → fleet not preserved) | Minor asset delta |

**Cash isolation works; progression-stat isolation does not.**

---

## Code path (root cause)

### Submit transaction reads cloud save after serverState exists

```196:204:backend/src/leaderboard.ts
      if (saveSnap.exists && !serverStateCreatedFromSave) {
        serverState = mergeLeaderboardStatsFromCloudSave(
          identity.uid,
          serverState,
          saveSnap.data() ?? {},
          Timestamp.fromMillis(nowMs),
          { preserveAuthoritativeFleet: marketplaceSnap.exists },
        );
      }
```

Then score is computed **only** from merged `serverState` (correct pattern), but merge **imports client save stats**:

```405:431:backend/src/serverState.ts
export function mergeLeaderboardStatsFromCloudSave(...) {
  // ...
  const companyLevel = clamp(finite(player.level, ...), ...);
  const reputation = clamp(finite(player.reputation, ...), ...);
  const completedDeliveries = clamp(finite(player.completedContracts, ...), ...);
  // cash is NOT updated — existing.cash preserved via spread
```

Merged stats are **persisted** back to `serverState` via `pickLeaderboardServerStatePersistPatch` on submit — poison persists for future submits and season seed.

### Introduced by

**Commit `197b2ef`** (2026-08-18): *"fix: sync leaderboard stats from cloud save and speed up screen opens"*

Documented intent in `mergeLeaderboardStatsFromCloudSave`:

> *Cloud save'deki güncel ilerleme istatistiklerini serverState'e yansıtır. Liderlik submit/seed skoru bu belgeye dayanır; migration sonrası stale kalmasın diye.*

Also wired in `leaderboardSeasonSeed.ts` for weekly seeding.

### Conflicting regression suite

`scripts/leaderboard-server-state-sync-regression-test.ts` **expects** merge to sync `completedDeliveries` from cloud save (25 deliveries → ranked eligible). That feature **directly contradicts** the malicious-save emulator test and B-001 docs.

| Suite | Expectation |
|-------|-------------|
| `leaderboard.emulator.test.ts` | Malicious save must **not** change score |
| `security-malicious-save-trust-test.ts` | Resubmit after forged save → **same** score (`assert.equal(..., expectedScore)`) |
| `leaderboard-server-state-sync-regression-test.ts` | Stale serverState **must** pick up cloud save deliveries |
| `docs/release-audit/FINAL_PRE_BUILD_GATE.md` | Malicious test **PASS** (pre-merge) |

---

## Classification matrix

| Option | Applies? | Reason |
|--------|----------|--------|
| **A) Implementation regression** | **Yes** | `mergeLeaderboardStatsFromCloudSave` on submit breaks server-authoritative anti-cheat invariant |
| **B) Stale expected value** | **No** | `17,530` is correct first-score; test expects equality, not a hardcoded legacy constant |
| **C) Fixture contamination** | **No** | `clearFirestore()` per test; scores deterministic |
| **D) Malicious cloud save isolation failure** | **Yes** | Client save inflates progression stats (primary); cash isolated |
| **E) Unrelated test setup bug** | **No** | Test setup matches intended security scenario |

**Final status:** `LEADERBOARD_IMPLEMENTATION_BUG`  
(Subsumes D — isolation failure is the manifestation.)

---

## Critical invariants check

| Invariant | Status |
|-----------|--------|
| Client cannot spoof score via submit payload | **Pass** — score computed server-side from `serverState` |
| Cloud save cannot override server-authoritative score | **FAIL** — merge imports save stats before calculate |
| One UID = one entry | **Pass** — same doc id, merge update |
| Score deterministic from canonical server state | **Pass given state** — but state is corrupted by merge |
| Reputation logic unchanged | **Pass** — formula unchanged; **inputs** spoofed via merge |
| No stale test data leaking | **Pass** — emulator cleared each test |

---

## Production vs emulator formula parity

- Same `calculateLeaderboardScore` / `extractCanonicalPlayerStateFromServerState` in emulator and Cloud Functions (`backend/src/leaderboardScore.ts`)
- Same `submitLeaderboardScoreTransaction` path
- **Production deployed functions include this merge** if `197b2ef` is live (marketplace P0 deploy updated functions bundle)
- Emulator failure reflects **production behavior**, not test-only drift

---

## Duplicate submit / merge behavior

- First and second submits use **different** idempotency keys → both execute full transaction
- Second submit **overwrites** serverState leaderboard fields with merged (inflated) stats
- Leaderboard entry `companyScore` updated to `95,790` (`updated: true`)
- Not a double-charge/idempotency bug — intentional second transaction with corrupted inputs

---

## Relation to recent marketplace / economy work

| Change | Impact on this failure |
|--------|------------------------|
| Marketplace P0 data-loss fix | **None** — different collections |
| Periodic economy fix | **None** — client simulation only |
| `mergeLeaderboardStatsFromCloudSave` | **Direct cause** — predates marketplace P0 |
| Leaderboard v2 score formula (`3f10e52`) | Changes **weights**, not trust boundary; first score `17,530` uses v2 formula correctly |

---

## Recommended fix direction (not executed)

1. **Remove or gate** `mergeLeaderboardStatsFromCloudSave` from `submitLeaderboardScoreTransaction` — score only from trusted `serverState` / server-written delivery counters
2. If legitimate sync needed: merge only from **server-verified** sources (delivery settlement events, marketplace txn), not raw client save
3. Reconcile `leaderboard-server-state-sync-regression-test.ts` with security tests — pick one trust model
4. Re-run `backend:verify` + `security-malicious-save-trust-test.ts` under emulator

---

## Binary / deploy

- **Deploy required to fix production:** Yes (Cloud Functions `submitLeaderboardScore`)
- **Binary required:** No (backend-only trust boundary)
- **Not produced this pass**

---

## Files audited

| File | Role |
|------|------|
| `backend/test/leaderboard.emulator.test.ts` | Failing test |
| `backend/src/leaderboard.ts` | Submit path + merge call |
| `backend/src/leaderboardScore.ts` | v2 formula + weekly season |
| `backend/src/serverState.ts` | `mergeLeaderboardStatsFromCloudSave` |
| `backend/src/leaderboardSeasonSeed.ts` | Same merge on seed |
| `scripts/leaderboard-server-state-sync-regression-test.ts` | Conflicting sync expectation |
| `scripts/security-malicious-save-trust-test.ts` | Same invariant, would also fail |

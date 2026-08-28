# V1.1 — Periodic Economy Fix Report

**Date:** 2026-08-28  
**Final status:** `PERIODIC_ECONOMY_FIXED`  
**Scope:** Offline/online 24h periodic operating-cost cursor and charge semantics only.

---

## Summary

| Item | Result |
|------|--------|
| Root bug fixed | `src/simulation/periodicCosts.ts` — elapsed-period math replaces broken cursor loop |
| `offline-economy-test.ts` | **52/52 PASS** (incl. original 4 failures + boundary matrix) |
| `time-progression-audit-test.ts` — periodic assertions | **All PASS** (35 periodic-related) |
| `time-progression-audit-test.ts` — full file | **35/38** — 3 unrelated pre-existing failures (see below) |
| `npx tsc --noEmit` | PASS |
| `git diff --check` | PASS |
| Cloud Functions deploy required | **No** (client simulation only) |
| Binary required for production fix | **Yes** (app update); **not produced** this pass |

---

## Exact code fix

### File: `src/simulation/periodicCosts.ts`

**Removed:** Early `maxPeriods <= 0` return that zeroed `periodsElapsed` and `capped`, plus cursor-mutation loop:

```typescript
// OLD — skipped elapsed metadata and missed exact 24h boundary
if (maxPeriods <= 0) {
  return { periodsElapsed: 0, periodStarts: [], capped: false };
}
while (cursor + PERIOD_24H_MS <= now) { ... }
```

**Added:** Elapsed-period semantics:

```typescript
const elapsedPeriods = Math.floor((now - last) / PERIOD_24H_MS);

// Offline (maxPeriods = 0): metadata only, no charges
if (maxPeriods <= 0 && elapsedPeriods > 0) {
  return { periodsElapsed: elapsedPeriods, periodStarts: [], capped: true };
}

// Online: charge oldest pending periods up to cap
const periodsToProcess = Math.min(elapsedPeriods, maxPeriods);
const periodStarts = [last, last + PERIOD, ...]; // deterministic from cursor
```

**Added:** `resolveNewlyProcessedUntil()`:

| Mode | `newlyProcessedUntil` |
|------|------------------------|
| `elapsedPeriods <= 0` | unchanged (`last`) |
| Offline (`maxPeriods = 0`, elapsed > 0) | `now` — forgives historical debt |
| Online (`periodsToProcess > 0`) | `last + periodsToProcess × PERIOD_24H_MS` |

**Added:** Dev diagnostics when `operatingCostBalance.economyAuditLogsEnabled` — logs `previousCursor`, `now`, `elapsedPeriods`, `periodsToProcess`, `newCursor` (no production spam).

### File: `scripts/offline-economy-test.ts`

Extended with boundary matrix (offline 23h59m–10d, online 23h59m–48h, offline→online transition, idempotency).

### Unchanged (by design)

- `src/store/gameStore.ts` — retains defensive `Math.max(..., periodic.newlyProcessedUntil, nowMs)` on offline return; pure function now returns correct values without relying on it.
- Marketplace, cloud save, balance amounts, salaries/prices, offline fixed-cost product rule (`OFFLINE_CATCHUP_MAX_COST_PERIODS = 0`).

---

## Old vs new behavior

| Scenario | Old | New |
|----------|-----|-----|
| Offline 10d, `maxPeriods=0` | `capped=false`, cursor stuck 10d behind | `capped=true`, `periodsElapsed=10`, `charges=0`, `cursor=now` |
| Online exactly 24h | `periodsCharged=0` (~47–48h needed) | `periodsCharged=1` |
| Online 24h + 1ms | `0` | `1` (cursor at `last+PERIOD`, fractional preserved) |
| Online 48h, cap=1/tick | `1` (wrong threshold) | `1` this tick, `capped=true`, second tick charges remaining |
| Offline 10d → online +24h | Risk of historical debt math | `periodsElapsed=1`, exactly **one** current period |

---

## Proofs (test-backed)

### 24h boundary

```
online exactly 24h: periodsCharged=1
online 24h+1ms: periodsCharged=1
online 23h59m: periodsCharged=0
idle şoför (24h): periodsCharged=1, salary=$120
```

### 72h offline

```
offline 72h: periodsCharged=0, newlyProcessedUntil=now
72h offline capped without charging: PASS
```

### Offline → online transition (no historical debt)

```
Day 0 cursor → offline 10d → cursor=now (Day 10), charges=0
+24h online → periodsElapsed=1, periodsCharged=1 (not 10)
```

### Idempotency

```
Second hydrate with same keys: periodsCharged=0
Same periodKeysApplied replay: periodsCharged=0
```

---

## gameStore integration audit

### `applyOfflineProgressionIfNeeded`

- Calls `buildPeriodicCostDeductions` with `OFFLINE_CATCHUP_MAX_COST_PERIODS` (0).
- Does **not** call `processDailyOperatingCosts` for offline fixed costs.
- Sets `lastProcessedEconomyAt: Math.max(state, periodic.newlyProcessedUntil, nowMs)`.
- With fix: `periodic.newlyProcessedUntil === nowMs` when elapsed ≥ 1 period; `Math.max` is belt-and-suspenders only.

### `advanceTime` (online)

- Calls `buildPeriodicCostDeductions` with `ONLINE_TICK_MAX_COST_PERIODS` (1).
- Charges via `processDailyOperatingCosts({ days: periodic.periodsCharged, reason: 'daily_tick', ... })` only when `periodsCharged > 0`.
- Updates `lastProcessedEconomyAt` to `periodic.newlyProcessedUntil`.
- Transaction IDs: `periodic-cost:${periodic.periodKeysApplied.join('|')}` — deterministic, no duplicate when `periodsCharged=0`.

**No gameStore code changes required** — integration already correct once pure function is fixed.

---

## Test results

### Required (periodic)

| Suite | Result |
|-------|--------|
| `offline-economy-test.ts` | **52/52 PASS** |
| Original 4 failing assertions | **ALL PASS** |
| `time-progression-audit-test.ts` periodic cost assertions | **ALL PASS** |

### Full verify gate

`npm run verify` stops at `time-progression-audit-test.ts` with **3 unrelated failures**:

| Failure | Cause | Related to periodic fix? |
|---------|-------|--------------------------|
| `1 dakika offline progress uygulanır` | `DEFAULT_OFFLINE_MIN_MS = 5 min` in `deliveryOfflineProgress.ts`; 1 min < 5 min threshold | **No** |
| `1 dakika elapsed tam uygulanır` | Same | **No** |
| `1 dakika simulation hours > 0` | Same | **No** |

These pre-existed before this fix. Not weakened. Separate offline-progression minimum-threshold issue.

### Backend verify

`npm run backend:verify` — emulator suite **56/57 PASS**. Unrelated failure:

- `malicious cloud save write does not change leaderboard score` (leaderboard emulator) — pre-existing.

### Other unrelated regression grep failures

`offline-operating-cost-disabled-regression-test.ts` — 3 source-string pattern checks (`offline_skip`, `maxOfflineCostPeriods: 0` literal in gameStore) — pre-existing string-match drift, not periodic math.

---

## Changed files

| File | Change |
|------|--------|
| `src/simulation/periodicCosts.ts` | Elapsed-period calculation, cursor semantics, diagnostics |
| `scripts/offline-economy-test.ts` | Boundary matrix tests |
| `docs/release-audit/V1_1_PERIODIC_ECONOMY_FIX_REPORT.md` | This report |

---

## Deployment / binary

| Question | Answer |
|----------|--------|
| Cloud Functions deploy required? | **No** — client-side simulation module only |
| Firestore rules deploy? | **No** |
| App binary required? | **Yes** — players need updated client for correct online salary cadence and offline cursor |
| Binary produced this pass? | **No** |

---

## Verdict

`PERIODIC_ECONOMY_FIXED`

Periodic operating-cost pure function is deterministic and correct for both `maxPeriods=0` (offline) and `maxPeriods=1` (online). Product rules satisfied:

1. Offline fixed operating cost = 0  
2. Online 24h period charges exactly at 24h elapsed  
3. No double charge (idempotent period keys)  
4. No ~48h delayed first charge  

**Phase 2 performance work:** Not started.

**Follow-up (out of scope):** Align `time-progression-audit-test.ts` 1-minute offline assertions with `DEFAULT_OFFLINE_MIN_MS = 5 min`, or adjust minimum threshold policy — separate from periodic economy.

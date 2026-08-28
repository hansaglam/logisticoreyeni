# V1.1 Contract Scheduler Optimization Report

**Phase:** 2B — CONTRACT SCHEDULER PERFORMANCE OPTIMIZATION  
**Date:** 2026-08-28  
**Status:** `CONTRACT_SCHEDULER_OPTIMIZED`

---

## Goal

Reduce full contract refresh cost without changing contract availability semantics, economy formulas, payments, reputation, save format, or player-facing contract rules.

---

## Baseline (pre-2B, measured / audited)

From `docs/release-audit/PERFORMANCE_SPIKE_FOLLOWUP_REPORT.md` and `[perf-contract-schedule]` instrumentation on full refresh ticks (~80–84 ms class on device):

| Stage | Role | Baseline assessment |
|-------|------|---------------------|
| `fast-path-eligibility` | Skip when no tick boundaries | ~1–3 ms steady path (unchanged) |
| `city-fleet-context` | Fleet/world-event context build | Moderate |
| `generation-small` / `generation-medium` | Bounded tick loops → `generateContracts` | High when ticks stack |
| **`route-eligibility`** | `generateContracts` city×city×product scan | **Top contributor** |
| **`minimum-supply-ensure`** | Playable bootstrap when supply low | **Top contributor** (when triggered) |
| `playable-contract-scan` | Debug-only heavy scan | Dev/diagnostics only |
| `debug-snapshot` | Debug struct | Low–moderate |

### Root cost centers inside `generateContractsCore` (static + profile)

1. **Per-candidate `pendingContracts` rebuild** — filtered all available contracts + all candidates inside the inner product loop (O(candidates × contracts) per viable cell).
2. **Per-candidate `countAvailableDuplicates`** — full `contracts.filter(...)` per city×city×product cell.
3. **Repeated `routes.find(...)`** — O(R) route lookup per eligible pair (despite static `ROUTES_BY_ID` existing).
4. **Repeated `toProductMarket` + surplus/shortage** — recomputed for every inner iteration.
5. **Repeated `isContractCityPairEligible`** — warehouse unlock + road-graph checks without pass cache.

`findMarketOpportunities` ran a **second** full city×city×product traversal before generation (iteration order preserved — not merged to avoid randomness/order risk).

---

## Optimizations implemented

### New module: `src/simulation/contractGenerationIndex.ts`

| Artifact | Classification | Purpose |
|----------|----------------|---------|
| `lookupRouteBetweenCities` | **STATIC** (uses `getRoute` / `ROUTES_BY_ID`) | O(1) directed route lookup; array fallback for custom test fixtures |
| `buildAvailableDuplicateIndex` | **PER-GENERATION-PASS** | O(1) duplicate-count per origin/dest/product |
| `buildCityProductEconomyIndex` | **PER-GENERATION-PASS** | Precomputed surplus/shortage + markets per city×product |
| `isContractCityPairEligibleCached` | **PER-GENERATION-PASS** | Memoized warehouse unlock + road connectivity per pair×level |

### `generateContractsCore` changes (`src/simulation/contracts.ts`)

- Build **available contract list**, **duplicate index**, **economy index**, and **pair eligibility cache** once per generation pass.
- Replace inner-loop `countAvailableDuplicates(filter)` with `getAvailableDuplicateCount(index, ...)`.
- Replace inner-loop pending-list rebuild with **incremental unreachable counters** (same ratio semantics for `shouldSpawnBeyondFleetContract`).
- Use `lookupRouteBetweenCities` in generation and candidate selection.
- Apply economy + eligibility indexes in the main loop.

### `findMarketOpportunities`

- Reuses economy index + pair eligibility cache + O(1) route lookup.
- **Iteration order unchanged** (`product → origin → destination`).

### Unchanged

- `contractEconomics`, rewards, generation frequencies, balance values, map/route data.
- `processContractGenerationSchedule` orchestration and `gameStore` advanceTime flow.
- Minimum-supply guarantee logic (`isContractMinimumSupplyNeeded` / `ensureMinimumEligibleContracts`).
- Randomness sources (`Math.random` call sites and iteration order).

---

## Complexity before / after

| Operation | Before (per generation pass) | After |
|-----------|------------------------------|-------|
| Route lookup per cell | O(R) linear scan | O(1) index |
| Duplicate count per cell | O(C) filter | O(1) map lookup |
| Pending unreachable ratio | O(C × candidates) rebuilds | O(1) incremental |
| Surplus/shortage per cell | Recompute market | O(1) index read |
| City-pair eligibility | Uncached graph checks | O(1) per unique pair×level |

Where C = contract count, R = route count, candidates = accepted generation candidates.

---

## Timing before / after (development machine)

Measured via `scripts/contract-scheduler-performance-test.ts` (12× `generateContracts`, 8× full `processContractGenerationSchedule` refresh):

| Benchmark | Pre-2B (audit spike class) | Post-2B (this machine) |
|-----------|----------------------------|------------------------|
| `generateContracts` full scan | Dominant stage in **~80 ms** refresh ticks | **~5.5 ms** avg |
| `processContractGenerationSchedule` full refresh | **~80 ms+** spike class | **~16.4 ms** avg |
| Steady skip path | ~1–3 ms | Unchanged |

Target **&lt;30–40 ms** full refresh: **met** on development baseline.

### Remaining hotspot

When minimum supply triggers, `[perf-contract-schedule] minimum-supply-ensure` still logs **~21–28 ms** in test runs (playable scans + bootstrap generation). This is **behavior-preserving** and only runs when supply checks fail — not on the steady fast path.

---

## Semantic parity evidence

| Check | Result |
|-------|--------|
| Seeded `Math.random` — same seed → identical available contract semantic set | PASS |
| Duplicate index matches legacy `countAvailableDuplicates` | PASS |
| `contract-generation-reliability-test.ts` (minimum supply, fast path, Bursa/İzmir) | **18/18 PASS** |
| No duplicate dedupe keys in generated batch | PASS |
| Route direction preserved (e.g. `ankara → izmir`) | PASS |
| Accepted contracts excluded from duplicate index | PASS |

Compared fields: origin, destination, product, amount, payment, deadline, contract type, required level (ordering ignored).

---

## Minimum supply proof

- `isContractMinimumSupplyNeeded` and `ensureMinimumEligibleContracts` **not modified**.
- Fast skip when supply satisfied remains in `processContractGenerationSchedule`.
- Reliability suite confirms Bursa/İzmir per-city playable guarantees, empty-pool bootstrap, and fast-path reference stability.

---

## Files changed

| File | Change |
|------|--------|
| `src/simulation/contractGenerationIndex.ts` | **NEW** — route, duplicate, economy, eligibility indexes |
| `src/simulation/contracts.ts` | Hot-path generation + opportunity scan optimizations |
| `scripts/contract-scheduler-performance-test.ts` | **NEW** — parity, index correctness, benchmarks |
| `scripts/performance-regression-test.ts` | Guards for index usage + pending-list removal |
| `package.json` | Added scheduler test to `verify` chain |

---

## Tests

- `npx tsx scripts/contract-scheduler-performance-test.ts`
- `npx tsx scripts/contract-generation-reliability-test.ts`
- `npx tsx scripts/performance-regression-test.ts`

---

## Validation

| Command | Result |
|---------|--------|
| `npx tsc --noEmit` | **PASS** |
| `npm run verify` | Stops at `verify-ios-apple-auth-config.ts` — `IOS_ARCHIVE_APP_PATH` missing |
| `npm run backend:verify` | **PASS** |
| `git diff --check` | **PASS** |

**Classification:** `FUNCTIONAL_VERIFY_PASS` + `IOS_ARCHIVE_PREFLIGHT_PENDING`

---

## Real-device checks still required

1. Capture one **full refresh spike** tick on device with `[perf-contract-schedule]` — confirm `route-eligibility` no longer dominates 80 ms class.
2. Idle-city minimum-supply bootstrap after long offline session (Bursa/İzmir playable guarantee).
3. Contract board variety after several medium/small generation boundaries — no visible reduction in offers.
4. Market opportunity strip vs contract offers — opportunity highlighting unchanged.

---

## Final status

`CONTRACT_SCHEDULER_OPTIMIZED`

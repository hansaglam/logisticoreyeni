# Performance Spike Follow-Up Report

**Date:** 2026-08-14  
**Scope:** Spike audit + safe micro-optimizations only (no persistence rewrite, no gameplay changes).

---

## 1. Contract-schedule spike (83.6 ms)

### Root cause (static audit)

Steady-state ticks (1–3 ms) use `canSkipContractScheduleTick` → no `buildContractRefreshParams`, no `set()`, no generation.

The **83.6 ms spike** is a **full refresh tick** — one or more of:

| Branch | Typical cost driver |
|--------|---------------------|
| `city-fleet-context` | `citiesToRecord`, idle/busy city sets, `buildPlayerFleetCityContext`, world events |
| `generation-small` / `generation-medium` | Bounded tick loops → `runContractGenerationTick` → `generateContracts` |
| `generation-daily` + `generation-daily-expiry` | Daily cleanup boundary + boost generation |
| `route-eligibility` | `generateContracts` city×city×product scan + route lookup |
| `minimum-supply-check` + `minimum-supply-ensure` | `countPlayableContracts` / per-origin scans + bootstrap generation |
| `playable-contract-scan` | Heavy `countPlayableContracts` in debug snapshot (`__DEV__` or `PERF_DIAGNOSTICS_ENABLED`) |
| `debug-snapshot` | Debug struct assembly |

**Most likely dominant stage on a 80+ ms tick:** `route-eligibility` (generation) plus `minimum-supply-ensure` when idle cities lack playable contracts, compounded by `city-fleet-context` on large city/fleet state.

Exact per-stage breakdown requires **one device run** with the new instrumentation (logs only when stage ≥20 ms or `PERF_DIAGNOSTICS_ENABLED`).

### Instrumentation added

`[perf-contract-schedule]` stages:

- `skip-tick`, `fast-path-eligibility`
- `city-fleet-context` (gameStore `buildContractRefreshParams`)
- `generation-daily-expiry`, `generation-daily`, `generation-medium`, `generation-small`
- `minimum-supply-check`, `minimum-supply-ensure`
- `route-eligibility` (`generateContracts`)
- `playable-contract-scan` (debug snapshot path)
- `debug-snapshot`
- `schedule-run` (aggregate + elapsed tick counts)

No log spam in production unless a sub-stage exceeds **20 ms**.

### Safe optimization

- **`ensureMinimumEligibleContracts` skipped** when `isContractMinimumSupplyNeeded` returns false (same behavior — previously always called; often no-op but still ran supply scans internally).

Gameplay unchanged; steady path unchanged.

---

## 2. Finance-periodic spike (11.6 ms)

### Root cause

On **every** `advanceTime` tick (even when no 24h economy period elapsed):

1. `buildPeriodicCostDeductions` always ran `calculateDailyOperatingCostBreakdown` (fleet/warehouse scan).
2. `set()` always ran with `buildDailyOperatingCostDebugSnapshot` (second breakdown pass).
3. When a period **did** cross: `processDailyOperatingCosts` maps `financeLedger` for duplicate `transactionId` check — O(ledger length).

The **11.6 ms** tick is either (a) a period-charge tick with ledger work, or (b) a no-op tick paying breakdown + debug snapshot + Zustand `set` every frame.

### Safe optimizations

1. **`buildPeriodicCostDeductions`:** early return when `periodStarts.length === 0` — skips breakdown entirely.
2. **`advanceTime`:** skip `set()` when `periodsCharged === 0`, cursor unchanged, and no new period keys.

Sub-stages logged on spike: `finance-periodic-build`, `finance-periodic-charge`.

Behavior unchanged; charging/idempotency unchanged.

---

## 3. Save audit (255 ms total)

| Stage | ~ms | Finding |
|-------|-----|---------|
| serialize | 7.9 | OK — single `serializeGameState` |
| checksum | 73 | `canonicalJsonStringify` + async SHA-256 (`expo-crypto`); **not** duplicate disk JSON |
| storageWrite | 76 | `atomicWriteSaveJson`: 5–6 AsyncStorage ops (staging, read-back, backup, promote, cleanup) |

### Redundancy check

| Question | Result |
|----------|--------|
| Same-revision redundant checksum? | **No** — `saveRevision.ts` cache skips re-hash when revision unchanged |
| Duplicate serialization in adapter? | **No** — one `JSON.stringify` in `persistLocalSavePayload` |
| Extra metadata I/O? | **No** separate metadata write; integrity lives in payload `meta` |
| Weaken atomic write? | **Not done** — corruption safety preserved |

**Conclusion:** Checksum and storageWrite cost is **intrinsic** to integrity + atomic durability on large saves. No safe win without risky persistence rewrite.

---

## 4. Tests

| Command | Result |
|---------|--------|
| `npx tsc --noEmit` | PASS |
| `npm run verify` | PASS (incl. performance, save-checksum, contract generation regressions) |
| `npm run firebase:emulators:test` | PASS (50/50) |
| `git diff --check` | PASS |

No AAB/APK/IPA produced (per instructions).

---

## 5. Behavior & release status

- **Gameplay:** unchanged
- **Persistence safety:** unchanged
- **Production log spam:** none (spike/diagnostics thresholds only)

### Real-device recheck required

After installing this build, capture one **refresh spike** tick and confirm `[perf-contract-schedule]` shows the dominant stage. Target: refresh spike **&lt;20–30 ms** if dominant stage is optimizable; otherwise document accepted bound.

Enable `PERF_DIAGNOSTICS_ENABLED` temporarily if sub-20 ms stages need full visibility.

---

## Files touched

- `src/utils/performanceDiagnostics.ts` — contract sub-stage profiler
- `src/simulation/contracts.ts` — stages, minimum-supply gate, `generateContractsCore` split
- `src/simulation/periodicCosts.ts` — no-period fast exit
- `src/store/gameStore.ts` — finance no-op skip, contract schedule stages
- `src/storage/saveGame.ts` — audit comments only

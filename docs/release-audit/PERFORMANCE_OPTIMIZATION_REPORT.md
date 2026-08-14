# LogistiCore — Performance Optimization Report (Android measured bottlenecks)

**Date:** 2026-08-14  
**Scope:** `contract-schedule` + save checksum/write pipeline  
**Device validation:** **PENDING REAL DEVICE** — do not treat targets as PASS until re-profiled on Android Internal build.

---

## Measured baseline (user-provided Android logs)

| Metric | Before (measured) |
|--------|-------------------|
| `advanceTime` total | 53–59 ms |
| `contract-schedule` stage | 37.7–43.5 ms |
| Other advanceTime stages | ~0–1 ms |
| Save payload | 58,365 bytes |
| Save serialize | 25.2 ms |
| Save checksum | 82.7 ms |
| Save storage write | 56.8 ms |
| Save total | 318.2 ms |

---

## Root cause audit

### 1. Contract-schedule (37–43 ms / tick)

| Finding | Detail |
|---------|--------|
| Ran every game-loop tick | `advanceTime` always called `buildContractRefreshParams` + full `processContractGenerationSchedule` |
| Full generation on idle ticks | Small/medium/daily elapsed ticks usually **0**, but `ensureMinimumEligibleContracts` + debug snapshot still ran |
| O(n) work every tick | `expireOldContracts` allocated new array via `.map` even when nothing expired |
| Expensive debug | `buildContractGenerationDebugSnapshot` called `countPlayableContracts` (full eligibility scan) every tick |
| Heavy param build | `citiesToRecord`, fleet city context, world events on every tick |

### 2. Save checksum (82.7 ms)

| Finding | Detail |
|---------|--------|
| Triple JSON work | `canonicalJsonStringify` (checksum) + `JSON.stringify` (byte count) + `JSON.stringify` (AsyncStorage write) |
| Deep clone path | Checksum could re-clone via non-shallow prepare path in some call sites |
| Revision cache existed | `saveRevision.ts` cache present but invalidated each `markSaveDirty` (expected) |
| Same-revision coalesce | In-flight save coalesce could re-checksum same revision — cache now used within seal |

### 3. Save scheduling

| Finding | Detail |
|---------|--------|
| `time_tick` defer | Already deferred during navigation via `InteractionManager` |
| Risk | Continuous interaction could defer indefinitely |
| Background | Used `runAfterInteractions` before flush — lifecycle save could be delayed |

---

## Changes implemented

### Contract-schedule

- `canSkipContractScheduleTick` / `isContractScheduleFastPathEligible` — skip full schedule when no small/medium/daily tick, no expiry, supply OK
- `gameStore.advanceTime` — **no** `buildContractRefreshParams` on fast-path ticks; no `set()` when unchanged
- `processContractGenerationSchedule` internal fast path (shared eligibility helper)
- `expireOldContracts` — returns **same array reference** when nothing expired
- Production debug — skip `countPlayableContracts` in `contractGenerationDebug` unless `__DEV__` or diagnostics enabled

### Save checksum / write

- `computeChecksumFromPreparedPayload` — single shallow-prepared canonical stringify + SHA-256
- `sealSavePayloadIntegrity` — revision cache preserved; no extra deep clone on seal path
- `persistLocalSavePayload` — **one** `JSON.stringify` for atomic write + byte size
- Removed redundant `JSON.stringify` in `writeGameStateOnce`

### Save scheduling

- `scheduleDeferredTimeTickSave` + `AUTO_SAVE_MAX_DEFER_MS` (4s) — max defer for `time_tick` during navigation
- `flushLifecycleSave('background')` — immediate save on AppState background (no InteractionManager defer)
- Single-flight + coalesce unchanged (`inFlightSaveWrite`, `pendingCoalescedSave`)

---

## Expected targets (PENDING REAL DEVICE)

| Metric | Before | Target | Validation |
|--------|--------|--------|------------|
| `advanceTime` total | 53–59 ms | **<15 ms** steady tick | Android perf logs |
| `contract-schedule` | 37–43 ms | **<5 ms** steady tick | `[perf-advance-time]` stage |
| `contract-schedule` (refresh tick) | n/a | **<20 ms** when tick fires | When 3h/6h/24h boundary crossed |
| Save serialize | 25.2 ms | **~15–22 ms** | `[perf-save]` |
| Save checksum | 82.7 ms | **~35–55 ms** | single canonical pass + cache on coalesce |
| Save write | 56.8 ms | **~50–58 ms** | one stringify (platform-bound) |
| Save total | 318.2 ms | **~180–240 ms** | sum of above |

**Status:** **NOT VERIFIED** on device in this session. Re-run Internal Test with `EXPO_PUBLIC_BACKEND_DIAGNOSTICS_ENABLED=true` on a diagnostic profile build and compare `[perf-advance-time]` / `[perf-save]` lines.

---

## Regression tests

| Test | Result |
|------|--------|
| `npx tsc --noEmit` | PASS |
| `npm run verify` | PASS |
| `npm run firebase:emulators:test` | PASS 50/50 |
| `scripts/performance-regression-test.ts` | PASS |
| `scripts/save-checksum-regression-test.ts` | PASS |
| `scripts/contract-generation-reliability-test.ts` | PASS (fast path + expiry) |
| `git diff --check` | PASS |

### Safety preserved

- Contract expiry / generation / minimum supply — same eligibility rules; fast path only when provably no-op
- Offline progression — unchanged in this pass
- Checksum corruption detection — `verifyRawSaveChecksum` unchanged; tamper test PASS
- Save recovery / single-flight — unchanged semantics
- Background save — **improved** (immediate flush vs deferred)

---

## Files touched

- `src/simulation/contracts.ts`
- `src/store/gameStore.ts`
- `src/storage/saveGame.ts`
- `src/utils/saveIntegrity.ts`
- `App.tsx`
- `scripts/performance-regression-test.ts`
- `scripts/save-checksum-regression-test.ts`
- `scripts/contract-generation-reliability-test.ts`
- `package.json` (verify includes perf + checksum tests)

---

## Next step (required)

1. Install diagnostic Internal build on the same Android device that produced baseline logs.
2. Capture 60s gameplay: idle dashboard + tab navigation + one manual save trigger.
3. Compare `contract-schedule` and `[perf-save]` lines to table above.
4. If `contract-schedule` still >5 ms steady-state, profile `isContractMinimumSupplyNeeded` with idle trucks (playable scan may still be required on those ticks).

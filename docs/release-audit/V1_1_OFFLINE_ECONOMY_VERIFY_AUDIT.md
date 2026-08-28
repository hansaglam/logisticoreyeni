# V1.1 — Offline Economy Verify Failure Audit

**Date:** 2026-08-28  
**Final status:** `IMPLEMENTATION_BUG`  
**Scope:** Read-only audit. No code changes. Marketplace logic untouched.

---

## Executive summary

`npm run verify` fails early in `scripts/offline-economy-test.ts` with **4 failures** (28 pass). These failures reproduce on **committed `main`** with marketplace P0 changes stashed — they are **not** caused by the marketplace patch.

| # | Assertion | Verdict |
|---|-----------|---------|
| 1 | `72h offline: cost cursor capped without charging` | Implementation incomplete in `periodicCosts.ts` (`maxPeriods=0` early return). **Production offline path compensated** by `gameStore` `Math.max(..., nowMs)`. |
| 2 | `offline catch-up advances economy cursor to now` | Same as #1 — pure function does not advance cursor; **gameStore does**. |
| 3 | `idle şoför: 1 dönem kesilir` | **Real implementation bug** — online periodic charge threshold is ~47h, not 24h. |
| 4 | `24s hiç iş yapmayan şoför: yalnız 1× günlük maaş` | Consequence of #3 (`periodsCharged=0` → no deductions). |

**Canonical product rule (confirmed in code comments and balance):**

- Offline fixed operating costs = **0** (`OFFLINE_CATCHUP_MAX_COST_PERIODS = 0`, `maxOfflineChargeDays: 0`)
- Online periodic operating costs (driver salary, warehouse, operations) = **continue on 24h real-time periods**

**Config drift:** None. `src/config/balance.ts` and `periodicCosts.ts` constants match the product rule.

**Test staleness:** Idle-driver tests (#3–#4) are **not stale** — they encode the intended 24h online cadence since Model A (`71c45bf`). Offline metadata tests (#1–#2) were **added in `5c23d5e`** to document behavior that `buildPeriodicCostDeductions` never implemented; production relies on `gameStore` instead.

---

## Reproduction

```bash
npx tsx scripts/offline-economy-test.ts
# Result: 28 passed, 4 failed
```

Also confirmed on clean committed tree (marketplace changes stashed): same 4 failures.

Related suite (not in verify's first gate, but same root module):

```bash
npx tsx scripts/time-progression-audit-test.ts
# Result: 29 passed, 9 failed (overlapping periodic-cost + offline-progress expectations)
```

---

## Files audited

| File | Role |
|------|------|
| `scripts/offline-economy-test.ts` | Failing assertions |
| `scripts/time-progression-audit-test.ts` | Extended periodic/offline expectations |
| `src/simulation/periodicCosts.ts` | Period counting, charge cap, cursor math |
| `src/store/gameStore.ts` | `applyOfflineProgressionIfNeeded`, `advanceTime` periodic apply |
| `src/config/balance.ts` | `operatingCostBalance`, `maxOfflineChargeDays`, `maxOfflineProgressHours` |
| `src/simulation/offlineProgression.ts` | Offline elapsed/progress cap (24h) — **passing** |

---

## Failure 1 — `72h offline: cost cursor capped without charging`

### Test setup

```ts
const now = 1_700_000_000_000;
const last = now - 10 * PERIOD_24H_MS; // 10×24h = 240h elapsed

buildPeriodicCostDeductions({
  economyNowMs: now,
  lastProcessedEconomyAt: last,
  maxOfflineCostPeriods: OFFLINE_CATCHUP_MAX_COST_PERIODS, // 0
});
```

### Expected vs actual

| Field | Expected | Actual |
|-------|----------|--------|
| `capped` | `true` (elapsed > charge cap) | `false` |
| `periodsCharged` | `0` | `0` ✓ |
| `totalAmount` | `0` | `0` ✓ |

### Code path

1. `buildPeriodicCostDeductions` → `calculatePeriodicCostPeriods`
2. `maxPeriods = OFFLINE_CATCHUP_MAX_COST_PERIODS` → `0`
3. Early return at `periodicCosts.ts:71-72`:

```71:72:src/simulation/periodicCosts.ts
  if (maxPeriods <= 0) {
    return { periodsElapsed: 0, periodStarts: [], capped: false };
```

No period enumeration runs; `capped` is hard-coded `false` even though 10 periods elapsed between `last` and `now`.

### Production behavior (offline return)

`gameStore.applyOfflineProgressionIfNeeded` does **not** depend on `periodic.capped`:

```4562:4566:src/store/gameStore.ts
      lastProcessedEconomyAt: Math.max(
        midState.lastProcessedEconomyAt ?? 0,
        periodic.newlyProcessedUntil,
        nowMs,
      ),
```

Cursor advances to `nowMs` regardless of pure-function `capped` flag. Offline charges remain 0 (`periodsCharged=0`). **Product rule satisfied at runtime.**

### Root cause

`calculatePeriodicCostPeriods` treats `maxPeriods=0` as “no work” instead of “count elapsed periods, charge zero, report cap metadata.”

### Who is wrong?

- **Test vs pure function:** Test documents intended module contract; implementation is incomplete.
- **Production:** Not wrong for charging; cursor advance is delegated to `gameStore`.

---

## Failure 2 — `offline catch-up advances economy cursor to now`

### Expected vs actual

| Field | Expected | Actual |
|-------|----------|--------|
| `newlyProcessedUntil` | `now` (`1_700_000_000_000`) | `last` (`1_699_136_000_000`) |
| Delta | `0` | `864_000_000` ms (10 days behind) |

### Code path

Same `maxPeriods=0` early return → `periodsElapsed=0`, `periodStarts=[]`.

`newlyProcessedUntil` fallback (`periodicCosts.ts:121-128`):

```121:128:src/simulation/periodicCosts.ts
  const newlyProcessedUntil =
    economyNowMs <= previousProcessedAt
      ? previousProcessedAt
      : capped
        ? economyNowMs
        : Math.min(
            economyNowMs,
            previousProcessedAt + periodsElapsed * PERIOD_24H_MS,
          );
```

With `capped=false`, `periodsElapsed=0` → `newlyProcessedUntil = previousProcessedAt = last`.

### Production behavior

Same `gameStore` `Math.max(..., nowMs)` as Failure 1. Offline cursor reaches `now` in production.

### Who is wrong?

- **Pure function:** Wrong — does not advance cursor on offline catch-up path.
- **Test:** Correct intent; tests module in isolation without `gameStore` wrapper.
- **Not CONFIG_DRIFT** — `maxOfflineChargeDays: 0` is intentional.

### Git note

Assertions #1–#2 were **introduced in `5c23d5e`** (2026-08-14) when offline charging was disabled. Prior test only asserted `periodsCharged === 0` and `totalAmount === 0` (which still pass). New metadata assertions were added without updating `calculatePeriodicCostPeriods`.

---

## Failure 3 — `idle şoför: 1 dönem kesilir`

### Test setup

```ts
buildPeriodicCostDeductions({
  economyNowMs: now,
  lastProcessedEconomyAt: now - PERIOD_24H_MS, // exactly 24h ago
  maxOfflineCostPeriods: ONLINE_TICK_MAX_COST_PERIODS, // 1
});
```

### Expected vs actual

| Field | Expected | Actual |
|-------|----------|--------|
| `periodsCharged` | `1` | `0` |
| `periodsElapsed` | (implicit 1) | `0` |

### Code path

`calculatePeriodicCostPeriods` with `maxPeriods=1`:

1. `firstPeriodStart = floor(last / PERIOD_24H_MS) * PERIOD_24H_MS` → equals `last` (boundary-aligned timestamp)
2. `last > firstPeriodStart` → false → `cursor = firstPeriodStart = last`
3. `cursor <= last` → true → `cursor = last + PERIOD_24H_MS = now`
4. While loop: `cursor + PERIOD_24H_MS <= now` → `now + PERIOD <= now` → **false**
5. `allStarts = []` → no charge

### Charge threshold probe (current implementation)

| Real hours since `last` | `periodsCharged` (online max=1) |
|-------------------------|----------------------------------|
| 24h | 0 |
| 25h–36h | 0 |
| 47h | 1 |
| 48h | 1 |
| 72h | 1 (2 elapsed, 1 charged due to cap) |

Online periodic costs require **~47–48h** of real time before the first charge when using boundary-aligned timestamps — not 24h.

### Production impact

`gameStore.advanceTime` calls `buildPeriodicCostDeductions` with `ONLINE_TICK_MAX_COST_PERIODS` on every game tick (`gameStore.ts:4775-4785`). `lastProcessedEconomyAt` only advances when `periodsCharged > 0` or `newlyProcessedUntil` changes. With 0 charges, cursor stalls until ~47h elapses, then one period charges.

**Effect:** Driver salary / warehouse / operations periodic deductions likely run at **~2× intended interval** during continuous online play.

### Who is wrong?

- **Implementation:** Bug in `calculatePeriodicCostPeriods` cursor init + `while (cursor + PERIOD_24H_MS <= now)` semantics.
- **Test:** Correct — encodes 24h online periodic rule.

### Git note

Idle assertion existed before `5c23d5e` (with `maxOfflineCostPeriods: 3`). It **already failed** on parent commit — predates offline-cost disable work. Cursor logic introduced with Model A economy clock (`71c45bf`).

---

## Failure 4 — `24s hiç iş yapmayan şoför: yalnız 1× günlük maaş`

### Expected vs actual

| Field | Expected | Actual |
|-------|----------|--------|
| `idleSalaryDeduction` | `120` (`getDriverDailySalary`) | `0` |

### Code path

Direct consequence of Failure 3: `periodsCharged=0` → empty `deductions` → salary sum 0.

`advanceTime` → `processDailyOperatingCosts({ days: periodic.periodsCharged, ... })` never invoked with `days > 0`.

### Who is wrong?

**Implementation** (same root as #3). Model A contract economics tests in the same file (settlement excludes driver from cash, transfer = fuel only) **all pass** — only periodic application is broken.

---

## Cross-check: what still passes

| Check | Status |
|-------|--------|
| Offline catch-up charges 0 (`periodsCharged=0`, `totalAmount=0`) | ✓ |
| `maxOfflineProgressHours = 24` / progress cap | ✓ |
| Online charge after large gap (`onlineAfterReturn` in test: 11 periods elapsed → 1 charged) | ✓ |
| Second hydrate idempotency (no double charge) | ✓ |
| Model A contract/settlement/transfer economics | ✓ |
| `scripts/offline-operating-cost-disabled-regression-test.ts` charge=0 assertions | ✓ |
| `gameStore` offline cursor `Math.max(..., nowMs)` | ✓ (runtime) |

---

## gameStore integration map

### Offline catch-up (`applyOfflineProgressionIfNeeded`)

```
applyOfflineProgress (simulation only)
  → buildPeriodicCostDeductions(maxOfflineCostPeriods: 0)  // never charges
  → lastProcessedEconomyAt = max(state, periodic.newlyProcessedUntil, nowMs)  // cursor forced to now
  → processDailyOperatingCosts NOT called for offline fixed costs
```

Product rule **offline fixed costs = 0**: satisfied.

### Online tick (`advanceTime`)

```
buildPeriodicCostDeductions(maxOfflineCostPeriods: ONLINE_TICK_MAX_COST_PERIODS (=1))
  → if periodsCharged > 0: processDailyOperatingCosts(reason: 'daily_tick')
  → lastProcessedEconomyAt = periodic.newlyProcessedUntil
```

Product rule **online 24h periodic costs**: **not satisfied** — effective cadence ~47–48h due to cursor math.

---

## Related test drift (`time-progression-audit-test.ts`)

Same `periodicCosts.ts` issues cause 9 failures there, including:

- `periodsElapsed` expectations under `OFFLINE_CATCHUP_MAX_COST_PERIODS` (expects elapsed count while charges stay 0)
- `cap sonrası cursor trustedNow`
- `online tick: 24 saat geçince 1 period kesilir`
- `24 saat yalnız 1 cost period elapsed`

Separate offline-progress failures (`1 dakika offline progress uygulanır`) involve `MIN_OFFLINE_PROGRESS_MS` vs `GAME_LOOP_TICK_MS` threshold — outside the 4 `offline-economy-test` assertions but same verify run.

---

## Classification summary

| Category | Applies? |
|----------|----------|
| `TEST_STALE` | Partially — only for #1–#2 if testing pure function without acknowledging `gameStore` wrapper; idle tests (#3–#4) are valid |
| `CONFIG_DRIFT` | No — balance constants match product rule |
| `NO_ISSUE` | No |
| **`IMPLEMENTATION_BUG`** | **Yes** — primary verdict |

### Recommended fix direction (not executed this pass)

1. **`maxPeriods=0` path:** Still enumerate `periodsElapsed` / set `capped=true` when elapsed > 0; set `newlyProcessedUntil=now`; never populate `periodStarts` for charging.
2. **Online cursor math:** Fix period boundary logic so exactly 24h elapsed triggers exactly one completed period (e.g. adjust while condition or cursor start to charge the period ending at `now`, not require an additional full period).
3. **Tests:** After implementation fix, align `offline-economy-test.ts` and `time-progression-audit-test.ts`; add regression for 24h / 47h / 48h thresholds.

---

## Verify gate impact

`npm run verify` stops at `offline-economy-test.ts` (4 failures). This blocks full verify on `main` independent of marketplace work. Marketplace-specific suites (`vehicle-marketplace-*`, emulator) are unaffected.

**Binary status:** NOT PRODUCED (audit only).

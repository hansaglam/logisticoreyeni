# V1.1 — Offline Progress Threshold Audit

**Date:** 2026-08-28  
**Final status:** `PRODUCT_DECISION_REQUIRED`  
**Scope:** Read-only audit. No code changes.

---

## Executive summary

`time-progression-audit-test.ts` fails 3 assertions because it expects **1 minute** of background time to apply offline progress. Runtime gating uses **`DEFAULT_OFFLINE_MIN_MS = 5 minutes`** (when `hasActiveDeliveries` is false), so 1 minute correctly returns `shouldApply: false`, `reason: 'below_minimum'`.

There is **no single canonical rule in the repo today**. Three layers disagree:

| Source | Stated minimum (no active delivery) | Stated minimum (active delivery) |
|--------|--------------------------------------|----------------------------------|
| `offlineProgression.ts` comment + `MIN_OFFLINE_PROGRESS_MS` | **1 game tick (~1s)** | (not specified) |
| `deliveryOfflineProgress.ts` + regression/smoke tests | **5 minutes** | **15 seconds** |
| `time-progression-audit-test.ts` | **1 minute** | (not passed — defaults to 5 min) |
| **Production `applyOfflineProgress` path** | **5 minutes always** | **15s path not wired** |

**Verdict:** Product/engineering must pick one policy and align constants, `applyOfflineProgress` wiring, and tests. The 1-minute audit tests are **stale relative to the shipping regression suite**; the **5m/15s split is the closest thing to an intentional release rule** but is **incompletely wired** in `gameStore`.

---

## 1. Why was 5 minutes introduced?

**Commit:** `bbb56b0` (2026-08-06) — *Fix iOS regressions and harden offline delivery, market layout, and warehouse upgrades.*

`src/simulation/deliveryOfflineProgress.ts` was introduced with:

```20:23:src/simulation/deliveryOfflineProgress.ts
/** Aktif teslimat varken offline catch-up eşiği (kısa background dahil) */
export const ACTIVE_DELIVERY_OFFLINE_MIN_MS = 15_000;
/** Aktif teslimat yokken genel offline eşiği */
export const DEFAULT_OFFLINE_MIN_MS = 5 * MS_PER_MINUTE;
```

Commit message: *"make active deliveries catch up from real time"* alongside offline fixed-cost disable and iOS release hardening.

**Two days earlier** (`6845c3a`, 2026-08-04), `offlineProgression.ts` had **lowered** the exported `MIN_OFFLINE_PROGRESS_MS` from 5 minutes to `GAME_LOOP_TICK_MS` (~1s) with an explicit comment that the old 5-minute gate made short Android backgrounds feel frozen — but `calculateOfflineElapsed` was already delegating to `resolveOfflineProgressMinMs()` from `deliveryOfflineProgress.ts`, **not** to `MIN_OFFLINE_PROGRESS_MS`.

So 5 minutes was introduced as a **dual-threshold product rule** (idle vs active-delivery), not as a raw performance constant. It arrived in the same release pass that prioritized trustworthy delivery catch-up on iOS.

---

## 2. Classification: performance, product rule, anti-abuse, or legacy?

| Factor | Assessment |
|--------|------------|
| **Product rule** | **Primary.** Two-tier threshold is documented in `deliveryOfflineProgress.ts` and enforced in regression/smoke tests. |
| **Anti-abuse / noise guard** | **Secondary.** Skips full offline simulation for very short idle returns (quick app switch, notification shade, brief multitask). |
| **Performance optimization** | **Secondary.** Avoids `advanceTime` + ledger/world-event work on sub-5-minute idle pauses. |
| **Legacy constant** | **Partially.** `MIN_OFFLINE_PROGRESS_MS = GAME_LOOP_TICK_MS` in `offlineProgression.ts` is a **superseded intent** that was never wired into the elapsed gate after the delivery module split. |

**Not** a meaningless legacy typo — `offline-delivery-progress-regression-test.ts` and `offline-progression-smoke-test.ts` **actively assert** the 5-minute default.

---

## 3. User-visible behavior caused by 5 minutes

### Idle (no `on_route` / `preparing` delivery)

When the player backgrounds the app and returns in **1–4 minutes**:

1. `applyOfflineProgressionIfNeeded` runs on foreground/cold-start.
2. `applyOfflineProgress` → `calculateOfflineElapsed` **without** `hasActiveDeliveries` → `minMs = 5 min`.
3. `shouldApply: false`, `reason: 'below_minimum'`.
4. `gameStore` updates `lastSeenRealTimeMs` / `lastSimulatedRealTimeMs` and **returns without** `advanceTime`, delivery reconcile, transfers, or offline summary.

**Player sees:** No offline summary, no simulation catch-up, no world/market tick from that absence. Game state is effectively frozen for that window.

At **≥ 5 minutes**, full offline catch-up runs (capped at 24h real time).

### Active delivery (truck on route) — **intended vs actual**

**Intended** (per `deliveryOfflineProgress.ts` + smoke tests): 15s minimum; 20s–3min backgrounds should apply.

**Actual production:** `applyOfflineProgress` never passes `hasActiveDeliveries` into `calculateOfflineElapsed`:

```94:94:src/simulation/offlineProgression.ts
    : calculateOfflineElapsed(baselineMs, nowMs);
```

`gameStore` computes `hasActiveDeliveries` at line 4290 but **does not use it** in the offline plan. Result: **active deliveries also wait 5 minutes** before offline catch-up runs.

**Player sees:** Truck on map appears frozen for 1–4 minute app switches; delivery timers do not advance until 5+ minutes away (unless online ticks happen while app stays foreground).

---

## 4. Is 1–4 minutes ignored entirely?

**Yes**, for the full offline catch-up pipeline:

- `calculateOfflineElapsed` → `below_minimum`
- No `advanceTime(gameHours)`
- No `reconcileDeliveriesWithRealTime` (only called after `shouldApply` is true)
- No transfer/warehouse offline progression from this path

Partial state updates still occur on sub-threshold return:

- `lastSeenRealTimeMs` and `lastSimulatedRealTimeMs` jump to `nowMs`
- Periodic economy cursor may advance via separate `lastProcessedEconomyAt` logic on offline return (periodic economy fix pass)

So **delivery progress and general simulation time** are ignored; **some timestamps** still move forward.

---

## 5. Could short switches make delivery timers feel wrong?

**Yes — this is a live UX risk**, especially with active deliveries:

| Absence | Intended (15s path) | Actual production |
|---------|---------------------|-------------------|
| 30s, truck on route | Progress catch-up | **No progress** |
| 2 min, truck on route | Progress catch-up | **No progress** |
| 4 min, idle | No catch-up | No catch-up ✓ |
| 6 min, truck on route | Progress catch-up | Progress catch-up ✓ |

`reconcileDeliveriesWithRealTime` is **only** invoked from `applyOfflineProgressionIfNeeded` after `elapsed.shouldApply`. There is no secondary foreground reconcile. Short backgrounds while a delivery is active can feel “stuck” until the 5-minute gate clears.

---

## 6. Would lowering threshold to 1 minute or 0 create duplicate progression risk?

### Existing guards

| Mechanism | Role |
|-----------|------|
| `shouldSkipDuplicateOfflineApply` | Skips re-apply if `lastOfflineProgressAppliedAt` is within `minMs` of `nowMs` |
| `duplicatePrevented` in `applyOfflineProgress` | Returns `appliedMs: 0` on duplicate window |
| `settlementId` / delivery settlement guards | Prevent double settlement (separate path) |
| `offlineProgressApplying` mutex in `gameStore` | Prevents concurrent offline apply |

`shouldSkipDuplicateOfflineApply` uses the **same** `resolveOfflineProgressMinMs` as the elapsed gate, so lowering the threshold **narrows** the duplicate-suppression window proportionally.

### Risk by threshold

| Threshold | Duplicate risk | Other risk |
|-----------|----------------|------------|
| **5 min (current default path)** | Lowest apply frequency | Frozen short sessions |
| **1 minute** | Low–moderate; guards still apply | More frequent offline runs; aligns with stale audit test but **conflicts** with smoke test expecting 3 min idle = no apply |
| **1 tick (~1s)** | Moderate; rapid foreground/background cycles could hit apply more often | Matches `MIN_OFFLINE_PROGRESS_MS` comment; highest CPU/battery churn on idle flicker |
| **0** | Highest; every foreground could trigger catch-up | Not recommended without stronger debounce |

**Lowering to 1 minute** does not inherently break idempotency if duplicate guards stay aligned, but it **changes product behavior** (3-minute idle pauses would start applying) and **contradicts** `offline-progression-smoke-test.ts`.

**Wiring the 15s active-delivery path** (pass `hasActiveDeliveries` through `applyOfflineProgress`) would **reduce** perceived timer bugs without opening idle 1-minute simulation — likely the lowest-risk fix if product confirms the 5m/15s split.

---

## 7. Are tests stale or implementation stale?

### Both — but for different pieces

| Artifact | Status |
|----------|--------|
| `time-progression-audit-test.ts` 1-minute assertions | **`TEST_STALE`** — updated in `FIX_TEST_SUITE_RESULTS.md` (2026-08-06) to match `MIN_OFFLINE_PROGRESS_MS === GAME_LOOP_TICK_MS`, but that constant is **not** the elapsed gate. Conflicts with smoke/regression tests that expect 3 min idle = no apply. |
| `MIN_OFFLINE_PROGRESS_MS` comment in `offlineProgression.ts` | **`IMPLEMENTATION_STALE`** — documents 1-tick rule not used by `calculateOfflineElapsed`. |
| `applyOfflineProgress` not passing `hasActiveDeliveries` | **`IMPLEMENTATION_STALE`** — 15s active-delivery rule exists in module + tests but not in production path. |
| `DEFAULT_OFFLINE_MIN_MS = 5 min` + regression assertions | **Current shipping intent** for idle offline gate (closest to canonical product rule). |

### Conflicting test evidence

**Smoke test (`offline-progression-smoke-test.ts`):**

```
3 min idle → shouldApply false (below 5 min)
3 min + hasActiveDeliveries → shouldApply true (above 15s)
20s + hasActiveDeliveries → shouldApply true
```

**Audit test (`time-progression-audit-test.ts`):**

```
1 min idle → shouldApply true  ← FAILS today
assert MIN_OFFLINE_PROGRESS_MS === GAME_LOOP_TICK_MS  ← passes but irrelevant to gate
```

**Regression test (`offline-delivery-progress-regression-test.ts`):**

```
resolveOfflineProgressMinMs(false) === 5 * 60_000  ← explicit canonical assert
45s + hasActiveDeliveries → shouldApply true
```

---

## gameStore offline path (audited)

```
applyOfflineProgressionIfNeeded
  → hasActiveDeliveries computed (unused for threshold)
  → applyOfflineProgress (no hasActiveDeliveries passed)
  → calculateOfflineElapsed → minMs = 5 min (default)
  → if !shouldApply: update timestamps, return (no simulation)
  → if shouldApply: advanceTime + reconcileDeliveriesWithRealTime + periodic costs...
```

When `shouldApply` is false, player still gets timestamp bookkeeping but **no delivery reconciliation**.

---

## Answers to audit questions (checklist)

1. **Why 5 minutes?** Introduced in `bbb56b0` as idle offline gate while adding real-time delivery catch-up; paired with 15s gate for active deliveries.
2. **What kind of rule?** Primarily **product rule** with anti-noise and performance secondary effects.
3. **User-visible effect?** Idle returns &lt; 5 min: no offline simulation. Active deliveries: also frozen &lt; 5 min in production (wiring gap).
4. **1–4 minutes ignored?** Yes for simulation/delivery catch-up; timestamps still updated.
5. **Delivery timers feel wrong?** Yes, for 1–4 min backgrounds with trucks on route.
6. **Duplicate risk if lowered?** Manageable with existing duplicate guards; 1 min conflicts with smoke tests; 0 not recommended.
7. **Tests vs implementation?** **Both stale in different places**; no single winner without a product decision.

---

## Recommended decision axes (for follow-up — not executed here)

| Option | Aligns with | Tradeoff |
|--------|-------------|----------|
| **A. Keep 5m idle / wire 15s active** | `deliveryOfflineProgress.ts`, smoke + regression tests | Fix `applyOfflineProgress` + `gameStore` wiring; update audit test 1-min → 5-min or mark idle scenario |
| **B. Lower idle to 1 tick (~1s)** | `MIN_OFFLINE_PROGRESS_MS` comment, audit test | Update smoke/regression; more offline churn on quick switches |
| **C. Lower idle to 1 minute** | Partial audit test intent | Conflicts with 3-min smoke assertion; awkward middle ground |
| **D. Keep 5m everywhere** | Current production behavior | Document 15s intent as abandoned; fix active-delivery stall by wiring 15s or accepting 5m |

---

## Related files

| File | Relevance |
|------|-----------|
| `src/simulation/deliveryOfflineProgress.ts` | Canonical constants + delivery reconcile |
| `src/simulation/offlineProgression.ts` | `calculateOfflineElapsed`, `applyOfflineProgress`, stale `MIN_OFFLINE_PROGRESS_MS` |
| `src/store/gameStore.ts` | `applyOfflineProgressionIfNeeded` — threshold wiring gap |
| `scripts/time-progression-audit-test.ts` | 3 failing 1-minute assertions |
| `scripts/offline-progression-smoke-test.ts` | Asserts 5m idle / 15s active split |
| `scripts/offline-delivery-progress-regression-test.ts` | Asserts 5m default + 45s active |
| `docs/release-audit/FIX_TEST_SUITE_RESULTS.md` | Records audit test change to 1-minute expectation (test-only, not product) |

---

## Binary / deploy

Not applicable — audit only.

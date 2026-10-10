# Map V2 — Canonical daily opex / staff state authority (Step 29S)

**Status:** `CANONICAL_DAILY_OPEX_STAFF_STATE_AUTHORITY_PASS_INTERNAL_CLOCK_ONLY`

**Readiness:** `DAILY_OPEX_INTERNAL_CLOCK_ONLY_LEGACY_STATE_BLOCKED`

HUD overlay/listener **off**. `cashAuthorityVersion` **0**. Public `processDailyOperatingCosts` **unwired** from the INTERNAL callable. Coverage remains **24 / 0 / 24**.

Gate: `CANONICAL_DAILY_OPEX=INTERNAL_TEST` (missing = OFF).

---

## 1. Live daily opex audit

| COMPONENT | FORMULA | STATE SOURCE | WHEN CHARGED | UNIT | ROUNDING | OFFLINE | MAX CATCH-UP | LEDGER | SERVER STATE | CANONICAL |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Driver salaries | Σ `dailySalary \|\| salaryPerDay \|\| 120` for **all save drivers** | save roster | online 24h tick | **real 24h**, not game day | integer sum | **0** | online 1 / offline 0 | `driver_salary` inside summarized `daily_operating_cost` | INTERNAL `canonicalDrivers` hired only | INTERNAL |
| Warehouse | `Math.round(rent+elec+staff)` per warehouse (or stored `dailyOperatingCost`) | save warehouses | same | real 24h | per-warehouse round then sum | 0 | 1 / 0 | `warehouse_rent` | none | **BLOCKED** |
| Operations | `80 + ownedTrucks×25 + drivers×15` | save trucks + drivers | same | real 24h | integer | 0 | 1 / 0 | `operations` | INTERNAL fleet + hired count | INTERNAL subset |
| Lease recurring | `chargedTruckLeaseTotal = 0` | prepaid at `leaseTruck` | never in daily opex | n/a | n/a | n/a | n/a | `truck_lease` at start only | canonical lease `recurringCost` metadata | **0** (no double-charge) |
| Insurance / other staff | none | — | — | — | — | — | — | — | — | `NOT_PRESENT` |
| Delivery maintenance | completion, not opex | — | — | — | — | — | — | — | — | excluded |

Charge path: `advanceTime` (online) → `buildPeriodicCostDeductions` (`getEconomyNow()`, `PERIOD_24H_MS`) → `processDailyOperatingCosts({ days: periodsCharged })` → one `mandatory-expense`. Comment in store: **not** accelerated game-day.

Period key: `p24_${floor(periodStartMs / DAY_MS)}`.

## 2–6. Clock

Production cadence is **real 24-hour economy periods** (`DAY_MS`), using `LocalEconomyClock` (monotonic device fallback), **not** `currentTime` game hours.

Canonical model: **MODEL C** `INTERNAL_TEST_FIXED_SPEED_OPEX_CLOCK`. Server `Date.now()` / injected `nowMs`. Policy `canonical-daily-opex-internal-fixed-v1`. **Not** production `LocalEconomyClock` / gameSpeed parity.

## 7–10. Opex state / period / catch-up

`users/{uid}/canonicalOpexState/current`: schema, policy, epochMs, lastSettledPeriodIndex (−1 until first charge), lastSettledAtMs, authorityMode.

Period id: `p24_{periodIndex}` (0-based from epoch). Txn: `opex:p24_{n}:daily`.

Catch-up: first call **initializes cursor at now, charges 0** (matches missing `lastProcessedEconomyAt`). Each later call charges **at most 1** due period (`ONLINE_TICK_MAX_COST_PERIODS`). Extra elapsed periods remain due for later calls. Public offline catch-up remains **0**.

## 11–16. Drivers / leases

Hired canonical drivers at settlement time: full `salaryPerDay`. **No prorate** (production uses current roster). Fired (`status !== hired`) excluded. Legacy save drivers excluded (`LEGACY_DRIVER_UNVERIFIED`).

Hire/fire vs opex: transaction isolation; whoever commits first determines roster. `firedAtMs` recorded on fire. Inclusion is status-at-settle, not mid-period fraction.

Lease daily cash: **0**. Prepaid at lease start. Recurring metadata is for later/UI, not a second debit. Expiry still `LEASE_RETURN_BLOCKED_CLIENT_CLOCK`; opex does not use client expiry because recurring is 0.

## 17–20. Warehouse / vehicles / other staff

Warehouse **INTERNAL canonical** via Step 29T (`WAREHOUSE_INTERNAL_CANONICAL`). Production save warehouses remain unverified. INTERNAL receipts include per-site `warehouseExpense`. Overdraft parity still blocked.

Vehicle recurring in opex is the **operations** line (owned canonical trucks), not per-km maintenance.

Other employee roles: `NOT_PRESENT`.

## 21–22. Breakdown / rounding

`driverSalary + leaseExpense(0) + warehouseExpense(0) + vehicleRecurringExpense(0) + operations + other(0)`. Integer add; no extra total round (matches production component sum).

## 23–39. Settlement

Callable `settleCanonicalDailyOpexInternal`. Request: `canonicalSchemaVersion` (+ optional non-authoritative `expectedPeriodIndex`). Rejects elapsed days / totals / cashDelta.

Atomic: derive → mandatory partial debit (`canonical-mandatory-expense-v1`) → `canonicalDailyOpexReceipts/{periodId}` → advance cursor, including when actual debit is 0 at the floor. Retry returns the stored receipt. Cash below -5000 is `CANONICAL_CASH_BELOW_MINIMUM_INTEGRITY_ERROR` and does not settle.

Production mandatory opex partial-pays down to `minCashBalance = -5000`. Step 29V matches that for `CANONICAL_DAILY_OPEX` only. Voluntary purchases stay at floor 0. Clock and legacy state still block HUD. See `MAP_V2_CANONICAL_DAILY_OPEX_OVERDRAFT_POLICY.md`.

Device clock is not authority (`nowMs` is server). One opex cursor per uid. Restart keeps Firestore state.

## 40–46. Offline / HUD

Public signed-in offline opex **unchanged** (0 charge). Canonical opex is **ONLINE_REQUIRED**. HUD still blocked: warehouse + overdraft + remaining cash paths. Counts **24 / 0 / 24**.

## 47–52. Gate / cash / staff

No public UI, no `player.money` / ledger mirror. `serverState.cash` only.

## Next

**STEP 29V — DAILY OPEX OVERDRAFT POLICY** matched production mandatory floor for INTERNAL daily opex. Clock and legacy state remain. Next: local reward claim authority.

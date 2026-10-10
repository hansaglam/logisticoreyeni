# Map V2 — Canonical daily opex overdraft policy (Step 29V)

**Status:** `CANONICAL_DAILY_OPEX_OVERDRAFT_POLICY_PASS_INTERNAL_ONLY`

**Daily-opex readiness:** `DAILY_OPEX_INTERNAL_CLOCK_ONLY_LEGACY_STATE_BLOCKED`

**Policy:** `canonical-mandatory-expense-v1` (`MANDATORY_RECURRING_EXPENSE` on `CANONICAL_DAILY_OPEX` only)

Public `processDailyOperatingCosts` is unchanged. HUD overlay, cash listener, and `cashAuthorityVersion` stay off. This is not production clock parity and not a public HUD path.

## 1–5. Production mandatory expense

Helper: `applyCashTransaction` with `kind: 'mandatory-expense'` in `src/utils/cashPolicy.ts`. Daily opex calls it once on `breakdown.total * chargedDays`.

`financeBalance.minCashBalance` is **-5000**, inclusive.

`maximumDeduction = max(0, cashBefore - minCashBalance)`. `amount = min(requested, maximumDeduction)`. Result is clamped with `normalizeCashBalance`.

| cashBefore | expense | actual debit | cashAfter | unpaid (not stored as debt) |
| --- | --- | --- | --- | --- |
| 10000 | 1000 | 1000 | 9000 | 0 |
| 1000 | 1000 | 1000 | 0 | 0 |
| 0 | 1000 | 1000 | -1000 | 0 |
| 100 | 6000 | 5100 | -5000 | 900 |
| -4000 | 500 | 500 | -4500 | 0 |
| -4000 | 2000 | 1000 | -5000 | 1000 |
| -4999 | 2 | 1 | -5000 | 1 |
| -5000 | 100 | 0 | -5000 | 100 |

Unpaid remainder is **not** a debt ledger. The next day computes a new expense and charges toward the floor again. `financeLedger` records the **paid** amount (`cashTransaction.amount`) and scales the breakdown by `paid / requested`. A zero paid amount writes no ledger row. The day cursor still advances, including at the floor and when the breakdown total is 0.

No reputation change inside `processDailyOperatingCosts`. Driver fire uses `voluntary-expense` and full funds. Fail penalties and completion expenses also use `mandatory-expense`; this step does **not** give them the canonical floor.

Production normalizes cash already below -5000 up to the floor. Canonical server cash below -5000 is `CANONICAL_CASH_BELOW_MINIMUM_INTEGRITY_ERROR` and does not settle the period.

## 6–14. Canonical policy

Voluntary purchases (`VOLUNTARY_PURCHASE`) and signed settlements (`SIGNED_DELTA_FLOOR_ZERO`, including ROAD shadow) keep floor **0**.

Only `CANONICAL_DAILY_OPEX` uses `MANDATORY_RECURRING_EXPENSE`. Unknown operation types fail closed. The client cannot send `allowOverdraft`, `minCashBalance`, `actualDebit`, or a partial amount.

`rejectDebitAgainstPolicy` in the cash helper enforces the floor from the operation type. Daily opex computes the production partial debit first and writes a cash transaction only for `actualDebit > 0`. At the floor, the period receipt is written with an empty `cashTransactionIds` and the cursor advances. No zero-delta cash transaction.

Receipt fields added (schema version stays 1): `requestedDebit`, `actualDebit`, `unpaidExpense`, `minCashBalance`, `cashPolicyVersion`, `cashPolicyClass`. `totalExpense` remains the derived request. Cash transaction `amountDelta` is `-actualDebit`. Old receipts are returned as stored and are not rewritten.

## 15–20. Retry, credits, coverage

Retry of a settled period returns the stored receipt and does not debit again. One period per call. A later canonical credit from -5000 works. Voluntary fuel, repair, upgrade, warehouse, cargo buy, catalog, hire, and lease start still reject when the debit would pass below 0.

ROAD shadow stays `ROAD_SERVER_SETTLEMENT_BLOCKED_OVERDRAFT_POLICY`.

Clock remains `INTERNAL_TEST_FIXED_SPEED_OPEX_CLOCK`. Legacy drivers, leases, and public warehouses stay unverified. HUD coverage **24 / 0 / 24**. `SAVE_GAME_VERSION` 6.

## Next

**STEP 29W — LOCAL REWARD CLAIM AUTHORITY.** Fuel production progression and the production market tick are larger public-economy rewrites. Reward claims are the next unsigned credit path that still blocks HUD.

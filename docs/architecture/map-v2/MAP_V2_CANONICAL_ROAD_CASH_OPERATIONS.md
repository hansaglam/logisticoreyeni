# Map V2 — Canonical ROAD cash operations (Step 29E)

**Status:** `CANONICAL_ROAD_CASH_OPERATIONS_FOUNDATION_PASS`

This is **not** unified signed-in cash authority. HUD still uses local `player.money`. Overlay and cash listener stay **off**.

Public rollout remains `MULTIMODAL_OFF`. RAIL / SEA / AIR remain `FOUNDATION_ONLY`. `SAVE_GAME_VERSION` remains **6**.

Live policy: `src/domain/canonicalCashOperation.ts`, `src/domain/cashAuthority.ts`.  
Matrix: `docs/architecture/map-v2/ROAD_CASH_CANONICALIZATION_MATRIX.md`.

---

## 1. Why unified authority is still blocked

Signed-in ROAD still mutates save `player.money`. `serverState.cash` is already used by marketplace and some reward claims. Turning on a production HUD listener today would snap ROAD delivery revenue and local purchases back to stale server cash.

Gate: `canUseServerAuthoritativeSettlement()` = **false**, reason `ROAD_ECONOMY_NOT_SERVER_CANONICAL_PRODUCTION_FLEET`.

Dominant ROAD-specific blocker: `ROAD_DELIVERY_SERVER_SETTLEMENT_BLOCKED_MISSING_CANONICAL_DELIVERY`.

## 2. Existing serverState cash systems (reused, not duplicated)

| System | Callable / txn | Cash fields |
| --- | --- | --- |
| Marketplace purchase | `purchaseVehicleListing` | `marketplaceState.canonicalCash` + `serverState.cash` |
| Listing fee | `createVehicleListing` | same |
| Weekly missions | `claimWeeklyMissionRewardTransaction` | same |
| Season rewards | `claimSeasonRewardTransaction` | same |
| Challenges | `claimChallengeRewardTransaction` | same |
| Bootstrap | `migrateLegacyServerStateTransaction` | bounded `serverState.cash` init |

These remain the production server cash writers. Step 29E adds a **narrow internal helper** for future operation handlers. Marketplace/rewards were **not** rewritten onto the helper in this step (avoid dual-cash and production risk).

## 3. Why arbitrary delta endpoints are forbidden

A client `applyCashDelta({ delta })` is not authority. The server must see a **real game action** and derive money. There is no `updateMoney`, `setCash`, or generic `applyCanonicalCashTransaction` callable.

## 4. Canonical transaction namespace

`users/{uid}/canonicalCashTransactions/{transactionId}`

Client write: **deny**. Client read: owner only (future ledger mirror). Not HUD authority.

## 5. Idempotency

Firestore transaction: create receipt + update `serverState.cash` together.

- Same id + same operation + same amount → `alreadyApplied` receipt, no second movement.
- Same id + conflicting payload → `CANONICAL_CASH_TRANSACTION_CONFLICT` (never overwrite).

## 6. Server transaction helper

`backend/src/canonicalCashTransaction.ts`

- `applyCanonicalCashMutationInTransaction` / `runCanonicalCashMutation`
- **Internal only.** Not exported from `backend/src/index.ts`.
- Allowed operation types: `INTERNAL_TEST_CREDIT`, `INTERNAL_TEST_DEBIT`, `ROAD_DELIVERY_SETTLEMENT` (settlement handler only).
- Fuel / truck catalog / multimodal types are rejected (`INVALID_OPERATION`).

Auth: helper requires `uid` from the trusted caller (Functions `request.auth.uid` in a future callable). Empty uid → `UNAUTHENTICATED`. No client-supplied uid as authority.

## 7. Candidate ROAD operations

Evaluated: delivery settlement, fuel purchase, catalog truck purchase (credit + small debit + large debit).

None of the three is production-callable in 29E because the server cannot independently validate them without weakening rules.

## 8. What can migrate now

Already canonical (do not duplicate):

- Marketplace purchase / listing fee / marketplace-scoped reconcile
- Weekly / season / challenge **server** claims
- Legacy `serverState` bootstrap (not a gameplay delta API)

Catalog truck/trailer purchase: `CANONICAL_READY_WITH_SMALL_SERVER_PORT` (port catalog + prices). **Not implemented** — calling it while HUD is local would create dual-cash UX.

## 9. What is blocked

See matrix. Highlights: ROAD delivery family, fuel, staff, warehouses, cargo market, client rewards/ads, daily opex, guest multimodal local settle, debug/test money.

## 10. Canonical ROAD delivery requirement

`completeDeliveryById` uses `calculateDeliverySettlement` from **local** contract payment, `delivery.fuelCost`, `delivery.maintenanceCost`, lateness penalties, fragile condition extras.

`canonicalDeliveryCompletions` only stores delivery **count** proof. **Do not** repurpose it as financial authority.

Reserved (not implemented): `users/{uid}/canonicalRoadDeliveries/{deliveryId}` for an accepted execution snapshot (payment, deadline, costs, status). Until that exists:

`ROAD_DELIVERY_SERVER_SETTLEMENT_BLOCKED_MISSING_CANONICAL_DELIVERY`

Do not trust client final payment.

## 11. Fuel authority

Live tank and `quote.unitPrice` are client. `serverState.ownedTrucks.currentFuelL` exists for marketplace fleet snapshots but is **not** ROAD HUD-authoritative. Client could lie about an empty tank. Fuel canonicalization is **blocked**.

## 12. Truck purchase authority

Marketplace listing purchase is already server-canonical — reuse it.

Catalog `buyTruck` uses client catalog prices and `Date.now` instance ids. Server could port the catalog (`CANONICAL_READY_WITH_SMALL_SERVER_PORT`) but 29E does **not** add a debit callable (HUD still local).

## 13. Offline implications

ROAD offline completion, progress, and local `applyCashTransaction` (including `minCashBalance` **-5000** overdraft on **local** save cash) stay as they are.

Server helper floor is **0**, matching marketplace/`serverState.cash` (no invented overdraft on server cash). Documented difference; not a HUD change.

## 14. Client ledger mirror

`financeLedger` is not authority. Future: server receipt → deterministic ledger row using the same transaction ids. 29E tests do **not** overlay receipt cash onto the HUD.

## 15. HUD authority unchanged

`AUTHORITATIVE_CASH_OVERLAY_ENABLED = false`  
`AUTHORITATIVE_CASH_LISTENER_ENABLED = false`

## 16. Guest behavior

Guest ROAD economy and guest multimodal local settlement unchanged. No server calls required.

## 17. Migration matrix

`docs/architecture/map-v2/ROAD_CASH_CANONICALIZATION_MATRIX.md`

## 18. Next authority step

**STEP 29F — CANONICAL ROAD DELIVERY ECONOMY** (canonical acceptance/execution snapshot, then server-derived settlement). Do **not** enable overlay until ROAD credits **and** the main debit families used in live play are server-canonical.

Purchase/expense port (catalog truck, then fuel) is 29F-alternative only if delivery snapshot is deferred; delivery remains the HUD snap-back risk.

---

## Transaction schema (minimal)

- `transactionId`, `operationType`, `sourceId`, `amountDelta`, `currency` (`USD_GAME_INTEGER`)
- `createdAt`, `ownerUid`, `cashBefore`, `cashAfter`
- `cashAuthorityVersion` = **1** (transaction schema)
- `accountCashAuthorityMigrationVersion` = **0** (account **not** migrated)
- small `metadata` map (capped)

## Receipt

`transactionId`, `operationType`, `cashBefore`, `cashDelta`, `cashAfter`, `currency`, `applied`, `alreadyApplied`, `createdAt`

## Internal test harness

- `backend/test/canonicalCashTransaction.unit.test.ts`
- `scripts/map-v2-canonical-road-cash-operations-regression-test.ts`

Not wired to production UI. Not on a main tab. Does not use `testMoneySyncService` / profile money.

## Money safety

Finite `cashBefore`; safe-integer **delta**; finite `cashAfter`; debit `cashAfter >= 0` on server cash. Reject NaN / Infinity / fractional deltas.

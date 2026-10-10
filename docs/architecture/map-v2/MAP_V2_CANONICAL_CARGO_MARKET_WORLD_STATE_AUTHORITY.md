# Map V2 — Canonical cargo market / world-state authority (Step 29U)

**Status:** `CANONICAL_CARGO_MARKET_WORLD_STATE_AUTHORITY_PASS_INTERNAL_POLICY_ONLY`

**Readiness:** `CARGO_MARKET_INTERNAL_TEST_CANONICAL_PUBLIC_UNWIRED`

**Authority model:** MODEL C — INTERNAL_TEST fixed snapshots (`canonical-cargo-market-internal-v1`)

**Gate:** `CANONICAL_CARGO_MARKET_AUTHORITY=INTERNAL_TEST` (missing = OFF)

This pass establishes server-owned city/product stock + price snapshots, warehouse-bound canonical inventory, and atomic INTERNAL buy/sell. Production `buyProductForWarehouse` / `sellProductFromWarehouse` and MapScreen market UX stay local. HUD overlay/listener remain off. `cashAuthorityVersion` remains 0.

---

## 1. Live cargo market architecture

Production trade is city + warehouse bound (`buyProductForWarehouse` / `sellProductFromWarehouse` in `gameStore`).

| FIELD / OPERATION | CURRENT FUNCTION | STATE SOURCE | PRICE FORMULA | STOCK FORMULA | MUTATION | CASH EFFECT | WAREHOUSE EFFECT | CLOCK/TICK | SERVER STATE? | CANONICALIZATION |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| City product price | `toProductMarket` + `getEffectiveTradeUnitPrice` | save `city.products` | start `currentPrice` / events overlay | n/a | local tick | none | none | `marketPriceTick` local | no | INTERNAL snapshot only |
| City product stock | city product `stock` | save | n/a | start stock then tick | buy − / sell + | none | occupancy tons | same | no | INTERNAL snapshot |
| Buy | `buyProductForWarehouse` | client save | buy = unit × qty × (1+3%) | must ≤ market stock | decrement stock, add inventory | debit `player.money` | occupancy += qty tons | none at trade | no public | INTERNAL `buyCanonicalCargo` |
| Sell | `sellProductFromWarehouse` | client save | quality 100 → unit; fee 3% | stock += qty | decrement inventory | credit | occupancy − | none at trade | no public | INTERNAL `sellCanonicalCargo` |
| Inventory | warehouse `inventory[].quantity` | save | n/a | sum tons | mutate rows | none | capacity gate | none | no | `canonicalCargoInventory` |
| Capacity | `capacityTons` | save warehouse | n/a | occupied = Σ quantity (tons, not `weightPerUnit`) | reject overfill | none | hard fail | none | 29T INTERNAL warehouse | 29T + 29U |
| Storage compat | `evaluateStorageSuitability` | product registry | n/a | n/a | fruit/beverage cold-only | none | blocked types | none | product catalog | enforced INTERNAL |
| Tick | `runEconomyTick` → `refreshMarketSnapshot` | server `globalEconomy/current` | epoch snapshot | epoch supply regenerated; tradable stock is trade-owned | snapshot replace | none | none | 30-minute server epoch | INTERNAL when stamped | `PRODUCTION_MARKET_TICK_AUTHORITY_PASS_INTERNAL_ONLY` |
| World events | `buildGlobalEventsForEpoch` | epoch + config | demand × 1.08 or fuel × 1.12 | none on tradable stock | pure schedule | none | none | same epoch | INTERNAL epoch schedule | `WORLD_EVENT_PRICE_AUTHORITY_INTERNAL_EPOCH_SCHEDULE` |
| Global economy | fuel/world | mixed | fuel path separate | n/a | — | — | — | — | fuel INTERNAL elsewhere | **not** in cargo INTERNAL price |

Public complete-fail (no partial fill) on insufficient cash, stock, or capacity. Quantity 5–50. Production allows non-integer qty; INTERNAL requires integer.

## 2. Product registry

Authoritative: `PRODUCTS` / `PRODUCT_BY_ID` / `PRODUCT_IDS` in `src/data/products.ts`.

IDs: `fruit`, `steel`, `electronics`, `machinery`, `textile`, `furniture`, `beverage`.

Weights (`weightPerUnit`) exist for display/simulation; **warehouse occupancy uses inventory quantity in tons**, matching production.

Cold-only (allowed `cold`): fruit, beverage. Others per `storageRequirement.allowedWarehouseTypes`.

Unknown `productId`: reject.

## 3. City registry

`CITIES` / `CITIES_BY_ID` (8 production cities). Unknown `cityId`: reject.

## 4–5. Dynamic vs static

**STATIC:** product catalog, 8 cities, buy/sell fees 3%, min/max qty 5/50, storage rules, occupancy = tons.

**DYNAMIC (production):** tick, world events, live surplus/shortage. **Not** INTERNAL authority.

## 6. Canonical authority model

MODEL C. MODEL D (client upload) forbidden.

Do **not** claim production tick/event/contract-issuance parity.

## 7–10. Policy, path, schema

Policy: `canonical-cargo-market-internal-v1`. Unknown: fail closed.

World: `canonicalWorldMarkets/{cityId}_{productId}` (client write false; signed-in read ok).

Records: `schemaVersion`, `cityId`, `productId`, `stock` (rounded start), `basePrice`, `currentPrice` (rounded `toProductMarket` at bootstrap), `supplyIndex` = `productionPerDay`, `demandIndex` = `consumptionPerDay`, `marketRevision`, `policyVersion`, `lastUpdatedAtMs`, `authorityMode` = `INTERNAL_TEST_FIXED_MARKET_SNAPSHOT`.

Bootstrap: `bootstrapInternalCanonicalCargoMarket`. Server writes 8×7 docs. Idempotent match; conflict otherwise. **No** `importMarketFromSave`.

## 11–13. Price, rounding, spread

INTERNAL unit price = snapshot `currentPrice` (frozen at bootstrap from start city markets).

Buy total: `Math.round(calculateTradeBuyCost(unit, qty))` = round(unit × qty × 1.03).

Sell total (quality 100): `Math.round(calculateTradeSellRevenue(unit, qty, 100))` = round(unit × qty × 0.97).

Production cash is float-capable; INTERNAL cash is integer via `Math.round`. Spread is the 3% buy fee vs 3% sell fee — not a rounding bug.

Quote is advisory. Transaction re-reads snapshot. Stale quote cannot lock price.

## 14–17. Stock, revision, tick

Buy: stock − qty (no negative). Sell: stock +. Cap: production start snapshot (no extra INTERNAL cap). `marketRevision` increments per mutating trade.

Tick: server epoch for rows stamped `canonical-production-market-tick-internal-v1`. Unstamped 29U rows stay fixed. Classification: `PRODUCTION_MARKET_TICK_AUTHORITY_PASS_INTERNAL_ONLY`. Public UI stays local. See `MAP_V2_PRODUCTION_MARKET_TICK_AUTHORITY.md`.

## 18–19. Global economy / events

Unstamped INTERNAL rows keep bootstrap prices. Stamped rows take the epoch snapshot, including demand-boom multipliers. `WORLD_EVENT_PRICE_AUTHORITY_INTERNAL_EPOCH_SCHEDULE`.

## 20–23. Canonical inventory

Path: `users/{uid}/canonicalCargoInventory/{warehouseId}__{productId}`.

Warehouse-bound (matches production). Starts empty except INTERNAL buy. `LEGACY_CARGO_INVENTORY_UNVERIFIED`. No `registerMyInventory`.

Fields: warehouseId, productId, quantity, inventoryRevision, ownerUid, updatedAtMs, authorityMode.

## 24–27. Capacity and storage

Uses Step 29T `capacityTons`. Occupied = Σ canonical inventory `quantity` for that warehouse. Server-derived. Player must send `warehouseId`; server checks ownership, city match, type compatibility. Fruit into standard → `INCOMPATIBLE_WAREHOUSE`. Ports/airports not activated for SEA/AIR ops.

Opex: warehouse operating cost is inventory-independent (29T). Cargo qty must not change opex.

## 29–48. Buy/sell, receipts, concurrency

**Buy request:** `cityId`, `productId`, `quantity`, `warehouseId`, `purchaseIntentId`, `canonicalSchemaVersion`. Reject price/stock/supply/demand/inventory/capacity/cashDelta/money/payment/amount.

ID: `cargo:{cityId}:{productId}:buy:{intentId}`. Receipt: `users/{uid}/canonicalCargoMarketReceipts/{intentId}`.

Same intent: replay receipt, no second mutation. Conflict: `CANONICAL_CARGO_MARKET_OPERATION_CONFLICT`.

One Firestore txn: market + inventory + `serverState.cash` + cash txn + receipt.

Sell analog: `saleIntentId`, credit `CANONICAL_CARGO_SELL`, ID `…:sell:…`.

NSF / insufficient stock / capacity / inventory: complete no-op (no partial). Sequential transactions re-read stock (lost-update safe in-memory). Two buyers of last N units: one succeeds.

## 50–51. ROAD contract issuance

Canonical INTERNAL rows can expose epoch price, epoch supply, and tradable stock after Step 29Z. `CANONICAL_ROAD_CONTRACT_WORLD_STATE` = `ROAD_CONTRACT_MARKET_STATE_INTERNAL_ONLY`. `generateContracts` is not wired to that state.

## 52–54. Opex / coverage

Daily opex mandatory floor is INTERNAL parity (`canonical-mandatory-expense-v1`). Clock and legacy state still block HUD. Coverage **24 / 0 / 24**.

`CARGO_MARKET_NOT_CANONICAL` remains a unified-settlement diagnostic (public market still local).

## 55–60. Gate / rules / cash

Rules: `canonicalWorldMarkets`, `canonicalCargoInventory`, `canonicalCargoMarketReceipts` client write false.

Cash: `serverState.cash` + `canonicalCashTransactions` only. Not `users/{uid}.money`, save/local `player.money`, `financeLedger`.

## Remaining

- Production tick authority
- World-event price parity
- Legacy inventory migration (do not auto-import)
- Public UI wiring
- Contract issuance world-state parity
- HUD / cash listener
- Daily opex overdraft
- Local reward claim
- Fuel production progressive
- Production incident / ROAD settlement
- Multimodal settlement; public RAIL/SEA/AIR

## Next

Recommended **STEP 29V — LOCAL REWARD CLAIM AUTHORITY** or **STEP 29V — DAILY OPEX OVERDRAFT POLICY** (cargo public/HUD still blocked; market tick is a large production rewrite). Choose overdraft if finishing opex HUD parity; rewards if treating market tick as a later production step.

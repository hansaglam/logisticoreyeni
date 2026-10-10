# Map V2 — Canonical warehouse state authority (Step 29T)

**Status:** `CANONICAL_WAREHOUSE_STATE_AUTHORITY_PASS_INTERNAL_ONLY`

**Warehouse readiness:** `WAREHOUSE_INTERNAL_CANONICAL_ONLY`

**Daily opex after 29V:** `DAILY_OPEX_INTERNAL_CLOCK_ONLY_LEGACY_STATE_BLOCKED`

HUD overlay/listener **off**. `cashAuthorityVersion` **0**. Public `openWarehouse` / `upgradeWarehouse` **unwired**. Coverage remains **24 / 0 / 24**.

Gate: `CANONICAL_WAREHOUSE_AUTHORITY=INTERNAL_TEST` (missing = OFF).

---

## 1. Live warehouse model

Production `Warehouse`: `id`, `cityId`, `capacityTons`/`capacityTon`, `upgradeTier` (1–3), `warehouseType`, `inventory`, `usedCapacityTon`, `openCost`, `dailyOperatingCost`, `qualityProtection`.

**A. Economic state** (this step): city, type, level, capacity, open/upgrade cash, recurring opex.  
**B. Cargo inventory** (not this step): `inventory` / market buy-sell.

Close/sell-warehouse-building: **`NOT_PRESENT`**. UI “sell” is cargo sale from a warehouse.

## 2. Warehouse types

Type union: `standard | cold | secure | heavy | port | airport`.

**Openable in production:** `standard` and `cold` only. Others: “Bu depo tipi henüz kullanılamıyor.” Schema keeps port/airport for future SEA/AIR storage class; INTERNAL open **rejects** them (`UNSUPPORTED_WAREHOUSE_TYPE`). No transport operations.

Cold: open cost × `1.6`; electricity × `2.5`.

## 3. City authority

`CITIES_BY_ID` only (`izmir`, `istanbul`, `ankara`, `bursa`, `antalya`, `adana`, `trabzon`, `diyarbakir`). Arbitrary city IDs fail `UNKNOWN_CITY`. Cost uses `warehouseCostModifier` from that registry.

## 4–6. Ownership / path / schema

One warehouse **per city + type** (standard and cold may coexist in the same city).

Path: `users/{uid}/canonicalWarehouses/{warehouseId}` with `warehouseId = wh_{cityId}_{type}`.

Fields: schemaVersion, warehouseId, ownerUid, cityId, warehouseType, level, capacityTons, economicRevision, warehousePolicyVersion, authorityClass `INTERNAL_TEST_FIXTURE`, createdAtMs, updatedAtMs. Client write **false**.

## 7–9. Authority classes / legacy

`SERVER_CANONICAL | INTERNAL_TEST_FIXTURE | LEGACY_CLIENT_UNVERIFIED | UNSUPPORTED`.

Live INTERNAL docs: `INTERNAL_TEST_FIXTURE`. Save warehouses: **`LEGACY_CLIENT_UNVERIFIED`**. **`NO_AUTOMATIC_LEGACY_WAREHOUSE_MIGRATION`**. No `registerMyWarehouse`.

## 8–15. Open

Eligibility (INTERNAL): registry city; type standard/cold; not duplicate city+type; city unlocked and slot available under **frozen** `CANONICAL_WAREHOUSE_INTERNAL_COMPANY_LEVEL = 10` (not `player.level`).

Formula: `Math.round(8000 * cityModifier * (cold ? 1.6 : 1))`. Initial level **1**, capacity **80**.

Policy: `canonical-warehouse-open-v1`. Request: `cityId`, `warehouseType`, `openIntentId`, `canonicalSchemaVersion`. Rejects price/level/capacity/opex/cashDelta.

Cash: `CANONICAL_WAREHOUSE_OPEN`, txn `warehouse:{cityId}:{type}:open`. Receipt `canonicalWarehouseReceipts/{openIntentId}`. Atomic with warehouse create. Retry same intent: existing receipt. Different intent, same city+type: `DUPLICATE_WAREHOUSE`. Voluntary expense: money ≥ cost; floor 0 matches production `canAffordVoluntaryPurchase`. Insufficient: no warehouse, no receipt.

## 16–20. Upgrade / revision / capacity

Max tier **3**. 1→2: +40 t, requires company level 5 (INTERNAL 10). 2→3: +60 t, requires level 8. Cost: `Math.round(8000 * 0.5 * cityModifier)` (not type-dependent).

Policy: `canonical-warehouse-upgrade-v1`. Request: `warehouseId`, `upgradeIntentId`, `canonicalSchemaVersion`. Server next level only. Txn `warehouse:{warehouseId}:upgrade:{nextLevel}`. Revision 1 at open, +1 per upgrade. City immutable.

## 21–23. Operating cost / opex / rounding

**Does not depend on inventory.** `Math.round(rent + electricity + staff)` per site:

- rent = capacity × 1.8 × cityModifier  
- electricity = capacity × 0.25 × (cold ? 2.5 : 1) × cityModifier  
- staff = 140 × tier  

Then **sum** of per-site totals (same as production `calculateWarehouseDailyOperatingCost` when stored daily cost is the computed snapshot). Canonical opex **recomputes** from capacity/tier/type/city (does not trust a client stored `dailyOperatingCost`).

Receipt `componentBreakdown.warehouseSites[]`: warehouseId, cityId, type, level, economicRevision, operatingExpense.

## 24–25. Daily opex / new account

INTERNAL opex enumerates **canonical** warehouses only. Legacy save warehouses excluded. New canonical account can open warehouse then settle opex with warehouseExpense > 0. Production HUD opex still local.

## 26–27. Cargo / port-airport

Inventory **not** required for opex parity (`WAREHOUSE_INVENTORY_SEPARATE_NOT_REQUIRED_FOR_OPEX`). Cargo market remains a later step. Port/airport types reserved, not openable.

## 32. Company level

Production gates city unlock, max warehouse count, and upgrade tiers on save `player.level`. **Not server-owned** → `WAREHOUSE_COMPANY_LEVEL_UNVERIFIED` for public. INTERNAL uses frozen level 10.

## 35–36. Overdraft

Open/upgrade: voluntary, floor 0. Daily opex may reach `minCashBalance = -5000` via Step 29V. Warehouse open/upgrade do not.

## 41–49. Migration / UI / coverage

Public UI local. `serverState.cash` only. Overlay/listener off. Warehouse rows INTERNAL `CANONICAL_READY_WITH_SMALL_PORT` but still **BLOCKS_HUD**. Counts **24 / 0 / 24**.

## Next

Step **29U** completed INTERNAL cargo market snapshots + inventory. Warehouse occupancy for INTERNAL buy uses canonical inventory tons against this capacity. Public warehouse UI unchanged. Next after 29U: local reward claim authority, daily-opex overdraft, or production market tick — see cargo-market doc.

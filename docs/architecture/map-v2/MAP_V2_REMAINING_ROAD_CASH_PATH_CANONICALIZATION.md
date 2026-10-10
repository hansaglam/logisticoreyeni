# Map V2 — Remaining ROAD cash path canonicalization (Step 29P)

**Status:** `REMAINING_ROAD_CASH_PATH_CANONICALIZATION_PASS_FOUNDATION`  
**Signed-in HUD readiness:** `SIGNED_IN_CASH_AUTHORITY_BLOCKED_MULTIPLE_PATHS`

This step classifies every production cash write from `PRODUCTION_CASH_WRITE_AUDIT` / `ROAD_CASH_CANONICALIZATION_MATRIX` and canonicalizes **only** INTERNAL_TEST catalog truck/trailer purchase against `serverState.cash`. It does **not** enable HUD overlay, production cash listener, `cashAuthorityVersion=1`, production ROAD settlement, incident production parity, or multimodal settlement.

Live coverage: `src/domain/signedInCashAuthorityCoverage.ts` → `getSignedInCashAuthorityCoverage()`.  
Catalog purchase: `purchaseCanonicalCatalogAsset` (gate `CANONICAL_CATALOG_PURCHASE=INTERNAL_TEST`). Public `buyTruck` / `buyTrailer` remain local.

---

## 1. Remaining cash paths

Every `PRODUCTION_CASH_WRITE_AUDIT` id has an exact authority status (no `UNKNOWN`). See `SIGNED_IN_CASH_AUTHORITY_READINESS_MATRIX.md`.

## 2. Blocking vs non-blocking

**BLOCKS_HUD_AUTHORITY** (must be canonical or retired before `cashAuthorityVersion=1`): production ROAD settlement family, fuel, catalog buy (public still local), lease, hire/fire, sale, repair/upgrade (public), warehouses, cargo market, recovery, incident cash (production), local rewards/ads, marketplace HUD reconcile overlay.

**CAN_REMAIN_LEGACY_LOCAL_ONLY:** guest RAIL settle, debug cash, TEST_MONEY_SYNC, cloud-save blob (future cache), `users/{uid}.money`, marketplace/server claims (already server), legacy serverState bootstrap.

## 3. Fuel

`FUEL_CASH_AUTHORITY_INTERNAL_TEST_PROGRESSIVE_PUBLIC_BLOCKED`. INTERNAL purchase remains. Progressive burn is a separate INTERNAL gate and does not move cash. Public `refuelTruck` still local.

## 4–5. Catalog truck / trailer

INTERNAL_TEST `purchaseCanonicalCatalogAsset`:

- Request: `catalogModelId`, `purchaseId`, `assetType`, `canonicalSchemaVersion` only.
- Server derives model, integer catalog `purchasePrice`, initial condition/upgrades from catalog mint.
- Atomically: debit `serverState.cash`, `canonicalCashTransactions` (`CANONICAL_CATALOG_PURCHASE`), `canonicalFleetAssets`, immutable `canonicalPurchaseReceipts`.
- Transaction id: `fleet:{assetId}:purchase:{purchaseId}`.
- Public buttons **not** wired (would dual-debit HUD `player.money`).

## 6. Vehicle sale

`VEHICLE_SALE_INTERNAL_TEST_CANONICAL_PUBLIC_UNWIRED`. INTERNAL `sellCanonicalFleetAsset` uses canonical condition, `mileageKm`, upgrades. Public `sellTruck` still local. HUD still blocked.

## 7. Recovery

`VEHICLE_RECOVERY_BLOCKED_CLIENT_EXECUTION_STATE` unchanged. `recoverCanonicalVehicle` fail-closed.

## 8–9. Driver hire / fire

`DRIVER_HIRE_AUTHORITY_INTERNAL_POLICY_ONLY` / `DRIVER_FIRE_INTERNAL_TEST_CANONICAL_ROSTER`. `DRIVER_POOL` is a static catalog (not client RNG). Company level still save-owned. Public hire/fire local.

## 10–11. Warehouse open / upgrade

`WAREHOUSE_INTERNAL_CANONICAL_ONLY`. INTERNAL `openCanonicalWarehouse` / `upgradeCanonicalWarehouse`. Public `openWarehouse` / `upgradeWarehouse` local. Company level INTERNAL frozen 10 (`WAREHOUSE_COMPANY_LEVEL_UNVERIFIED`). See `MAP_V2_CANONICAL_WAREHOUSE_STATE_AUTHORITY.md`.

## 12–13. Cargo buy / sell

`CARGO_MARKET_INTERNAL_TEST_CANONICAL_PUBLIC_UNWIRED`. INTERNAL `buyCanonicalCargo` / `sellCanonicalCargo` with server market snapshots + canonical inventory. Public buy/sell remain local. Tick/events not production-parity. See `MAP_V2_CANONICAL_CARGO_MARKET_WORLD_STATE_AUTHORITY.md`.

## 14. Daily opex

`DAILY_OPEX_INTERNAL_CLOCK_ONLY_LEGACY_STATE_BLOCKED`. INTERNAL 24h server cursor + canonical salaries/operations/warehouses. Mandatory debit matches production `minCashBalance = -5000` (partial pay, unpaid not a debt). Lease recurring 0. Public offline catch-up still 0. Clock and legacy roster/warehouses still block HUD. See `MAP_V2_CANONICAL_DAILY_OPEX_OVERDRAFT_POLICY.md`.

## 15–17. Rewards / ads / missions

- Ads: `AD_REWARD_AUTHORITY_BLOCKED_VERIFICATION` (no provider attestation).
- Local missions/milestones: client progress.
- Client weekly objectives: distinct from server `weeklyMissionClaims` — do not dual-pay.
- Server weekly/season/challenge claims: already canonical on `serverState.cash`.

## 18. Lease

`LEASE_START_INTERNAL_TEST_CANONICAL_PUBLIC_UNWIRED`. Prepaid INTERNAL `createCanonicalVehicleLease`. Recurring: `LEASE_RECURRING_COST_BELONGS_TO_DAILY_OPEX` (V1 public daily charge is 0). Return: `LEASE_RETURN_BLOCKED_CLIENT_CLOCK`. Public `leaseTruck` local.

## 19. Marketplace

Purchase and listing fee already mutate `serverState.cash`. After a future HUD switch, marketplace cash is already on that field; `applyVehicleMarketplaceReconciliation` must stay **marketplace-scoped** and must not fight ROAD HUD. Listener/overlay still **off**.

## 20. Incident cash

Classified only. INTERNAL_TEST finalize catalog cash exists. Production `resolveDeliveryIncident` remains local. **Not** an incident-system rewrite. Production parity remains `PRODUCTION_INCIDENT_PARITY_BLOCKED_CLIENT_EXECUTION_STATE`.

## 21. Server-state requirements

Do not canonicalize unless server owns enough state. Explicit statuses: `CANONICAL_READY`, `CANONICAL_READY_WITH_SMALL_PORT`, `BLOCKED_SERVER_STATE`, `BLOCKED_WORLD_STATE`, `BLOCKED_VERIFICATION`, `BLOCKED_LEGACY_ASSET`, `LOCAL_ONLY`.

## 22. Offline implications

Public signed-in local flows unchanged. Foundation canonical catalog purchase is `ONLINE_REQUIRED`. Guest unchanged (local, no backend).

## 23. Canonical transaction identities

Deterministic, not timestamp-only. Examples: `fleet:{assetId}:purchase:{purchaseId}`, `fuel:{assetId}:{purchaseIntentId}` (reserved), `delivery:{id}:revenue` (existing local ledger ids).

## 24. Idempotency / atomicity

Catalog purchase: first apply writes receipt+cash+asset; retry returns same receipt; conflict if asset exists without matching receipt. Cash helper remains backend-internal (no arbitrary client delta).

## 25. HUD migration blocker set

See coverage `criticalBlockers`. Unified cash is **not** ready (`criticalBlockedCount > 0`).

## 26. Before `cashAuthorityVersion=1`

Canonicalize (or explicitly retire) every `BLOCKS_HUD_AUTHORITY` path, prove no dual debit, then enable overlay/listener in a later step. Not this step.

## 27. Why multimodal settlement is deferred

Signed-in HUD still uses save `player.money`. `settleCanonicalMultimodalShipment` would credit a different authority than production ROAD. Unified signed-in cash first.

## Stop boundary

No HUD overlay, no production cash listener, no `cashAuthorityVersion=1`, no production `completeDeliveryById` replacement, no public RAIL/SEA/AIR.

**Recommended Step 29Q:** `STEP 29Q — FUEL TANK / PRICE AUTHORITY` (dominant engineering gap among remaining HUD blockers; world-state cargo/opex remain parallel blockers).

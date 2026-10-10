# Map V2 — Canonical non-delivery company XP authority (Step 29AH)

**Status:** `CANONICAL_NON_DELIVERY_COMPANY_XP_AUTHORITY_PASS_PARTIAL`

**Gate:** `CANONICAL_NON_DELIVERY_XP_AUTHORITY=INTERNAL_TEST` (missing or any other value means OFF). XP also needs `CANONICAL_COMPANY_PROGRESSION_AUTHORITY=INTERNAL_TEST` and the gate of the underlying operation.

**Policy:** `canonical-company-non-delivery-xp-v1` (stored in each progression receipt's `xpEvidence.policyVersion`). Cargo cost basis: `canonical-cargo-cost-basis-v1`.

Code: `src/domain/canonicalNonDeliveryCompanyXp.ts`, `backend/src/canonicalNonDeliveryCompanyXp.ts`, plus the purchase, hire, warehouse and cargo transactions. Tests: `backend/test/canonicalNonDeliveryCompanyXp.unit.test.ts`, `scripts/map-v2-canonical-non-delivery-company-xp-authority-regression-test.ts`.

Canonical truck purchase, driver hire, warehouse open and warehouse upgrade now grant exact production XP. Canonical cargo sales grant exact production XP only when the sold units have a trusted server cost basis and the product/warehouse pair has zero quality decay. Other sales record XP 0 with the exact blocking reason, which is why the outcome is `PASS_PARTIAL` and not `PASS_INTERNAL_ONLY`.

## 1. Full XP source audit

Every production call to `addCompanyXp` / `applyXpToPlayer` was traced in `src/store/gameStore.ts`. The table lives in code as `PRODUCTION_NON_DELIVERY_XP_AUDIT`. It has no UNKNOWN rows.

| Source | Production | XP | Canonical operation | Status |
|---|---|---|---|---|
| Truck purchase | `buyTruck` | 30 fixed | `purchaseCanonicalCatalogAsset` (TRUCK) | `TRUCK_PURCHASE_XP_CANONICAL_INTERNAL` |
| Trailer purchase | `buyTrailer` | none | catalog purchase (TRAILER) | `TRAILER_PURCHASE_NO_PRODUCTION_XP` |
| Lease | `leaseTruck` | none | `createCanonicalVehicleLease` | `VEHICLE_LEASE_NO_PRODUCTION_XP` |
| Marketplace purchase | `applyMarketplacePurchaseResult` | none | — | `MARKETPLACE_PURCHASE_NO_PRODUCTION_XP` |
| Vehicle sale | `sellTruck` | none | `sellCanonicalFleetAsset` | `VEHICLE_SALE_NO_PRODUCTION_XP` |
| Driver hire | `hireDriver` | 10 fixed | `hireCanonicalDriver` | `DRIVER_HIRE_XP_CANONICAL_INTERNAL` |
| Driver fire | `fireDriver` | none | `fireCanonicalDriver` | `DRIVER_FIRE_NO_PRODUCTION_XP` |
| Warehouse open | `openWarehouse` | 40 fixed | `openCanonicalWarehouse` | `WAREHOUSE_OPEN_XP_CANONICAL_INTERNAL` |
| Warehouse upgrade | `upgradeWarehouse` | 25 per tier | `upgradeCanonicalWarehouse` | `WAREHOUSE_UPGRADE_XP_CANONICAL_INTERNAL` |
| Cargo buy | `buyProductForWarehouse` | none | `buyCanonicalCargo` (records cost basis) | `CARGO_BUY_NO_PRODUCTION_XP` |
| Cargo sale | `sellProductFromWarehouse` | trade formula | `sellCanonicalCargo` | `CARGO_SALE_XP_CANONICAL_INTERNAL_ZERO_DECAY_ONLY` |
| Vehicle recovery | recovery flow | none (reputation only) | `recoverCanonicalVehicle` (fail-closed) | `VEHICLE_RECOVERY_XP_BLOCKED_RECOVERY_AUTHORITY` |
| Repair / truck upgrade / ad reward | `repairTruck`, `upgradeTruck`, `applyAdReward` | none | — | `*_NO_PRODUCTION_XP` |
| Missions | `claimMissionReward` | `reward.xp` | — | `MISSION_XP_CLIENT_OWNED` |
| Milestones | `claimMilestoneReward` | `reward.xp` | — | `MILESTONE_XP_CLIENT_OWNED` |
| Local weekly objectives | `claimWeeklyObjectiveReward` | `reward.xp` | — | `WEEKLY_OBJECTIVE_XP_CLIENT_OWNED` |
| Server weekly missions | backend catalog rejects `xp` | none | — | `SERVER_WEEKLY_MISSION_NO_XP` |
| Season / challenge / achievement | server catalogs | none | — | `SEASON_CHALLENGE_ACHIEVEMENT_NO_XP` |
| Operation choice | `resolveDeliveryOperationChoice` | `effects.playerXpDelta` (no current option sets it) | — | `OPERATION_CHOICE_XP_CLIENT_OWNED` |
| Debug | `DebugSimulationScreen` +50 / +250 | dev only | — | `DEBUG_XP_DEV_ONLY_NOT_CANONICAL` |
| Delivery completion | `completeDelivery` | `calculateDeliveryXp` | Step 29AF/29AG | `CANONICAL_DELIVERY_XP_INTERNAL_SERVER_DERIVED` |

Vehicle recovery grants no production XP. It is listed because its reputation effect remains client-owned and the canonical recovery transaction is still fail-closed.

## 2. Truck purchase XP

Production `buyTruck` calls `addCompanyXp(levelBalance.xpRewards.truckPurchase)` = `levelConfig.xpRewards.truckPurchase` = **30** after a successful purchase. Canonical catalog purchase with `assetType: 'TRUCK'` applies 30 in the same transaction as the asset mint and cash debit. `TRAILER` purchases apply nothing, because production `buyTrailer` grants no XP. Leases grant nothing (`leaseTruck` has no XP call).

## 3. Driver hire XP

Production `hireDriver` grants `xpRewards.driverHire` = **10**. Canonical `hireCanonicalDriver` applies 10 after the driver doc, receipt and roster meta writes. A second hire of an already-hired pool driver fails with `DRIVER_ALREADY_HIRED` and grants nothing. Firing grants nothing.

## 4. Warehouse open XP

Production `openWarehouse` grants `xpRewards.warehouseOpen` = **40**. Production supports only `standard` and `cold` opens, and canonical open supports the same two types, so there are no hidden INTERNAL-only types. Duplicate opens (`DUPLICATE_WAREHOUSE`) and full slots (`WAREHOUSE_LIMIT_REACHED`) grant nothing.

## 5. Warehouse upgrade XP

Production `upgradeWarehouse` calls `addCompanyXp(xpRewards.warehouseUpgrade)` on every successful tier upgrade: **25 per tier**, not only the first. Canonical upgrade applies 25 for each successful level step. `MAX_LEVEL` grants nothing.

## 6. Cargo-sale XP

Production `sellProductFromWarehouse`:

- `profit = calculateTradeProfit(unitPrice, inventoryItem.averageBuyPrice ?? unitPrice, quantity, inventoryItem.quality ?? 100)`, unrounded.
- `xp = calculateTradeSaleXp(profit)`: `profit ≤ 0` gives `lossSale` = 2. Otherwise `clamp(round(10 + profit / 1500), 10, 100)`.
- `calculateTradeProfit` = sell revenue after the 3% sell fee, at `price × quality / 100`, minus buy cost including the 3% buy fee.

Canonical sale XP calls the same two functions with:

- the committed receipt's `unitPrice` and `quantity`;
- the trusted `averageBuyPrice` from the inventory doc;
- quality 100.

It applies only when quality is provably 100 (section 7). The golden vectors are loss 2, break-even 2, small profit 10, a mid profit that follows the formula, and large profit clamped to 100.

## 7. Cost-basis authority

Canonical inventory (Step 29U) stored quantity only. Production profit needs the weighted average buy price (`computeWeightedAverageBuyPrice` on buy; sells keep the average; an item filtered at quantity 0 starts fresh). Step 29AH records a server-owned cost basis on the inventory doc when the XP gate is ON:

- A buy into quantity 0 sets `averageBuyPrice = unitPrice` and `costBasisPolicyVersion = canonical-cargo-cost-basis-v1`.
- A buy into a trusted basis sets the production weighted average.
- A buy into stock without a trusted basis (pre-policy or mixed) writes `averageBuyPrice: null`, which marks it untrusted.
- A buy with the gate OFF invalidates any existing basis, because the added units are untracked.
- A sell leaves the basis unchanged.

A sale without a trusted basis records XP 0 with `CARGO_SALE_XP_BLOCKED_COST_BASIS_AUTHORITY`. Nothing is imported from saves, and the client cannot send a price, profit or cost.

**Quality.** Production decays inventory quality every game hour in some product/warehouse pairs. Canonical inventory has no quality clock, so sale XP is derived only where `calculateQualityLossForPeriod` is exactly 0, using production protections (cold 1, standard 0.5):

- **Zero decay:** fruit/cold, steel/standard, beverage/cold.
- **Blocked:** electronics, machinery, textile and furniture in standard record XP 0 with `CARGO_SALE_XP_BLOCKED_QUALITY_AUTHORITY`.

This quality gap also affects the 29U cargo cash revenue, which already assumes quality 100.

## 8. Trusted operations

XP is derived only from the operation's own server receipt, built in the same transaction:

| Operation | Receipt | Evidence fields |
|---|---|---|
| Truck purchase | `canonicalPurchaseReceipts/{purchaseId}` | purchaseId, policyVersion, transactionId |
| Driver hire | `canonicalDriverReceipts/{hireIntentId}` | intentId, policyVersion, transactionId |
| Warehouse open/upgrade | `canonicalWarehouseReceipts/{intentId}` | operationId, levelBefore/After, cashTransactionId |
| Cargo sale | `canonicalCargoMarketReceipts/{saleIntentId}` | unitPrice, quantity, cashTransactionId + inventory cost basis |

## 9. XP policies

Fixed rewards come from `levelBalance.xpRewards` (single source: `levelConfig.xpRewards`). Trade XP comes from `levelConfig.tradeXp` through `calculateTradeSaleXp`. Evidence stores `policyVersion`, `sourceType`, `formula` (FIXED / TRADE_SALE), `rewardKey` or trade inputs, `xp`, the operation receipt id, the operation policy version, and the cash transaction id. Operation receipt semantics and policy versions are unchanged. XP policy lives on the progression receipt only, so old operation receipts stay valid.

## 10. Operation identity

- `progression:truck-purchase:{purchaseId}`
- `progression:driver-hire:{hireIntentId}`
- `progression:warehouse-open:{warehouseId}` (canonical warehouse ids are deterministic per city/type and cannot be reopened)
- `progression:warehouse-upgrade:{warehouseId}:{fromLevel}:{toLevel}`
- `progression:cargo-sale:{saleIntentId}`

## 11. Progression receipts

The Step 29AF pipeline is reused: `readCanonicalProgressionContext`, `planCanonicalProgressionWrite`, `commitCanonicalProgressionWrite`. New source types are `COMPANY_TRUCK_PURCHASE`, `COMPANY_DRIVER_HIRE`, `COMPANY_WAREHOUSE_OPEN`, `COMPANY_WAREHOUSE_UPGRADE` and `COMPANY_CARGO_SALE`. `reputationDelta` is always 0. A cargo sale blocked on cost basis or quality still writes a receipt with `xpDelta: 0` and the exact `xpAuthority`, so the sale can never be granted later.

## 12. Atomicity

All progression reads (doc and receipt) happen before the operation's first write, which Firestore requires. If a progression receipt already exists for a new operation, the operation fails closed before any write. After the operation's own writes, XP is planned from the stored receipt and committed in the same transaction. There is no second cash transaction, and cash transaction identities are unchanged. If the plan conflicts after writes, the helper throws and the whole transaction aborts.

## 13. Retry

A replay of an operation returns its existing receipt. The progression result is `ALREADY_APPLIED` when the progression receipt exists. Cash, asset, inventory and XP are untouched.

## 14. Two-device

Transactions serialize on the operation receipt, driver/warehouse doc and progression doc:
- **Same intent:** one call `APPLIED`, the other `ALREADY_APPLIED`.
- **Different intents on the same driver or warehouse:** exactly one succeeds.
- **Concurrent cargo sells:** these exceed inventory, and only one commits.

## 15. Level-up behavior

`applyCanonicalCompanyXp` delegates to production `applyXpToPlayer`: carry-over and multi-level loops. Fixed XP levels up (for example, 95 XP + 30 gives level 2 with xp 25). One non-delivery operation grants at most 100 XP, while level 1→2 needs 100 and 2→3 needs 273. So a single operation cannot jump two levels, but the multi-level semantics are tested directly.

## 16. Max-level behavior

At level 30, production resets `xp` to 0 while `totalXp` keeps growing. Canonical matches this exactly.

## 17. Reputation separation

No non-delivery operation changes reputation. Receipts store `requestedReputationDelta: 0`, and the reputation value is unchanged.

## 18. Historical operation behavior

Operations committed before 29AH, or while the gate was OFF, are never backfilled. Replaying them with the gate ON returns `NON_DELIVERY_XP_HISTORICAL_OPERATION_UNAPPLIED` with no progression write. Unknown XP policy on an existing progression receipt fails closed: `NON_DELIVERY_XP_POLICY_UNKNOWN`.

## 19. Legacy state

Legacy progression is never imported. Initialization still refuses accounts with a save or a used serverState. A non-canonical progression doc gives `NOT_APPLIED_NOT_SERVER_CANONICAL` and is not mutated. An uninitialized account gives `NOT_APPLIED_UNINITIALIZED`: the operation succeeds and no XP is recorded. Legacy cargo inventory never gets a trusted cost basis until its quantity returns to 0.

## 20. Public-path limitations

Public `buyTruck`, `hireDriver`, `openWarehouse`, `upgradeWarehouse` and `sellProductFromWarehouse` still call local `addCompanyXp`. Public progression UI, Contracts UI, HUD and the cash listener are unchanged. `canUseServerAuthoritativeSettlement` stays false, `SAVE_GAME_VERSION` stays 6, and critical cash coverage stays 24 / 0 / 24.

## 21. Remaining client-owned XP sources

- Trade sales of decaying products (quality clock).
- Missions, milestones and local weekly objectives. Step 29AI made the server-derivable ones canonical for internal accounts (7/12 missions, 30/41 milestones, 5/5 weekly slots); the rest stay client-owned. See `MAP_V2_CANONICAL_CLIENT_REWARD_XP_AUTHORITY.md`.
- Operation-choice XP (dormant: no option sets it).
- Debug XP.
- Vehicle recovery reputation.

## 22. Progression readiness

Readiness `CANONICAL_PROGRESSION_BLOCKED_CLIENT_REWARD_XP_SOURCES` replaces `CANONICAL_PROGRESSION_BLOCKED_NON_DELIVERY_XP_SOURCES`. Step 29AI later narrowed it to `CANONICAL_PROGRESSION_BLOCKED_UNSUPPORTED_REWARD_PROGRESS`.

The non-delivery readiness classifier (`classifyCanonicalNonDeliveryXpReadiness`) gives two results:
- **Operations scope:** `NON_DELIVERY_XP_INTERNAL_PARTIAL`.
- **All sources:** `NON_DELIVERY_XP_BLOCKED_MISSIONS`.

## 23. Contract issuance impact

The next refresh reads the updated canonical level, and existing batches stay frozen. Issuance readiness stays `ROAD_CONTRACT_ISSUANCE_BLOCKED_PUBLIC_PROGRESSION`. The public blocker `COMPANY_XP_NON_DELIVERY_SOURCES_CLIENT_OWNED` becomes two narrower blockers:
- `COMPANY_XP_NON_DELIVERY_OPERATIONS_INTERNAL_CANONICAL_ONLY`
- `COMPANY_XP_CLIENT_REWARD_SOURCES_CLIENT_OWNED` (Step 29AI replaced it with `COMPANY_XP_CLIENT_REWARD_SOURCES_INTERNAL_PARTIAL` and `COMPANY_XP_UNSUPPORTED_REWARD_PROGRESS_CLIENT_OWNED`)

Finding: catalog-purchased trucks get no `canonicalFleetRuntime` doc. With the runtime gate ON, refresh fails with `FLEET_RUNTIME_LOCATION_UNAVAILABLE` until one exists. The tests seed a fixture runtime, as Step 29AG did.

## 24. Next step

The dominant remaining progression blocker is client reward XP: missions, milestones and weekly objectives are client catalogs with client progress. Also open:
- The cargo quality clock, which blocks both trade XP and cargo cash parity for decaying goods.
- Runtime minting for catalog-purchased trucks.
- Legacy state migration and public Contracts wiring for any public rollout.

Do not canonicalize missions, milestones, weekly rewards, operation choices or recovery without a dedicated step.

Client reward XP was done in Step 29AI (`CANONICAL_CLIENT_REWARD_XP_AUTHORITY_PASS_PARTIAL`, `MAP_V2_CANONICAL_CLIENT_REWARD_XP_AUTHORITY.md`). The 29AH operation XP and the 29AH readiness facts are unchanged.


Step 29AJ/29AK: legacy progression migration is internal only. Apply uses a create-only frozen source (`MAP_V2_LEGACY_SAVE_AUTHORITY_HARDENING.md`). Public rollout remains blocked. Cash authority, ROAD settlement, and RAIL/SEA/AIR are unchanged.

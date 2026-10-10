# ROAD cash canonicalization matrix (Step 29E)

**Source of truth:** `src/domain/canonicalCashOperation.ts` → `ROAD_CASH_CANONICALIZATION_MATRIX`  
Must stay 1:1 with `PRODUCTION_CASH_WRITE_AUDIT` in `src/domain/cashAuthority.ts`.

HUD overlay remains **off**. `canUseServerAuthoritativeSettlement()` remains **false** (`ROAD_ECONOMY_NOT_SERVER_CANONICAL_PRODUCTION_FLEET`). Step 29AD offer expiry does not settle cash. Step 29AE refresh is free and does not settle cash. Step 29AF progression/reputation mutations are not cash writes. Step 29AG driver assignment, risk snapshots and completion XP write no cash either (driver hire/fire cash is unchanged). Step 29AH non-delivery XP is written in the same transaction as the canonical purchase, hire, warehouse or cargo-sale operation, after that operation's existing single cash transaction. It adds no cash transaction and changes no amount. Step 29AI client-reward XP writes no cash for missions, milestones or weekly objectives, except `own_2_trucks` and `ms_second_truck`: those reuse their existing 29W cash mutation (same transaction id as the claim, same amount) in the claim transaction. All other reward cash is recorded as `CASH_BLOCKED_NO_SERVER_CASH_AUTHORITY`. Public contract expiry, refresh, and progression remain on the device.  
Public rollout `MULTIMODAL_OFF`. RAIL/SEA/AIR `FOUNDATION_ONLY`. `SAVE_GAME_VERSION` **6**.

Classifications (exactly one per write):

- `CANONICAL_READY_NOW`
- `CANONICAL_READY_WITH_SMALL_SERVER_PORT`
- `BLOCKED_MISSING_SERVER_STATE`
- `BLOCKED_CLIENT_ONLY_GAMEPLAY_CONTEXT`
- `LOCAL_ONLY_DEBUG`
- `LEGACY_TEST_ONLY`

| auditId | Family | Current authority | Target authority | Canonical record needed? | Server validation source | Offline impact | Status | Next step |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| road-delivery-revenue | A delivery | save `player.money` | `serverState.cash` | delivery + execution + timing + **canonicalFleetAssets** + wear/repair receipts | INTERNAL_TEST fleet mutations. Production UI local. | Keep local complete | `BLOCKED_MISSING_SERVER_STATE` | 29O incident / other paths |
| repair | B vehicle | client condition | server condition | canonical repair receipt | INTERNAL_TEST `repairCanonicalFleetAsset` | Keep local repairTruck | `BLOCKED_MISSING_SERVER_STATE` | production UI |
| truck-upgrade | B vehicle | client | server upgrades | canonical upgrade receipt | INTERNAL_TEST `upgradeCanonicalFleetAsset` | Keep local upgradeTruck | `BLOCKED_MISSING_SERVER_STATE` | production UI |
| road-delivery-completion-expenses | A delivery | save | `serverState.cash` | same | Frozen start bundle + derived penalties | Keep local | `BLOCKED_MISSING_SERVER_STATE` | 29I |
| road-delivery-fail-penalty | A delivery | save | `serverState.cash` | same | Failure derived from canonical payment | Keep local fail | `BLOCKED_MISSING_SERVER_STATE` | 29I |
| road-delivery-incident | A delivery | save | INTERNAL_TEST catalog plan | delivery + eventId | Production UI still client | Keep local public | `BLOCKED_CLIENT_ONLY_GAMEPLAY_CONTEXT` | 29O INTERNAL_TEST |
| road-fuel | C opex | save + live tank/quote | INTERNAL `purchaseCanonicalFuel` | canonical tank+price | INTERNAL purchase. Progressive burn is INTERNAL and does not move cash. Public refuel stays local. | Keep local refuel | `CANONICAL_READY_WITH_SMALL_SERVER_PORT` | public + HUD |
| daily-operating | C opex | public local 24h clock; INTERNAL server | settleCanonicalDailyOpexInternal | canonicalOpexState | mandatory expense parity to -5000; clock/legacy still blocked | Public offline 0 | `CANONICAL_READY_WITH_SMALL_SERVER_PORT` | clock + legacy before HUD |
| truck-purchase | B vehicle | client catalog | INTERNAL `purchaseCanonicalCatalogAsset` | catalog + ownership | Server catalog price INTERNAL; **public buyTruck local** | Local catalog buy | `CANONICAL_READY_WITH_SMALL_SERVER_PORT` | do not wire HUD |
| trailer-purchase | B vehicle | client catalog | same INTERNAL callable | trailer catalog | Same | Local | `CANONICAL_READY_WITH_SMALL_SERVER_PORT` | no public wiring |
| truck-lease | B vehicle | public local; INTERNAL prepaid catalog | createCanonicalVehicleLease | canonicalVehicleLeases | TRUCK_MARKET weeklyLeaseCost | Public local | `CANONICAL_READY_WITH_SMALL_SERVER_PORT` | no public wire; recurring = daily opex |
| driver-hire | D staff | public local; INTERNAL DRIVER_POOL | hireCanonicalDriver | canonicalDrivers | DRIVER_POOL hiringFee | Public local | `CANONICAL_READY_WITH_SMALL_SERVER_PORT` | INTERNAL_POLICY (no company level) |
| truck-sale | B vehicle | public local; INTERNAL valuation | sellCanonicalFleetAsset | canonicalFleetAssets mileageKm | calculateCanonicalTruckResaleValue | Public local | `CANONICAL_READY_WITH_SMALL_SERVER_PORT` | no public wire |
| driver-severance | D staff | public local; INTERNAL roster | fireCanonicalDriver | canonicalDrivers | salary * 2 days | Public local | `CANONICAL_READY_WITH_SMALL_SERVER_PORT` | no public wire |
| vehicle-recovery | B vehicle | client issues | server issues | issue+action | Client simulation | Local | `BLOCKED_CLIENT_ONLY_GAMEPLAY_CONTEXT` | vehicle-state authority |
| warehouse-open | E infra | public save; INTERNAL canonical | openCanonicalWarehouse | canonicalWarehouses | CITIES_BY_ID + warehouseBalance | Local public | `CANONICAL_READY_WITH_SMALL_SERVER_PORT` | no public wire |
| warehouse-upgrade | E infra | public save; INTERNAL canonical | upgradeCanonicalWarehouse | canonical warehouse revision | Server next level/cost | Local public | `CANONICAL_READY_WITH_SMALL_SERVER_PORT` | no public wire |
| cargo-buy | F cargo | public save; INTERNAL snapshot | `buyCanonicalCargo` | canonicalWorldMarkets + inventory | INTERNAL epoch price when stamped; public local | Keep local public | `CANONICAL_READY_WITH_SMALL_SERVER_PORT` | public UI unwired; contracts still on save cities |
| cargo-sell | F cargo | public save; INTERNAL inventory | `sellCanonicalCargo` | canonical inventory | INTERNAL canonical qty | Keep local public | `CANONICAL_READY_WITH_SMALL_SERVER_PORT` | issuance still blocked on player/events/RNG |
| ad-reward | H rewards | client after ad | attested claim | attestation | `applyAdReward` | Ads network; cash local | `BLOCKED_CLIENT_ONLY_GAMEPLAY_CONTEXT` | attested rewards later |
| mission-reward | H rewards | public local; INTERNAL own_2_trucks | claimCanonicalLocalReward | canonical fleet count | Catalog amount. Other missions local. | Local public | `CANONICAL_READY_WITH_SMALL_SERVER_PORT` | no public wire |
| milestone-reward | H rewards | public local; INTERNAL ms_second_truck | same callable | canonical fleet count | Catalog amount. Other milestones local. | Local public | `CANONICAL_READY_WITH_SMALL_SERVER_PORT` | no public wire |
| client-weekly-objective | H rewards | client | `weeklyMissionClaims` | already for server weeks | Separate client path | Local | `BLOCKED_CLIENT_ONLY_GAMEPLAY_CONTEXT` | unify claims; no dual-pay |
| guest-multimodal-rail-settle | multimodal guest | guest `player.money` | never server for guests | none | Local settlement | Must stay local | `BLOCKED_CLIENT_ONLY_GAMEPLAY_CONTEXT` | keep guest |
| debug-cash | I debug | DEV | never server | none | debugAdd/Set/Remove | DEV | `LOCAL_ONLY_DEBUG` | isolated |
| test-money-sync | I debug | `users/{uid}.money` | never canonical | none | `testMoneySyncService` | n/a | `LOCAL_ONLY_DEBUG` | isolated |
| cloud-save-blob | save | LWW `saves/current` | cache after overlay | none | Client cloud save | HUD/save stay current | `BLOCKED_CLIENT_ONLY_GAMEPLAY_CONTEXT` | no 29E save change |
| profile-money-write | legacy | `users/{uid}.money` | **NONE** | none | cloudSave omit if TEST_MONEY_SYNC | n/a | `LEGACY_TEST_ONLY` | no new gameplay writes |
| marketplace-purchase | G market | `serverState.cash` + `canonicalCash` | already | marketplace ledger | Listing price server | Online | `CANONICAL_READY_NOW` | reuse; do not duplicate |
| marketplace-listing-fee | G market | server | already | listing docs | Server fee | Online | `CANONICAL_READY_NOW` | reuse |
| marketplace-reconcile-overlay | G market | marketplace-scoped save overlay | keep scoped | reconcile | `applyVehicleMarketplaceReconciliation` | Online | `CANONICAL_READY_NOW` | do not expand to ROAD HUD |
| weekly-mission-claim-server | H rewards | server | already | `weeklyMissionClaims` | Server reward table | Online | `CANONICAL_READY_NOW` | reuse |
| season-reward-claim-server | H rewards | server | already | season claims | Entitlement | Online | `CANONICAL_READY_NOW` | reuse |
| challenge-claim-server | H rewards | server | already | `challengeClaims` | Server table | Online | `CANONICAL_READY_NOW` | reuse |
| legacy-serverstate-bootstrap | bootstrap | server migrate | init only | `serverState/current` | Bounded save migrate | Signed-in | `CANONICAL_READY_NOW` | not a gameplay delta API |

## Ledger ID alignment (preserve where they exist)

- `delivery:{deliveryId}:revenue`
- `delivery:{deliveryId}:completion-expenses`
- `delivery:{deliveryId}:failure-penalty`
- `delivery:{deliveryId}:maintenance` / `:penalty` (alternate complete paths)
- `refuel:{truckId}:{currentFuelL}:{newFuelL}:{unitPrice}`
- `vehicle-purchase:{instanceId}`
- `periodic-cost:{periodKeys}`

Server canonical transaction IDs should reuse these strings when a path is later canonicalized.

## What 29E/29H did **not** migrate

No ROAD delivery, fuel, or **public** catalog truck cash apply.  
INTERNAL_TEST `purchaseCanonicalCatalogAsset` exists (29P) and mutates `serverState.cash` only.  
No HUD switch to `serverState.cash`.  
No `settleCanonicalMultimodalShipment`.  
Live save fleet condition/upgrades are **not** production HUD authority (INTERNAL_TEST fixtures/mutations only).


Step 29AJ/29AK: legacy progression migration is internal only. Apply uses a create-only frozen source (`MAP_V2_LEGACY_SAVE_AUTHORITY_HARDENING.md`). Public rollout remains blocked. Cash authority, ROAD settlement, and RAIL/SEA/AIR are unchanged.

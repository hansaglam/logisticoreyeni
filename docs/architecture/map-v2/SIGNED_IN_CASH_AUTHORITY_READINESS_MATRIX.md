# Signed-in cash authority readiness matrix (Step 29P)

Source of truth: `getSignedInCashAuthorityCoverage()` in `src/domain/signedInCashAuthorityCoverage.ts`.  
1:1 with `PRODUCTION_CASH_WRITE_AUDIT`. HUD overlay **off**. `cashAuthorityVersion` **0**. `canUseServerAuthoritativeSettlement()` **false** (`ROAD_ECONOMY_NOT_SERVER_CANONICAL_PRODUCTION_FLEET` + diagnostic `ROAD_CASH_PATHS_NOT_FULLY_CANONICAL`).

Statuses: `CANONICAL_READY` | `CANONICAL_READY_WITH_SMALL_PORT` | `BLOCKED_SERVER_STATE` | `BLOCKED_WORLD_STATE` | `BLOCKED_VERIFICATION` | `BLOCKED_LEGACY_ASSET` | `LOCAL_ONLY`.

HUD: `BLOCKS_HUD_AUTHORITY` must be canonical (or retired) before `cashAuthorityVersion=1`. `CAN_REMAIN_LEGACY_LOCAL_ONLY` does not block the switch by itself.

| auditId | Current function | Authority | Credit/Debit | Server-validatable? | Trusted input | Canonical txn id | Offline | Complexity | Status | HUD |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| road-delivery-revenue | completeDeliveryById | save | CREDIT | no | none | delivery:{id}:revenue | public local | HIGH | BLOCKED_SERVER_STATE | BLOCKS |
| road-delivery-completion-expenses | completeDeliveryById | save | DEBIT | no | none | delivery:{id}:completion-expenses | public local | HIGH | BLOCKED_SERVER_STATE | BLOCKS |
| road-delivery-fail-penalty | failDeliveryById | save | DEBIT | no | none | delivery:{id}:failure-penalty | public local | HIGH | BLOCKED_SERVER_STATE | BLOCKS |
| road-fuel | refuelTruck / INTERNAL purchaseCanonicalFuel | public save; INTERNAL server | DEBIT | INTERNAL yes | tank+price INTERNAL; progressive burn INTERNAL only | fuel:{assetId}:{intent} | public local | HIGH | CANONICAL_READY_WITH_SMALL_PORT `FUEL_CASH_AUTHORITY_INTERNAL_TEST_PROGRESSIVE_PUBLIC_BLOCKED` | BLOCKS |
| daily-operating | processDailyOperatingCosts / INTERNAL settleCanonicalDailyOpexInternal | public local 24h clock; INTERNAL server | DEBIT | INTERNAL yes | canonical drivers/fleet/warehouses; mandatory floor -5000 | opex:p24_{n}:daily | public offline 0; INTERNAL online | HIGH | CANONICAL_READY_WITH_SMALL_PORT `DAILY_OPEX_INTERNAL_CLOCK_ONLY_LEGACY_STATE_BLOCKED` | BLOCKS |
| truck-purchase | buyTruck / INTERNAL purchaseCanonicalCatalogAsset | public save; INTERNAL server | DEBIT | yes (catalog) | TRUCK_MARKET | fleet:{assetId}:purchase:{purchaseId} | public local; INTERNAL online | LOW | CANONICAL_READY_WITH_SMALL_PORT `…PUBLIC_UNWIRED` | BLOCKS |
| trailer-purchase | buyTrailer / same INTERNAL | same | DEBIT | yes | TRAILER_MARKET | fleet:{assetId}:purchase:{purchaseId} | same | LOW | CANONICAL_READY_WITH_SMALL_PORT | BLOCKS |
| truck-lease | leaseTruck / INTERNAL createCanonicalVehicleLease | public save; INTERNAL server prepaid | DEBIT | INTERNAL yes | TRUCK_MARKET weeklyLeaseCost | fleet:{assetId}:lease:{intent} | public local; INTERNAL online | MEDIUM | CANONICAL_READY_WITH_SMALL_PORT `LEASE_START_INTERNAL_TEST_CANONICAL_PUBLIC_UNWIRED` | BLOCKS |
| driver-hire | hireDriver / INTERNAL hireCanonicalDriver | public save; INTERNAL DRIVER_POOL | DEBIT | INTERNAL yes | DRIVER_POOL hiringFee (level INTERNAL_POLICY) | driver:{id}:hire:{intent} | public local; INTERNAL online | MEDIUM | CANONICAL_READY_WITH_SMALL_PORT `DRIVER_HIRE_AUTHORITY_INTERNAL_POLICY_ONLY` | BLOCKS |
| truck-sale | sellTruck / INTERNAL sellCanonicalFleetAsset | public local; INTERNAL mileage+condition | CREDIT | INTERNAL yes | calculateCanonicalTruckResaleValue | fleet:{assetId}:sale:{intent} | public local; INTERNAL online | MEDIUM | CANONICAL_READY_WITH_SMALL_PORT `VEHICLE_SALE_INTERNAL_TEST_CANONICAL_PUBLIC_UNWIRED` | BLOCKS |
| driver-severance | fireDriver / INTERNAL fireCanonicalDriver | public roster; INTERNAL canonicalDrivers | DEBIT | INTERNAL yes | salary * 2 days | driver:{id}:fire:{intent} | public local; INTERNAL online | MEDIUM | CANONICAL_READY_WITH_SMALL_PORT `DRIVER_FIRE_INTERNAL_TEST_CANONICAL_ROSTER` | BLOCKS |
| repair | repairTruck / INTERNAL repair | public save; INTERNAL server | DEBIT | INTERNAL yes | canonical condition | fleet:{assetId}:repair:{intent} | public local | MEDIUM | CANONICAL_READY_WITH_SMALL_PORT | BLOCKS |
| truck-upgrade | upgradeTruck / INTERNAL | same | DEBIT | INTERNAL yes | canonical upgrades | fleet:{assetId}:upgrade:… | public local | MEDIUM | CANONICAL_READY_WITH_SMALL_PORT | BLOCKS |
| warehouse-open | openWarehouse / INTERNAL openCanonicalWarehouse | public save; INTERNAL server | DEBIT | INTERNAL yes | CITIES_BY_ID + type | warehouse:{city}:{type}:open | local public | HIGH | CANONICAL_READY_WITH_SMALL_PORT `WAREHOUSE_INTERNAL_CANONICAL_ONLY` | BLOCKS |
| warehouse-upgrade | upgradeWarehouse / INTERNAL upgradeCanonicalWarehouse | public save level; INTERNAL canonical | DEBIT | INTERNAL yes | canonical warehouse; no client level | warehouse:{id}:upgrade:{next} | local public | HIGH | CANONICAL_READY_WITH_SMALL_PORT `WAREHOUSE_INTERNAL_CANONICAL_ONLY` | BLOCKS |
| cargo-buy | buyProductForWarehouse / INTERNAL buyCanonicalCargo | public save; INTERNAL snapshot | DEBIT | INTERNAL yes | INTERNAL currentPrice+stock; qty action | cargo:{city}:{product}:buy:{intent} | public local; INTERNAL online | HIGH | CANONICAL_READY_WITH_SMALL_PORT `CARGO_MARKET_INTERNAL_TEST_CANONICAL_PUBLIC_UNWIRED` | BLOCKS |
| cargo-sell | sellProductFromWarehouse / INTERNAL sellCanonicalCargo | public save; INTERNAL inventory | CREDIT | INTERNAL yes | canonical qty + snapshot | cargo:{city}:{product}:sell:{intent} | public local; INTERNAL online | HIGH | CANONICAL_READY_WITH_SMALL_PORT `CARGO_MARKET_INTERNAL_TEST_CANONICAL_PUBLIC_UNWIRED` | BLOCKS |
| vehicle-recovery | resolveVehicleStateIssue | client issues | DEBIT | no | none | recovery:… | local | HIGH | BLOCKED_SERVER_STATE | BLOCKS |
| road-delivery-incident | resolveDeliveryIncident / INTERNAL finalize | production client | TRANSFER | INTERNAL catalog only | plan (INTERNAL) | incident:{delivery}:{event} | public local | HIGH | BLOCKED_SERVER_STATE | BLOCKS |
| ad-reward | applyAdReward | client SDK | CREDIT | no | no attestation | reward:ad:{claimId} | ads online; cash local | MEDIUM | BLOCKED_VERIFICATION | BLOCKS |
| mission-reward | claimMissionReward / INTERNAL claimCanonicalLocalReward | public save progress; INTERNAL fleet count for own_2_trucks | CREDIT | INTERNAL one mission | canonical truck count | reward:mission:own_2_trucks | public local | MEDIUM | BLOCKED_SERVER_STATE `MISSION_INTERNAL_CANONICAL_STATE_ONLY` | BLOCKS |
| milestone-reward | claimMilestoneReward / INTERNAL claimCanonicalLocalReward | public save; INTERNAL fleet count for ms_second_truck | CREDIT | INTERNAL one milestone | canonical truck count | reward:milestone:ms_second_truck | public local | MEDIUM | BLOCKED_SERVER_STATE `MILESTONE_INTERNAL_CANONICAL_STATE_ONLY` | BLOCKS |
| client-weekly-objective | claimWeeklyObjectiveReward | client | CREDIT | no | do not dual-pay | reward:weekly-local:{claimId} | local | MEDIUM | BLOCKED_SERVER_STATE | BLOCKS |
| guest-multimodal-rail-settle | guest RAIL settle | guest save | CREDIT | n/a | guest | n/a | must stay local | LOW | LOCAL_ONLY | remain |
| debug-cash | debugAdd/Set/Remove | DEV | TRANSFER | n/a | n/a | n/a | DEV | LOW | LOCAL_ONLY | remain |
| test-money-sync | testMoneySyncService | profile overlay | MIRROR | n/a | n/a | n/a | n/a | LOW | LOCAL_ONLY | remain |
| cloud-save-blob | cloudSaveService | LWW save | MIRROR | n/a | future cache | n/a | sync | MEDIUM | LOCAL_ONLY | remain |
| profile-money-write | users/{uid}.money | NONE | MIRROR | n/a | n/a | n/a | n/a | LOW | LOCAL_ONLY | remain |
| marketplace-purchase | purchaseVehicleListing | serverState.cash | DEBIT | yes | listing | marketplace ids | ONLINE | LOW | CANONICAL_READY | remain |
| marketplace-listing-fee | createVehicleListing | serverState.cash | DEBIT | yes | fee table | listing fee ids | ONLINE | LOW | CANONICAL_READY | remain |
| marketplace-reconcile-overlay | applyVehicleMarketplaceReconciliation | scoped save overlay | TRANSFER | yes | server marketplace cash | reconcile:{uid}:{version} | online | MEDIUM | CANONICAL_READY_WITH_SMALL_PORT | BLOCKS |
| weekly-mission-claim-server | claimWeeklyMissionReward | serverState.cash | CREDIT | yes | server table | reward:weekly:… | ONLINE | LOW | CANONICAL_READY | remain |
| season-reward-claim-server | claimSeasonReward | serverState.cash | CREDIT | yes | entitlement | reward:season:… | ONLINE | LOW | CANONICAL_READY | remain |
| challenge-claim-server | claimChallengeReward | serverState.cash | CREDIT | yes | server table | reward:challenge:… | ONLINE | LOW | CANONICAL_READY | remain |
| legacy-serverstate-bootstrap | migrateLegacyServerState | one-time | TRANSFER | yes | bounded save | bootstrap:{uid} | signed-in | LOW | CANONICAL_READY | remain |

## Coverage (technical, not a score)

Counts come from `getSignedInCashAuthorityCoverage()` at runtime. Critical HUD paths are those with `requiredBeforeCashAuthorityVersion1`. None of those are `CANONICAL_READY` yet (INTERNAL catalog/repair do not replace public HUD writes). Step 29AD game-time expiry, Step 29AE refresh, Step 29AF progression/reputation, Step 29AG driver risk / completion XP, and Step 29AH non-delivery operation XP are not cash paths and do not change the counts. 29AH adds no second cash transaction to purchase, hire, warehouse or cargo-sale operations. Step 29AI client-reward XP is not a cash path either. Only the two 29W rewards keep their existing internal cash, and the local mission/milestone/weekly cash mint stays client-owned, so the counts are unchanged. Unified cash is **not** ready.

## After future HUD authority

Marketplace already lives on `serverState.cash`. ROAD/fuel/catalog public paths must use the same field before overlay. Marketplace reconcile must not write a second HUD cash.

## Forbidden

`applyCashDelta` / `setCash` / `updateMoney` / arbitrary `applyTransaction` callables. Client fuel cost, catalog price, sale value, warehouse level, cargo price/stock are untrusted.


Step 29AJ/29AK: legacy progression migration is internal only. Apply uses a create-only frozen source (`MAP_V2_LEGACY_SAVE_AUTHORITY_HARDENING.md`). Public rollout remains blocked. Cash authority, ROAD settlement, and RAIL/SEA/AIR are unchanged.


Step 29AL: internal immediate progression cutover reads the save and creates the frozen source plus migration in one transaction (`MAP_V2_LEGACY_PROGRESSION_IMMEDIATE_CUTOVER.md`). Public rollout remains blocked by `PUBLIC_PROGRESSION_UI_SPLIT_BRAIN`. Cash authority and ROAD settlement are unchanged.

Step 29AM: progression read authority does not change cash. HUD cash, `cashAuthorityVersion`, and `canUseServerAuthoritativeSettlement` stay as they are (`MAP_V2_CANONICAL_PROGRESSION_READ_AUTHORITY.md`).

Step 29AN: progression eligibility does not change cash (`MAP_V2_CANONICAL_PROGRESSION_ELIGIBILITY_AUTHORITY.md`).

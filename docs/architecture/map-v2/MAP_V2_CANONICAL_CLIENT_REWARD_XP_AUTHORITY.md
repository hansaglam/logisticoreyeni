# Map V2 — Canonical client-reward XP authority (Step 29AI)

**Status:** `CANONICAL_CLIENT_REWARD_XP_AUTHORITY_PASS_PARTIAL`

**Gate:** `CANONICAL_CLIENT_REWARD_XP_AUTHORITY=INTERNAL_TEST` (missing or any other value means OFF). A claim also needs `CANONICAL_COMPANY_PROGRESSION_AUTHORITY=INTERNAL_TEST`. The two 29W cash rewards additionally need `CANONICAL_LOCAL_REWARD_AUTHORITY=INTERNAL_TEST`.

**Policies:** `canonical-client-reward-xp-v1` (claim receipt `rewardXpPolicyVersion` and progression receipt `xpEvidence.policyVersion`). Weekly cycle: `canonical-weekly-objective-cycle-iso-utc-v1`. Any other policy value on an existing receipt fails closed.

Code: `src/domain/canonicalClientRewardXp.ts`, `backend/src/canonicalClientRewardXp.ts`, `backend/src/canonicalLocalReward.ts` (shared 29W cash helper), and the `claimCanonicalClientReward` callable in `backend/src/index.ts`. Tests: `backend/test/canonicalClientRewardXp.unit.test.ts` and `scripts/map-v2-canonical-client-reward-xp-authority-regression-test.ts`.

For canonical accounts, missions, milestones and local weekly objectives now grant exact production XP and production reputation. The claim is manual and one-time (once per cycle for weekly objectives). Progress is derived on the server from canonical receipts and state inside the claim transaction. Rewards whose production progress depends on data the server cannot verify are refused with an exact reason. That is why the outcome is `PASS_PARTIAL`: 7 of 12 missions, 30 of 41 milestones and all 5 weekly slots are canonical, and the rest stay client-owned. Public UI, the public save and guests are unchanged.

## 1. Reward XP source audit

Every production reward path that can grant company XP was traced. Among reward paths, only `claimMissionReward`, `claimMilestoneReward` and `claimWeeklyObjectiveReward` call `addCompanyXp`. The table lives in code as `CLIENT_REWARD_XP_AUDIT`, with one row per mission, milestone and weekly slot plus one row per other family (65 rows in total). No row is UNKNOWN (`clientRewardAuditHasUnknown() === false`). Each row carries the reward id, family, XP, cash, other rewards, progress condition, progress source, reset cycle, claim model, whether it is client-owned today, whether it is server-derivable, and its canonical status.

| Family | XP | Status |
|---|---|---|
| A. Missions (12) | `reward.xp` on manual claim | 7 canonical, 5 blocked (see §2) |
| B. Milestones (41) | `reward.xp` on manual claim | 30 canonical, 11 blocked (see §4) |
| C. Local weekly objectives (5 slots per cycle) | `reward.xp` on manual claim | 5 canonical; the trade slot counts trusted sale profit only |
| D. Server weekly missions | none (`weeklyMissionCatalog` rejects `xp` and `reputation`) | `SERVER_WEEKLY_MISSION_NO_XP` |
| E. Season rewards | none | `SEASON_REWARD_NO_XP` |
| F. Challenge rewards | none | `CHALLENGE_REWARD_NO_XP` |
| G. Achievement catalog | none (informational) | `ACHIEVEMENT_CATALOG_NO_XP` |
| H. Rewarded ads | none | `AD_REWARD_NO_XP_AUTHORITY_BLOCKED_VERIFICATION`; ad cash stays `AD_REWARD_AUTHORITY_BLOCKED_VERIFICATION` |
| I. Operation choice | `effects.playerXpDelta` (no current option sets it) | `OPERATION_CHOICE_XP_CLIENT_OWNED_DORMANT` |
| Debug | +50 / +250 buttons, dev only | `DEBUG_XP_DEV_ONLY_NOT_CANONICAL` |

## 2. Mission catalog

`CANONICAL_MISSION_REWARD_CATALOG` is built from `ALL_MISSIONS` at module load. A mission without a server rule throws, so a new mission can never be silently claimable.

| Mission | XP | Rep | Production cash | Target | Server metric | Status | Cash authority |
|---|---|---|---|---|---|---|---|
| `first_contract_start` | 25 | — | 500 | 1 | `DELIVERIES_STARTED` | canonical | none (cash blocked) |
| `first_delivery` | 50 | 1 | 1500 | 1 | `DELIVERIES_COMPLETED` | canonical | none |
| `first_profit` | 75 | — | 2000 | 5000 | — | `CLIENT_REWARD_XP_BLOCKED_CASH_AUTHORITY` | none |
| `open_market` | 50 | — | 0 | 1 | — | `CLIENT_REWARD_XP_BLOCKED_CLIENT_UI_EVENT` | no cash component |
| `first_trade` | 50 | — | 1000 | 1 | `CARGO_BOUGHT` | canonical | none |
| `complete_5_deliveries` | 100 | 1 | 2500 | 5 | `DELIVERIES_COMPLETED` | canonical | none |
| `complete_10_deliveries` | 200 | 2 | 7500 | 10 | `DELIVERIES_COMPLETED` | canonical | none |
| `reach_company_score_150k` | 150 | — | 5000 | 25000 | — | `CLIENT_REWARD_XP_BLOCKED_COMPANY_SCORE_AUTHORITY` | none |
| `own_2_trucks` | 120 | — | 3000 | 2 | `ACTIVE_TRUCKS` | canonical | `CANONICAL_29W_INTERNAL` |
| `reach_warehouse_value_25000` | 100 | — | 3500 | 25000 | — | `CLIENT_REWARD_XP_BLOCKED_MARKET_PRICE_AUTHORITY` | none |
| `earn_10000_trade_profit` | 150 | — | 5000 | 10000 | `TRADE_CASH_FLOW_PROFIT` | canonical (trusted trade only) | none |
| `operate_in_3_cities` | 100 | — | 4000 | 3 | — | `CLIENT_REWARD_XP_BLOCKED_FLEET_LOCATION_AUTHORITY` | none |

Totals: 12 missions, 12 XP-bearing, 7 canonical, 5 blocked.

## 3. Mission progress conditions

Production (`getMissionProgress`) compared with the server derivation:

- **`first_contract_start`:** production counts any started delivery. The server counts any canonical delivery doc owned by the account (accepted or later).
- **`first_delivery`, `complete_5_deliveries`, `complete_10_deliveries`:** production uses `player.completedContracts`, which `completeDelivery` increments and which failures and cancels never touch. The server counts owned deliveries with `completionOutcome === 'COMPLETED'` in `COMPLETION_REPORTED` or `SETTLED`. Server-derived failures and cancels are excluded.
- **`first_trade`:** production uses the sticky `tradePurchased` flag or any purchase ledger entry. The server checks for any canonical cargo BUY receipt.
- **`own_2_trucks`:** production counts owned plus unexpired leased trucks. The server uses the 29W active-truck rule over **trusted** assets only (`SERVER_CANONICAL` / `INTERNAL_TEST_FIXTURE`).
- **`earn_10000_trade_profit`:** production uses uncapped `financeTotals`, sales minus purchases. The server computes the same cash flow from canonical cargo receipts. Sales of products that decay in their warehouse are excluded, so the value is a lower bound (§9).
- **Blocked rows:**
  - `first_profit`: contract income is not server cash yet.
  - `open_market`: a screen-open flag.
  - `reach_company_score_150k`: the company score includes client cash.
  - `reach_warehouse_value_25000`: uses client market prices.
  - `operate_in_3_cities`: uses the truck `currentCityId`/`homeCityId`, and catalog-purchased trucks have no runtime location doc.

## 4. Milestone catalog

`CANONICAL_MILESTONE_REWARD_CATALOG` is built from `MILESTONE_DEFINITIONS`, mapped by metric type. Totals: 41 milestones, 41 XP-bearing, 30 canonical, 11 blocked.

| Metric type | Milestones | Server metric | Status |
|---|---|---|---|
| `completed_contracts` | `ms_first_delivery`, `ms_regular_carrier`, `ms_regional_operator`, `ms_national_carrier`, `ms_logistics_giant`, `ms_deliveries_200` | `DELIVERIES_COMPLETED` | canonical |
| `truck_count` | `ms_second_truck` (29W cash), `ms_small_fleet`, `ms_ops_fleet`, `ms_fleet_8` | `ACTIVE_TRUCKS` | canonical |
| `high_capacity_truck` | `ms_heavy_hauler` | `HIGH_CAPACITY_TRUCK` (capacity ≥ 20) | canonical |
| `warehouse_active` | `ms_first_warehouse` | `WAREHOUSE_STOCK_ACTIVE` | canonical |
| `warehouse_stock_tons` | `ms_warehouse_keeper`, `ms_strategic_stock`, `ms_warehouse_500t` | `WAREHOUSE_STOCK_TONS` | canonical |
| `warehouse_cities` | `ms_regional_stock` | `WAREHOUSE_STOCK_CITIES` | canonical |
| `reputation` | `ms_trusted_company`, `ms_respected_brand`, `ms_flawless_operator`, `ms_reputation_max` | `REPUTATION` | canonical |
| `city_deliveries` | `ms_city_istanbul`, `ms_city_ankara`, `ms_city_izmir`, `ms_city_antalya`, `ms_city_bursa` | `CITY_DELIVERIES` | canonical |
| `urgent_/fragile_/high_reputation_contracts_completed` | `ms_urgent_5`, `ms_fragile_5`, `ms_prestige_1` | `CONTRACT_TYPE_COMPLETED` | canonical |
| `truck_upgraded` | `ms_truck_upgrade_1` | `TRUCK_UPGRADES` | canonical |
| `maintenance_count` | `ms_maintenance_10` | `TRUCK_REPAIRS` | canonical |
| `trade_profit_total`, `trade_profit_product`, `trade_buy_and_sell` | `ms_first_trade`, `ms_smart_trader`, `ms_market_expert`, `ms_electronics_expert`, `ms_fruit_trader`, `ms_trade_profit_100k` | — | `CLIENT_REWARD_XP_BLOCKED_LEDGER_WINDOW_PARITY` |
| `cash` | `ms_cash_100k`, `ms_cash_500k` | — | `CLIENT_REWARD_XP_BLOCKED_CASH_AUTHORITY` |
| `company_score` | `ms_company_score_500k`, `ms_company_score_1m` | — | `CLIENT_REWARD_XP_BLOCKED_COMPANY_SCORE_AUTHORITY` |
| `driver_level_3` | `ms_driver_level_3` | — | `CLIENT_REWARD_XP_BLOCKED_DRIVER_LEVEL_AUTHORITY` |

XP, reputation and cash per milestone are copied from the production definition; the unit test checks every row.

## 5. Milestone conditions

- **Completed contracts:** same rule as §3.
- **City deliveries:** production adds 1 for the origin and 1 for the destination of each completed delivery (`cityDeliveryCounts`). The server counts the same over canonical deliveries.
- **Contract type:** production emits one special event per urgent, fragile or high_reputation completion. The server counts completed deliveries by `contractType`, and a missing `contractType` means `standard` (29AF convention).
- **Trucks:** production uses `!leaseExpired` (sold trucks are removed). The server uses the 29W active-truck rule over trusted assets.
- **Warehouse:** production sums warehouse inventory quantities and counts cities that have stock. The server does the same from `canonicalCargoInventory` joined to `canonicalWarehouses`.
- **Reputation:** the canonical progression reputation.
- **Truck upgrades:** production emits one `truck_upgraded` event per upgrade. The server counts canonical fleet `UPGRADE` receipts.
- **Maintenance:** production emits `truck_maintained` only when a repair costs money. The server counts `REPAIR` receipts with `derivedCost > 0`.
- **Trade milestones:** these are computed over the finance ledger, which is capped at 200 entries, so production values can shrink as old entries are evicted. A server total would diverge, so they stay blocked.

## 6. Weekly objective catalog

`buildCanonicalWeeklyObjectiveCatalog(cycleId)` calls the production `generateWeeklyObjectives(cycleId)`. Targets, rewards and ids are therefore identical, for example `weekly_weekly_2026-W39_delivery`. There are five slots per cycle, all XP-bearing:

| Slot | Production metric | Server metric |
|---|---|---|
| delivery | `weekly_deliveries` | completed canonical deliveries in the cycle |
| reputation | `weekly_on_time_deliveries` | completed in the cycle with `actualTravelHours ≤ deadlineHours` (production `onTime = !(actual > deadline)`) |
| bonus | `weekly_cities_operated` | distinct origin and destination cities of completed deliveries in the cycle |
| warehouse | `weekly_stock_stored` | highest total canonical stock seen during the cycle (§8) |
| trade | `weekly_trade_profit` | Σ max(0, profit) of cycle sales with 29AH `SERVER_DERIVED` sale evidence |

Weekly cash has no server authority. Receipts record `CASH_BLOCKED_NO_SERVER_CASH_AUTHORITY`.

## 7. Weekly cycle

Production uses `getWeeklySeasonKey()` (ISO-8601 week, UTC) on the **device** clock. The server evaluates the same function on the **server** clock: `resolveCanonicalWeeklyCycle(nowMs)` returns `cycleId`, `startMs` (Monday 00:00 UTC) and `endMs` (start + 7 days).

- Only the current cycle is claimable. Any other cycle id gives `REWARD_CYCLE_NOT_CURRENT`.
- The window is half-open: the last millisecond before Monday 00:00 UTC belongs to the old cycle, and Monday 00:00 UTC starts the new one.
- Progress resets because each cycle only reads evidence inside its own window. There is no counter to reset.
- When `WEEKLY_MISSIONS_BACKEND_ENABLED=true`, production disables local weekly claims (`isLocalWeeklyCashMintAllowed`). The server does the same and returns `LOCAL_WEEKLY_OBJECTIVE_DISABLED_BACKEND_WEEKLY_MODE`.

## 8. Trusted progress evidence

These are read inside the claim transaction, before any write:

- `canonicalRoadDeliveries`: lifecycle, outcome, `completionReportedAtMs`, cities, `contractType`, `actualTravelHours`, `deadlineHours`.
- `canonicalCargoMarketReceipts`: BUY/SELL, quantity, `totalCashDelta`, `inventoryAfter`, `createdAtMs`.
- `canonicalProgressionReceipts` with source type `COMPANY_CARGO_SALE`: the 29AH sale evidence (`xpAuthority`, `xpEvidence.profit`).
- `canonicalCargoInventory` and `canonicalWarehouses`.
- `canonicalFleetAssets`, trusted classes only.
- `canonicalFleetMutationReceipts`: REPAIR and UPGRADE.
- `canonicalCompanyProgression`: reputation.

Only the collections the metric needs are read (`requiredEvidenceForMetric`).

Weekly stock replays cargo receipts in order (`createdAtMs`, then `inventoryRevisionAfter`). Stock carried into the week counts, as production's first sync of the week records it. A peak that happened before the week does not count. The highest total seen inside the week is kept even after selling.

## 9. Unsupported progress

A reward is refused, and nothing is written, when its trusted evidence cannot decide it:

| Reason | Cause |
|---|---|
| `CLIENT_REWARD_XP_BLOCKED_CASH_AUTHORITY` | Needs server cash (contract income, cash balance) |
| `CLIENT_REWARD_XP_BLOCKED_COMPANY_SCORE_AUTHORITY` | The score includes client cash and client inventory valuation |
| `CLIENT_REWARD_XP_BLOCKED_MARKET_PRICE_AUTHORITY` | The inventory value uses client city prices |
| `CLIENT_REWARD_XP_BLOCKED_FLEET_LOCATION_AUTHORITY` | Truck locations are not canonical for catalog-purchased trucks |
| `CLIENT_REWARD_XP_BLOCKED_LEDGER_WINDOW_PARITY` | Production progress uses the 200-entry ledger window |
| `CLIENT_REWARD_XP_BLOCKED_DRIVER_LEVEL_AUTHORITY` | Driver levels are client state |
| `CLIENT_REWARD_XP_BLOCKED_CLIENT_UI_EVENT` | A screen-open flag |
| `CLIENT_REWARD_XP_BLOCKED_CARGO_QUALITY_AUTHORITY` | A sale needed for the target was of decaying cargo |
| `CLIENT_REWARD_XP_BLOCKED_TRADE_PROFIT_AUTHORITY` | A cycle sale has no trusted profit evidence |
| `LEGACY_REWARD_PROGRESS_UNVERIFIED` | Legacy or pending-migration assets would be needed to reach the target |

**Lower-bound rule:** when unverified inputs exist but the trusted part alone reaches the target, the claim is eligible (`evidenceClass: 'LOWER_BOUND'`), because production can only be higher. Below target, the claim returns the reason above; otherwise it returns `REWARD_NOT_ELIGIBLE` with the server progress and target.

## 10. Catalog authority

The client sends only `rewardId`. Missions and milestones are looked up in the static server catalogs. A weekly id must match `weekly_(weekly_YYYY-Www)_(slot)`, its cycle must equal the server's current cycle, and it must exist in the server-generated catalog. XP, reputation, cash, target, metric, cycle and claim policy all come from the server catalog. Anything else is `UNKNOWN_REWARD`, including non-string ids.

## 11. Progress state

There is no stored progress state. Progress is recomputed from canonical evidence at claim time, so there is nothing to tamper with, nothing to back-fill, and no counter that one operation could bump twice. A `canonicalRewardProgress/{id}` rule (owner read, `write: if false`) was added defensively; the server never reads that collection. Forged docs there, and forged public-save progress, are ignored (tested).

## 12. Claim authority

The claim is `claimCanonicalClientRewardTransaction(fs, uid, rewardId, nowMs, options)`, exposed as the callable `claimCanonicalClientReward`. Allowed request keys are `rewardId` and `canonicalSchemaVersion`. Every key in `CANONICAL_CLIENT_REWARD_FORBIDDEN_CLIENT_KEYS` is rejected: progress, target, completed, claimed, xp, xpReward, rewardXp, cashReward, rewardAmount, cycle/mission/milestone/weekly progress, eligible, claimable, cycleId, seasonKey, reputation, level, amount, money, cash, and so on. The 29W key set applies too. When the XP gate is ON, the existing `claimCanonicalLocalReward` callable routes to the same transaction, and a direct 29W transaction returns `CLIENT_REWARD_XP_CLAIM_PATH_REQUIRED`.

Order inside one transaction:

1. Resolve the catalog. Stop on unknown, non-current cycle, backend weekly mode or a blocked reward.
2. Read the claim doc, the progression context (state and receipt) and the evidence.
3. Handle an existing claim (§15, §17).
4. Require `SERVER_CANONICAL_PROGRESSION`; otherwise return uninitialized or not canonical, with no claim written.
5. Reject an orphan progression receipt (`CLIENT_REWARD_XP_PROGRESSION_RECEIPT_CONFLICT`).
6. Derive progress and check eligibility.
7. Plan the progression write.
8. Apply the 29W cash, only for 29W rewards (§19).
9. Create the claim receipt.
10. Commit the progression receipt and state.

## 13. Claim receipt

Path: `users/{uid}/canonicalRewardClaims/{claimId}`. Claim ids:

- `reward:mission:{id}`
- `reward:milestone:{id}`
- `reward:weekly:{cycleId}:{objectiveId}`

Fields:

- `claimSchemaVersion` = 2, `claimId`, `rewardId`, `rewardFamily`
- `cycleId`, `cyclePolicyVersion`, `rewardXpPolicyVersion`
- `metric`, `progress`, `target`, `evidenceClass`
- `xpReward`, `reputationReward`
- `cash`: `{ productionCashReward, authority, granted, cashTransactionId }`
- `progressionOperationId`, `claimedAtMs`, `ownerUid`
- `multiplicity`: `ONE_TIME` or `ONE_PER_CYCLE`
- `authoritySource` = `INTERNAL_CANONICAL_RECEIPTS`

29W rewards also carry the 29W fields (`schemaVersion`, `eligibilityPolicyVersion`, `rewardAmount`, `cashBefore`, `cashAfter`, `cashTransactionId`), so the 29W replay check still accepts them.

## 14. Progression receipt

Op ids:

- `progression:reward:mission:{id}`
- `progression:reward:milestone:{id}`
- `progression:reward:weekly:{cycleId}:{objectiveId}`

Source types: `CLIENT_REWARD_MISSION`, `CLIENT_REWARD_MILESTONE`, `CLIENT_REWARD_WEEKLY_OBJECTIVE`. Other fields:

- `xpAuthority: 'SERVER_DERIVED'`
- `xpDelta` equal to the catalog XP
- `requestedReputationDelta` equal to the catalog reputation
- `reputationReasons`: `mission-reward`, `milestone-reward` or `weekly-reward`, the same reasons production uses
- `xpEvidence`: policy, family, reward, cycle, claim id, metric, progress, target, evidence class, XP and reputation

The receipt is written through the 29AF pipeline (`planCanonicalProgressionWrite` / `commitCanonicalProgressionWrite`), so leveling and the reputation clamp are the production ones.

## 15. Idempotency

The claim doc and the progression receipt are created together, in the same transaction, with `create`. A retry finds the claim and checks it:

- **Matches** the catalog (family, cycle, XP, reputation, op id, claim id, owner) and its progression receipt exists: `ALREADY_APPLIED`, with no writes.
- **Tampered** receipt: `CLIENT_REWARD_XP_CLAIM_CONFLICT`.
- **Unknown policy**: `CLIENT_REWARD_XP_POLICY_UNKNOWN`.
- **Claim present but progression receipt missing**: `CLIENT_REWARD_XP_PROGRESSION_RECEIPT_CONFLICT`.

A replayed delivery report does not add a delivery, so it cannot move progress twice.

## 16. Two-device

Two or three concurrent claims for the same reward serialize on the claim doc. Exactly one returns `APPLIED`; the others return `ALREADY_APPLIED`. XP, reputation and the receipt count change once (tested with `Promise.all`). A claim racing with a progress-changing operation sees either the state before it or after it. Both outcomes are safe, because eligibility is decided from the evidence inside the claim's own snapshot.

## 17. Historical progress

A reward claimed under 29W before XP authority (a receipt without `rewardXpPolicyVersion` and with policy `canonical-local-reward-internal-v1`) returns `ok` with `CLIENT_REWARD_XP_HISTORICAL_CLAIM_UNAPPLIED`. It grants no XP and no cash, and the old receipt is left untouched. An existing claim with no XP policy that is not a 29W reward returns `CLIENT_REWARD_XP_POLICY_UNKNOWN`. There is no automatic back-fill of historical local claims or progression.

## 18. Legacy save behavior

The public save (`users/{uid}/saves/current`), including its `missions`, `retention`, `rewardReceipts`, `player.completedContracts` and trucks, is never read. Legacy and pending-migration fleet assets never complete a target (`LEGACY_REWARD_PROGRESS_UNVERIFIED`); they can only coexist with a trusted lower bound that already reaches it. Local claims already made in the public save do not block or trigger canonical claims.

## 19. Cash coexistence

- **`own_2_trucks` and `ms_second_truck`:** these already had 29W server cash. The claim applies XP plus the 29W cash in one transaction, reusing the 29W mutation: transaction id equals the claim id (`reward:mission:own_2_trucks`), with operation types `CANONICAL_MISSION_REWARD` / `CANONICAL_MILESTONE_REWARD`. It requires the 29W gate; otherwise it returns `CLIENT_REWARD_CASH_AUTHORITY_REQUIRED` and writes nothing.
- **All other rewards:** XP and reputation only. The receipt records `cash.authority: 'CASH_BLOCKED_NO_SERVER_CASH_AUTHORITY'` and `granted: false`. No cash transaction, server-cash change or public-save money change happens (tested).
- **Badges:** client cosmetics, not granted canonically.
- **Old 29W claims:** immutable (§17).

## 20. XP leveling

XP goes through `applyCanonicalCompanyXp` (production `applyXpToPlayer` semantics); reputation goes through the production clamp. Tests cover a level-up from reward XP (200 XP at 10 XP below the threshold), and the clamp at reputation 100 (requested +1, applied 0). The existing contract batch keeps its frozen `playerLevel`; the next refresh uses the new level.

## 21. Public UI limitations

`MissionsScreen`, the store claim functions and `ContractsScreen` are unchanged and not wired. Public mission, milestone and weekly XP stays local (`addCompanyXp(... 'mission_reward' | 'milestone_reward' | 'weekly_objective_reward')`). Guests are rejected (`UNAUTHENTICATED`). No public progression or Contracts UI changes were made.

## 22. Progression readiness

`CANONICAL_PROGRESSION_READINESS` = `CANONICAL_PROGRESSION_BLOCKED_UNSUPPORTED_REWARD_PROGRESS` (previously `..._CLIENT_REWARD_XP_SOURCES`).

Remaining blockers (`CANONICAL_PROGRESSION_REMAINING_BLOCKERS`):

- `UNSUPPORTED_REWARD_PROGRESS`
- `CARGO_QUALITY_AUTHORITY`
- `LEGACY_PROGRESSION_MIGRATION`
- `PUBLIC_PROGRESSION_UI`

Remaining client XP sources:

- `trade-sale-quality-decay`
- `missions-unsupported-progress`
- `milestones-unsupported-progress`
- `weekly-trade-untrusted-profit`
- `operation-choices`
- `vehicle-recovery` (reputation only)

Client-reward readiness is internal `CLIENT_REWARD_XP_INTERNAL_PARTIAL` and public `CLIENT_REWARD_XP_BLOCKED_LEGACY_HISTORY`. The classifier also defines `_CANONICAL_READY`, `_BLOCKED_CLIENT_PROGRESS`, `_BLOCKED_CASH_AUTHORITY`, `_BLOCKED_WEEKLY_CLOCK` and `_BLOCKED_INCIDENT_PARITY`.

## 23. Contract issuance impact

Issuance readiness stays `ROAD_CONTRACT_ISSUANCE_BLOCKED_PUBLIC_PROGRESSION`. `COMPANY_XP_CLIENT_REWARD_SOURCES_CLIENT_OWNED` is replaced by `COMPANY_XP_CLIENT_REWARD_SOURCES_INTERNAL_PARTIAL` and `COMPANY_XP_UNSUPPORTED_REWARD_PROGRESS_CLIENT_OWNED`. Reward XP raises canonical level, and the next refresh reads it; existing batches are unchanged.

## 24. Remaining reward blockers

- **5 missions and 11 milestones** remain blocked on cash authority, company score, market prices, fleet location, ledger-window parity, driver level or the UI event.
- **Weekly trade** counts only trusted, zero-decay sales, which ties it to cargo quality authority.
- **Legacy history:** local claims and progress in public saves are not imported, so public readiness is blocked on legacy history.
- **Cash:** reward cash outside the two 29W rewards has no server authority.
- **Ads:** ad rewards remain unverified.

## 25. Next step

This step is internal only. It does not solve cargo quality decay, does not wire public missions, milestones, weeklies, progression or Contracts UI, does not enable production ROAD settlement, the HUD overlay, the cash listener or `cashAuthorityVersion=1`, does not import legacy progression or reward history, and does not implement multimodal settlement or activate RAIL/SEA/AIR. The next step should come from the 29AI report. The dominant remaining progression blocker is legacy progression and reward-history migration (`LEGACY_PROGRESSION_MIGRATION`); cargo quality authority is the other shared blocker.


Step 29AJ/29AK: legacy progression migration is internal only. Apply uses a create-only frozen source (`MAP_V2_LEGACY_SAVE_AUTHORITY_HARDENING.md`). Public rollout remains blocked. Cash authority, ROAD settlement, and RAIL/SEA/AIR are unchanged.


Step 29AL: internal immediate progression cutover reads the save and creates the frozen source plus migration in one transaction (`MAP_V2_LEGACY_PROGRESSION_IMMEDIATE_CUTOVER.md`). Public rollout remains blocked by `PUBLIC_PROGRESSION_UI_SPLIT_BRAIN`. Cash authority and ROAD settlement are unchanged.

Step 29AM: internal UI read authority for canonical level, XP, and reputation is `CANONICAL_PROGRESSION_READ_AUTHORITY_PASS_INTERNAL_ONLY` (`MAP_V2_CANONICAL_PROGRESSION_READ_AUTHORITY.md`). Mission progress UI stays local. Cash authority and ROAD settlement are unchanged.

Step 29AN: eligibility for shop and warehouse level gates can follow that read model (`MAP_V2_CANONICAL_PROGRESSION_ELIGIBILITY_AUTHORITY.md`). Mission progress, ads, and delivery boost stay local. Cash authority and ROAD settlement are unchanged.

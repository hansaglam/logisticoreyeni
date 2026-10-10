# Map V2 — Multimodal production migration plan

**Step 22 persistence foundation is complete** (`multimodalShipments: []` only). Do not generate live multimodal contracts until later numbered steps.

Default: `MULTIMODAL_OFF`. Live ROAD `Contract` / `Delivery` unchanged.

---

## Principles

1. Additive save fields only; never convert in-flight `Delivery`.  
2. Visual `turkey-*-corridors.json` is not routing truth.  
3. Player owns trucks; books RAIL/SEA/AIR capacity (ADR 0009).  
4. First production mode: **RAIL**.  
5. Feature flag can stop **new** offers without deleting in-flight shipments.  
6. DEV simulator remains the semantic reference for the reducer; production replaces DEV timing and `DEV_SIMULATED_ROAD_CARRIER`.

---

## Recommended subsequent steps

### STEP 22 — Shipment persistence schema (flagged, empty) — **COMPLETE**

Live types: `src/domain/multimodalShipmentPersistence.ts`.  
Save: additive `multimodalShipments` default `[]`. `SAVE_GAME_VERSION` remains **6** (ADR 0012 nested `shipmentSchemaVersion`).  
`MULTIMODAL_OFF`. No generator, no UI, no gameplay.  
`multimodalContractOffers` deferred (no live offers field yet).

Tests: missing field loads; ROAD delivery unchanged; malformed omit; unknown schema unreadable.

See `MAP_V2_MULTIMODAL_PERSISTENCE_FOUNDATION.md`.

### STEP 23 — Settlement / idempotency contract — **COMPLETE**

Live helpers: `src/domain/multimodalSettlementIdentity.ts`  
Namespace: `shipment:{shipmentId}:revenue` (and `…:completion`).  
`canonicalDeliveryCompletions` **unchanged** (ROAD `deliveryId` docs only).  
No Cloud Function deployed; future callable documented as type-only.  
No cash / Firestore / `serverState` mutation.

See `MAP_V2_MULTIMODAL_SETTLEMENT_IDEMPOTENCY.md`.

### STEP 24 — Production duration policy (not DEV speeds) — **COMPLETE**

Live module: `src/domain/multimodalDurationPolicy.ts` (`multimodal-duration-policy-v1`).  
Canonical unit: integer game seconds. ROAD movement reuses `calculateContractDurationHours.travelHours`.  
DEV inspector playback: `getDevPlaybackWallMs` only.  
Save envelope unchanged (v6). No payout. RAIL/SEA/AIR remain `FOUNDATION_ONLY`.

See `MAP_V2_MULTIMODAL_DURATION_POLICY.md`.

### STEP 25 — ROAD first/last-mile production semantics — **COMPLETE**

Live planner: `src/domain/multimodalRoadAssignment.ts` (planned only, no reservation).  
Compact access: `src/mapV2/generated/multimodal/turkey-road-transfer-access.json` (offline Dijkstra).  
Duration authority: `SOURCE_BACKED_ROAD_TRANSFER_ACCESS`. 5 km stub removed from vertical slices.  
`SAVE_GAME_VERSION` remains **6**. RAIL/SEA/AIR remain `FOUNDATION_ONLY`.

See `MAP_V2_MULTIMODAL_ROAD_ASSIGNMENT.md`.

### STEP 26 — RAIL tariff / economy foundation — **COMPLETE**

Live module: `src/domain/multimodalRailTariff.ts` (`multimodal-rail-tariff-v1`).  
Third-party RAIL **carrier COST** only (integer game dollars). Not player reward, not settlement, not ROAD fuel/toll.  
Accepted diagnostic corridors only. `RAIL_TRANSFER_MONETARY_FEE = 0` in v1.  
`SAVE_GAME_VERSION` remains **6**. No live snapshot write. RAIL/SEA/AIR remain `FOUNDATION_ONLY`.  
`MULTIMODAL_OFF`. No generator, no UI, no money mutation.

See `MAP_V2_MULTIMODAL_RAIL_TARIFF.md`.

### STEP 27 — RAIL contract generation foundation — **COMPLETE**

Live modules: `src/domain/multimodalRailOffer.ts`, `src/domain/multimodalRailOfferEconomics.ts`.  
Isolated ROAD→RAIL→ROAD **offer candidates** only. Not inserted into `availableContracts`.  
`MULTIMODAL_OFF`. `SAVE_GAME_VERSION` remains **6**. No acceptance, shipment, money, or reservation.

See `MAP_V2_MULTIMODAL_RAIL_OFFER_GENERATION.md`.

### STEP 28 — Player UI: contract card + active timeline — **COMPLETE (foundation, not live)**

Production-safe RAIL offer **presentation** on existing İşler/Contracts secondary segment **Raylı**, hidden unless internal UI preview (`EXPO_PUBLIC_MAP_V2_MULTIMODAL_UI_PREVIEW=true` + `__DEV__` + still `MULTIMODAL_OFF`).  
Disabled CTA **Yakında**. No accept, shipment, money, reservation, persistence, or MapScreen routes.  
Live ROAD pool / `ContractCard` / `startDelivery` unchanged when preview is off.

See `MAP_V2_MULTIMODAL_UI_FOUNDATION.md`.

### STEP 29 — INTERNAL_TEST RAIL acceptance + execution — **COMPLETE (gated, unsettled)**

Live modules: `multimodalFeatureRollout.ts`, `multimodalRailAcceptance.ts`, `multimodalRailExecution.ts`.  
Env: `EXPO_PUBLIC_MULTIMODAL_ROLLOUT=INTERNAL_TEST`. Default remains `MULTIMODAL_OFF`. Preview env cannot mutate.  
Prepare/commit split. Step 25 revalidation. Persisted `multimodalShipments[]`. `SAVE_GAME_VERSION` **6**.  
Execution `multimodal-execution-v1` → `COMPLETED_UNSETTLED`. No money, ledger, settlement, XP, reputation.  
Kill switch: no new offers; in-flight continues.

See `MAP_V2_MULTIMODAL_INTERNAL_TEST_ACTIVATION.md`.

### STEP 29B — RAIL settlement / authority foundation — **LOCAL PASS / SERVER BLOCKED**

Live module: `src/domain/multimodalRailSettlement.ts`. Guest/local INTERNAL_TEST applies frozen `playerPayment` − `railCarrierCost` with `shipment:{id}:revenue` and `shipment:{id}:rail_carrier`.  
Signed-in path **blocked**: no canonical shipment record; save blob is not trusted; no callable.  
`SAVE_GAME_VERSION` **6**. RAIL/SEA/AIR remain `FOUNDATION_ONLY`. `MULTIMODAL_OFF` default. No ROAD `canonicalDeliveryCompletions` reuse.

See `MAP_V2_MULTIMODAL_RAIL_SETTLEMENT_AUTHORITY.md`.

### STEP 29C — Canonical multimodal shipment + server money authority foundation — **PASS / SETTLEMENT DEFERRED**

Live: `src/domain/canonicalMultimodalRailEconomics.ts`, `backend/src/canonicalMultimodalShipment.ts`.  
Callables: `acceptCanonicalMultimodalShipment`, `reportCanonicalMultimodalShipmentCompleted`, `cancelCanonicalMultimodalShipment`. **No** `settleCanonicalMultimodalShipment`.  
Path: `users/{uid}/canonicalMultimodalShipments/{shipmentId}`. Model A recomputation. Client money not trusted.  
Signed-in cash mutation deferred: ROAD still uses save `player.money`; canonical payout field is `serverState.cash` (client cannot write it).  
`SAVE_GAME_VERSION` **6**. Public default `MULTIMODAL_OFF`. SEA/AIR off.

See `MAP_V2_CANONICAL_MULTIMODAL_AUTHORITY.md`.

### STEP 29D — Unified signed-in cash authority — **BLOCKED_ROAD_ECONOMY**

Policy: `src/domain/cashAuthority.ts`. Target remains `serverState.current.cash`. Overlay/listener **off**.  
ROAD completeDelivery, fuel, purchases, daily opex still mutate local `player.money`. Enabling overlay would snap HUD back to marketplace/server cash and undo ROAD earnings/expenses.  
No `updateCash({delta})`. No multimodal settlement. `canUseServerAuthoritativeSettlement()` is false.  
`SAVE_GAME_VERSION` **6**. `MULTIMODAL_OFF`. SEA/AIR off.

See `MAP_V2_UNIFIED_SIGNED_IN_CASH_AUTHORITY.md`.

### STEP 29E — Canonical ROAD cash operations foundation — **PASS (HUD unchanged)**

Internal `canonicalCashTransactions` + backend helper (test credit/debit only). Full write matrix. **No** generic delta callable. **No** ROAD delivery/fuel/truck production callable. Overlay/listener still off. Settlement gate still `ROAD_ECONOMY_NOT_SERVER_CANONICAL_PRODUCTION_FLEET` (Step 29J).  
See `MAP_V2_CANONICAL_ROAD_CASH_OPERATIONS.md` and `ROAD_CASH_CANONICALIZATION_MATRIX.md`.

### STEP 29F — Canonical ROAD delivery economy — **PASS_SHADOW_ONLY**

Server-owned `canonicalRoadDeliveries` / `canonicalRoadContracts` (Admin write). Accept/report callables **do not move cash**. Live `generateContracts` remains client-world/RNG; live payment is not independently issued. Shadow vectors MATCH on trusted issuance fixtures. Overlay/listener off.

See `MAP_V2_CANONICAL_ROAD_DELIVERY_ECONOMY.md`.

### STEP 29G — Canonical ROAD contract issuance — **PASS_INTERNAL_POLICY_ONLY**

Server-owned INTERNAL_TEST batches (`canonical-road-contract-issuance-internal-v1`). Live city-stock generator unchanged. Production parity blocked on world-state authority. Accept binds to issued docs; no cash. Contracts UI not wired.

See `MAP_V2_CANONICAL_ROAD_CONTRACT_ISSUANCE.md`.

### STEP 29H — Canonical ROAD execution economics snapshot — **PASS_INTERNAL_TRUCK_POLICY_ONLY**

Server-owned immutable `executionEconomicsSnapshot` on `canonicalRoadDeliveries` at INTERNAL_TEST accept. Fixture truck/trailer economics only (live save fleet is not authority). Shadow derivation matches live `createDelivery`/`completeDelivery` formulas for those fixtures. **No cash.** Overlay/listener off. Dominant remaining blocker: client `actualTravelHours`.

See `MAP_V2_CANONICAL_ROAD_EXECUTION_ECONOMICS.md`.

### STEP 29I — Canonical ROAD timing authority — **PASS_INTERNAL_FIXED_SPEED_ONLY**

Server-owned `timingSnapshot` at accept. Frozen 1x wall-clock (`15000` ms / game hour). Completion ignores client `actualTravelHours`. Late penalty from server elapsed. **No cash.** Overlay/listener off. Next blocker: live truck state.

See `MAP_V2_CANONICAL_ROAD_TIMING_AUTHORITY.md`.

### STEP 29J — Canonical ROAD fleet economic authority — **PASS_INTERNAL_FIXTURES**

Server-owned `canonicalFleetAssets` for INTERNAL_TEST fixtures. Accept reads those docs; client condition/upgrades rejected. Live save fleet remains `LEGACY_CLIENT_FLEET_UNVERIFIED`. **No cash.** Overlay/listener off.

See `MAP_V2_CANONICAL_ROAD_FLEET_ECONOMIC_AUTHORITY.md`.

### STEP 29K — Canonical ROAD server-cash shadow settlement — **PASS**

INTERNAL_TEST `settleCanonicalRoadDeliveryInternal` applies `serverState.cash` for standard canonical fixture jobs (exactly-once, immutable receipt). HUD/`player.money` unchanged. Overlay/listener off. Production fleet still unverified.

See `MAP_V2_CANONICAL_ROAD_SERVER_CASH_SHADOW_SETTLEMENT.md`.

### STEP 29L — Production fleet authority migration — **PASS_NEW_ASSETS_ONLY**

No automatic legacy import. Catalog/starter mint helpers create `cfa_*` SERVER_CANONICAL docs without cash or public UI. Marketplace identity is server-canonical; listing economics remain client-originated. Wear/repair/upgrade not persisted.

See `MAP_V2_PRODUCTION_FLEET_AUTHORITY_MIGRATION.md` and `PRODUCTION_FLEET_AUTHORITY_MATRIX.md`.

### STEP 29M — Canonical fleet condition / delivery-wear — **PASS_SUCCESS_ONLY**

Server derives BASE_DELIVERY_WEAR from `calculateConditionLoss` with frozen driver attention 100. Persists once onto `canonicalFleetAssets`, increments `economicRevision`, writes `canonicalFleetMutationReceipts`. Accept reserves the asset. FAILED/incident/cancel do not apply trusted wear (fail/incident blocked; cancel releases reservation). **No cash.** Overlay/listener off. Next: repair (no free restore).

See `MAP_V2_CANONICAL_FLEET_CONDITION_WEAR_AUTHORITY.md`.

### STEP 29N — Canonical fleet repair / upgrade — **PASS_INTERNAL_ONLY**

INTERNAL_TEST `repairCanonicalFleetAsset` / `upgradeCanonicalFleetAsset`. Server-derived cost, `serverState.cash` debit, revision+1, mutation receipts. Production UI remains local. Overlay/listener off. Next: incident / fragile / failure.

See `MAP_V2_CANONICAL_FLEET_REPAIR_UPGRADE_AUTHORITY.md`.

### STEP 29O — Canonical incident / fragile / failure — **PASS_INTERNAL_POLICY_ONLY**

Server-issued incident plan at accept (gate on). `finalizeCanonicalRoadExecution` applies catalog cash/condition once. too_late is SERVER_DERIVED_FAILURE (half wear). Client FAILED unverified. Fragile uses completion-before-wear truck condition. Production UI local. Production incident parity blocked. Next: remaining ROAD cash or production incident parity.

See `MAP_V2_CANONICAL_ROAD_INCIDENT_FRAGILE_FAILURE_AUTHORITY.md`.

### STEP 29P — Remaining ROAD cash path canonicalization — **PASS_FOUNDATION**

Classified every production cash write. INTERNAL_TEST `purchaseCanonicalCatalogAsset` (server-derived catalog price, atomic cash+asset+receipt). Fuel/warehouse/cargo/opex/rewards/sale/hire remain blocked honestly. HUD overlay/listener off. `cashAuthorityVersion` 0. Next: fuel tank/price authority or other HUD blockers — **not** multimodal settlement.

See `MAP_V2_REMAINING_ROAD_CASH_PATH_CANONICALIZATION.md` and `SIGNED_IN_CASH_AUTHORITY_READINESS_MATRIX.md`.

### STEP 29Q — Canonical fuel tank / price — **PASS_INTERNAL_ONLY**

INTERNAL_TEST `purchaseCanonicalFuel` (FILL_TO_CAPACITY / BUY_LITERS). Canonical tank + `fuelRevision` on SERVER_CANONICAL / fixture trucks. Price from `globalEconomy` or 1.72 fallback. Canonical accept burns required liters once (not production progressive). Roadside/incident tank blocked. HUD overlay off. Fuel still blocks HUD migration.

See `MAP_V2_CANONICAL_FUEL_TANK_PRICE_AUTHORITY.md`.

### STEP 29R — Core vehicle / staff cash — **PASS_FOUNDATION**

INTERNAL_TEST lease start (prepaid catalog), DRIVER_POOL hire, roster fire, canonical sale with `mileageKm`. Recovery fail-closed (`VEHICLE_RECOVERY_BLOCKED_CLIENT_EXECUTION_STATE`). Recurring lease belongs to daily opex (not billed here). Public UI unwired. HUD 24/0/24. Next: daily opex/staff clock or warehouse state — **not** multimodal settlement.

See `MAP_V2_CORE_VEHICLE_STAFF_CASH_AUTHORITY.md`.

### STEP 29S — Canonical daily opex / staff state — **PASS_INTERNAL_CLOCK_ONLY**

INTERNAL_TEST 24h server wall-clock cursor (`canonical-daily-opex-internal-fixed-v1`). Charges canonical hired salaries + operations; lease recurring **0** (prepaid). Warehouse excluded. Catch-up cap 1 period/call; public offline still 0. Overdraft parity blocked (local −5000 vs server floor 0). HUD 24/0/24. Next: warehouse state — **not** multimodal settlement.

See `MAP_V2_CANONICAL_DAILY_OPEX_STAFF_STATE_AUTHORITY.md`.

### STEP 29T — Canonical warehouse state — **PASS_INTERNAL_ONLY**

INTERNAL `openCanonicalWarehouse` / `upgradeCanonicalWarehouse`. Server-derived city/type/price/level/capacity/opex. Per-site warehouse opex in daily settlement. Public warehouse UI local. Company level INTERNAL policy 10. Inventory not required for opex. HUD 24/0/24. Overdraft parity came in 29V. Next at the time: cargo world state — **not** multimodal settlement.

See `MAP_V2_CANONICAL_WAREHOUSE_STATE_AUTHORITY.md`.

### STEP 29U — Canonical cargo market / world state — **PASS_INTERNAL_POLICY_ONLY**

INTERNAL_TEST `canonical-cargo-market-internal-v1` snapshots (`canonicalWorldMarkets`), warehouse-bound `canonicalCargoInventory`, atomic `buyCanonicalCargo` / `sellCanonicalCargo`. At the time of 29U there was no production tick. Public market stayed local. Step 29Z later moved contract market state to `ROAD_CONTRACT_MARKET_STATE_INTERNAL_ONLY`. HUD 24/0/24.

See `MAP_V2_CANONICAL_CARGO_MARKET_WORLD_STATE_AUTHORITY.md`.

### STEP 29V — Canonical daily opex overdraft — **PASS_INTERNAL_ONLY**

`CANONICAL_DAILY_OPEX` uses production mandatory-expense semantics (`minCashBalance = -5000`, partial debit, no debt ledger). Voluntary purchases and ROAD shadow stay at floor 0. Clock remains INTERNAL. Legacy state unverified. HUD 24/0/24. Next: local reward claim authority — **not** multimodal settlement.

See `MAP_V2_CANONICAL_DAILY_OPEX_OVERDRAFT_POLICY.md`.

### STEP 29W — Canonical local reward claims — **PASS_PARTIAL**

INTERNAL claims for `own_2_trucks` and `ms_second_truck` from canonical fleet count. Other missions/milestones stay on local progress. Ads remain client `EARNED_REWARD` with no SSV. Weekly/season/challenge claims unchanged and not dual-paid. HUD 24/0/24. Next: production fuel progressive — **not** multimodal settlement.

See `MAP_V2_CANONICAL_LOCAL_REWARD_CLAIM_AUTHORITY.md`.

### STEP 29X — Production progressive fuel — **PASS_INTERNAL_ONLY**

INTERNAL deliveries can burn fuel from server-timed progress instead of a full accept burn. The formula reuses `advanceFuelConstrainedProgress`. Production offline/background catch-up, roadside purchase, incident liters, and legacy tanks stay outside this gate. Public refuel and ROAD settlement stay local. HUD 24/0/24. Next: production timing and offline execution — **not** multimodal settlement.

See `MAP_V2_PRODUCTION_PROGRESSIVE_FUEL_AUTHORITY.md`.

### STEP 29Y — Production ROAD timing and offline execution — **PASS_INTERNAL_ONLY**

New INTERNAL deliveries can use `canonical-road-execution-timing-internal-v1`. Server elapsed, speed buckets, and the 24-game-hour cap drive progress, fuel, and deadline hours. Step 29I fixed-speed snapshots stay valid when that policy is absent. Public multi-delivery speed, driver duration, paused-offline catch-up, and device clocks stay outside this gate. HUD 24/0/24. Next: production market tick — **not** multimodal settlement.

See `MAP_V2_PRODUCTION_ROAD_TIMING_OFFLINE_EXECUTION_AUTHORITY.md`.

### STEP 29Z — Production market tick — **PASS_INTERNAL_ONLY**

INTERNAL rows stamped `canonical-production-market-tick-internal-v1` take price and epoch supply from the 30-minute global snapshot. Tradable stock stays the buy/sell balance. Unstamped 29U snapshots do not tick. Public market UI stays local. Contract generation still reads save cities, local events, and `randomBetween`. HUD 24/0/24. Next: public ROAD contract issuance parity — **not** multimodal settlement.

See `MAP_V2_PRODUCTION_MARKET_TICK_AUTHORITY.md`.

### STEP 29AA — Production ROAD contract issuance parity — **PASS_INTERNAL_ONLY**

INTERNAL batches call `generateContracts` with epoch supply, epoch prices, a server seed, and a server progression document. Contract world events are not the market-epoch schedule, so public readiness stays `ROAD_CONTRACT_ISSUANCE_BLOCKED_WORLD_EVENTS`. Public Contracts UI stays local. HUD 24/0/24. Next: contract world-event authority — **not** multimodal settlement.

See `MAP_V2_PRODUCTION_ROAD_CONTRACT_ISSUANCE_PARITY.md`.

### STEP 29AB — Contract world-event authority — **PASS_INTERNAL_ONLY**

Server schedule uses the production `worldEvents.ts` templates, not the 29Z epoch events. Payment and duration multipliers are derived on the server and frozen on the batch and each offer. v1 batches stay multiplier 1. Public Contracts UI stays local. Readiness after 29AB was `ROAD_CONTRACT_ISSUANCE_BLOCKED_FLEET_LOCATION`. HUD 24/0/24. Next at that point: fleet location — **not** multimodal settlement.

See `MAP_V2_CONTRACT_WORLD_EVENT_AUTHORITY.md`.

### STEP 29AC — Canonical fleet runtime location — **PASS_INTERNAL_ONLY**

Server runtime city and idle/busy status drive INTERNAL idle-origin scoring. Trucks are not teleported to a contract origin. v1 and v2 batches stay unchanged. Public readiness after 29AC was `ROAD_CONTRACT_ISSUANCE_BLOCKED_GAME_TIME_EXPIRY`. HUD 24/0/24. Next at that point: game-time offer expiry — **not** multimodal settlement.

See `MAP_V2_CANONICAL_FLEET_RUNTIME_LOCATION_AUTHORITY.md`.

### STEP 29AD — Contract game-time expiry — **PASS_INTERNAL_ONLY**

v4 offers expire on an INTERNAL account game-hour clock. Pause stops accrual. Speed uses the production millisecond buckets. A long gap uses the 24-real-hour then 24-game-hour cap. v1, v2, and v3 keep the server window. Public readiness after 29AD was `ROAD_CONTRACT_ISSUANCE_BLOCKED_REFRESH_GAME_TIME`. HUD 24/0/24. Next at that point: refresh game-time parity — **not** multimodal settlement.

See `MAP_V2_CONTRACT_GAME_TIME_EXPIRY_AUTHORITY.md`.

### STEP 29AE — Contract refresh game-time parity — **PASS_INTERNAL_ONLY**

Manual refresh cooldown is 3 trusted game hours on the same account clock. A refresh appends at most 3 offers and does not replace still-valid ones. Retry and a second device do not create a second roll. v5 identity is the refresh sequence. Public readiness is `ROAD_CONTRACT_ISSUANCE_BLOCKED_PUBLIC_PROGRESSION`. HUD 24/0/24. Next: public progression — **not** multimodal settlement.

See `MAP_V2_CONTRACT_REFRESH_GAME_TIME_PARITY.md`.

### STEP 29AF — Canonical company progression / reputation — **BLOCKED_XP_SOURCE**

Server-owned `canonicalCompanyProgression/current` for new canonical accounts (level 1, XP 0, reputation 50). Canonical completion, cancel, and server-derived failure apply exact production reputation once, with receipts. Client FAILED applies nothing. Completion XP is blocked because the delivery risk tier (driver attention/speed, truck reliability) is not frozen from trusted state. Legacy saves are not imported. Public readiness stays `ROAD_CONTRACT_ISSUANCE_BLOCKED_PUBLIC_PROGRESSION`. HUD 24/0/24. Next: delivery risk-tier / driver assignment authority — **not** multimodal settlement.

See `MAP_V2_CANONICAL_COMPANY_PROGRESSION_AUTHORITY.md`.

### STEP 29AG — Canonical delivery risk tier / driver assignment — **PASS_INTERNAL_ONLY**

Canonical accept (gate `CANONICAL_ROAD_DRIVER_RISK_AUTHORITY=INTERNAL_TEST`) binds a server-owned canonical driver atomically, one delivery per driver. It freezes catalog attention, speed, fuelSaving and tier, plus truck reliability and pre-wear condition, into `canonical-road-delivery-risk-tier-v1` / `canonical-road-driver-snapshot-v1`. Completion grants exact production XP once through the 29AF receipt, and only when netProfit inputs are trusted (driver economics v2, server fuel price, canonical world events, no unresolved fragile incident). The driver is released on completion, cancel and failure, and kept while out of fuel. Legacy drivers are rejected; old deliveries stay XP-blocked. Progression status is now `PASS_INTERNAL_ONLY`, readiness `CANONICAL_PROGRESSION_BLOCKED_NON_DELIVERY_XP_SOURCES`. Issuance stays `ROAD_CONTRACT_ISSUANCE_BLOCKED_PUBLIC_PROGRESSION`. HUD 24/0/24. Next: from the 29AG report — **not** multimodal settlement.

See `MAP_V2_CANONICAL_DELIVERY_RISK_DRIVER_AUTHORITY.md`.

### STEP 29AH — Canonical non-delivery company XP — **PASS_PARTIAL**

Gate `CANONICAL_NON_DELIVERY_XP_AUTHORITY=INTERNAL_TEST`, policy `canonical-company-non-delivery-xp-v1`. The following canonical operations grant exact production XP once, through the 29AF receipt, in the same transaction:
- truck purchase +30;
- driver hire +10;
- warehouse open +40;
- warehouse upgrade +25 per tier;
- cargo sale by the trade formula.

Cargo-sale XP needs a trusted server cost basis (`canonical-cargo-cost-basis-v1`, recorded on buys) and a zero-decay product/warehouse pair. Other sales record 0 with `CARGO_SALE_XP_BLOCKED_COST_BASIS_AUTHORITY` or `CARGO_SALE_XP_BLOCKED_QUALITY_AUTHORITY`.

Other rules:
- No backfill of earlier operations.
- Client XP and profit keys are rejected.
- No second cash transaction.

Progression readiness is now `CANONICAL_PROGRESSION_BLOCKED_CLIENT_REWARD_XP_SOURCES`. Issuance stays `ROAD_CONTRACT_ISSUANCE_BLOCKED_PUBLIC_PROGRESSION`. HUD 24/0/24. Next: from the 29AH report, **not** multimodal settlement.

See `MAP_V2_CANONICAL_NON_DELIVERY_COMPANY_XP_AUTHORITY.md`.

### STEP 29AI — Canonical client-reward XP — **PASS_PARTIAL**

Gate `CANONICAL_CLIENT_REWARD_XP_AUTHORITY=INTERNAL_TEST`, policy `canonical-client-reward-xp-v1`, weekly cycle `canonical-weekly-objective-cycle-iso-utc-v1` (production ISO week, UTC, on the server clock).

- **Catalog:** server catalogs are built from the production missions, milestones and weekly generator.
- **Claim:** the client sends only `rewardId`. Progress is derived at claim time from canonical deliveries, cargo receipts, 29AH sale evidence, inventory, warehouses, trusted fleet, fleet repair/upgrade receipts and progression reputation. There are no stored counters.
- **Grant:** exact XP plus production reputation, once, through the 29AF receipt.
- **Canonical coverage:** 7/12 missions, 30/41 milestones, 5/5 weekly slots. The rest fail closed with their exact authority (cash, company score, market price, fleet location, ledger window, driver level, UI event).
- **Cash:** only `own_2_trucks` and `ms_second_truck` keep their 29W cash, in the same transaction. All other reward cash is recorded as `CASH_BLOCKED_NO_SERVER_CASH_AUTHORITY`.
- **History:** historical 29W claims get no retroactive XP. Nothing is back-filled.

Progression readiness is now `CANONICAL_PROGRESSION_BLOCKED_UNSUPPORTED_REWARD_PROGRESS`. Issuance stays `ROAD_CONTRACT_ISSUANCE_BLOCKED_PUBLIC_PROGRESSION`. HUD 24/0/24. Next: from the 29AI report, **not** multimodal settlement.

See `MAP_V2_CANONICAL_CLIENT_REWARD_XP_AUTHORITY.md`.

### STEP 30 — Unified HUD overlay / multimodal payout (after ROAD credits+debits are canonical)

Server-validated ROAD credits **and** live debits, then stale-save overlay + `settleCanonicalMultimodalShipment`.

### STEP 31 — SEA production slice (optional after signed-in RAIL settlement)

- Same shipment schema; SEA adapter; port handling snapshot; no ships.

### STEP 32 — AIR production slice

- Geodesic diagnostics; IST/COV gates; not a flight plan in copy.

### STEP 32 — Map V2 country overlay for active shipment (optional)

- Static highlight only; no animated vehicles.

### Later (not scheduled until RAIL MVP ships)

Owned rolling stock; exact ROAD path to infra; warehouse↔GeoPort bind; per-leg reputation; multi-middle ROAD→RAIL→SEA.

---

## Why this order (not the example A–G blindly)

Persistence and settlement **before** generator/UI prevents undeliverable offers. Duration policy before economy so snapshots have a clock. **RAIL before SEA/AIR** because inland pairs (Ankara) match existing ROAD demand, diagnostics are path-based, and there is no 98MB graph or aircraft model. Economy before UI so cards do not show invented prices. SEA/AIR reuse the same persist/UI once RAIL settlement is proven.

---

## MVP mode choice (detail)

| | RAIL | SEA | AIR |
|---|---|---|---|
| Data confidence | High (Dijkstra report + access nodes) | High but graph-heavy | High geodesic, few pairs |
| Transfer complexity | Station / Yenice honesty | DIRECT/REGIONAL ports, channels | Airport IATA education |
| Economy | Access charge | Port + freight | Air freight |
| Assets | None if booked | None if booked | None if booked |
| Player comprehension | Strong | Strong coastal | Weaker (“not a flight”) |
| Engineering risk | Medium | Higher (maritime) | Lower route math, higher copy risk |

**Recommendation: RAIL.**

---

## Rollout

`DEV_PREVIEW` = current simulator (already exists).  
Step 28 adds **internal UI preview** (DEV + env), still `MULTIMODAL_OFF`.  
`INTERNAL_TEST` starts at Step **29**.  
`PRODUCTION_ROLLOUT` only after settlement + resume + flag rollback tests pass.

---

## Explicit non-goals until named steps

Persist runtime, modify `Contract`/`Delivery`, Firestore schema, economy live numbers, activate RAIL/SEA/AIR gameplay, MapScreen, owned trains/ships/aircraft.


Step 29AJ/29AK: legacy progression migration is internal only. Apply uses a create-only frozen source (`MAP_V2_LEGACY_SAVE_AUTHORITY_HARDENING.md`). Public rollout remains blocked. Cash authority, ROAD settlement, and RAIL/SEA/AIR are unchanged.


Step 29AL: internal immediate progression cutover reads the save and creates the frozen source plus migration in one transaction (`MAP_V2_LEGACY_PROGRESSION_IMMEDIATE_CUTOVER.md`). Public rollout remains blocked by `PUBLIC_PROGRESSION_UI_SPLIT_BRAIN`. Cash authority and ROAD settlement are unchanged.

Step 29AM: internal canonical progression display (`MAP_V2_CANONICAL_PROGRESSION_READ_AUTHORITY.md`). RAIL, SEA, and AIR stay foundation-only. Cash authority and ROAD settlement are unchanged.

Step 29AN: internal shop and warehouse level eligibility (`MAP_V2_CANONICAL_PROGRESSION_ELIGIBILITY_AUTHORITY.md`). RAIL, SEA, and AIR stay foundation-only. Cash authority and ROAD settlement are unchanged.

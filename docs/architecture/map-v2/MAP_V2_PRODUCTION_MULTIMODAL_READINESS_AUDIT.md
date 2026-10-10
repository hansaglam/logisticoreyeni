# Map V2 — Production multimodal readiness audit

**Step 21.** Audit and ADRs only. **No live Contract / Delivery / save / Firestore / economy changes. Multimodal gameplay not activated.**

Related: [migration plan](./MAP_V2_MULTIMODAL_MIGRATION_PLAN.md), ADRs [0007](./decisions/0007-legacy-delivery-coexistence.md)–[0013](./decisions/0013-feature-rollout-rollback.md).

DEV slices already prove one reducer can run ROAD→RAIL→ROAD, ROAD→SEA→ROAD, ROAD→AIR→ROAD. Live gameplay remains ROAD-only.

---

## 1. Live Contract

`src/types/game.ts` `Contract`:

| Area | Current |
|---|---|
| Identity | `id` from origin+dest+product+time+sequence |
| Geography | `originCityId`, `destinationCityId` (legacy city strings) |
| Cargo | `productId`, `amount` tons, `cargoWeight` (same as amount for generator) |
| Money | `payment` USD-game; `bonusMultiplier` / `penaltyMultiplier` optional |
| Time | `deadlineHours`, `createdAt`, `expiresAt` (game hours) |
| Distance | **`distanceKm` from `Route` in `src/data/routes.ts`** |
| Status | available / active / completed / expired / failed |
| Gates | `requiredLevel`, `requiredReputation`, `requiredDriverLevel`, `recommendedTruckCondition` |
| Type | standard / urgent / fragile / high_reputation / bulk / refrigerated |
| Persistence | `SaveGamePayload.contracts[]`; normalized by `normalizeContract` |

**ROAD-only assumptions:** one city-pair `Route`; one `distanceKm`; deadline from `distanceKm / averageSpeed`; payment via `calculateContractPayment` using that route; availability requires a truck **in origin city**; trailer rules (refrigerated / heavy) are truck-haul rules; no legs, transfers, or mode list.

Accept (`ContractsScreen` → `startDelivery`) binds one truck + one driver immediately. There is no separate “accepted but unassigned shipment plan” object.

---

## 2. Live Delivery

Created in `createDelivery` (`src/simulation/delivery.ts`): copies contract geo/cargo/distance; stores `truckId`, `driverId`; `progress` 0..1; `travelHours` from `calculateContractEconomics` (truck speed, cargo, route difficulty); fuel liters from km × consumption; tolls from `route.tollCost`; incidents are ROAD operations (traffic, fuel, tires, …); pause `out-of-fuel`; completion `completeDeliveryById` with `settledAt` + `settlementId`.

Offline: `deliveryOfflineProgress.ts` advances `progress` from real time vs `expectedDurationGameHours`.

**Assumes:** one truck, one driver, one continuous ROAD leg, one progress bar, fuel tank on that truck, truck `currentCityId` jumps origin→destination on complete, warehouse stock at destination optional.

`TruckTransfer` and `WarehouseStockTransfer` are also single ROAD hauls — not multimodal templates.

---

## 3. Player save

- Key `logisticore_save_v1`, `SAVE_GAME_VERSION = 6`.
- Local AsyncStorage primary; cloud `users/{uid}/saves/current` is a sanitized blob of the same payload.
- Relevant fields: `player` (money, level, xp, reputation, homeCityId, trucks, trailers, drivers, warehouses), `contracts`, `activeDeliveries`, transfer arrays, `globalEconomy`, timers (`lastContractGenerationTime`, …), `deliverySettlementHistory`, `reputationHistory`, `offlineProgressVersion`.
- Missing additive fields default in `load`/`normalize*` (trailers, companyStats, progressionFoundation).
- Newer `saveVersion` than client → recovery path, not silent play.
- **No `shipments` field today.** Correct future behavior: default `[]`.

---

## 4. Firestore / server

| Path | Role |
|---|---|
| `users/{uid}/saves/current` | Full local game blob (client write, rules owner-only) |
| `users/{uid}/serverState/current` | Server cash, owned trucks/warehouses, reputation/delivery counters, leaderboard score |
| `users/{uid}/marketplaceState/current` | Authoritative fleet marketplace |
| `users/{uid}/canonicalDeliveryCompletions/{deliveryId}` | Completion uniqueness (exists in rules) |
| `globalEconomy/*` | Server economy epoch; client listens |
| Vehicle marketplace collections | Server transactions + idempotency |
| Challenges / seasons / weekly missions | Server rewards |

**Mixed ownership:** simulation (deliveries, contracts, fuel ticks) is **client-authoritative**; cash/fleet for marketplace is **server-authoritative** when linked. Listeners on global economy can change fuel price **under** an in-flight ROAD delivery (economics already snapshotted on start via delivery fuel fields; contract payment is fixed on the Contract record).

This step did **not** modify rules or functions.

---

## 5. Contract generation

`generateContracts` / `generateContractForProduct`:

1. All city pairs in `CITIES` (8 legacy cities), skip same city.  
2. `isContractCityPairEligible` (level).  
3. **`lookupRouteBetweenCities(ROUTES)` required** — no route, no contract.  
4. Surplus/shortage + product markets.  
5. Tonnage vs fleet capacity.  
6. Payment, deadline, expiry, type modifiers, world-event multipliers.  
7. Existing available contracts are **not mutated**.

**Must change before ROAD+RAIL / SEA / AIR offers:** route lookup cannot be `routes.ts` only; need source-backed middle-leg availability + origin/dest ROAD↔mode transfers; cargo compatibility; progression/feature flags; optional capacity inventory. Do not invent pairs absent from diagnostics.

Visual `turkey-*-corridors.json` must **not** become generator truth.

---

## 6. Economy (as-is)

ROAD trip cost model (`contractEconomics.ts`): fuel (liters × global fuel price × driver fuelSaving), maintenance $/km, trailer cost, **route.tollCost**, other/risk reserve. Driver salary is **not** deducted per trip (periodic). Reward = contract.payment. Reputation/XP/company score on completion. Incidents can apply cash/time/fuel deltas.

Assumes ROAD km, ROAD speed, truck operating cost, city-pair toll. No rail access charge, port THC, or air freight line items.

**Do not balance new numbers in this step.**

---

## 7. Progression

- `player.level` / XP, `companyLevel`, `reputation` 0–100.
- Warehouse unlocks via `levelConfig` (separate from Map V2 city lock).
- Vehicle unlocks / shop / marketplace.
- Map V2 city progression default `LEGACY_ALL_UNLOCKED` (DEV preview only).
- Mode readiness: ROAD ACTIVE; RAIL/SEA/AIR `FOUNDATION_ONLY`.

Future gates can be **feature flags + requiredLevel on multimodal offers + city transfer matrix**, without colliding warehouse unlocks. Do not assign final unlock levels here.

---

## 8. Player infrastructure vs Geo

`WarehouseType` includes `port` and `airport` as **storage classes**. GeoPort / GeoAirport are Map V2 geo. `LIVE_WAREHOUSE_TYPE_IS_NOT_GEO_INFRA` remains true.

**Future binding:** optional explicit link `warehouse.id → geoPortId` only after a dedicated product step. Do **not** auto-bind existing warehouses.

---

## 9. Fleet

Reusable: Truck location/status/fuel/condition, Driver ROAD assignment, Trailer ROAD cargo constraints, marketplace ownership, `activeJobIds` on server trucks.

**Do not prematurely generalize** Truck into Train/Ship/Aircraft. Maintenance, fuel, and `currentCityId` are ROAD semantics.

---

## 10. Vehicle architecture recommendation

See [ADR 0009](./decisions/0009-non-road-vehicle-ownership.md): **Option B** (trucks owned; middle-leg capacity purchased). Not Option A generic `TransportVehicle` in V1. Hybrid ownership is post-MVP.

---

## 11. DEV domain → production classification

| Concept | Class | Why |
|---|---|---|
| `MultimodalShipmentPlan` | **KEEP** (refine ids/provenance) | Matches Contract vs Shipment split |
| `TransportLeg` | **KEEP** | Mode-generic; add persist fields |
| `TransferNode` | **KEEP** as geo catalog; **REFINE** instance vs definition | Foundation nodes are city infra; runtime needs instance status |
| `MultimodalShipmentRuntime` | **REFINE** | Replace synthetic clock with game hours + real timestamps; keep reducer semantics |
| `DEV_SIMULATION_SPEEDS` / DEV dwell | **DEV_ONLY** | Not gameplay balance |
| `DEV_SIMULATED_ROAD_CARRIER` | **REPLACE** | Production assigns real trucks |
| Generic DEV cargo | **REFINE** | Use `ProductId` + constraint flags |
| Simulator UI | **DEV_ONLY** | Lessons → production timeline, not the screen |
| Vertical-slice fixture builders | **KEEP** as planning adapters | Eligibility/diagnostics; not live generator |

---

## 12–14. Contract vs Shipment; Delivery compatibility

[ADR 0008](./decisions/0008-contract-vs-shipment.md): Contract offer ≠ runtime.

[ADR 0007](./decisions/0007-legacy-delivery-coexistence.md): **Legacy Delivery remains.** Additive shipments. No in-place Delivery→Shipment conversion.

---

## 15–18. Persistence proposal

Nested `shipmentSchemaVersion` ([ADR 0012](./decisions/0012-schema-versioning.md)). Shape in `src/mapV2/prototypes/productionMultimodal/persistedShipment.ts` (not imported by live code).

**Plan fields (immutable after accept):** mode, nodes, routeReference, distance, infra ids.  
**Runtime fields:** status, progress, timestamps, assignedAssetId.  
**Transfers:** node id, from/to mode, status, dwell timestamps, fee snapshot — **no prices assigned**.

---

## 19–20. Resume and time

Reuse Delivery patterns: `startedAt` game hours, `expectedDurationGameHours`, `lastProgressedRealAtMs`, offline reconcile. Per leg/transfer: `startedAtGameHours` + `expectedCompleteAtGameHours`. Pause = existing `isPaused` / delivery pause semantics, not a second clock.

Crash/restart: persist runtime after each completed step (not every 50ms tick). Cloud resync: last-write-wins on save blob is current cloud-save reality; shipment `settlementId` must still be idempotent.

---

## 21–22. Authority and idempotency

[ADR 0011](./decisions/0011-client-server-authority.md). Settlement keys: `shipment:{id}:capacity`, `shipment:{id}:revenue`, `shipment:{id}:completion-expenses`. Terminal writes no-op if `settledAt` set. Completions collection analog to `canonicalDeliveryCompletions`.

---

## 23–24. Economy snapshot and future cost categories

Snapshot at accept: reward, deadline, fuel price assumption, ROAD toll assumption, mode charge placeholders, transfer fee placeholders, `balancePolicyVersion`.

Future categories (no numbers): ROAD fuel/toll/driver-op/truck; RAIL transport + terminal; SEA freight + port handling; AIR freight + airport handling; TRANSFER handling/storage/time.

---

## 25–26. Ownership

MVP: outsource RAIL/SEA/AIR capacity. Player trucks for first/last mile. See ADR 0009.

---

## 27. Transfer economy placement

**Fee belongs on the shipment transfer instance snapshot**, not on the shared `TransferNode` catalog (catalog is geo/eligibility). Contract may preview a range; binding amount is snapshotted at accept.

---

## 28–29. Cargo / capacity MVP

Minimum: existing `ProductId` + tons (`cargoWeight`) + current trailer gates (refrigerated / heavy / container type as **ROAD last-mile** constraint). Optional flags later: cold chain on SEA/AIR, hazardous, oversized.

Do not build a universal VehicleCapacity class. ROAD uses truck+trailer tons; middle-leg uses booked capacity tons on the snapshot.

---

## 30–32. Generator pipeline (future)

Origin/dest → feature flag → city transfer capabilities → source-backed diagnostic pair → cargo mode compatibility → player level/reputation → ROAD truck feasibility at origin (V1) → snapshot economics → emit multimodal offer with `contractSchemaVersion`.

**Visual corridors are not routing truth.**

---

## 33–37. First/last mile, trucks, drivers

[ADR 0010](./decisions/0010-first-last-mile.md): city-level haulage V1.

**Asset assignment (recommended V1):** origin last-mile truck may differ from destination last-mile truck. Origin truck waits or returns via existing `TruckTransfer` (player choice later). Do not require the same truck at both ends (Ankara rail to a coastal dest would strand the truck).

**Drivers:** ROAD legs only. Do not generalize `Driver` to train/ship/air crew.

---

## 38–41. Failure, cancel, deadline, reputation

Failure categories: vehicle unavailable, transfer blocked, deadline missed, insufficient funds for booked capacity, route diagnostic missing, infra/city locked.

Cancel: before departure (offer-like); during ROAD/middle leg; during transfer — economic penalties **deferred**.

Deadline interface: `sum(leg durations + transfer dwells) * buffer` using **snapshotted** durations, not DEV speeds.

Reputation: **one shipment outcome** (success / late / fail), not per-leg scoring. Reuse `applyReputationChange`. Do not change current reputation numbers.

---

## 42–45. UI impact (no implementation)

| Screen | Eventual change |
|---|---|
| `ContractsScreen` | Mode chips, transfer count, IST/ESB style infra, capacity cost; keep ROAD cards unchanged |
| Delivery overlay / Dashboard | Branch: Delivery vs Shipment timeline |
| `FleetScreen` | Truck busy during first mile; no trains |
| `MapScreen` | **Unchanged until a dedicated map step**; no plane/ship markers now |
| Map V2 country | Optional highlight of planned legs later; not live shipment |
| `WarehouseScreen` | No auto port/airport bind |
| City Detail | Optional infra copy; no transfer tab required for V1 |
| Market / Shop / Marketplace | Capacity SKU later, not trucks-as-ships |
| Finance | New ledger categories later |
| Missions / Leaderboard | Count shipments separately or as completed contracts — decide in economy step |

Simulator lessons: one active step, weighted overall progress, fail/block/cancel.

---

## 46–48. Background, offline, cloud

Delivery completion already works offline then syncs. Long RAIL/SEA legs should use the same offline progress vs expected duration. Risk: fuel-price listener vs snapshot (mitigate with snapshot). Risk: two devices completing the same shipment (mitigate settlement id + completions doc). **Do not change money sync in this step.**

---

## 49–51. Existing players

- Active ROAD deliveries finish on the legacy engine.  
- Existing ROAD offers stay valid; new multimodal offers are a new schema.  
- Loader defaults empty shipment arrays (lazy/additive).

---

## 52–53. Rollback / flags

[ADR 0013](./decisions/0013-feature-rollout-rollback.md). Prototype flags in `prototypes/productionMultimodal/featureFlags.ts` — **not wired**.

---

## 54–55. Phasing and first mode

See migration plan. **First production multimodal mode: RAIL** (inland coverage, source-backed graph diagnostics, honest missing cities, no maritime graph, no aircraft education). AIR is simpler geometrically but weaker logistics metaphor; SEA has channel/port-regional complexity.

---

## 56. Production gate matrix

| Gate | Status | Reason |
|---|---|---|
| DOMAIN | **PARTIAL** | DEV domain proven; production persist/authority not in live types |
| PERSISTENCE | **BLOCKED** | No save field; by design this step |
| BACKEND | **BLOCKED** | No shipment settlement function |
| ECONOMY | **BLOCKED** | No mode tariffs; ROAD economics only |
| CONTRACTS | **BLOCKED** | Generator is `routes.ts` ROAD only |
| UI | **BLOCKED** | Simulator DEV-only |
| ASSETS | **PARTIAL** | No need for 3D trains if capacity-booked; UI icons later |
| QA | **PARTIAL** | Vertical-slice tests exist; no save/idempotency tests |
| PERFORMANCE | **PARTIAL** | Compact diagnostics OK; must never load 98MB sea graph |
| ROLLBACK | **PARTIAL** | Designed, not implemented |

---

## 57. Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| Save corruption / failed load | High | Additive arrays; quarantine unknown shipment version |
| Double payout | High | settlementId + completions collection |
| Incomplete resume | High | Persist per completed step; offline duration model |
| Cloud conflict two devices | High | Same as delivery; last blob wins + idempotent settle |
| Contract inflation (too many modes) | Med | Flags per mode; generator caps |
| Vehicle ownership scope explosion | High | ADR 0009 capacity booking |
| Visual corridor ≠ route | Med | Diagnostics-only planning |
| UI overload | Med | ROAD cards unchanged; multimodal as distinct row |
| Mixing warehouse type=port with GeoPort | Med | No auto-bind |
| DEV speeds leaking into live | Med | Separate production duration policy step |

---

## 58. ADRs created

0007 coexistence · 0008 contract/shipment · 0009 ownership · 0010 first/last mile · 0011 authority · 0012 versioning · 0013 rollout.

---

## 63. Future test categories (not implemented)

Schema default `[]`; legacy delivery regression; shipment resume; settlement idempotency; economy snapshot freeze; generator eligibility; flag rollback (creation off, in-flight still runs); offline/cloud conflict; RAIL/SEA/AIR adapter integration; MapScreen isolation.

---

## Confirmation

Live schemas, economy numbers, Firestore, MapScreen, and RAIL/SEA/AIR gameplay activation were **not** changed in this step. Optional prototypes are isolated under `src/mapV2/prototypes/productionMultimodal/`.

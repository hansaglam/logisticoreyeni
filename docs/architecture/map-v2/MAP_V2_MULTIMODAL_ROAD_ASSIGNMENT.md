# Map V2 — Multimodal ROAD first/last-mile assignment (Step 25)

**Status:** planning foundation only — **no live multimodal activation**  
**Date:** 2026-09-22  
**Modules:** `src/domain/multimodalRoadAccess.ts`, `src/domain/multimodalRoadAssignment.ts`  
**Artifact:** `src/mapV2/generated/multimodal/turkey-road-transfer-access.json`  
**Offline build:** `scripts/map-v2/build-turkey-multimodal-road-access.ts`

## 1. Purpose

Replace the prototype ~5 km `PROVIDED_PLANNING_METERS` / `DEV_FALLBACK_LOCAL_TRANSFER_METERS` ROAD stubs with:

1. Compact, offline, OSM-backed city→infrastructure ROAD access distances.
2. A pure, non-mutating planner that answers which owned trucks/drivers/trailers *could* run first-mile and last-mile.

This is **not** reservation, dispatch, contract generation, payout, or MapScreen.

## 2. Existing fleet audit

Live ROAD `startDelivery` (`gameStore`) requires:

| Topic | Production rule |
| --- | --- |
| Ownership | Fleet `player.trucks[]`. Leased trucks allowed until expiry (`isTruckEligibleForNewAssignment`). |
| Location | `resolveTruckCityId` = `currentCityId ?? homeCityId`. Must equal contract origin. No teleport. |
| Availability | `status === 'idle'`. `marketplace_locked`, `on_route`, `transferring`, `maintenance`, `out_of_fuel` rejected. |
| Active job | `findActiveDeliveryForTruck` + lease eligibility. |
| Capacity | `canTruckCarryCargo` using **attached** trailer only (`getAttachedTrailerForTruck`). |
| Condition | `< 30` blocked (`MIN_TRUCK_CONDITION` / `MIN_TRUCK_CONDITION_FOR_DELIVERY`). |
| Driver | Always required. `evaluateDriverOption` / operational state (delivery, transfer, rest). |
| Trailer | Not a separate owned-asset gate; capacity/refrigerated attach semantics only. |
| Fuel | Checked at start against `routes.ts` via `evaluateDeliveryReadiness`. **Not** applied in Step 25 planning (no live ROAD route object). Future accept must revalidate. |
| Mutation | Only after all gates pass: delivery created, truck `on_route`, fuel later. |

Helpers reused: `evaluateTruckOption`, `evaluateDriverOption`, `resolveTruckCityId`, `canTruckCarryCargo`. Planner does not import `gameStore`.

## 3. Planned assignment

Output may name `truckId` / `driverId` / `trailerId`. It does **not** write those fields, mark busy, attach `deliveryId`, change `currentCityId`, deduct fuel, lock marketplace, or save.

`toctou = PLANNING_ONLY_REVALIDATE_AT_ACCEPTANCE`.

## 4. First-mile

Origin gameplay city ROAD anchor → transfer infrastructure ROAD endpoint. Truck must be idle and located at **origin** (`resolveTruckCityId`).

## 5. Last-mile

Transfer infrastructure → destination gameplay city. Independent truck at **destination**. Third-party RAIL/SEA/AIR does not move the player truck.

## 6. No-teleport

If `originCityId !== destinationCityId`, `firstMileTruckId !== lastMileTruckId`. Same id is `SAME_TRUCK_TELEPORT`. Drivers assigned to the origin truck are excluded from last-mile.

## 7. Truck eligibility

Same predicates as live ROAD selection for city, idle, marketplace lock, lease (when `currentTime` provided), capacity, condition. Automatic pick: selectable trucks sorted by **stable `truck.id`**. No new scoring.

## 8. Driver / trailer

Driver required (live ROAD). Trailer id is the currently attached trailer if any. Unavailable driver → `NO_ELIGIBLE_DRIVER`. Capacity fail → `CARGO_INCOMPATIBLE` (production does not auto-hitch an idle trailer).

## 9. City ROAD anchors

Same giant-component resolution as player ROAD corridors (`resolveProvisionalAccess` in `build-turkey-road-corridors.ts`). Istanbul stored city-access node is **not** in the giant component; corridor replacement node `tn.tur.road.n.29.0115806_41.0087370` is used. Not a second anchor system.

## 10. Infrastructure ROAD snap

- Collect up to 24 giant-component ROAD nodes within 15 km (haversine).
- If none, and nearest **any** ROAD node is ≤ 2.5 km (infra sits on a disconnected local fragment), expand to 40 km (IST precinct).
- Score candidates by **undirected Dijkstra length from the city anchor**, reject national detours (`max(4× crow, 80 km)` DIRECT; 150 km REGIONAL).
- Nearest node is **not** always chosen: Adana COV nearest fragment routes ~936 km; a farther node (~8.8 km snap) yields ~26 km.
- Snap evidence: `ATTACHED_EXACT` ≤ 25 m, `PROVISIONAL_NEAR_ROAD` ≤ 2.5 km, else `PROVISIONAL_BOUNDED_SNAP`. Never `VERIFIED`.

## 11. Routing algorithm

`dijkstra-road-transfer-access-v1` = same undirected length/class-weight Dijkstra as `dijkstra-length-classweight-undirected-overview-v1`. Local/regional **planning** only. Not turn-by-turn, not legal truck routing, not lane-level.

## 12. Directionality

`ROAD_ACCESS_ROUTING_DIRECTIONALITY = OVERVIEW_UNDIRECTED_SOURCE_BACKED`. Geography is source-backed; OSM oneway / HGV restriction is **not** verified.

## 13. Source lineage

Each record: `legacyCityId`, `geoCityId`, transfer node id, infrastructure id, city ROAD anchor, infra ROAD node, `sourceRoadPackageHash`, algorithm id, association `DIRECT`/`REGIONAL`.

Canonical ROAD package: `sha256:b506587dfd7e390794a448a0a855b773af640ebfeba316a4ffc86bacf4d45882`.

## 14. Compact artifact

No polyline. Semantic metadata + meters + edge count. Full ROAD graph is gitignored / offline-build only.

## 15. Duration integration

Step 24 accepts `SOURCE_BACKED_ROAD_TRANSFER_ACCESS` for ROAD legs. Formula still `calculateContractDurationHours.travelHours`. Not labeled `PRODUCTION_ROAD_ROUTE` (`routes.ts` city pairs). DEV playback unchanged.

## 16. No-mutation

Planner copies inputs; tests deep-compare fleet snapshots. No `gameStore` action.

## 17. Future acceptance

Revalidate origin/dest trucks, drivers, trailers, cargo, frozen infrastructure, then reserve **atomically** with shipment create. Not implemented.

## 18. Persistence snapshot (later)

Accepted shipment should snapshot first/last-mile assignment ids + access lineage. **Not written.** `SAVE_GAME_VERSION` remains **6**.

## 19. Non-goals

No rail/sea/air tariffs, contracts, payout, settlement execution, Firestore, Cloud Functions, MapScreen, `routes.ts`, fuel, money.

## 20. Known limitations

- IST AIR endpoint is the nearest **giant** ROAD node (~34 km snap); airport service roads are a disconnected component.
- Trabzon AIR ROAD access is **unresolved** (local graph detour > 80 km). AIR diagnostics may still list the pair; the ROAD mile fails closed.
- Colocated city-anchor / infra-node (Ankara RAIL, İzmir RAIL, İstanbul RAIL/SEA) uses 1 m / 0 edges.
- Fuel/deadline/rental-duration vs live `routes.ts` not planned here.
- Explicit `requestedTruckId` that is ineligible fails with `INVALID_REQUESTED_TRUCK` (no silent swap).

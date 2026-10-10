# Map V2 — ROAD → SEA → ROAD vertical slice

**Step 19.** DEV-only executable simulation. SEA gameplay stays `FOUNDATION_ONLY`. No ships, contracts, economy, save, or moving vehicles.

## Goal

Prove `MultimodalShipmentRuntime` is mode-generic by running a second topology on the **same** reducer / clock / fail-block-cancel / weighted progress:

ROAD (origin first mile) → TRANSFER (ROAD→SEA) → SEA → TRANSFER (SEA→ROAD) → ROAD (destination)

This is not a second SEA shipment engine.

## Supported patterns after this step

- `ROAD → RAIL → ROAD` (Step 18, still valid)
- `ROAD → SEA → ROAD` (this step)
- `ROAD → AIR → ROAD` (Step 20)

Not yet: `RAIL↔SEA`, multi-middle chains, production contracts.

## Middle-leg adapters

Eligibility, GeoPort / PortSeaAccess resolution, canonical route reference, source length, and channel/region lineage live in:

- RAIL adapter: `buildRoadRailRoadFixture` + rail *build report*
- SEA adapter: `buildRoadSeaRoadFixture` + sea *build report*

`buildMultimodalVerticalSlice({ pattern, origin, destination })` dispatches. Runtime never branches on SEA vs RAIL except duration lookup by `leg.mode`.

## SEA route availability

Source of truth is **build-time diagnostics** in `turkey-sea-corridors.report.json` (canonical Dijkstra length, access node ids, regions, channels, `sourceSeaPackageHash`).

Player visual `turkey-sea-corridors.json` is a curated subset. The plan `routeReference` is `domain.canonical.sea.{a}.{b}`. Simulator may mention the visual corridor id as **display-only**.

No on-device Dijkstra. No 98 MB sea graph at runtime.

## Eligible / invalid pairs

Eligible when origin and destination both have ROAD↔SEA transfers **and** a source-backed maritime pair exists. Current report pairs (bidirectional):

İstanbul↔İzmir, İstanbul↔Trabzon, İzmir↔Antalya, Antalya↔Adana, Bursa↔Trabzon, Bursa↔İzmir.

Invalid with **no nearest-port fallback**:

- Ankara → İstanbul → `NO_ROAD_SEA_TRANSFER_AT_ORIGIN`
- Diyarbakır → İzmir → `NO_ROAD_SEA_TRANSFER_AT_ORIGIN`

## Plan

1. ROAD: origin operational node → origin ROAD↔SEA transfer  
2. TRANSFER ROAD→SEA (GeoPort + PortSeaAccess `PROVISIONAL`)  
3. SEA: origin PortSeaAccess → destination PortSeaAccess  
4. TRANSFER SEA→ROAD  
5. ROAD: destination transfer → destination operational node  

First/last mile use Step 25 source-backed ROAD transfer-access distances (Adana REGIONAL port may be tens of km). No city→port drawn geometry.

## Lineage

SEA leg retains access ids on `fromInfrastructureId` / `toInfrastructureId`, plus preview: `fromPortId`/`toPortId` as GeoPort ids, `sourceSeaPackageHash`, routing policy versions, length, regions, **channels from the routed diagnostic path** (not inferred from endpoints).

Examples: İstanbul→Trabzon includes `BOSPHORUS`. İstanbul→İzmir includes `DARDANELLES` and must not claim Bosphorus. Antalya→Adana uses Yumurtalık with **REGIONAL** association.

## DEV timing

`DEV_SIMULATION_SPEEDS = { ROAD_LOCAL: 2000, RAIL: 2000, SEA: 1500 }` m / sim-second. `getDevLegSimulationDuration(mode, meters)`. Not gameplay balance.

Transfers: ROAD↔RAIL 45 s, ROAD↔SEA 60 s DEV dwell. Not port handling economics.

Overall progress is still weighted by those durations.

## Failure / block / cancel / pause

Same as Step 18. SEA `FAILED` fails the shipment; ROAD2 stays `PLANNED`. Block transfer1 → SEA stays `PLANNED`. Block transfer2 → ROAD2 stays `PLANNED`. Pause freezes SEA progress. Reset restores seed.

## Simulator

Single screen: pattern selector ROAD→RAIL→ROAD | ROAD→SEA→ROAD. Eligible city chips refresh per pattern. No player map, no ship marker.

## Live isolation

No `useGameStore`, save, Firestore, money, trucks, contracts. Closing discards runtime.

## Future (out of scope)

Ships/ownership, multimodal contracts, persistence, player SEA gameplay, AIR slice, city→port ROAD topology.

# Map V2 — Multimodal logistics domain foundation

**Step 17.** Architecture only. No trains, ships, aircraft, multimodal contracts, economy, or persistence.

## Live gameplay vs this domain

Current `Contract` / `Delivery` are **truck + cityId** jobs:

- origin/destination are `legacyCityId` strings
- one `distanceKm` from `src/data/routes.ts`
- progress, fuel, tolls, incidents, warehouse stock, `truckId` + `driverId`
- completion is a single ROAD delivery

They are **not** mutated here. `LIVE_DELIVERY_IS_NOT_MULTIMODAL_SHIPMENT = true`.

A multimodal shipment is not a recolored ROAD path. It is:

`Shipment → leg → transfer → leg → transfer → leg`

## Domain objects

`MultimodalShipmentPlan` (in-memory / DEV fixture only): origin city, destination city, `TransportLeg[]`, `TransferNode[]`, status, provenance. Schema versioned separately from live Delivery.

`TransportLeg`: one mode (`ROAD|RAIL|SEA|AIR`), `fromNodeId` / `toNodeId` (not cityId-only), optional infrastructure ids, optional **canonical** `routeReference`. Statuses: PLANNED, WAITING_TRANSFER, READY, IN_PROGRESS, COMPLETED, FAILED, CANCELLED.

`TransferNode`: place cargo may switch mode. Capabilities are explicit pairs (`ROAD_TO_RAIL`, …). Evidence is required. Nearby features do not grant a pair.

## GeoInfrastructure vs PlayerInfrastructure

A GeoPort / GeoAirport / rail access node can exist with **zero** player ownership.

A player warehouse with `type: 'port' | 'airport'` does **not** create GeoInfrastructure (`LIVE_WAREHOUSE_TYPE_IS_NOT_GEO_INFRA`).

## Mode readiness

| Mode | Gameplay |
|---|---|
| ROAD | ACTIVE |
| RAIL | FOUNDATION_ONLY |
| SEA | FOUNDATION_ONLY |
| AIR | FOUNDATION_ONLY |

Overall: `READY_FOR_DOMAIN`. Not player-available.

City matrix statuses: ACTIVE / PROVISIONAL / UNAVAILABLE / NOT_READY. Derived from loaders, not hand-copied.

## Transfer evidence policy

- ROAD↔RAIL: city RAIL access PROVISIONAL with an access node. Bursa / Antalya / Trabzon: none.
- ROAD↔SEA: explicit city–GeoPort association (DIRECT or REGIONAL). Ankara / Diyarbakır: none.
- ROAD↔AIR: logistics-primary GeoAirport READY. Bursa: none.
- RAIL↔SEA / RAIL↔AIR: modeled as UNRESOLVED notes. Same-city co-presence is **not** a transfer complex.

`localTransferDistanceMeters` is diagnostic (association distance). No time or fee.

Do not draw city→port / city→airport / city→station gameplay connectors.

## Planning graph

Separate from ROAD/RAIL/SEA canonical graphs and from player visual corridors.

Nodes: ROAD operational (legacy city adapter), rail access, port, airport, transfer.

Edges: `TRANSPORT_LEG` (city-pair **mode availability**, not `turkey-*-corridors.json`) and `TRANSFER`.

Player-facing curated corridors are visual subsets. They are not the only planning routes.

## Fixture planner

DEV: origin + destination + allowed modes → unique high-level sequences (`ROAD`, `ROAD→RAIL→ROAD`, …).

- max 4 sequence tokens (`MULTIMODAL_MAX_TRANSPORT_LEGS`)
- no mode jump without a transfer capability
- no ranking by cost/time/profit
- not persisted

## Cargo compatibility

Extension point: `CargoTransportCompatibility` with future flags (`requiresColdChain`, `hazardous`, `oversized`, `containerized`, `timeCritical`). Fixture: GENERIC may use all modes. No balancing.

## Persistence / gameplay activation boundary

Do **not** write `MultimodalShipmentPlan` to player save or Firestore.

Do **not** generate multimodal jobs, fleets, or payouts.

Player country dashboard, City Detail, transport legend, `MapScreen`, `routes.ts`, and live delivery lifecycle stay as they are.

DEV entry: Simülasyon Testi → **Map V2 Multimodal Inspector** and **Multimodal Shipment Simulator**.

## Vertical slices (DEV)

The same `MultimodalShipmentRuntime` reducer, clock, fail/block/cancel, and weighted progress run:

- **ROAD → RAIL → ROAD** (Step 18) — rail middle-leg adapter + rail build-report diagnostics
- **ROAD → SEA → ROAD** (Step 19) — sea middle-leg adapter + sea build-report diagnostics
- **ROAD → AIR → ROAD** (Step 20) — air middle-leg adapter + AIR build-report **geodesic** diagnostics (no AIR graph)

Adapters resolve eligibility, infrastructure, canonical `routeReference`, distance, and lineage. They do not duplicate the state machine. Multi-middle chains are not enabled.

AIR middle legs are logistics simulation only: airport endpoints + precomputed geodesic. They are not filed flight plans.

Production activation is **not** done. See `MAP_V2_PRODUCTION_MULTIMODAL_READINESS_AUDIT.md` and `MAP_V2_MULTIMODAL_MIGRATION_PLAN.md`.

## Future gameplay requirements (out of scope)

Vehicle models per mode, transfer timing, handling fees, cargo constraints, ranked routing, save schema, contract generation, and player UI.

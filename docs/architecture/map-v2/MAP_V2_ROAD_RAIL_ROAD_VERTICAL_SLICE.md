# Map V2 — ROAD → RAIL → ROAD vertical slice

**Step 18.** DEV-only executable simulation. RAIL gameplay stays `FOUNDATION_ONLY`. No trains, contracts, economy, save, or moving vehicles.

## Goal

Prove a `MultimodalShipmentPlan` can run as sequential legs + transfers:

ROAD (origin last/first mile) → TRANSFER → RAIL → TRANSFER → ROAD (destination)

Live `Contract` / `Delivery` are not involved.

## State machine

Shipment: `PLANNED` → `ACTIVE` → `COMPLETED` | `FAILED` | `CANCELLED` | `BLOCKED`

One step at a time. No skipping.

1. ROAD1 `READY` → `IN_PROGRESS` → `COMPLETED`
2. Transfer1 `READY` → `IN_PROGRESS` → `COMPLETED` (or `BLOCKED`)
3. RAIL `READY` → `IN_PROGRESS` → `COMPLETED`
4. Transfer2 …
5. ROAD2 …
6. Shipment `COMPLETED`

## DEV simulation timing

`getDevLegSimulationDuration` uses `DEV_SIMULATION_SPEEDS.ROAD_LOCAL` / `.RAIL` (both `2000` m/sim-s so this slice is unchanged) / `.SEA` / `.AIR`.

Transfers: ROAD↔RAIL `45000` sim ms. ROAD↔SEA uses a separate DEV dwell (Step 19).

Marked `DEV_SIMULATION_ONLY` / `NOT_GAMEPLAY_BALANCE`. Not travel time, payout, or `routes.ts`.

ROAD miles use Step 25 compact `SOURCE_BACKED_ROAD_TRANSFER_ACCESS` (offline OSM Dijkstra). Not `routes.ts` PRODUCTION_ROAD_ROUTE. Not a 5 km stub.

RAIL uses **source-backed diagnostic length** from the rail *build report* (`turkey-rail-corridors.report.json`): canonical Dijkstra length + access node ids. That report is **not** the player visual `turkey-rail-corridors.json` geometry package. `TransportLeg.routeReference` is `domain.canonical.rail.{a}.{b}`.

## Overall progress

`sum(step.progress * step.durationSimMs) / sum(durations)`

No economy meaning.

## Failure / block / cancel

- `FAIL_LEG` on the active transport leg → shipment `FAILED`. Downstream stays `PLANNED` / `PENDING`.
- `BLOCK_TRANSFER` on the active transfer → shipment `BLOCKED`. The transfer is not skipped. RAIL / final ROAD must not start.
- `CANCEL` → shipment `CANCELLED`. Active step stops. No further ticks.
- `FAILED` / `CANCELLED` / `COMPLETED` cannot `RESUME` or `START` without `RESET`.

## Live isolation

No player truck, train, money, warehouses, fleet, contracts, deliveries, Firestore, or save. ROAD carrier is `DEV_SIMULATED_ROAD_CARRIER`. Closing the simulator discards state.

Entry: Simülasyon Testi → **Multimodal Shipment Simulator**.

## Future production requirements

Train/truck assignment, real transfer dwell, routed first-mile ROAD, ranked multimodal contracts, persistence, player map vehicles, RAIL gameplay activation.

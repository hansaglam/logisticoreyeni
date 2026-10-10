# Map V2 — ROAD → AIR → ROAD vertical slice

**Step 20.** DEV-only executable simulation. AIR gameplay stays `FOUNDATION_ONLY`. No aircraft, contracts, economy, save, or moving vehicles.

## Goal

Prove `MultimodalShipmentRuntime` is mode-generic by running a third topology on the **same** reducer / clock / fail-block-cancel / weighted progress:

ROAD (origin first mile) → TRANSFER (ROAD→AIR) → AIR → TRANSFER (AIR→ROAD) → ROAD (destination)

This is not a second AIR shipment engine and not a filed flight plan.

## Supported executable patterns after this step

- `ROAD → RAIL → ROAD` (Step 18)
- `ROAD → SEA → ROAD` (Step 19)
- `ROAD → AIR → ROAD` (this step)

Still unsupported: RAIL↔SEA, SEA↔AIR, RAIL↔AIR, multi-middle chains, production AIR gameplay.

## AIR vs RAIL/SEA routing

AIR has **no canonical transport graph**. The middle leg is:

- logistics-primary GeoAirport endpoints (READY / `VERIFIED_SUPPORTED`)
- **build-time geodesic diagnostic** (`turkey-air-corridors.report.json`)

Player visual `turkey-air-corridors.json` is display-only. Plan `routeReference` is `domain.canonical.air.{a}.{b}`.

AIR is a **logistics simulation abstraction**. It is not ATC, airways, SID/STAR, airline schedules, or airspace-compliant routing.

## Middle-leg adapter

`buildRoadAirRoadFixture` + `getTurkeyAirRouteDiagnostics()`. `buildMultimodalVerticalSlice({ pattern: 'ROAD_AIR_ROAD', ... })` dispatches. Runtime only switches duration by `leg.mode`.

## Eligible / invalid pairs

Accepted report pairs (bidirectional), both cities ROAD↔AIR READY:

İstanbul↔İzmir, İstanbul↔Ankara, İstanbul↔Antalya, İstanbul↔Trabzon, Ankara↔Diyarbakır, Ankara↔Adana, İzmir↔Antalya.

Invalid:

- Bursa → İstanbul → `NO_READY_AIR_LOGISTICS_TRANSFER_AT_ORIGIN` (no SAW/IST/YEI substitute)
- Adana → Diyarbakır → no source-backed accepted diagnostic (curated skeleton rejected it). No runtime geodesic invent.

Endpoints: IST, ADB, ESB, AYT, COV, DIY, TZX. Never SAW for İstanbul, never ADA for Adana.

## DEV timing

`DEV_SIMULATION_SPEEDS.AIR = 2500` m/sim-s. Transfers ROAD↔AIR `40000` sim ms. `NOT_GAMEPLAY_BALANCE` / `DEV_SIMULATION_ONLY`.

## Live isolation

No aircraft model, player fleet, money, contracts, Firestore, save, or country-dashboard plane.

## Future (out of scope)

Aircraft ownership, AIR gameplay activation, multimodal contracts, persistence, multi-middle chains.

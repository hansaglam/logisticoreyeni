# Map V2 — Player-facing AIR corridors

**Step 16.** DEV/internal geodesic overlay. Havayolu gameplay remains inactive.

## What these are

Visual logistics air corridors between source-backed **logistics-primary** airports.

They are **not**:

- filed flight plans
- ATC routes / airways
- SID/STAR procedures
- restricted-airspace-compliant paths
- real airline schedules
- a dense AIR topology graph

Status is `VERIFIED_ENDPOINTS_PREVIEW` or `UNRESOLVED`. Never `REAL_FLIGHT_ROUTE`.

## Architecture difference

| Mode | Geometry source |
|---|---|
| ROAD | ground network topology |
| RAIL | rail network topology |
| SEA | navigable water topology |
| AIR | airport endpoints + mathematical geodesic |

`turkey-air-network.json` stays empty `SOURCE_PENDING`. Player preview does not invent fake AIR edges to match other modes.

Catalog: `INFRASTRUCTURE_READY`. Overlay: `PLAYER_CORRIDOR_PREVIEW`. Gameplay AIR: inactive.

## Endpoints

READY logistics cities only:

| City | Logistics IATA | Notes |
|---|---|---|
| istanbul | IST | passenger primary is SAW — unused here |
| izmir | ADB | |
| ankara | ESB | |
| antalya | AYT | |
| adana | COV | ADA is CLOSED_OR_INACTIVE |
| diyarbakir | DIY | |
| trabzon | TZX | |

Bursa is `NOT_READY`. No corridor. Do not substitute YEI, SAW, or IST.

`allowPreviewOnlyEndpoints = false`. No PREVIEW_ONLY / UNKNOWN / military-only / closed endpoints.

## Curated skeleton

Accepted (7): İstanbul–İzmir, İstanbul–Ankara, İstanbul–Antalya, İstanbul–Trabzon, Ankara–Diyarbakır, Ankara–Adana, İzmir–Antalya.

Rejected (optional): Adana–Diyarbakır — inland coverage already via Ankara; avoid extra crossing.

IDs: `corridor.tur.air.{left}.{right}.v1` with canonical city order.

## Geodesic

Build-time only (`scripts/map-v2/build-turkey-air-corridors.ts`):

1. Spherical slerp on WGS84 lon/lat (`map-v2-spherical-slerp-v1`)
2. Adaptive sample ~40 km, 8–32 vertices
3. Project each geographic sample with current Web Mercator
4. Quantize + delta-encode into compact `q`

Do not interpolate in screen space. Do not draw 3D altitude arcs.

`geodesicDistanceMeters` is diagnostic only. Not travel time, payout, or `routes.ts`.

## Runtime

- Flag: `EXPO_PUBLIC_MAP_V2_AIR_PLAYER_VISUAL=PREVIEW` and `__DEV__`. Default OFF.
- Loads only `src/mapV2/generated/countryOverview/turkey-air-corridors.json`.
- Skia batched paths cached by `contentHash:corridorId`. Selection changes paint only.
- Draw order: ROAD → RAIL preview → SEA preview → AIR → city nodes/labels.
- Paint: pale sky-steel (`#A7B3BE`), thin solid stroke (no dash, no cyan).
- Interaction: `AIR_DEFAULT` / `AIR_CONNECTED_TO_SELECTED` / `AIR_DIMMED` / `AIR_UNAVAILABLE`.
- Locked-city mute uses shared city availability. No AIR-specific unlock rules.
- City Detail back keeps `selectedCityId` and therefore AIR highlight.
- Reduce Motion: instant opacity 1. Optional single fade otherwise. No looping / aircraft.

## Future aircraft boundary

Do not add plane icons, moving aircraft, flight timers, airport ownership, AIR contracts, or truck↔airport multimodal in this layer.

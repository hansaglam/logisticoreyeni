# Map V2 — Multimodal duration policy (Step 24)

**Status:** planned-time policy only — **no live multimodal activation**  
**Date:** 2026-09-21  
**Module:** `src/domain/multimodalDurationPolicy.ts`  
**Policy version:** `multimodal-duration-policy-v1`

## 1. Purpose

Define deterministic planned durations (game seconds) for future multimodal shipments so DEV inspector speeds cannot become accidental production balance.

## 2. Production vs DEV timing

| Concept | Owner | Unit |
| --- | --- | --- |
| Planned duration | `multimodalDurationPolicy.ts` | integer **game seconds** |
| DEV playback | `multimodalRuntime.ts` `getDevPlaybackWallMs` | real milliseconds at inspector 1x |

`DEV_PLAYBACK_REAL_MS_PER_GAME_HOUR = 1000` means “1 planned game hour plays in 1 real second” in the inspector. Changing that constant must not change `plannedDurationGameSeconds`.

Removed as semantic duration source: `DEV_SIMULATION_SPEEDS` (2000/1500/2500 m per sim-second) and 45/60/40s transfer dwells.

## 3. Existing ROAD duration audit

Live ROAD deliveries:

- Formula: `calculateContractDurationHours` in `src/simulation/contractEconomics.ts` (also `calculateTravelHours` in `delivery.ts`).
- Inputs: `distanceKm`, cargo tons, route difficulty, truck speed/class/condition/catalog, driver speed/tier, optional trailer and event multipliers.
- Speed: `calculateVehicleSpeed` / `vehicleSpeedBalance`. Fallback average `contractBalance.averageSpeedKmh` (60).
- Result: `durationHours = max(0.25, travelHours + handlingHours + restHours)`.
- Stored on `Delivery` as `travelHours` and `expectedDurationGameHours` at **create** time (not recalculated every tick).
- Progress: `hoursPassed / travelHours`. Offline: `realMsToGameHours` via `getMsPerGameHour` (15000 ms per game hour at 1x) against stored hours.
- `gameSpeed` affects wall-clock ↔ game-hour conversion, not the stored trip length.

**Untouched:** `completeDeliveryById`, payout, fuel, tolls, reputation, `routes.ts`, MapScreen.

Multimodal ROAD **movement** legs reuse **`travelHours` only** from that same function (distance / effective km/h). Contract handling + rest stay on live ROAD Delivery; multimodal transfers have their own dwell policy so first/last mile does not double-count terminal handling.

## 4. Canonical time unit

Integer **game seconds**. `3600` game seconds = 1 game hour. Deterministic `Math.round`. Non-zero distance never rounds to 0 (minimum 1 s).

## 5. Policy version

`multimodal-duration-policy-v1`

A future balance change must use a new version. Accepted live shipments (later step) must snapshot this version and **resume from the snapshot**, not recompute current policy.

## 6–9. Mode semantics

| Mode | Rule | Label |
| --- | --- | --- |
| ROAD | `calculateContractDurationHours(...).travelHours` | production ROAD movement |
| RAIL | distance / `110` km/h | `GAMEPLAY_BALANCE_CONSTANT` |
| SEA | distance / `22` km/h | `GAMEPLAY_BALANCE_CONSTANT` |
| AIR | distance / `480` km/h | `GAMEPLAY_BALANCE_CONSTANT` — not a flight plan |

Relative intent (same synthetic distance): AIR fastest, then RAIL, then ROAD planning average (~60 km/h class), SEA slowest. Not a real-world timetable claim.

## 10. Transfer policy

Supported only: ROAD↔RAIL, ROAD↔SEA, ROAD↔AIR.

| Pair | Game seconds | Policy id |
| --- | --- | --- |
| ROAD↔RAIL | 2700 (45 min) | `transfer-road-rail-v1` |
| ROAD↔SEA | 5400 (90 min) | `transfer-road-sea-v1` |
| ROAD↔AIR | 3600 (60 min) | `transfer-road-air-v1` |

`GAMEPLAY_BALANCE_CONSTANT`. RAIL↔SEA / RAIL↔AIR / SEA↔AIR → `UNSUPPORTED_TRANSFER`.

## 11. Distance authority

| Mode | Required authority |
| --- | --- |
| ROAD | `PRODUCTION_ROAD_ROUTE`, `SOURCE_BACKED_ROAD_TRANSFER_ACCESS` (city↔transfer graph access), or `PROVIDED_PLANNING_METERS` (explicit test meters only) |
| RAIL | `SOURCE_BACKED_RAIL_LENGTH` + non-empty `routeReference` (not `corridors.json`) |
| SEA | `SOURCE_BACKED_SEA_LENGTH` + routeReference |
| AIR | `SOURCE_BACKED_AIR_GEODESIC` + routeReference |

No SkPath, pixels, visual corridors, or straight-line fallbacks inside this module. No runtime Dijkstra.

## 12. Fail-closed

`READY` / `INVALID_PLAN` / `INVALID_DISTANCE` / `MISSING_ROUTE_DISTANCE` / `MISSING_ROUTE_REFERENCE` / `UNSUPPORTED_MODE` / `UNSUPPORTED_TRANSFER` / `UNRESOLVED_INFRASTRUCTURE` / `UNSUPPORTED_SCHEMA` / `NOT_EXECUTABLE`.

No “use ROAD if sea missing.” No NaN/Infinity/negative.

## 13. Determinism

Same inputs → same integers. No Date, random, network, locale, screen.

## 14. Persistence snapshot contract

**Save envelope unchanged** (`SAVE_GAME_VERSION = 6`). No live `durationSnapshot` field yet.

Future accepted shipment should store:

```
durationSnapshot: {
  policyVersion,
  totalDurationGameSeconds,
  movementDurationGameSeconds,
  transferDurationGameSeconds,
  legDurations,
  transferDurations
}
```

plain JSON only.

## 15. Offline / resume (future)

Resume uses snapshotted game seconds + `lastProgressedRealAtMs` like Delivery. Do not recompute v2 policy on an in-flight v1 shipment.

## 16. Non-goals

No payout, settlement execution, contract generation, MapScreen, `routes.ts` change, Firestore, Cloud Functions, RAIL/SEA/AIR activation, player vehicles.

## 17. Balance vs source facts

Speeds and transfer dwells are **design constants**. Distances are **source-backed diagnostics** when the caller supplies the matching authority. Visual corridor JSON is not duration truth.

## 18. Versioning strategy

Bump `MULTIMODAL_DURATION_POLICY_VERSION` when constants or ROAD adapter semantics change. Keep old snapshots executable under their recorded version (future loader).

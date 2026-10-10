# Map V2 — Migration contract

Live systems keep running. This is classification and adapter design only.

## Domain dependency findings (audit)

Gameplay **location** is almost always a **city string id**:

- Player: `homeCityId` (default `'izmir'` in save/server parse)
- Truck: `currentCityId`, `homeCityId`
- Trailer/driver: city fields
- Warehouse: `warehouse.cityId`
- Contract/delivery/transfer: `originCityId` / `destinationCityId` (and `fromCityId`/`toCityId` on `Route`)
- Market economy worker: `cityId` in history document ids
- Leaderboard/serverState: warehouse `cityId`, truck cities
- UI labels: `getCityName(cityId)` from `City.name` (Turkish hard-code)
- Map: PNG-normalized positions + `getWorldMapCityPosition`; pixels computed at render time, not saved as WGS84

**Assumptions that hold today:**

| Assumption | Reality |
|---|---|
| Türkiye-only | Yes — no `countryId`; GDD “yurt dışı” is `coming_soon` |
| Exactly 8 cities | Catalog has 8; saves merge via `mergeCanonicalCatalog` so old 5-city saves grow to 8 |
| `cityId` globally unique | Yes within the game catalog |
| Every city has road access | `ROUTES` is a complete directed pair graph among the 8; truck transfer fails if pair missing |
| Warehouse type = real infra | **No** — `'port'`/`'airport'` are storage classes |
| Route pair always exists | **Required** for generation/start; missing pair → no contract / transfer error |
| Distance from `ROUTES` | Yes — gameplay km, toll, difficulty |
| Location always `cityId` | **Yes for live gameplay** — no port/rail/airport location refs |

Backend/account deletion: city IDs are nested in player JSON; recursive user delete does not remap cities. Analytics service has no dedicated city event schema found.

Tests/fixtures: heavy use of `'izmir'` / `'ankara'` etc. Map tests use PNG x/y.

---

## Legacy map artifacts

| Artifact | Classification |
|---|---|
| `WorldMapCanvas` | REPLACE_WITH_MAP_V2 |
| `InteractiveTurkeyMap` | REPLACE_WITH_MAP_V2 |
| `worldMapPositions.ts` | DO_NOT_MIGRATE_AS_GEO_DATA; DEPRECATE_AFTER_CUTOVER |
| `networkPositions.ts` | DO_NOT_MIGRATE_AS_GEO_DATA; DEPRECATE_AFTER_CUTOVER |
| `mapRoadNetwork.ts` | DO_NOT_MIGRATE_AS_GEO_DATA; ADAPTER_REQUIRED during shadow (visual only) |
| `TURKEY_OUTLINE` (`mapVisuals.ts`) | DO_NOT_MIGRATE_AS_GEO_DATA |
| `assets/maps/*.png` | KEEP_DURING_MIGRATION until cutover; DO_NOT_MIGRATE_AS_GEO_DATA |
| `ROUTES` / `src/data/routes.ts` | KEEP_DURING_MIGRATION; ADAPTER_REQUIRED later to GameplayTransportGraph |
| `CITIES` / `src/data/cities.ts` | KEEP_DURING_MIGRATION; split GameplayCity vs GeoCity later, not now |
| `MapCityNode` | DEPRECATE_AFTER_CUTOVER (already unused) |
| `mapTheme.ts` / map chrome | KEEP_DURING_MIGRATION |

---

## City

`City` in `types/game.ts` mixes identity, economy, and market. **Do not split live files now.**

Future:

- **GameplayCity** — id, market, modifiers, unlock level, display via `nameKey` later
- **GeoCity** — geographic record
- **GameplayCityGeoMapping** — versioned table

Display name is not identity. Mapping stays UNRESOLVED until ingest.

---

## Routes

`LegacyGameplayRoute` = current `Route` (`id`, `fromCityId`, `toCityId`, `distanceKm`, `difficulty`, `tollCost`).

Later: RouteDefinition / GameplayTransportEdge with optional `geometryRef`. Toll/difficulty stay **gameplay metadata**. Do not recalculate km. Do not delete `ROUTES`.

Versioned table later: `legacyRouteId` or sorted pair → gameplay edge id. Unresolved until defined.

---

## Warehouse

Keep `warehouse.cityId` as `gameplayCityId`. Optional future `geoInfrastructureId` nullable. Missing geography **must not** drop ownership.

Do not auto-create GeoInfrastructure from warehouse type `port`/`airport`.

---

## Contracts

Keep `originCityId` / `destinationCityId`. Visualization may map to geo if VERIFIED; if UNRESOLVED, draw using legacy PNG adapters or hide geo layer — **do not crash**, **do not invent coords**. Schema unchanged.

---

## Delivery / vehicles

Active jobs survive renderer swap by **progress + city pair + route id**, not pixels.

Invariant: **PLAYER SAVE MUST NOT STORE MAP PIXELS** in the final Map V2 model.

Today pixels exist only in render (`pixelPoint` on map helpers). Do not add them to `saveGame`. Do not change delivery persistence in this step.

---

## Versioned mapping tables (empty of geo ids)

- `gameplayCityId` → `geoCityId` (`mappingVersion`, status)
- legacy route pair → gameplay transport definition
- legacy warehouse type → geo infra **only if verified**

No fake rows with invented geo ids.

---

## Compatibility modes (flags not implemented)

See `MAP_V2_ROLLOUT_MODES.md`.

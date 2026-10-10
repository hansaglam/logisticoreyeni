# Map V2 — Domain architecture

**Phase:** 0 Step 3  
**Policy:** `MAP_DATA_SOURCE_POLICY_VERSION = 1`  
**Visual IDs:** MAP-01 … MAP-09  
**Code (types only, unused by live app):** `src/mapV2/domain/`

This document is the domain contract. It does not replace `MapScreen`, ingest geography, or migrate saves.

---

## Pipeline

```
SOURCE DATA (Step 1 manifests)
    ↓
GEOGRAPHIC DOMAIN
    ↓
GAMEPLAY MAPPING
    ↓
PLAYER / GAME STATE  (authoritative for progression)
    ↓
VIEW MODEL
    ↓
RENDERER
```

The renderer is never the source of truth for gameplay.

## Domain boundaries

| Domain | Owns | Must not own |
|---|---|---|
| A. Geographic | Countries, geo cities, real infra, networks, geometry refs, provenance refs | Money, unlocks, owned warehouses |
| B. Gameplay | `gameplayCityId`, `ROUTES`, contracts, city markets, warehouse *types* | WGS84, OSM, country polygons |
| C. Player state | Unlocks, ownership, levels, vehicles, deliveries, cash, reputation | Map pixels, MapData packages |
| D. Rendering | Camera, projected/screen coords, visible layers | Firestore, OSM files, economy |
| E. Source/provenance | Dataset manifests (Step 1) | Entity gameplay fields |

Türkiye-specific strings must not appear as required fields on Map V2 geo types. Live game remains Türkiye-only until later.

---

## Geographic entities (unpopulated)

Identity is never a display name. IDs are opaque strings assigned at **ingestion**, not now.

- **GeoCountry** — `geoCountryId`, optional `iso2`/`iso3` (validated from approved source at ingest — **do not invent**), `nameKey`, `boundaryRef`, `centroidRef`, `regionIds`, `provenanceRef`, `productionApproved`, optional disputed metadata.
- **GeoRegion** — optional. Kinds: `continent` | `subregion` | `gameplay_grouping` | `visual_grouping`. **Not** required for Türkiye. MAP-02 is skippable. Europe is not a hard parent of Türkiye.
- **GeoCity** — `geoCityId`, `geoCountryId`, `nameKey`, optional `coordinateRef` / `administrativeAreaRef`, `provenanceRef`, `productionApproved`.
- **GeoInfrastructure** — real-world catalog entity (port/airport/station…) with provenance. Not player-owned.
- **GeoTransportNode / Edge / Network** — see transport model.
- **GeoBoundary / GeoLabel** — display-ready refs + `nameKey`.
- **GeoEntityReference** — `{ kind, id }` pointer.

`provenanceRef` points at a Step 1 dataset/entity id. Do not copy full attribution onto every record.

---

## Gameplay mapping (critical)

Live IDs stay:

`izmir` `istanbul` `ankara` `bursa` `antalya` `adana` `diyarbakir` `trabzon`

```
GameplayCityGeoMapping {
  gameplayCityId
  geoCityId        // null while UNRESOLVED
  mappingStatus    // UNRESOLVED | VERIFIED | DEPRECATED
  mappingVersion
}
```

Until ingestion: **all mappings UNRESOLVED**, `geoCityId = null`. Do not mint fake geo IDs.

---

## Gameplay location (future)

Live fields stay `cityId` / `originCityId` / `destinationCityId`.

Future **additive** ref (not persisted yet):

- `CITY` + `gameplayCityId`
- `INFRASTRUCTURE` + `playerInfrastructureId`
- `HUB` + stable hub id

Migration: keep city fields; adapters may resolve optional geo later. Unresolved geo → fail closed / degrade (legacy map), never invent coordinates.

---

## Infrastructure

| Layer | Example |
|---|---|
| REAL_WORLD (`GeoInfrastructure`) | DHMİ airport after verification |
| PLAYER (`PlayerInfrastructure`) | Owned warehouse in `izmir` |

Live `WarehouseType` `'port' | 'airport'` is **gameplay storage class**, not a registered port/airport. Mapping to `GeoInfrastructure` requires an explicit verified link.

Future player record (not persisted now): `playerInfrastructureId`, `ownerUid`, optional `geoInfrastructureId`, optional `gameplayCityId`, type, level, capacity, status.

---

## Transport

Canonical modes: `ROAD` | `RAIL` | `SEA` | `AIR` (enum, not display strings).

Two graphs:

1. **GeographicTransportNetwork** — licensed, detailed, `productionApproved`
2. **GameplayTransportGraph** — simplified for contracts; may reference geometry; **must not** fabricate real infrastructure

**Nodes:** CITY, ROAD_JUNCTION, RAIL_STATION, RAIL_TERMINAL, PORT, AIRPORT, INTERMODAL_HUB — uninstantiated.

**Edges:** `edgeId`, `mode`, `fromNodeId`, `toNodeId`, `geometryRef`, optional `distanceMeters` (not authoritative until verified), metadata, provenance. **Do not** copy `ROUTES.distanceKm` into geographic `distanceMeters`.

Live `ROUTES` remain gameplay (distance, difficulty, toll).

---

## Multimodal (future contract only)

`ShipmentRoute { legs[] }`  
`ShipmentLeg { mode, fromLocation, toLocation, transportAssetRef?, startAt, arrivalAt, routeRef? }`

Do not change `Delivery` documents.

---

## Progression

Player-only: unlocked countries/cities, owned infra, vehicles, contracts, deliveries, money, reputation, companyLevel.

`GeoCountry` ≠ `PlayerCountryProgress`.  
`GeoCity` ≠ `PlayerCityProgress`.

MapData updates **must not** mutate progression or cash. No unlock economy in this step.

---

## MapData package

`schemaVersion` ≠ `releaseVersion`.

```
MapDataPackage {
  schemaVersion
  releaseVersion          // null until first approved package
  generatedAt
  sourceManifestRefs
  countries, cities, infrastructure, networks
  metadata
}
```

`MAP_DATA_RELEASE_VERSION` stays **null**.

Distribution later: version check, hash, atomic activate, rollback; never partial activate. Bundled vs download **not chosen**.

---

## Geometry / coordinates

`geometryRef` → MapData-owned geometry (point, polyline, polygon, multipolygon, LOD variants). Not giant arrays on gameplay objects.

Spaces (never mixed):

```
WGS84 GEO  →  Projection service  →  MAP PROJECTED  →  Camera  →  SCREEN
LEGACY PNG X/Y is a fourth, deprecated space
```

Projection is **not selected** here; it must be replaceable. Gameplay must not depend on screen/projected coords.

**Never** treat PNG-normalized x/y as WGS84.

---

## View model / UI state

Renderer consumes prepared **VisibleCountry / VisibleCity / VisibleRoute / VisibleInfrastructure / VisibleVehicle** (names illustrative).

Renderer must **not** query Firestore, raw OSM, raw geoBoundaries, economy, or source manifests.

Transient UI: `geographicLevel`, selection ids, layer toggles, camera, navigation stack. Not player progression.

Stack: WORLD → optional REGION → COUNTRY → CITY → INFRASTRUCTURE.  
Back: dismiss sheets first, then pop stack, else app tab conventions. Not implemented.

---

## Backend vs client

| Static client MapData | Server / player authoritative |
|---|---|
| Boundaries, geo cities, transport geometry, real infra catalog | Ownership, unlocks, upgrades, contracts, money, active shipments |

Do not migrate Firestore schemas now. Backend already stores `homeCityId` / warehouse `cityId` as **gameplay strings**.

---

## Forward compatibility

Types must allow more countries, many cities, rail/sea/air, hubs, regions, multiple releases, localization, disputed-boundary display policy, new infra types — without encoding “exactly 8 Turkish cities” in the geo model.

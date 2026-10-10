# Map V2 — Türkiye SEA / PORT foundation (Step 10)

**Status:** OSM-derived GeoPort catalog. ODbL 1.0. Not production-approved. **Player shipping is inactive.**  
**Official QA:** `OFFICIAL_PORT_QA_ONLY`. `TURKEY_PORT_AUTHORITY_SOURCE = PENDING_VERIFICATION` — no official authority is named in code. Do not ingest official geometry.

Player country legend remains **Denizyolu — Yakında**. This step does not create shipping routes, ships, contracts, or port ownership.

## Source policy

- Primary: OpenStreetMap extract `data/map-raw/osm/turkey-260915.osm.pbf` (reuse; do not redownload).
- Filter extract: `data/map-raw/osm/turkey-ports.osm.pbf` + `turkey-ports.geojson` (gitignored).
- License: ODbL 1.0. Attribution required.
- Forbidden: Google Maps/Earth, screenshot tracing, invented coordinates, city-name-only ports, player warehouse `type=port`.

Generate (no download):

```
npx tsx scripts/map-v2/extract-turkey-ports-osm.ts
npx tsx scripts/map-v2/audit-turkey-port-tags.ts
npx tsx scripts/map-v2/ingest-turkey-ports.ts
```

Canonical package: `src/mapV2/generated/infrastructure/turkey-ports.json`.

## Port definition

A GeoPort is a clustered OSM facility with harbour / port landuse / industrial port / ferry terminal / seamark harbour evidence.

Standalone `man_made=pier` and marinas are **not** GeoPorts (audit extract may still contain them).

Supported classifications: `COMMERCIAL_PORT`, `CONTAINER_PORT`, `FREIGHT_PORT`, `FERRY_PORT`, `INDUSTRIAL_PORT`, `MARINA` (excluded from catalog), `FISHING_HARBOUR`, `UNKNOWN_PORT`.

## Logistics eligibility

| Eligibility | Meaning |
|---|---|
| `LOGISTICS_ELIGIBLE` | Freight / industrial / commercial port evidence. Future SEA freight candidates. |
| `PASSENGER_ONLY` | Ferry terminals without cargo/industrial port tags. Kept as infrastructure, not freight. |
| `LOCAL_MARITIME` | Fishing harbours. |
| `NON_LOGISTICS` | Marinas, piers, noise. Not catalogued as GeoPort. |
| `UNRESOLVED` | Named/unnamed harbour without freight tags. |

Missing OSM tags are `UNKNOWN` capabilities, never `KNOWN_FALSE`.

## GeoPort vs PlayerInfrastructure

`WarehouseType = "port"` is a storage class (`LIVE_WAREHOUSE_TYPE_IS_NOT_GEO_INFRA`). It does not prove a real-world port. Future ownership must bind explicitly to a GeoPort id.

`turkey-infrastructure.json` remains `facilities: []`. Ports live in the dedicated package, not that placeholder.

## Clustering

Union-find on OSM objects when:

- a point/line is contained in / very near (~250 m) a port polygon, or
- similar normalized names within 3.5 km, or
- unnamed objects within 250 m.

Independent named commercial ports are not merged merely because they are nearby (keep-apart ~800 m when names differ). Logical ids: `infra.tur.port.{sha256(sorted sourceIds)[:12]}`. OSM identities stay `node|way|relation/<id>`.

## Verification

OSM-only records are **PROVISIONAL**. Never auto-`VERIFIED`. Official QA may later promote selected major ports without ingesting proprietary geometry. Disagreements become `PORT_SOURCE_DISCREPANCY` issues.

## City association

Gameplay cities: izmir, istanbul, ankara, bursa, antalya, adana, diyarbakir, trabzon.

- Associates only `LOGISTICS_ELIGIBLE` ports.
- `DIRECT` ≤ 35 km, `REGIONAL` ≤ 90 km, otherwise `NONE`.
- Inland cities (Ankara, Diyarbakır) are expected `NONE`.
- Multiple ports per city are retained. `primaryPortCandidate` is PROVISIONAL: eligibility rank then distance then id — distance alone cannot beat logistics eligibility.

Association lines on the DEV map are diagnostics, not shipping routes.

## Sea access (foundation only)

`PortSeaAccess` is separate from the land representative point. A vertex outside the COUNTRY_HIGH land polygon is `PROVISIONAL` water. Land-only samples stay `UNRESOLVED`. No synthetic offshore offset. City coordinates are never used as sea access.

## Coastline / water limitations

COUNTRY_HIGH administrative polygons are land-ish country shapes, not a navigable maritime mesh:

- they do not encode fairways, depths, or traffic-separation schemes;
- centroids of port polygons are often on land;
- islands, lagoons, and port basins are coarse;
- they are insufficient for SEA routing.

Future geometry options (not implemented): OSM water/coastline extracts, Natural Earth ocean (visual/context only), purpose-built offline navigable graph. OSM ferry ways are passenger evidence, not a freight graph.

## Future SEA routing (not built)

```
PortSeaAccess → navigable maritime graph/policy → offline route extraction → PlayerFacingSeaCorridorSet
```

Straight lines over water are not acceptable. Do not assume Euclidean space over land polygons.

## Turkish Straits

İstanbul / Bosphorus and Çanakkale / Dardanelles are constrained waterways. Future routing must treat them as channel geometry, not as open sea crossing land polygons. No invented strait polylines in this step.

## Player isolation

- Do not import `countryPortLoader` from `MapV2WorldScreen`.
- Do not load `turkey-ports.json` via `transportNetworkLoader`.
- SEA canonical graph is gitignored. Metro uses the runtime manifest (empty geometry). Player Denizyolu remains Yakında.
- DEV: Yönetim → Simülasyon Testi → Map V2 Transport Inspector → **PORT Haritasını Aç**.

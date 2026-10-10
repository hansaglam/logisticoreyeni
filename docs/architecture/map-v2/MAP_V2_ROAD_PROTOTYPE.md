# Map V2 — Türkiye ROAD prototype (Step 2E)

**Status:** real Osmium extract ingest (Step 2E-2/2E-3). ODbL. Not production-approved.  
**License:** ODbL 1.0 (OSM-derived). `OSM_TRANSFORMED_DB_LICENSE_CHECKPOINT` remains open.

## Raw file

Path (gitignored): `data/map-raw/osm/turkey-roads.geojson`  
Derived from: `data/map-raw/osm/turkey-260915.osm.pbf` (Osmium `motorway|trunk|primary|secondary`).

Observed Osmium GeoJSON shape (do not assume `osm_id`):

- compact FeatureCollection
- many `Point` features (traffic_signals, motorway_junction, …) then `LineString` ways
- **no** `feature.id`, **no** `properties.id` / `osm_id` / `@id` on sampled ways
- tags only: `highway`, `name`, `ref`, `oneway`, `lanes`, …
- ingest source identity: extract those fields if present; otherwise deterministic `geom.<sha25616>` of canonical WGS84 topology keys

`MultiLineString` is accepted. `properties.highway` is required. No live OSM query.

Topology node identity is WGS84 7 d.p. keys, **not** `TRANSPORT_QUANTIZE` (1e5, ~400 m). Render quantization is separate (`ROAD_RENDER_QUANTIZE`).

## Filter policy

- Include: motorway, trunk, primary, secondary (and `*_link` via base class)
- Exclude by default: tertiary, residential, living_street, service, track, path, footway, pedestrian, steps, cycleway, bridleway
- Türkiye scope: **all vertices** must lie in `country.tur` COUNTRY_HIGH polygons. Partial foreign lines are rejected (`REJECT_PARTIAL_FOREIGN`). `BORDER_CROSSING` nodes are not minted in 2E.
- Truck/HGV legality is **UNVERIFIED**.

## Length

Edge `lengthMeters` is WGS84 haversine (mean Earth radius 6,371,000 m). It does not update `src/data/routes.ts`.

## LOD

- LOW: motorway/trunk
- MEDIUM: + primary
- HIGH: + secondary

Canonical WGS84 is stored; projected polylines may be simplified with endpoint preservation.

## Run

`npx tsx scripts/map-v2/ingest-turkey-roads.ts`

Missing source → exit 2 `STEP_2E_BLOCKED_RAW_SOURCE_REQUIRED`.

# Map V2 — Türkiye RAIL foundation (Step 7)

**Status:** OSM-derived prototype ingest. ODbL. Not production-approved. **Player rail is inactive.**  
**QA:** `TCDD_QA_ONLY` — TCDD public network information is a discrepancy checklist, not a geometry source.

## Raw files (gitignored)

- Parent: `data/map-raw/osm/turkey-260915.osm.pbf`
- Extract: `data/map-raw/osm/turkey-rail.osm.pbf`
- GeoJSON: `data/map-raw/osm/turkey-rail.geojson`

Generate (no download):

```
npx tsx scripts/map-v2/extract-turkey-rail-osm.ts
npx tsx scripts/map-v2/ingest-turkey-rail.ts
```

Osmium:

```
osmium tags-filter data/map-raw/osm/turkey-260915.osm.pbf nwr/railway -o data/map-raw/osm/turkey-rail.osm.pbf --overwrite
osmium export data/map-raw/osm/turkey-rail.osm.pbf -f geojson -c scripts/map-v2/osmium-rail-export.json -o data/map-raw/osm/turkey-rail.geojson --overwrite
```

## Source identity

Osmium default GeoJSON omits `feature.id`. Export config `scripts/map-v2/osmium-rail-export.json` sets `attributes.type` + `attributes.id`. Observed extract stores **`properties.@type` + `properties.@id`**. Ingest uses `way/<id>` / `node/<id>`. Topology vertices still use WGS84 7 d.p. keys (OSM node IDs are not present on LineString coordinates). Geometry-fingerprint fallback exists but was unused on the current extract’s accepted edges.

Do not fabricate OSM IDs.

## Filter

- Logistics default: `railway=rail`
- `narrow_gauge` only if `usage=main|branch`
- Excluded: tram, subway, light_rail, funicular, monorail, miniature, construction, abandoned, disused, razed, proposed, planned
- Excluded classes remain in the raw extract and ingest rejection report

## Border

`CLIP_TO_TURKEY_BBOX_KEEP_DOMESTIC`: vertices inside the Natural Earth land polygon **or** the country COUNTRY_HIGH projected bbox are in scope. This keeps Marmaray/İzmit gulf alignments that sit over water in the land polygon. True extraspatial vertices are still clipped. Neighbor networks are not ingested wholesale.

## LOD

- LOW: mainline / untagged operational rail
- MEDIUM: + `usage=branch`
- HIGH: industrial/military/tourism + yard/siding/spur

Canonical WGS84 unchanged; render polylines may simplify with endpoints kept.

## Runtime

Full `turkey-rail-network.json` is gitignored (~31MB). Metro loads:

- `turkey-rail-runtime-manifest.json` (counts, hashes, city access, TCDD QA)
- `turkey-rail-debug.json` (DEV map geometry)

DEV: Yönetim → Simülasyon Testi → Map V2 Transport Inspector → **RAIL Haritasını Aç**

Country dashboard legend remains **Demiryolu — Yakında**.

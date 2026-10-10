# ADR 0006 — City / settlement point source (Step 2C)

**Status:** ACCEPTED  
**Date:** 2026-09-16  
**Scope:** Map V2 city foundation. Türkiye-first package. Not a production MapData release.

## Decision

**PRIMARY city point source for Step 2C:** Natural Earth **10m Populated Places**, pin **natural-earth-vector v5.1.2**.

| Field | Value |
|---|---|
| Dataset | `ne_10m_populated_places` |
| License | Public domain |
| Coordinates | Source WGS84 in the GeoJSON geometry (also mirrored in `LONGITUDE` / `LATITUDE` fields) |
| Runtime | Preprocessed package only. No live Natural Earth / OSM / Google requests |

## Why not OSM in this step

OSM `place=*` is the preferred **global** settlement architecture later, and remains allowed by `MAP_DATA_SOURCE_POLICY_V1` §2.C for transport/POI pipelines (ODbL).

For Step 2C city **points**, Natural Earth is already an approved physical/context source in that policy (§2.B), has a cleaner public-domain license, ships stable `NE_ID` keys, and includes all eight legacy Türkiye gameplay cities as distinct source features.

OSM remains the planned source for roads/rail/ports/airports. It is **not** used here so city points are not mixed into an ODbL database before the OSM license checkpoint.

## Forbidden

- AI-generated lat/lng
- Google Maps/Earth extraction
- PNG / `worldMapPositions` / `networkPositions` / `mapRoadNetwork` as geographic truth
- Live Overpass or OSM tile servers
- HGM bundled as production city coordinates (QA/reference only)

## Identity

`geoCityId = city.tur.ne.{NE_ID}`

`NE_ID` is the Natural Earth stable numeric id. Display names are never IDs. `GEONAMESID` / `WIKIDATAID` are provenance metadata only.

## Türkiye inclusion (provisional)

All ADM0_A3=`TUR` rows in the 10m populated-places file (83 features). Presentation LOD is assigned from source `FEATURECLA` + `POP_MAX`. Gameplay mapping is a separate table.

## Checkpoint

`productionApproved: false`. Not a public MapData release.

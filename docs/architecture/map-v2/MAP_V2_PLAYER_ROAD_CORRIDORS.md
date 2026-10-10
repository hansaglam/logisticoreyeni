# Map V2 — Player-facing ROAD corridors

DEV country dashboard only. Production `MapScreen` is unchanged.

## Pipeline

Canonical OSM-derived Türkiye ROAD graph (`turkey-road-network.json`, contentHash `sha256:b506587d…`)
→ PROVISIONAL city access nodes (15 km, giant undirected component)
→ offline Dijkstra
→ Douglas–Peucker simplification (`0.000018` world units)
→ compact player artifact `src/mapV2/generated/countryOverview/turkey-road-corridors.json`
→ country dashboard Skia batches

The player dashboard **never** loads:

- the 237 MB ROAD monolith
- ROAD runtime chunks / overview-low
- routing graphs

## No runtime routing

`scripts/map-v2/build-turkey-road-corridors.ts` is build-time only.

## No fake geometry

If a candidate cannot be extracted from source edges, it is `UNRESOLVED` and invisible.

Do not use `src/data/routes.ts`, PNG positions, or straight city-to-city lines.

`sourceRouteLengthMeters` is diagnostic. It does **not** replace gameplay km/toll/difficulty.

## Access

City ROAD access remains **PROVISIONAL**. This step does not mark VERIFIED.

Stored candidates are used when they sit in the giant component (99 125 nodes of 823). İstanbul’s stored candidate is not in that component; the nearest giant-component node within 15 km is used instead (still PROVISIONAL).

## Oneway policy

OSM `oneway` is ingested on edges.

Directed Dijkstra does **not** yield a strongly connected national network from the 8 access nodes (İstanbul and Trabzon failed).

V1 overview extraction therefore uses **undirected** adjacency (`dijkstra-length-classweight-undirected-overview-v1`). This is not a claim that reverse travel is legal for trucks. Future driving/legal routing must revisit direction.

## Cost

Primary: `edge.lengthMeters` (WGS84 polyline).  
Modest class weights: motorway 0.92, trunk 0.95, primary 1.00, secondary 1.08, links slightly higher.

## Candidates vs resolved

10 candidate pairs. All 10 resolved. All 8 gameplay cities connected. No invented extra links.

## Lineage

Player JSON stores `sourceEdgeCount` + `sourceEdgeIdsHash`. Full `sourceEdgeIds` are in the rebuildable gitignored sidecar `turkey-road-corridors.lineage.json`.

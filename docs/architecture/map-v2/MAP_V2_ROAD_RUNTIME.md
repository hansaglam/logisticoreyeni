# Map V2 — Türkiye ROAD runtime chunks (Step 2F)

**Runtime source:** `src/mapV2/generated/transport/road/`  
**Canonical ingest JSON:** `src/mapV2/generated/transport/turkey-road-network.json` (gitignored build artifact, ~237 MB). Not Metro-required.

**Commit policy:** runtime chunks + `manifest.json` + `roadChunkRegistry.ts` may be committed (same generated-data policy as city packages). Raw OSM under `data/map-raw/` stays gitignored.

## LOD semantics

Source edges keep one `networkLod` assignment (LOW = motorway/trunk, MEDIUM = primary, HIGH = secondary).

**Visibility** is still `LOW ⊂ MEDIUM ⊂ HIGH` (`edgeVisibleAtLod`).

**Runtime files are additional, not complete sets:**

- `low/` = edges assigned `NETWORK_LOW`
- `medium/` = additional `NETWORK_MEDIUM` only
- `high/` = additional `NETWORK_HIGH` only

Loader unions layers for the active view LOD.

## Grid

Fixed grid over the Türkiye road coverage bbox in normalized Web Mercator:

| LOD | cols × rows |
|-----|-------------|
| LOW | 8 × 6 |
| MEDIUM | 12 × 9 |
| HIGH | 16 × 12 |

Each edge is owned by **exactly one** chunk (centroid of its projected bbox). Chunk `bounds` is the union of its edge bboxes (may extend outside the grid cell). Empty cells are omitted.

## Nodes

`CHUNK_LOCAL_INTERNED_BOUNDARY_DUPLICATE`: each chunk interns topology keys used by its edges. Boundary nodes may appear in multiple chunks. Canonical node identities remain `tn.tur.road.n.{lon7}_{lat7}`.

## Geometry

Runtime stores delta-encoded `projectedQuantized` integers at the ingest quantize scale (`1e8`). WGS84 is not duplicated into chunks. Decode is lossless vs the source package’s projected arrays.

## Progressive runtime (Step 2F fix)

Country first paint: polygon + cities, **no ROAD require()**.

Then LOW overview (`turkey-road-overview-low.json`): one render-only file, style-batched, extra Douglas–Peucker (`ROAD_OVERVIEW_SIMPLIFY`). Same source LOW edges, not a topology rewrite.

Spatial chunks load after relative zoom ≥ 1.22, **2 JSON + 2 SkPaths per tick**, paused during pan/pinch. Stale queues are dropped on generation bump.

DEV HUD: ROAD ON/OFF, tti / firstRoad ms.


`roadChunkRegistry.ts` uses **lazy** `() => require('./low/….json')`. No `require(\`…${id}\`)`. Modules parse on first load, not at startup.

## Cache

LRU, max 48 chunks or 24 MB estimated. Current viewport/prefetch set is pinned. Prefetch inflates viewport by 4%.

## AUTO LOD hysteresis (relative zoom = scale / country fit)

- MEDIUM → LOW when relative zoom **< 1.18**
- HIGH → MEDIUM when relative zoom **< 1.48**

Country overview max relative zoom is **1.8**. ROAD inspector currently shares that cap.

## Rebuild

```
npx tsx scripts/map-v2/ingest-turkey-roads.ts   # writes monolith + packs runtime
npx tsx scripts/map-v2/pack-turkey-road-runtime.ts
```

# Map V2 — Türkiye maritime navigability foundation (Step 11)

**Status:** Hybrid water-grid navigability graph for Türkiye. DEV / build-time only. **Not player-facing SEA corridors.**  
**Decision target:** `MARITIME_NAVIGATION_FOUNDATION_PASS` when straits connect without land-crossing shortcuts.

Player country legend remains **Denizyolu — Yakında**. No ships, sea contracts, port ownership, or AIR.

## Water / coast source

Natural Earth 10m land (public domain, `natural-earth-vector-v5.1.2`) is the land mask. It is **not** a navigable ocean mesh. At 10m scale the Bosphorus is closed land.

OSM marine polygons (ODbL 1.0, offline extract from `turkey-260915.osm.pbf`) overlay water tagged `strait` / `bay` / `sea` / `lagoon` / `harbour_basin` (lakes excluded). Those polygons open İstanbul Boğazı and Çanakkale Boğazı.

**Navigable** ⇔ OSM marine **or** not Natural Earth land.

Forbidden: Google Maps/Earth, screenshot tracing, city-to-city water lines, Beziers, invented seaward offsets.

Generate (no live fetch):

```
npx tsx scripts/map-v2/extract-turkey-water-osm.ts
npx tsx scripts/map-v2/ingest-turkey-maritime.ts
```

Canonical package: `src/mapV2/generated/transport/turkey-sea-network.json` (gitignored, build-time).  
Metro loads `turkey-sea-runtime-manifest.json` + `turkey-sea-debug.json` only. The country dashboard never `require`s the canonical graph.

## Graph strategy

Türkiye-first **hybrid water grid**, not a global ocean navmesh:

| Layer | Step | Role |
|---|---|---|
| Coarse | 0.12° | Black Sea, Aegean, Mediterranean, outer Marmara |
| Approach / Marmara fill | 0.02° | Mouth stitching; enclosed-sea connectivity |
| Bosphorus | 0.006° | Explicit channel window |
| Dardanelles | 0.008° | Explicit channel window |

Coarse and approach points inside strait windows are skipped so Black↔Marmara is not a land-crossing coarse hop. Channel nodes connect to nearby coarse/approach hubs only when endpoints and midpoint are navigable (portal test). Intra-layer edges use sampled `segmentHitsLand`.

8-connected neighbors. Max edge length 22 km.

## Land-mask / island policy

Any edge whose sampled segment leaves navigable water is invalid. Islands are Natural Earth land (plus OSM marine holes where tagged). Aegean is not one unrestricted polygon: a line through an island fails `segmentHitsLand`.

Grid resolution is chosen so Bosphorus/Dardanelles stay open (NE 10m alone would close them; OSM marine keeps them).

## Bosphorus / Dardanelles

Windows are **search bounds over source water**, not invented polylines.

- `BLACK_SEA` → `BOSPHORUS` → `MARMARA` → `DARDANELLES` → `AEGEAN` → open water → `MEDITERRANEAN`
- No synthetic land-crossing shortcut if the graph fails. Ingest exits `MARITIME_NAVIGATION_BLOCKED_STRAITS`.

## Adaptive port approach (Step 12)

Coarse 0.12° cells leave inner gulfs and harbour mouths in smaller components. Logistics access is two-stage and **build-time only**:

1. **LOCAL** — 0.008° grid in a ~0.11° window around each logistics GeoPort, plus 0.02° regional boxes over İzmir Gulf, Antalya bight, İskenderun Gulf, and Trabzon coast (geographic water, not invented fairways). Local/regional cells 8-connect with land-sampled edges. They then stitch to the nearest **COARSE/CHANNEL** trunk nodes with a land-free segment (not a straight snap through land, not a nationwide fine grid). Coarse 0.12° neighbor gaps (one missing cell ≈ 0.24° / >22 km) are bridged only by **land-sampled** coarse-to-coarse edges up to 40 km between existing water cells.
2. **TRUNK** — the union-find component that already contains Black Sea, Bosphorus, Marmara, Dardanelles, Aegean, and Mediterranean seeds. Access to an isolated harbour component is not accepted even if water exists.

A PortSeaAccess is `PROVISIONAL` only if both stages succeed. Isolated harbour puddles stay `UNRESOLVED` (`NO_TRUNK_CONNECTION`). GeoPort representative points are never moved; inland centroids use a nearby navigable-water candidate (`PORT_POSITION_INLAND` if none). Unresolved logistics ports may remain unresolved; ingest must not invent offshore connectors.

### Water precedence (geometry-local)

1. OSM marine / harbour polygons (`strait`, `bay`, `sea`, `lagoon`, `harbour`, `harbour_basin`, `dock`, `seamark:type=harbour_basin`)
2. Not Natural Earth 10m land

OSM override applies only to points inside those polygons. Lakes are still excluded. Breakwaters are **not** modeled as walls.

`man_made=breakwater` is context only in this step.


Logistics-eligible GeoPorts only. Search radii: **250 / 500 / 1000 / 2000 / 5000 m**. Snap to the nearest navigable graph node with a land-free diagnostic segment from the port representative point. No unverified seaward projection.

Statuses: `PROVISIONAL` | `UNRESOLVED`. `VERIFIED` requires human review plus official public list plus OSM agreement (`MARITIME_VERIFIED_CRITERIA`). Ingest never mass-promotes.

Failure reasons (legacy plus Step 12): `NO_NAVIGABLE_WATER_NEARBY`, `PORT_GEOMETRY_AMBIGUOUS`, `LAND_INTERSECTION`, `CLUSTER_AMBIGUITY`, `INSUFFICIENT_SOURCE`, `HARBOUR_GEOMETRY_MISSING`, `SOURCE_POSITION_SUSPECT`, `UNKNOWN`, `LAND_MASK_COARSE`, `HARBOUR_WATER_MISSING`, `NO_APPROACH_PATH`, `NO_TRUNK_CONNECTION`, `PORT_POSITION_INLAND`, `SOURCE_AMBIGUOUS`.

Region is classified from access geography, not gameplay city name.

Official QA remains `OFFICIAL_PORT_QA_ONLY` / `TURKEY_PORT_AUTHORITY_SOURCE = PENDING_VERIFICATION`. Candidate public lists (Ulaştırma ve Altyapı Bakanlığı, TÜRKLİM) may be used later for name/existence QA only — no official geometry ingest.

## Route smoke tests

Diagnostic smoke tests run at ingest. City-named pairs fail closed when that city’s logistics ports are unresolved. A Marmara↔Black Sea pair is used to prove Bosphorus connectivity on resolved trunk ports. Lengths are not economy. Not written to `routes.ts`. Not player corridors.

## Player isolation

- `MapV2WorldScreen` must not import `countryPortLoader`, `turkey-ports.json`, or `turkey-sea-network.json`.
- `getVisibleTransportEdges(..., 'SEA')` returns `[]`.
- ROAD / RAIL canonical, corridors, and interaction are untouched.
- DEV: Yönetim → Simülasyon Testi → Map V2 Transport Inspector → **PORT Haritasını Aç**. Overlay is muted blue-gray graph, brighter channels, small access markers, warning unresolved markers.

## Player-facing SEA corridors (Step 13)

Offline Dijkstra on the canonical graph produces a compact `turkey-sea-corridors.json` overlay.

- Cost: geographic meters × kind weight (CHANNEL 0.90, COARSE 1.00, APPROACH 1.08, LOCAL 1.18 near endpoints, 7.5 if LOCAL is far from both ports).
- `channelsUsed` is a **strait-span** of traversed Bosphorus/Dardanelles window edges, not endpoint channel membership.
- Salıpazarı may rehome to an existing non-channel MARMARA node within 12 km; the GeoPort is not moved.
- Player preview loads only the compact artifact. Default `SEA_PLAYER_VISUAL_OFF`. Legend stays Yakında unless DEV preview (Önizleme). Never Aktif.
- Ankara / Diyarbakır are not SEA endpoints. No city-to-port inland connectors.

# Map V2 — Transport network architecture (Step 2D)

**Phase:** 1 Step 2D  
**Policy:** `MAP_DATA_SOURCE_POLICY_VERSION = 1`  
**Code:** `src/mapV2/geo/transportNetwork.ts`, `src/mapV2/world/transportNetworkLoader.ts`  
**Production Harita:** unchanged

This step is architecture-first. It does **not** ship playable roads, rail, ships, or flights.

---

## Geographic vs gameplay graph

| Layer | Role | Must not |
|---|---|---|
| `GeoTransportNetwork` | Source-backed nodes/edges + projected polylines | Copy `ROUTES` km/toll; invent lanes |
| `GameplayTransportGraph` | Future playable/simplified graph with unlocks/hubs | Pretend it is OSM topology |
| `src/data/routes.ts` | Gameplay city-pair metadata | Be treated as real road geometry |
| `src/data/mapRoadNetwork.ts` | Legacy PNG-aligned polylines | Be imported into Map V2 geo packages |

Future gameplay graphs may simplify, restrict, or add balancing. They must keep links to geographic `nodeId` / `edgeId`.

---

## Mode separation

Canonical modes: `ROAD` `RAIL` `SEA` `AIR`.

Each mode is a **separate package file**. Do not load one giant blob as the long-term layout.

Node kinds (catalog; do not mint without source):

- ROAD: `ROAD_JUNCTION` `CITY_ACCESS` `BORDER_CROSSING`
- RAIL: `RAIL_JUNCTION` `RAIL_STATION` `RAIL_TERMINAL`
- SEA: `PORT` `SEA_WAYPOINT` `ANCHORAGE`
- AIR: `AIRPORT` `AIR_WAYPOINT`
- Shared: `INTERMODAL_HUB`

---

## Source status matrix

See `MAP_V2_TRANSPORT_SOURCE_STATUS.md`.

Step 2D packages are `SOURCE_PENDING` with **zero edges**. `READY` / `PROTOTYPE` require ingested, validated geometry. Missing modes must not be filled with synthetic lines.

OSM-derived candidates must record **ODbL** explicitly. `OSM_TRANSFORMED_DB_LICENSE_CHECKPOINT` remains open before public production distribution of transformed OSM databases.

---

## Package design

Türkiye-first, per-mode:

- `turkey-road-network.json`
- `turkey-rail-network.json`
- `turkey-sea-network.json`
- `turkey-air-network.json`
- `turkey-infrastructure.json`
- `turkey-city-access.json`
- `turkeyTransportManifest.json`

Schema `GeoTransportNetworkPackageV1`: schemaVersion, geoCountryId, mode, sourceStatus, projection (Web Mercator v1, preprojected), provenance manifest, transformation (filters, simplification version, projection version), nodes, edges, stats, contentHash.

Geometry: WGS84 source vertices stored once; projected quantized polyline stored at ingest. Runtime does not reproject thousands of vertices per frame.

---

## LOD strategy

`NETWORK_LOW` ⊂ `NETWORK_MEDIUM` ⊂ `NETWORK_HIGH` by visibility rank.

Country overview should later show major corridors only (`NETWORK_LOW`). Closer zoom reveals more edges.

Simplification must not drop endpoints. Topology validation runs after any future simplify pass. Disconnected components are allowed (islands, separate systems).

---

## Provenance

Every package stores provider, license, retrieval, transform version, source hash (or `unresolved` while pending), package hash, filters applied, simplification version, projection version.

Pending OSM packages still declare ODbL as the candidate license. They do not claim an extract hash until ingest.

---

## City-access mapping

Eight verified GeoCities are **not** transport nodes.

```
CityTransportAccess { geoCityId, mode, accessNodeIds, status }
status: VERIFIED | PROVISIONAL | UNRESOLVED
```

Nearest-node helpers **propose candidates only**. They must not mutate `GeoCity` or silently write `VERIFIED`.

---

## Infrastructure separation

`GeoInfrastructure` = real-world catalog (empty in 2D).  
`PlayerInfrastructure` / live `WarehouseType` `"port" | "airport"` = player storage class.

`LIVE_WAREHOUSE_TYPE_IS_NOT_GEO_INFRA = true`

---

## Multimodal future contract

No shipment migration. Types allow:

`ROAD node → INTERMODAL_HUB → RAIL → PORT → SEA → ROAD`

`ShipmentLegDraft` may later point at `mode`, `networkEdgeIds`, `originNodeId`, `destinationNodeId`.

---

## Render contract

`TransportRenderableEdge { edgeId, mode, projectedGeometry, styleClass }`

The renderer must not read OSM tags. `transportPaint.ts` maps attributes → style class.

Draft visual language (unpolished): ROAD solid cyan; RAIL dashed amber; SEA sparse maritime dash; AIR sparse violet. Modes must not share a single line language.

---

## Runtime APIs

Offline only. No live OSM.

- `getTransportNetwork(geoCountryId, mode, lod?)`
- `getVisibleTransportEdges(geoCountryId, mode, viewport, lod)`
- `getTransportNode(id)`
- `getCityTransportAccess(geoCityId, mode)`

`getVisibleTransportEdges` returns `[]` while `SOURCE_PENDING` or empty.

---

## DEV inspector

Yönetim → Simülasyon Testi → **Map V2 Transport Inspector**

Shows per-mode status, counts, provenance, pending states. Does not draw synthetic geometry.

---

## Ingest order (later steps, not 2D)

1. ROAD foundation (OSM extract + KGM QA)  
2. RAIL foundation (OSM + TCDD QA)  
3. PORT/AIRPORT infrastructure  
4. SEA/AIR routing only after a chosen navigational source  

Adapter: `scripts/map-v2/ingest-turkey-roads.ts` / `scripts/map-v2/ingest-turkey-rail.ts` (fail-closed without extract).

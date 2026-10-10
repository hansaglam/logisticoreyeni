# Map V2 — Transport source status

**Policy:** `docs/architecture/MAP_DATA_SOURCE_POLICY_V1.md`  
**This table is not legal clearance.** `OSM_TRANSFORMED_DB_LICENSE_CHECKPOINT` remains open. HGM remains non-commercial QA/reference only.

| MODE | SOURCE | LICENSE | STATUS | QA AUTHORITY | NOTES |
|---|---|---|---|---|---|
| ROAD | OSM-derived extract (ingested prototype; Metro uses chunks) | ODbL 1.0 | PROTOTYPE | KGM (QA/reference, not bundled) | Player country view uses curated corridors, not the full graph. |
| RAIL | OSM-derived extract (`turkey-260915.osm.pbf` → `turkey-rail.osm.pbf` / `.geojson`) | ODbL 1.0 | PROTOTYPE (DEV/inspector only) | TCDD — QA/reference, **not bundled** (`TCDD_QA_ONLY`) | National `railway=rail` topology ingested. Player Demiryolu remains Yakında. No trains. |
| SEA | Natural Earth 10m land + OSM marine/strait polygons; OSM GeoPort catalog | Public Domain + ODbL 1.0 | Graph PROTOTYPE (DEV) · ports PROTOTYPE · player inactive | Port authority pending (`TURKEY_PORT_AUTHORITY_SOURCE = PENDING_VERIFICATION`, `OFFICIAL_PORT_QA_ONLY`) | Hybrid water grid. Canonical `turkey-sea-network.json` is build-time only. Player Denizyolu remains Yakında. |
| AIR | OSM aeroway catalog (`turkey-airports.json`, DEV) · **route network pending** | ODbL 1.0 (catalog) | Catalog INFRASTRUCTURE_READY (DEV) · graph SOURCE_PENDING | DHMİ — identity QA only (`DHMİ_QA_ONLY`) | Do not invent air corridors. Player Havayolu remains Yakında. |

Google Maps/Earth extraction remains **FORBIDDEN**. AI remains **FORBIDDEN** as geographic authority.

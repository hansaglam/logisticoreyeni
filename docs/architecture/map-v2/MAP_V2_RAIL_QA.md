# Map V2 — Türkiye RAIL QA (Step 7)

**Status:** TCDD_QA_ONLY  
**Not a 100% correctness claim.** TCDD materials were not copied as geometry.

## Source

- Provider: OpenStreetMap (ODbL 1.0)
- Raw: `data/map-raw/osm/turkey-260915.osm.pbf`
- Extract: `data/map-raw/osm/turkey-rail.osm.pbf` / `data/map-raw/osm/turkey-rail.geojson`
- Source hash: `sha256:3b5aa51ac2076b94be018de31e706645dd4f3ab877cf46c7a9455b57b6fc23fb`
- Package hash: `sha256:979ab9b9cae0645f4500f607234e735d4e71c6d22caea97c6577ae0ad5cb7d2b`
- Border policy: tur-osm-railway-national-v1, CLIP_TO_TURKEY_BBOX_KEEP_DOMESTIC, topology-wgs84-7dp

## Counts

- Raw features: 51384
- Accepted line parts: 13757
- Rejected: 36276
- Nodes: 19228
- Edges: 21025
- Stations: 1336 (halt tags in extract: 244)
- Junctions: 17882
- Terminal-tagged nodes: 9 (not VERIFIED freight)
- LOW / MEDIUM / HIGH edges: 10320 / 10698 / 21025
- Components: 1063
- Largest component nodes: 17025
- Isolated nodes: 807
- OSM way/node IDs on accepted lines: 21025
- Geometry-fingerprint fallback lines: 0

## City rail access (PROVISIONAL / UNRESOLVED only)

- izmir: PROVISIONAL (tn.tur.rail.n.27.1485131_38.4387915) — Candidate only (RAIL_STATION, component 17025). 140 m. Not VERIFIED. Station ≠ freight terminal.
- istanbul: PROVISIONAL (tn.tur.rail.n.28.9784435_41.0149976) — Candidate only (RAIL_STATION, component 17025). 454 m. Not VERIFIED. Station ≠ freight terminal.
- ankara: PROVISIONAL (tn.tur.rail.n.32.8594740_39.9289862) — Candidate only (RAIL_STATION, component 17025). 254 m. Not VERIFIED. Station ≠ freight terminal.
- bursa: UNRESOLVED — No suitable mainline-scale component within radius. Isolated fragments are not forced access.
- antalya: UNRESOLVED — No suitable mainline-scale component within radius. Isolated fragments are not forced access.
- adana: PROVISIONAL (tn.tur.rail.n.35.0553773_36.9748405) — Candidate only (RAIL_STATION, component 17025). 23460 m. Not VERIFIED. Station ≠ freight terminal.
- diyarbakir: PROVISIONAL (tn.tur.rail.n.40.2153734_37.9136090) — Candidate only (RAIL_STATION, component 17025). 1494 m. Not VERIFIED. Station ≠ freight terminal.
- trabzon: UNRESOLVED — No suitable mainline-scale component within radius. Isolated fragments are not forced access.

## TCDD public-network checks

- istanbul-ankara: expected LIKELY_PRESENT; OSM same-component=true; PROVISIONAL/PROVISIONAL. TCDD conventional + YHT corridor is publicly documented.
- izmir-ankara: expected LIKELY_PRESENT; OSM same-component=true; PROVISIONAL/PROVISIONAL. TCDD west–central corridor via Afyon/Eskişehir is publicly documented.
- ankara-adana: expected LIKELY_PRESENT; OSM same-component=true; PROVISIONAL/PROVISIONAL. TCDD central–south corridor is publicly documented.
- adana-diyarbakir: expected LIKELY_PRESENT; OSM same-component=true; PROVISIONAL/PROVISIONAL. TCDD southeast corridor is publicly documented (may be fragmented in OSM).
- istanbul-bursa: expected MAY_BE_ABSENT; OSM same-component=null; PROVISIONAL/UNRESOLVED. Bursa high-speed / national mainline access is incomplete in public TCDD operations.
- antalya-network: expected MAY_BE_ABSENT; OSM same-component=false; UNRESOLVED/UNRESOLVED. Antalya city has no TCDD mainline passenger/freight station in common public network maps.
- trabzon-network: expected MAY_BE_ABSENT; OSM same-component=false; UNRESOLVED/UNRESOLVED. Trabzon city has no TCDD mainline into the urban core in common public network maps.

## Unresolved issues

- OSM may omit or mis-tag operational TCDD segments.
- Construction/disused/tram/subway/light_rail excluded from logistics default.
- Freight terminals are not inferred from `railway=station`.
- Cross-border alignments clipped to Türkiye; short stubs may become `BORDER_CROSSING`.
- Player-facing rail corridors are not built in this step.

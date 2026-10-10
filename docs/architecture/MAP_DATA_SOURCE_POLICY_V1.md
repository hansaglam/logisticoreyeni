# LogistiCore Map Data Source Policy V1

**Policy version:** `MAP_DATA_SOURCE_POLICY_VERSION = 1`  
**Status:** Binding for all Map V2 work. Not enabled in production.  
**This document does not replace the live map.** Legacy map files remain in place until a later, explicitly approved migration.

---

## 0. Purpose

This policy is the authoritative data-source, licensing, provenance, versioning, and geographic-integrity rule set for Map V2.

If a geographic record has no verified provenance, license status, or source version: **fail closed**. Do not ship it.

---

## 1. Binding constants

| Constant | Value | Meaning |
|---|---|---|
| `MAP_DATA_SOURCE_POLICY_VERSION` | `1` | This policy document |
| `MAP_DATA_SCHEMA_VERSION` | reserved integer, starts at `1` when MapData format exists | Structure of LogistiCore MapData |
| `MAP_DATA_RELEASE_VERSION` | **unresolved** until first approved geographic package | Contents of a shipped data package (e.g. `YYYY.MM`) |
| `GOOGLE_MAP_DATA_EXTRACTION_FOR_MAP_V2` | `FORBIDDEN` | See §7 |
| `REFERENCE_ART != GEOGRAPHIC_DATA` | true | 9:16 concept images are UI/UX only |
| `TURKEY_PORT_AUTHORITY_SOURCE` | `PENDING_VERIFICATION` | Do not guess |
| `HGM_PRODUCTION_BUNDLE` | `FORBIDDEN` until commercial rights are cleared | QA/reference only |
| `AI_AUTHORITATIVE_GEOGRAPHY` | `FORBIDDEN` | See §8 |

Do not treat the example string `2026.01` as a live release version. Assign `MAP_DATA_RELEASE_VERSION` only when a package passes license check, validation, and review.

Schema version and release version are different. A schema bump can keep the same geography; a release bump can keep the same schema.

---

## 2. Source hierarchy (mandatory)

### A. World administrative boundaries — PRIMARY

| Field | Rule |
|---|---|
| Source | geoBoundaries |
| Release type | **gbOpen only** |
| License | CC BY 4.0 |
| Use | Country polygons, ISO country mapping, administrative geometry where appropriate, detailed country geometry |

**Forbidden:**

- `gbAuthoritative` in the commercial game
- Silent switch from `gbOpen` to another release type
- Mixing unrelated boundary datasets across zoom/LOD without a documented reason

**Required on import:** pin exact dataset release/version; store acquisition date, source URL/reference, license identifier, source hash/checksum, transformation history. Attribution must be preserved.

For low-zoom world rendering, prefer the corresponding geoBoundaries **simplified** geometry so country shapes do not visually change when LOD changes.

### B. Physical world base data

Natural Earth may be used for:

- low-detail coastlines
- land/ocean visual base
- physical geographic context
- very-low-zoom supporting geometry

Natural Earth **must not** silently override §2.A country-boundary authority.

Natural Earth is public domain; still record provenance and version in the map source manifest.

### B.2 Settlement / city points (Step 2C)

**PRIMARY for Step 2C city points:** Natural Earth 10m Populated Places (`ne_10m_populated_places`, pin `natural-earth-vector v5.1.2`). License: public domain. Coordinates copied from source geometry. Preprocessed package only.

See `docs/architecture/map-v2/decisions/0006-city-source-selection.md`.

OSM `place=*` remains the preferred later **global** settlement architecture (ODbL checkpoint). It is not the Step 2C city-point source.

**Forbidden as city coordinates:** AI estimates, Google Maps/Earth extraction, PNG/`worldMapPositions`/`networkPositions`/`mapRoadNetwork`, live OSM APIs/tiles, HGM as a bundled production city dataset (QA/reference only).

Identity: `city.tur.ne.{NE_ID}`. Display names are never IDs.

### C. Global transport / network

OpenStreetMap may be used for:

- roads, railways, stations
- ports, airports
- transport-related POIs
- infrastructure connectivity

License: **ODbL**.

Mandatory:

- Preserve OSM provenance and required attribution
- Document ODbL usage
- Keep OSM-derived geographic/network data logically separable from proprietary player/gameplay state
- Do not strip source metadata during preprocessing
- Do not mix OSM-derived database content irreversibly into player save documents
- Do not use public OSM tile servers as a production map backend
- Do not depend on live OSM network requests for normal gameplay
- Map V2 must use a preprocessed, versioned pipeline

**OSM_TRANSFORMED_DB_LICENSE_CHECKPOINT:** before public production distribution of transformed OSM-derived database files, complete a licensing review (ODbL share-alike / produced work vs database). Do not skip this checkpoint because packaging is inconvenient.

### D. Türkiye — official verification (not silent replacement)

| Domain | Official verification | Machine-readable geometry |
|---|---|---|
| Administrative / geographic QA | Harita Genel Müdürlüğü (HGM) | geoBoundaries gbOpen (and OSM only where this policy allows) |
| Rail | TCDD | OSM after TCDD check |
| Road | KGM | OSM after KGM check of gameplay-relevant corridors |
| Airports | DHMİ | OSM coordinates after DHMİ identity check |
| Ports / maritime | `TURKEY_PORT_AUTHORITY_SOURCE = PENDING_VERIFICATION` | OSM global ports subject to ODbL |

Official sources **validate**. They do not automatically become bundled production datasets.

Never invent rail connections. Never infer a railway solely because two cities “should” connect. Never create fictional airports in the production geographic layer. Never present invented shipping lanes as real maritime routes.

Map V2 contains a **gameplay-relevant** transport graph backed by real geography. It does not need every real road.

### E. HGM commercial-use restriction

Current HGM downloadable products state free use for **non-commercial** activity.

Therefore HGM data **MUST NOT** be bundled, copied, converted, committed, or distributed as production game data unless commercial usage rights have been **explicitly cleared**.

Until then:

- HGM is a **QA/reference source only**
- Do not trace an HGM map into a new commercial polygon dataset to bypass the restriction

### F. Fictional gameplay infrastructure

If fictional facilities are ever introduced, they must be explicitly marked as fictional gameplay infrastructure and kept separate from real-world infrastructure records.

Gameplay sea routes must be distinguishable from authoritative geographic infrastructure data.

---

## 3. Google Maps / Google Earth

**QA/reference tools only.** Developers may visually inspect general location, coastline alignment, city placement, and geographic plausibility.

**MUST NOT** be used to:

- trace country boundaries, roads, or railway lines
- extract coordinates in bulk
- scrape data
- reproduce Google map geometry
- create derived polygon datasets
- create an independent LogistiCore geographic database from Google content
- copy Google map tiles into the game
- remove Google attribution
- use screenshots as the interactive Map V2 base

```
GOOGLE_MAP_DATA_EXTRACTION_FOR_MAP_V2 = FORBIDDEN
```

---

## 4. AI-generated geography

**AI MUST NEVER BE AN AUTHORITATIVE GEOGRAPHIC SOURCE.**

AI-generated values must not be accepted for latitude, longitude, country boundary coordinates, city location, railway/road topology, port/airport location, sea geography, or political boundaries.

AI may: write code, transform already-licensed data, generate UI concepts, flag anomalies for **human** review.

Authoritative geographic values must have provenance. If provenance is missing: **fail closed**. Do not silently use the value. Do not let AI auto-resolve source conflicts.

---

## 5. Reference artwork

9:16 LogistiCore map concept images are **visual / UI / UX references only**.

They may define composition, layout, hierarchy, colors, markers, route styling, panels, typography direction, interaction ideas, and information density.

They **MUST NOT** define true country geometry, exact city coordinates, railway/road/sea geometry, airport coordinates, or political boundaries.

```
REFERENCE_ART != GEOGRAPHIC_DATA
```

---

## 6. Political / disputed boundary model

Do not hard-code politically disputed geography into renderer components.

Map data must be able to distinguish:

- standard administrative boundary
- disputed boundary
- claim line
- territory
- gameplay region
- display label

Where the source dataset exposes disputed-boundary metadata, **preserve it**. Do not silently flatten disputed territories into unrelated country polygons during preprocessing.

Future configuration concept: `PoliticalBoundaryDisplayPolicy`.

The renderer must eventually receive **already-resolved display data**. The renderer must not decide geopolitical questions.

Country/territory naming is localization-ready and policy-driven.

This policy does not implement political logic in the live app.

---

## 7. Language / naming

No map label is authoritative because it appeared in an AI-generated reference image.

Use stable IDs, not display names as identity:

| Kind | ID pattern (concept) |
|---|---|
| Country | `country.tr` |
| City | `city.tr.istanbul` |
| Sea | `sea.black_sea` |
| Infrastructure | `infrastructureId` + `nameKey` |

All visible names must eventually come from localization.

- Turkish locale: Turkish geographic names
- English locale: English geographic names
- Do not mix Turkish and English labels inside the same locale
- Keep identity separate from display label

Legacy city records use `id: 'istanbul'` plus hard-coded Turkish `name`. That is **legacy identity**, not Map V2 naming. Map V2 must introduce `nameKey` without silently rewriting player saves in this phase.

---

## 8. Provenance manifest

Every imported dataset must have a machine-readable source manifest. Schema: `docs/architecture/map-source-manifest.schema.json`. Template: `docs/architecture/map-source-manifest.template.json`.

Required field concepts:

`datasetId`, `datasetType`, `sourceName`, `sourceURL`, `license`, `licenseURL`, `sourceVersion`, `retrievedAt`, `sourceHash`, `originalFormat`, `processedFormat`, `processingVersion`, `derivedFrom`, `attributionRequired`, `productionApproved`, `notes`

Do not invent missing metadata. If a required field cannot be verified, mark it **unresolved**. If license is unclear: `productionApproved = false`. If two authoritative sources disagree: record a conflict for human review.

---

## 9. Versioning and migration

| Concept | Role |
|---|---|
| Policy version | This document (`1`) |
| Schema version | LogistiCore MapData structure |
| Release version | A specific approved geographic package |

**Upgrade expectations:**

- Additive schema fields may ship with a minor/compatible schema bump once MapData exists
- Breaking MapData shape requires a schema bump and an explicit loader/migration path
- Geographic content updates bump **release** version, not player save version
- Map source updates **must not overwrite** player progression
- Unknown future schema: fail closed (do not partial-parse into production)

---

## 10. Player data remains separate

| Static map data | Player / game state |
|---|---|
| Country polygons | Unlocked country |
| City coordinates | Unlocked city |
| Railway / road edges | Owned warehouse / port |
| Ports, airports | Facility level, vehicles, cash, reputation |
| | Active contract |

Do not store OSM-derived geometry inside save documents. Player saves may reference stable IDs only.

---

## 11. Gameplay graph vs raw real-world data

Distinguish:

1. **RAW GEOGRAPHIC NETWORK** — detailed licensed geometry
2. **LOGISTICORE GAMEPLAY TRANSPORT GRAPH** — e.g. Istanbul → Bursa → Izmir, with rendered path following validated geography

The gameplay graph must never claim a fictional connection is a real existing railway/road. Abstraction and real-world infrastructure remain distinguishable in data (`graphKind`: `gameplay` vs `geographic`).

---

## 12. Attribution

Prepare an in-app **Map Data / Attribution** section (UI may ship in a later phase; the requirement is in force now).

Must support required notices for:

- geoBoundaries (CC BY 4.0)
- OpenStreetMap contributors / ODbL
- any other source requiring attribution

Natural Earth attribution may be listed voluntarily (public domain).

Do not add fake licensing text. Do not hide attribution solely because it is visually inconvenient.

Live Account Center already has version/about rows and legal links (`src/utils/legalLinks.ts`) for privacy/support — **not** map attribution. Map attribution is a new section, not a reuse of Google/AdMob legal copy.

---

## 13. Ingestion pipeline

```
RAW SOURCE
↓
SOURCE MANIFEST
↓
LICENSE / APPROVAL CHECK
↓
VALIDATION
↓
NORMALIZATION
↓
GEOMETRY PROCESSING
↓
LOD GENERATION
↓
LOGISTICORE MAPDATA
↓
AUTOMATED VALIDATION
↓
REVIEW
↓
RELEASE
```

No developer should manually paste arbitrary coordinate arrays into production Map V2 code without provenance.

Future bulk files belong under a staging tree (see `.gitignore` `data/map-raw/` / `data/map-staging/`). Do not commit large SHP/GeoJSON in this step.

---

## 14. Fail-closed

| Condition | Action |
|---|---|
| Unresolved authoritative provenance | Do not silently ship |
| Unclear license | `productionApproved = false` |
| Unknown source version | Flag unresolved |
| Authoritative sources disagree | Record conflict; human review only |
| AI-suggested coordinates | Reject as authority |

---

## 15. Feature flag / production behavior

Map V2 must remain fail-closed until an explicit later phase. Follow existing `EXPO_PUBLIC_*` + `storeProductionPolicy.ts` conventions. **Do not add or enable a Map V2 flag in this step.**

---

## 16. LEGACY_MAP_DATA_AUDIT

Do **not** delete or replace these files in this step.

| Path | What it is | Risk | Notes |
|---|---|---|---|
| `assets/maps/turkey-logistics-network-map.png` | Production map raster (labels baked in) | **HIGH** | No source manifest, license, or hash. Calibration target for hit-tests. Unknown whether any third-party map geometry was used. |
| `assets/maps/turkey-road-network-map.png` | Deprecated raster, still bundled | **HIGH** | Same provenance gap. Code marks deprecated. |
| `assets/maps/turkey-relief.png` | Committed raster, **unused by code** | **HIGH** | No provenance. Relief often originates from DEM/map products — do not treat as Map V2 base. |
| `src/data/worldMapPositions.ts` | Normalized 0–1 city hit points on the PNG | **HIGH** | Not WGS84. Several cities marked “Geçici”. Calibrated by tapping the raster. |
| `src/data/mapRoadNetwork.ts` | Normalized polylines aligned to the PNG | **HIGH** | Gameplay-visible roads traced to the raster, not a licensed transport dataset. |
| `src/data/mapVisuals.ts` (`TURKEY_OUTLINE` etc.) | Hand-drawn SVG silhouette / coast curves | **CRITICAL** for Map V2 boundaries | Stylized bezier, not administrative geometry. Must not become country polygons. |
| `src/data/networkPositions.ts` | Abstract tycoon layout (explicitly “Gerçek coğrafya yok”) | **MEDIUM** | Duplicate city xy vs `worldMapPositions`. Incomplete city set (5 of 8). |
| `src/data/mapPositions.ts` | Deprecated re-export of network positions | **LOW** | Compatibility shim. |
| `src/data/cities.ts` | Gameplay city catalog; Turkish `name` is identity-adjacent | **MEDIUM** | No lat/lng. IDs: `izmir`, `istanbul`, `ankara`, `bursa`, `antalya`, `adana`, `diyarbakir`, `trabzon`. No `countryId`. |
| `src/data/routes.ts` | Bidirectional city-pair distances / tolls | **MEDIUM** | Approximate highway km; not a real road graph. Used by contracts/deliveries. |
| `src/components/map/*`, `src/screens/MapScreen.tsx` | Live renderer (PNG + overlays) | **LOW** (this step) | Do not replace. No Skia. |
| `src/types/game.ts` `WarehouseType` `'port' \| 'airport'` | Gameplay warehouse kinds | **LOW** | Not real DHMİ/port registry records. |
| Hard-coded WGS84 lat/lng | **Not found** in `src/` | — | Legacy map is image-normalized, not geographic. |
| Country IDs / ISO polygons | **Not found** | — | Türkiye-only implicit world. |
| Railway / OSM / geoBoundaries datasets | **Not found** | — | |
| Google-derived files (named) | **Not found** as labeled Google tiles | **HIGH residual** | Rasters have **unverified** origin; treat as non-authoritative until proven otherwise. |
| AI-placeholder geography | Temporary city taps in `worldMapPositions.ts` | **HIGH** | Fail-closed for Map V2; keep as legacy only. |

**No country polygons exist.** The closest stand-in is the stylized `TURKEY_OUTLINE` path.

---

## 17. Out of scope (this step)

Do not: replace the map, install Skia, modify gameplay/progression, change contracts/economy/saves, migrate users, download massive datasets, deploy, enable Map V2, delete legacy map files, copy Google geography, trace Google Earth or HGM into production data, invent coordinates, introduce fictional real infrastructure, or begin rail/sea/air gameplay.

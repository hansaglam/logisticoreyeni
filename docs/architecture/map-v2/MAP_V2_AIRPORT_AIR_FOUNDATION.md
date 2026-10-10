# Map V2 — Türkiye AIRPORT / AIR geographic foundation

**Steps 14–16.** GeoAirport catalog + cargo QA + player geodesic corridor preview. No aircraft, contracts, ownership, or multimodal gameplay.

## Source policy

- Geometry/infrastructure: OpenStreetMap aeroway extract from `data/map-raw/osm/turkey-260915.osm.pbf` (ODbL 1.0).
- Raw extracts stay gitignored under `data/map-raw/osm/turkey-airports.osm.pbf` / `.geojson`.
- Official QA/reference: **DHMİ public identity** (`DHMİ_QA_ONLY`). Existence, general name, published role. **No DHMİ map graphics, no screenshot tracing, no Google geometry.**
- `TURKEY_AIRPORT_AUTHORITY_SOURCE = PENDING_VERIFICATION`.
- OSM-only records are **PROVISIONAL**. Ingest never mass-promotes to **VERIFIED**.
- VERIFIED requires human review plus DHMİ public identity agreement plus OSM geometry agreement.

## GeoAirport vs warehouse

`GeoAirport` / GeoInfrastructure AIRPORT is source-backed geography.

Live `WarehouseType` `"airport"` is a **gameplay storage class**. It must not create, verify, or bind a GeoAirport.

## Classification

Evidence-backed only:

| Class | Typical evidence |
|---|---|
| INTERNATIONAL_AIRPORT | `aerodrome:type=international` or `international=yes` |
| CARGO_AIRPORT | explicit cargo/freight tags |
| COMMERCIAL_AIRPORT | aerodrome with IATA/ICAO |
| DOMESTIC_AIRPORT | `aerodrome:type=regional\|domestic` |
| MILITARY_AIRFIELD | military tags; no automatic civilian cargo |
| GENERAL_AVIATION | aerodrome without IATA/ICAO |
| HELIPORT | standalone helipad/heliport — **not ingested as GeoAirport** |
| CLOSED_OR_INACTIVE | disused/abandoned/closed |
| UNKNOWN_AIRPORT | insufficient evidence |

Do not overclassify from name alone.

## Logistics eligibility

Airport exists ≠ cargo airport.

- **LOGISTICS_ELIGIBLE** — `VERIFIED_SUPPORTED` cargo + civil operational (includes dual-use with official civil cargo stats).
- **LOGISTICS_ELIGIBLE_PREVIEW** — `PROVISIONAL_SUPPORTED` (DHMİ cargo table 10–99 t YTD, or weak positive tonnes). Not a corridor grant.
- **PASSENGER_ONLY** — civil passenger role with `KNOWN_UNAVAILABLE` cargo (not inferred from missing tags).
- **UNRESOLVED** — cargo `UNKNOWN`. Still city-associable as passenger if IATA + operational.
- **MILITARY_RESTRICTED** — military-only. No city association. Dual-use is not military-only.
- **NON_LOGISTICS** — closed, GA, helipads.

Do not silently promote UNKNOWN.

## Cargo capability + evidence

`VERIFIED_SUPPORTED` | `PROVISIONAL_SUPPORTED` | `UNKNOWN` | `KNOWN_UNAVAILABLE`

OSM **absence** of cargo tags is **UNKNOWN**, not false.

Official QA dataset: `src/mapV2/data/qa/turkey-airport-cargo-qa.ts`

Primary cargo authority: **DHMİ Kargo Trafiği** (cargo tonnes, not yük=baggage+cargo+mail). Reviewed `KARGO.pdf` YTD Aug 2026.

Thresholds (documented, not inferred from airport size):

| DHMİ cargo tonnes YTD | Capability | Eligibility | Readiness |
|---|---|---|---|
| ≥ 100 t | VERIFIED_SUPPORTED | LOGISTICS_ELIGIBLE | READY |
| 10–99 t | PROVISIONAL_SUPPORTED | LOGISTICS_ELIGIBLE_PREVIEW | PREVIEW_ONLY |
| > 0 and < 10 t | PROVISIONAL_SUPPORTED (WEAK) | PREVIEW | PREVIEW_ONLY |
| not listed / 0 | UNKNOWN | UNRESOLVED | NOT_READY |

Operator cargo-terminal pages (ISG SAW, IGA IST, DHMİ Çukurova Turkish Cargo facility) strengthen VERIFIED. They do not replace DHMİ stats.

Airport `verificationStatus` stays **PROVISIONAL**. Cargo may be VERIFIED_SUPPORTED independently.

## Dual-use

`CIVIL` | `MILITARY` | `DUAL_USE` | `UNKNOWN`

Military runway availability is not logistics capability. Dual-use may be civil-logistics eligible only with official civil cargo evidence (e.g. DHMİ DIY tonnes).

## Closed / replaced

Official operational QA overrides active-endpoint eligibility. OSM geometry is not moved or deleted.

Example: ADA Şakirpaşa civil traffic replaced by COV Çukurova (DHMİ 2024 opening). ADA is CLOSED_OR_INACTIVE for primaries; COV is the operational candidate. Flag `AIRPORT_SOURCE_DISCREPANCY`.

## Passenger vs logistics primary

`primaryPassengerAirportCandidate` — nearest DIRECT operational civil IATA airport.

`primaryLogisticsAirportCandidate` — DIRECT + READY + VERIFIED cargo, cargo tonnes before distance. **Null if none.**

Regional READY airports (e.g. SAW for Bursa) are **not** auto-assigned as logistics primary.

İstanbul: passenger SAW (nearer), logistics IST (cargo volume).

## Player AIR corridor gate (STEP 16)

`FUTURE_AIR_CORRIDOR_ELIGIBILITY_RULE` is the player preview gate:

- endpoints must be `primaryLogisticsAirportCandidate`
- `airLogisticsReadiness = READY`
- cargo `VERIFIED_SUPPORTED`
- operational, civil (not military-only)
- `allowPreviewOnlyEndpoints = false` (no PREVIEW_ONLY without an explicit later allowlist)
- do not invent Bursa / passenger-primary substitutes (YEI, SAW for Bursa)

İstanbul logistics endpoint is **IST**, not passenger-primary SAW. Adana is **COV**, not closed ADA.

`turkey-air-network.json` remains empty `SOURCE_PENDING`. Player preview does **not** require a canonical AIR topology graph. Status split: airport catalog = `INFRASTRUCTURE_READY`; geodesic overlay = `PLAYER_CORRIDOR_PREVIEW`; gameplay AIR = inactive.

## Air logistics readiness

Per airport and per gameplay city: `READY` | `PREVIEW_ONLY` | `NOT_READY`.

A verified real airport may still be NOT_READY for AIR logistics when cargo is UNKNOWN.

## Clustering / source IDs

Preserve OSM `node/<id>`, `way/<id>`, `relation/<id>`.

One logical GeoAirport groups aerodrome polygon/node + contained/nearby runways/terminals/aprons when identity agrees.

Do **not** merge nearby independent airports. Different IATA or ICAO blocks merge. Same ICAO strongly supports identity.

Representative position: aerodrome node, else aerodrome polygon interior/centroid, else cluster representative. No aesthetic repositioning.

## City association

Gameplay cities may have **zero or many** airports (`city → GeoAirport[]` + optional `primaryAirportCandidate`).

- DIRECT ≤ 45 km, REGIONAL ≤ 100 km (civilian PASSENGER_ONLY or LOGISTICS_ELIGIBLE **with IATA**).
- Primary ranks logistics eligibility and classification **before** distance.
- İstanbul must support multiple region airports (IST, SAW, …).
- Bursa may be REGIONAL if Yenişehir is the relevant civilian field.
- Ankara and Diyarbakır may have AIR access; do not reuse maritime inland-NONE logic.

`CityAirAccess` is association metadata, **not** a flight.

## Geodesic player corridors (STEP 16)

AIR is not ROAD/RAIL/SEA topology. Corridors are:

gameplay city → logistics primary GeoAirport → WGS84 geodesic (spherical slerp) → Web Mercator projection → compact `turkey-air-corridors.json`.

No dense AIR graph. No on-device geodesic. No airspace, ATC, airways, SID/STAR, weather, or altitude. Geometry is **not** a real flight route (`VERIFIED_ENDPOINTS_PREVIEW`, never `REAL_FLIGHT_ROUTE`).

Default legend: **Havayolu — Yakında**. DEV `EXPO_PUBLIC_MAP_V2_AIR_PLAYER_VISUAL=PREVIEW` → **Havayolu — Önizleme**. Never **Aktif**. Production cannot enable preview (`__DEV__` gate).

See `MAP_V2_PLAYER_AIR_CORRIDORS.md`.

## Player isolation

- Country dashboard preview loads **only** `turkey-air-corridors.json`.
- Do not load `turkey-airports.json`, cargo QA, runways, or terminals on the player map.
- No airport markers on player country map. City nodes remain the interaction.
- DEV catalog: Yönetim → Simülasyon Testi → Map V2 Transport Inspector → AIR / AIRPORT.

## Artifact

`src/mapV2/generated/infrastructure/turkey-airports.json`

Türkiye package only. Foreign border noise is scoped out of the country polygon (+ small coastal buffer).

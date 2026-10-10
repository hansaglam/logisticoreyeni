# Map V2 — Visual specification

**Depends on:** `MAP_DATA_SOURCE_POLICY_V1.md` (geography) and this inventory (`MAP_V2_REFERENCE_INVENTORY.md`).

---

## Visual source-of-truth

```
REFERENCE_IMAGES_ARE_VISUAL_SOURCE_OF_TRUTH
```

Applies to composition, hierarchy, dark/navy treatment, neon/cyan routes, lock/unlock hierarchy, cards, markers, typography direction, spacing relationships, panel and control placement, transport-layer differentiation.

```
REFERENCE_IMAGES_ARE_NOT_DATA_SOURCE
```

Does **not** apply to political boundaries, coastlines, city positions, roads, railways, ports, airports, sea routes, distances, geographic labels, or country recognition. Step 1 policy remains authoritative. AI concept geography is styling only.

Pixel dimensions of a 9:16 still are **not** implementation dimensions. Layout must remain responsive.

---

## Existing theme audit

Canonical app tokens: `src/theme/colors.ts`, plus `spacing`, `typography`, `radius`, `shadows`.

Live map currently **forks** some values in `src/components/map/mapTheme.ts` and local `COLORS` in `MapScreen.tsx` (e.g. cyan `#38BDF8` / amber `#F59E0B` vs theme `info` / `amber` `#FFAA00`).

**Rule for Map V2:** prefer `src/theme/colors.ts`. Map-specific tokens below are **PROPOSED** extensions, not a silent global theme rewrite. Do not change `src/theme/colors.ts` in this step.

| Semantic token | Direction | Source |
|---|---|---|
| BACKGROUND | Near-black navy `#040A14` / map `#050A12` | EXISTING `colors.background` / `MAP_BG` |
| SURFACE_PRIMARY | `#091423` cards | EXISTING `colors.surface` / `card` |
| SURFACE_SECONDARY | `#0C1830` / `#081426` | EXISTING `colors.surface2` / `MAP_SURFACE` |
| MAP_LAND | Dark teal-navy land fill (reference + `mapVisuals.landFill`) | PROPOSED map-only |
| MAP_WATER | Deep `#031225` / `#020B14` ocean | PROPOSED map-only (align `MAP_VIEWPORT_BACKGROUND`) |
| BOUNDARY_DEFAULT | Muted land edge / `#4A7A9B` family | PROPOSED |
| BOUNDARY_SELECTED | Brand blue `#2388FF` / `#39A0FF` | EXISTING `colors.primary` |
| BOUNDARY_LOCKED | Desaturated + reduced opacity; lock icon | PROPOSED (use `colors.textMuted` + `gameIcons.lock`) |
| ROUTE_ROAD | Cyan/blue stroke `#39A0FF` | EXISTING map route / `colors.info` family |
| ROUTE_RAIL | Distinct **dashed / dual-rail** stroke; not cyan-solid | PROPOSED — must not equal ROAD |
| ROUTE_SEA | Soft aqua over water only; wider, lower contrast than road | PROPOSED |
| ROUTE_AIR | Thin arc / dotted airway; purple `#8C6BFF` family | EXISTING `colors.purple` reuse |
| MARKER_CITY | Compact node; selected ring | PROPOSED (legacy `MapCityNode` unused) |
| MARKER_HUB | Larger city / depot treatment | PROPOSED |
| MARKER_PORT | Anchor / port glyph | PROPOSED; no real registry |
| MARKER_AIRPORT | Aviation glyph | PROPOSED; no DHMİ data |
| TEXT_PRIMARY | `#F3F7FF` | EXISTING `colors.textPrimary` |
| TEXT_SECONDARY | `#A9B6CC` / `#91A0B8` | EXISTING `colors.textSecondary` / `MAP_MUTED` |
| ACCENT | Primary blue `#2388FF` | EXISTING `colors.primary` |
| SUCCESS | `#12D66B` / map green `#22C55E` | EXISTING `colors.success` (prefer theme in V2) |
| WARNING | Amber `#FFAA00` | EXISTING `colors.warning` |
| LOCKED | Muted + lock; never color-only | PROPOSED |

Do not invent a second brand palette. Amber remains warning/selection highlight, not the primary chrome (live header uses blue).

---

## Map layer visual contract

Overlap priority is **bottom → top** (later draws above). LOD is **intent only** — not implemented.

| Layer | Default visibility | Relative weight | Interactive | Zoom intent | Draw order |
|---|---|---|---|---|---|
| BASE_GEOGRAPHY | on | High (stage) | no | Always; simplify at world | 0 |
| COUNTRY_BOUNDARIES | on | High at world/region | select country | World–country | 1 |
| REGION_BOUNDARIES | off unless MAP-02 | Medium | optional | Region | 2 |
| SEA_NETWORK | off except MAP-06/07/09 | Medium on water | ports/routes later | Country+ | 3 |
| ROAD_NETWORK | on at country+ | Medium | later | Hide most at world | 4 |
| RAIL_NETWORK | off except MAP-05/07 | Medium | later | Country+ | 5 |
| AIR_NETWORK | off except MAP-07/09 | Low | later | World/country sparse | 6 |
| INFRASTRUCTURE | city+ or mode views | Medium | yes later | City / mode | 7 |
| CITY_MARKERS | playable cities at country+ | High locally | yes later | Not all cities at world | 8 |
| ACTIVE_CONTRACTS | indicators at country+ | Medium | yes (entry) | Cull at world | 9 |
| ACTIVE_VEHICLES | on when jobs exist | High locally | select job | Cull distant | 10 |
| LOCK_STATE | overlay on locked geo | Medium | no (or unlock CTA) | All levels | 11 |
| SELECTION | on when selection exists | Highest local | n/a | All | 12 |
| LABELS | locale names | High but sparse | no | Zoom-dependent; never tiny at world | 13 |

At **global** scale hide: most cities, local roads, rail mesh, warehouse icons, dense labels.

---

## Transport mode visual rules (styling only)

| Mode | Path | Iconography | Forbidden |
|---|---|---|---|
| ROAD | Continuous stroke; truck chevron (live pattern) | `truck` | Same dash as rail |
| RAIL | Parallel/dashed track language | station / rail | OSM/AI rail shapes as data |
| SEA | Soft maritime stroke **over water only** in geo rendering | port / ship | Land-crossing “sea” lines presented as real lanes |
| AIR | Dotted/arc great-circle **style** | airport / aircraft | Dense fake airline networks |

Modes must remain distinguishable after performance simplifications (glow/shadow off).

---

## Lock / unlock visual states

Semantics only. Game state stays authoritative later.

| State | Visual | Interaction |
|---|---|---|
| LOCKED | Dim + lock affordance; not color-only | Show requirements later; no fake unlock |
| AVAILABLE | Highlighted locked-but-reachable | Open MAP-08 / confirm later |
| UNLOCKED | Full geography + playable markers | Enter country/city |
| SELECTED | Ring / boundary accent + panel | Clear vs neighbors |
| OWNED | Facility badge (warehouse/port later) | Open operations |
| IN_PROGRESS | Pulse restrained on active job | Track vehicle |
| UNAVAILABLE | Grey, no CTA | Explain later; no economy numbers here |

Applies later to countries, cities, warehouses, ports, rail terminals, airports, routes.

---

## World → country → city UX (not implemented)

```
WORLD (MAP-01)
  → optional REGION (MAP-02)
    → COUNTRY (MAP-03 Türkiye first)
      → CITY (MAP-04)
        → INFRASTRUCTURE / OPERATIONS
```

Mode views MAP-05/06/07 may overlay country or be reached from controls without destroying camera context.

Principles:

- Always show geographic level (breadcrumb later).
- Back returns to previous **level**, not only previous pinch scale.
- Opening a child must not destroy parent camera/context (stack or restore).
- Selection must be obvious.
- Zoom is **not** the only way to change level (explicit drill-in / list / tap).
- Portrait one-handed: primary CTA and back in thumb zone; respect safe areas (`useTabBarLayout` pattern).
- Core controls must not sit under the home indicator or status bar.

---

## Responsive / device

Recorded facts (do not change config in this step):

- `app.json` `"orientation": "portrait"`
- iOS `"supportsTablet": false`
- Screens use `screenTopPadding` + `contentBottomPadding`

Future Map V2 must:

- Honor iPhone safe area and Android status/nav
- Scale for narrow (`<360`) and tall phones (scroll vs pinned map — implementation later)
- Allow font scaling; avoid clipping 44pt minimum targets
- Dynamic sheets (live: `RoadsideFuelSheet`) must not cover the only Back control
- Landscape: **not currently supported**; keep portrait unless a later product decision

Reference 9:16 is a **direction**, not a lock.

---

## Touch / accessibility

- Marker hit targets ≥ ~44pt (legacy unused `MapCityNode` used a 20px transparent circle — **do not copy**).
- Selection not by color alone (ring + label / icon).
- Contrast against navy land/water; no tiny world-scale labels.
- `accessibilityLabel` on controls (live: help, refresh only — **extend later**).
- No overlapping invisible hit zones (baked PNG labels vs future markers).
- Pan/pinch must not steal Back / tab bar (live: scroll lock during map gesture — **PRESERVE** pattern).

Do not redesign the global a11y system here.

---

## Motion

Intended: smooth level transitions; restrained marker pulse; route progress; selection feedback; sheet present/dismiss.

Avoid: particles, constant glow on every object, motion that hides geography, 60fps animation on all vehicles.

**REDUCED_MOTION:** later respect OS reduce-motion — skip pulses/glows; keep positional updates for jobs.

Live: `MAP_TRUCK_MARKER_ANIM_MS` 750, gesture snap 165ms — review under reduce-motion.

---

## Performance-aware visual policy

References do **not** authorize expensive shaders.

May drop, by zoom / device / budget: shadows, glows, terrain, textures, minor labels, small routes.

**Hierarchy must survive:** selected vs locked vs active job vs land/water.

---

## Component responsibility (proposed names)

Prefer `src/components/map/` prefix. Names are proposals; do not implement.

| Component | Owns | Must not own |
|---|---|---|
| MapViewport | Camera surface, gesture host | Game economy, geo datasets |
| MapCameraControls | Fit / reset / zoom buttons | Unlock rules |
| MapLayerControls | Layer toggles | Data ingest |
| MapBreadcrumb | WORLD / COUNTRY / CITY level | Routing |
| CountryPolygonLayer | Display-ready polygons | Geopolitical policy decisions |
| CityMarkerLayer | Playable city markers | Renaming city IDs |
| TransportRouteLayer | Mode-styled paths | Inventing corridors |
| InfrastructureMarkerLayer | Ports/stations/airports as **display** | Official registries |
| VehicleMarkerLayer | Active trucks/future modes | Save format |
| SelectionOverlay | Selected entity chrome | Persistence |
| MapInfoPanel / MapBottomSheet | Context actions | Full-screen redesign of Contracts |
| MapLegend | Mode/state key | Legal attribution dump (attribution is separate) |
| MapLoadingState / MapErrorState | Fail-closed UI | Silent fake geography |

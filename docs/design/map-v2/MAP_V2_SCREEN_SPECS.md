# Map V2 — Screen specs (MAP-01 … MAP-09)

Visual/UX contract only. No implementation, no coordinates, no datasets, no economy values.

Parent catalog: `map-v2-reference-manifest.json`.

---

## MAP-01 — World Map

**Purpose:** Global company expansion overview.

**Must support (future visual):** world geography, countries, locked/unlocked/selected country, sparse global transport at aggressive LOD, drill into country (Türkiye first), optional company/global summary, layer controls if they fit the reference.

**Must hide at this scale:** playable city lists, local roads, rail mesh, warehouses, dense labels, all routes at once.

**Entry:** Harita tab (replacing or wrapping today’s Türkiye-only canvas later).  
**Exit:** MAP-03 (or MAP-02), MAP-08, MAP-09, existing tabs (Contracts/Dashboard) unchanged until a later nav phase.

**Not:** live OSM tiles; all 81 TR provinces; all cities.

---

## MAP-02 — Region / Europe

**Purpose:** Optional bridge between world and country.

**Visual:** country labels, availability, selection, major international hubs, **limited** international corridors (styled, not invented geography).

**Navigation:** optional. Prefer MAP-01 → MAP-03 when Europe adds no decision value.

---

## MAP-03 — Country / Türkiye

**Purpose:** Primary country logistics operations. This is the **migration successor** of today’s MapScreen canvas.

**Future visual (not data):** playable cities (legacy IDs), geographic markers, roads, future rail/ports/airports, warehouses/hubs, selected city, contract/activity badges.

**Compatibility:** gameplay city IDs stay `izmir` … `trabzon`. No lat/lng in this step.

**Playable city ≠ geographic label.** Do not imply all provinces are playable.

**Must preserve from live MapScreen (see table):** active delivery overlay, tracking list, contract recommendation, filters as they evolve, tab entry, fuel sheet, help/sync.

---

## MAP-04 — City / Local operations

**Purpose:** Future detailed operations.

**Possible concepts:** warehouses, depot, terminal, port/airport **where geographically applicable**, local contracts, facility status.

**Do not** invent real infrastructure. **Implementation decision (unresolved):** whether every playable city gets unique local geometry vs a shared schematic.

---

## MAP-05 — Rail

**Purpose:** Rail network management UI (future).

Reference may show dense lines; **production geography later** from the Step 1 pipeline (OSM geometry + TCDD check). Never invent connections.

**Future UI:** network, hubs, availability, owned/usable infra, train movement, route selection.

**Do not** create rail gameplay in this step.

---

## MAP-06 — Port / maritime

**Purpose:** Port and maritime operations UI (future).

**Visual scope later:** port, status, capacity, sea connections, ships, contracts, buy/build/upgrade **states** (no numbers here).

`TURKEY_PORT_AUTHORITY_SOURCE = PENDING_VERIFICATION` — no port registry. Port Level 50 remains future-facing.

Sea routes in UI must be distinguishable from authoritative maritime data.

---

## MAP-07 — Multimodal

**Purpose:** Visualize shipment legs across modes.

Example **structure** (not routing):

`ROAD → RAIL → SEA → ROAD` or `ROAD → AIR → ROAD`

Specify handoff **markers** (hub/port/airport/station) and mode stroke changes. Do not implement multimodal routing.

---

## MAP-08 — Expansion / unlock

**Purpose:** Country/region unlock decisions.

**Future:** locked / available countries, requirements, company level, cost, strategic value, confirmation.

**Do not** invent economy values. Do not change current economy.

---

## MAP-09 — Global network / endgame

**Purpose:** Late-game visualization of authoritative state (hubs, corridors, mode mix, reach). Aggressive LOD/culling later. Not a second simulation.

---

## Legacy behavior preservation

Classified from the live repository. **No behavior change in this step.**

| Behavior | Classification | Notes |
|---|---|---|
| Main tab Harita opens `MapScreen` | PRESERVE | `App.tsx` tab `map` |
| Portrait-only app orientation | PRESERVE | `app.json` |
| Safe-area top + tab-bar bottom padding | PRESERVE | `useTabBarLayout` |
| Header title/subtitle pattern | REPLACE_LATER | Title will need geographic level; keep chrome language |
| Market refresh from map header | PRESERVE | `refreshMarketSnapshot` + toast |
| Help dialog: sync / inspect / rehber | PRESERVE | `reconcileMapTracking`, `inspectMapTracking`, `openHelpGuide('deliveries')` |
| Filter Tümü / Kamyonlar / Depolar | REPLACE_LATER | Depolar is placeholder; V2 layers differ |
| Stats strip counts | REPLACE_LATER | Keep glanceable metrics; schema may change |
| PNG Türkiye canvas + pan/pinch/double-tap | REPLACE_LATER | Renderer replacement is later; gesture-vs-scroll lock PRESERVE as pattern |
| Scroll lock while map gesture active | PRESERVE | Prevents nested scroll fighting |
| Active delivery route + moving truck (no endpoint nodes) | PRESERVE | `mapDeliveryOverlayPolicy` |
| Transfer routes (blue) vs delivery (green) | PRESERVE until multimodal styling |
| Selecting delivery from overlay focuses tracking filter | PRESERVE |
| Truck tracking cards → Fleet | PRESERVE |
| Roadside fuel sheet from tracking | PRESERVE |
| Recommended contract → Contracts with map source | PRESERVE | `openContractsForMapContract` |
| Onboarding visit `Map` + `follow_route` guide | PRESERVE |
| Loading / empty city catalog | PRESERVE |
| Compact layout width `< 360` | PRESERVE as pattern |
| City tap opens city sheet | DEPRECATE_LATER / not live | `MapCityNode` unused — V2 may **add** city select as new behavior |
| Warehouse icons on map | UNKNOWN_REQUIRES_REVIEW | Filter exists; no markers |
| `MapCityNode` market shortage/surplus dots | DEPRECATE_LATER | Unused |
| `networkPositions` abstract layout | DEPRECATE_LATER | Explicitly non-geographic |
| Baked PNG city names as geography | DEPRECATE_LATER | Labels must become localization |
| Calibration debug overlay | PRESERVE (dev-only) | Must not ship as player UX |
| World / Europe / rail / sea / air screens | REPLACE_LATER | Do not exist |
| Hardware Back geographic stack | UNKNOWN_REQUIRES_REVIEW | No level stack today |

---

## Identity mapping (concept only)

```
gameplayCityId: "istanbul"   // LEGACY-STABLE
geoEntityId:    <not defined in this step>
nameKey:        <future localization>
```

# Map V2 — Reference screen inventory

**Phase:** 0 Step 2  
**Depends on:** `docs/architecture/MAP_DATA_SOURCE_POLICY_V1.md`  
**Machine-readable catalog:** `map-v2-reference-manifest.json`  
**This step does not implement Map V2.**

---

## CURRENT_MAP_UX_AUDIT

Live map is a **main tab** (`App.tsx` `{ key: 'map', label: 'Harita' }`) rendering `MapScreen`. Expo `orientation` is **portrait**. iOS `supportsTablet` is **false**.

### Layout (top → bottom)

1. Safe-area top via `useTabBarLayout().screenTopPadding`
2. `MapHeader` — title “Türkiye Lojistik Ağı”, subtitle, help `?`, refresh
3. `MapFilterTabs` — Tümü / Kamyonlar / Depolar
4. `MapStatsStrip` — Şehir / Rota / İş / Aktif / Boşta counts
5. Optional status toast (3s)
6. `TurkeyNetworkCard` + `WorldMapCanvas` — PNG Türkiye network + pan/pinch/double-tap; active delivery/transfer overlays
7. Optional compact “Yeni rota hazır” → contracts
8. `MapTruckTrackingSection` — up to 3 trucks; open fleet; roadside fuel sheet
9. Scroll content bottom padding for tab bar; parent `ScrollView` **locks while map gestures are active**
10. `ContextualGuideHost` card `follow_route`

### What the live canvas does **not** do

- City marker layer is **removed** from production overlay (`WorldMapCanvas` comment; `MapCityNode` is unused).
- Tapping a city on the map does **not** open city details (tap is calibration / content-point plumbing).
- **No warehouse markers.** “Depolar” filter is a placeholder that still shows route + truck overlays.
- Labels are baked into the PNG; dynamic city names are not drawn on the map.
- No world / Europe / rail / sea / air screens.
- No in-map city selection state.

### Entry / exit

| Direction | Mechanism |
|---|---|
| Into map | Tab bar Harita; store `navigationRequest.tab = 'map'`; tips / “Haritada Gör” actions |
| Out to contracts | `onOpenContracts` + `openContractsForMapContract` |
| Out to fleet | `requestNavigationToFleet('trucks')` |
| Overlay | `RoadsideFuelSheet`; help `AppDialog`; contextual guide |

### States

- Loading: no player → “Oyun yükleniyor...”
- Empty: `cities.length === 0` → “Harita verisi yok”
- Compact header/stats when width `< 360`

### Accessibility / motion (live)

- Help and refresh have `accessibilityRole` + labels; filter tabs and most map markers do not.
- Truck marker animation ~750ms; route glow; gesture snap ~165ms. No `REDUCED_MOTION` handling.

---

## Official screen IDs (stable)

| ID | Name | Purpose |
|---|---|---|
| MAP-01 | World Map | Global expansion overview |
| MAP-02 | Region / Europe View | Optional bridge World → country |
| MAP-03 | Country View / Türkiye | Primary logistics operations |
| MAP-04 | City / Local Operations | Facility / local activity |
| MAP-05 | Rail Network View | Rail management (future) |
| MAP-06 | Port / Maritime View | Port/sea operations (future) |
| MAP-07 | Multimodal Network View | Multi-leg shipment visualization |
| MAP-08 | Expansion / Unlock View | Country unlock decisions |
| MAP-09 | Global Network / Endgame | Late-game corridor summary |

No MAP-10+ in this inventory: no additional distinct UX purpose is approved.

MAP-02 is **optional** in navigation. Direct MAP-01 → MAP-03 is allowed.

---

## Reference file status

All nine screens: **`PENDING_REFERENCE_FILE`**. `referenceFile` is `null`. See `references/README.md`.

Do not treat `assets/maps/*` as Map V2 references.

---

## LEGACY-STABLE GAMEPLAY IDENTITIES

Do **not** rename:

`izmir` · `istanbul` · `ankara` · `bursa` · `antalya` · `adana` · `diyarbakir` · `trabzon`

Future MapData may add a separate `geoEntityId` mapped **to** these IDs. Do not invent geo IDs in this step.

Distinguish later:

- **PLAYABLE CITY** — gameplay `cityId` above
- **GEOGRAPHIC LABEL** — localized place names that may exist without being playable (not all 81 provinces)

---

## Behaviors Map V2 must classify

See `MAP_V2_SCREEN_SPECS.md` § Legacy behavior preservation (full table).

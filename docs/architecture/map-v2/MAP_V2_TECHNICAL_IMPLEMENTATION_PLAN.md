# Map V2 — Technical implementation plan

**Phase:** 0 Step 4  
**Status:** PLAN ONLY — no renderer, Skia, ingest, flags, or gameplay changes in this step.  
**Depends on:** Steps 1–3 (`MAP_DATA_SOURCE_POLICY_V1`, MAP-01…09 design contracts, domain + migration).

This document records **how** Map V2 should be built after Phase 0. It does not authorize Phase 1 work until this plan is accepted.

---

## 1. Current technical audit (as of Step 4)

### Runtime / native

| Item | Finding |
|---|---|
| React Native | **0.81.5** |
| Expo | **~54.0.35** — **prebuild / native projects checked in** (`android/`, `ios/`). Scripts: `expo run:android` / `expo run:ios`. Not Expo Go as the production path. |
| Hermes | **Enabled** (`android/gradle.properties` `hermesEnabled=true`; iOS links `hermes.framework`) |
| New Architecture | **Enabled** (`app.json` `newArchEnabled: true`, Gradle `newArchEnabled=true`) |
| Reanimated | **~4.1.1** + `react-native-worklets` **0.5.1**; Babel `react-native-reanimated/plugin` |
| Gesture Handler | **~2.28.0**; app wrapped in `GestureHandlerRootView` |
| react-native-svg | **15.12.1** — live overlay polylines + truck chevron |
| Skia | **Not installed.** No `@shopify/react-native-skia` in `package.json` |
| Navigation | **Custom tab shell** in `App.tsx` (`GameTabBar`), **not** React Navigation. Tabs: Ana / Harita / İşler / Piyasa + More/Fleet/Shop overlays. `navigationRequest` in Zustand. |
| Orientation | **Portrait only** (`app.json`). iOS `supportsTablet: false`. Device rotation is a **fail / lock** test, not a landscape map mode. |
| Android SDK | `minSdk` / `compileSdk` / `targetSdk` from RN/Expo Gradle `ext` (not overridden in `android/app/build.gradle`). Expo modules default **minSdk 24**. |
| iOS | **Deployment target 15.1** (`IPHONEOS_DEPLOYMENT_TARGET`) |
| Bundle / OTA | `expoUpdatesEnabled: false`, `runtimeVersion: null`. **No `eas.json`.** Internal vs store via `LOGISTICORE_BUILD_PROFILE=internal\|production` + `.env.*`. Release: Gradle `bundleRelease` / Xcode Archive. |
| Image loading | Map PNG via `require` + `expo-asset` (`src/assets/mapAssets.ts`, `preloadMapAssets()`). PNG crunch **disabled** in Gradle (asset compile workaround). WebP enabled; animated WebP off. |
| Low-memory workarounds | No dedicated Map V2 memory manager. Known concern: logistics map PNG size (~2.65 MB cited in release readiness). Tab keep-alive is limited (`more`, `vehicleMarketplace`); **Map is not keep-alive** — remounts on tab leave unless visited-tabs cache later changes. |

### Live map render path

1. **Harita tab** mounts `MapScreen` (~740 lines): header, stats, filters, tracking list, fuel sheet, help, contract CTA. Subscribes to **`currentTime`** plus deliveries/fleet (tick-driven). `useScreenRenderProfiler('Map')`.
2. **`WorldMapCanvas`** (~800 lines): `Image` of `turkey-logistics-network-map.png` + SVG route overlays + `AnimatedDeliveryTruckMarker`. Deprecated second PNG still bundled.
3. **`InteractiveTurkeyMap`**: Reanimated **shared values** for pan/pinch/double-tap; **UI-thread transform**. Detail-level callbacks to JS (`runOnJS`) when zoom band changes — not every frame.
4. **Vehicle motion:** JS samples `delivery.progress` → PNG-space polyline (`getRoadRoute`) → pixel + heading → Reanimated `withTiming` toward those pixels. **Logical progress is not sampled on the UI thread.** Path split/rebuild happens when progress keys change.
5. **Pixels are render-derived.** Player save must not store them (Step 3 invariant). Live code still computes pixels each overlay refresh.

### Instrumentation / quality / tests

| Area | Finding |
|---|---|
| Perf | `performanceDiagnostics.ts` (long tasks, nav, map asset logs); `startupPerformance.ts`; `renderRateInstrumentation.ts`; `[tab-transition-performance]`; `[perf-render-storm]`. Gated by `__DEV__` or `EXPO_PUBLIC_BACKEND_DIAGNOSTICS_ENABLED`. **No FPS SDK.** |
| Crash reporting | **No Sentry / Crashlytics / Bugsnag.** `ScreenErrorBoundary` + `console.warn`. |
| Analytics | Gated `trackV11Analytics` (`EXPO_PUBLIC_ENABLE_V11_ANALYTICS`). No map events. Privacy-bounded parameter allowlist. |
| Tests | **tsx scripts** (`npm run verify`), not Jest/Detox. Map: road network, route coverage, truck heading, tracking integrity, map V2 domain isolation. |
| Flags | `EXPO_PUBLIC_*` + `storeProductionPolicy` **fail-closed** for store. Client flags are **not** security. |

### Implications for Map V2

- Skia spike **must** prove New Arch + Reanimated 4 + Expo 54 + Hermes on **both** platforms before production integration.
- Gesture/camera already follow the desired UI-thread pattern; **overlay + tick + SVG path rebuild** is the main live cost, not pan math.
- Hybrid RN chrome + canvas matches the current split (RN chrome around a transformable image).
- No EAS percentage canary infrastructure today — canary is **internal profile / staged store** unless a later pipeline is added.

---

## 2. Implementation principle

```
DATA (MapData packages + provenance)
    ↓
DOMAIN (geo / infrastructure / transport types)
    ↓
MAPPING (gameplayCityId ↔ geo; routes ↔ graph)
    ↓
VIEW MODEL (VisibleCountry / VisibleCity / … — no Firestore)
    ↓
CAMERA / VISIBILITY (LOD, culling, zoom band)
    ↓
RENDERER (replaceable canvas)
```

The renderer **must not** own: economy, Firestore writes, ingest, unlocks, progression.

Keep the canvas swappable (Skia now-proposed; SVG/Image remains legacy until retirement gates).

---

## 3. Proposed renderer strategy

**Proposal (status: PROPOSED — spike required):** Map V2 canvas uses **`@shopify/react-native-skia`**. **Do not install until Phase 1 spike.**

| Concern | Why Skia is a candidate | Risk / caveat |
|---|---|---|
| Polygons / multipolygons | Path + fill at GPU | Huge rings need LOD/simplification offline |
| Polylines | Native paths; dash/width | Thousands of unsimplified OSM ways will fail |
| Markers | Picture / atlas / grouped draws | Do not mount a RN view per marker at world scale |
| Clipping | Clip layers | Nested clips + blur is expensive |
| Transforms | Matrix on group ≈ camera | Camera must stay Skia/Reanimated values, not React state |
| Pan/zoom | Pair with Reanimated shared values (already in-app) | Spike must confirm Reanimated 4 + Skia on New Arch |
| Route animation | Precomputed path + progress sampling | Do not physics-simulate trucks |
| Images/sprites | Image shaders / snapshots | Huge rasters recreate today’s PNG problem |
| Draw-call volume | Batching / Picture recording | Unbatched 10k labels will miss 60 fps |

**Remain outside Skia (React Native):** tab bar, header, breadcrumb, sheets, CTA, forms, account/economy, help, error/retry/loading, accessibility-primary controls.

**Preferred architecture:** React Native UI chrome **+** Skia map canvas. Matches MAP-01…09 (canvas + overlays) and live MapScreen structure.

**Reject for Map V2 canvas:** Google Maps / Mapbox tiles as geographic authority (policy + gameplay map). **Keep** RN Image+SVG as **legacy fallback** until retirement.

ADR: `docs/architecture/map-v2/decisions/0001-renderer-selection.md`.

---

## 4. React Native / Skia ownership

**Skia canvas may own:** base geography, boundaries, routes, appropriate markers, vehicle glyphs, selection chrome, map-only visual effects.

**React Native may own:** header, breadcrumb, tabs, bottom sheet, info cards, CTAs, a11y controls, help, error/retry, loading, economy/account panels.

Do not put every label in Canvas if RN Text is more accessible; see § text strategy in performance budgets.

---

## 5. Threading / animation (hard rule)

**Hard performance rule:** pan, pinch, and continuous vehicle motion **must not** require JS-thread work **every frame**.

Prefer:

- UI-thread / Reanimated shared values / Skia uniforms
- Precomputed route geometry + `getPointAtProgress`
- Low-frequency React updates (zoom **band**, selected entity, geographic **level**)

Forbid:

- React `setState` on every gesture frame
- Firestore during render frames
- Pathfinding every frame
- Allocating large arrays every frame
- Rebuilding all markers on every camera tick

Live map already obeys this for **camera**; Map V2 must extend it to **vehicles and labels**.

---

## 6. MapData packages (provisional)

**Preferred provisional model:** **CORE WORLD PACKAGE (bundled)** + **ON-DEMAND COUNTRY PACKAGES**.

| Package | Contains | Must not contain |
|---|---|---|
| Core world | Country index, **simplified** country polygons, metadata, sparse world labels, manifest | Global roads/rail/local infra |
| Country | Detailed country geometry, playable/relevant cities, transport layers, verified infra catalog, LOD, provenance refs | Player progression |

**Launch implication:** Türkiye is the only live playable country. A **bundled Türkiye country package** (when ingest exists) avoids blocking first Map open on download. Additional countries stay downloadable.

**Not finalized** until size/offline/store-update measurements (ADR 0003).

**Integrity flow:** download → verify hash → stage → validate schema/entities → **atomic activate**. Never activate a partial package. Rollback to last valid release. `MAP_DATA_RELEASE_VERSION` stays **null** until an approved package exists.

**Player save never depends on cached map bytes.**

---

## 7. Offline

If a package is already installed/bundled: map remains usable offline.

| Situation | Behavior |
|---|---|
| Core world available | MAP-01 navigation |
| Installed country available | Country map |
| Country not downloaded | Controlled unavailable + retry; **no invented geometry** |
| Stale but valid | Use until newer verified package activates |
| Corrupt / incompatible | Fail closed; `LEGACY_FALLBACK` while that mode exists |

**Never block player save** because a map package cannot download.

---

## 8. World → country transition

Preserve camera context → animate toward country bounds → activate detailed package **asynchronously** → show loading chrome if needed → **never** freeze the JS thread on giant decode.

If package missing: graceful fallback (simplified world polygon, last good package, or legacy map per rollout mode).

---

## 9. Error categories

`MAPDATA_MISSING` · `MAPDATA_INVALID` · `PACKAGE_INCOMPATIBLE` · `PACKAGE_CORRUPT` · `PACKAGE_DOWNLOAD_FAILED` · `GEOMETRY_MISSING` · `ENTITY_MAPPING_UNRESOLVED` · `RENDERER_FAILURE`

Always: no gameplay corruption, no fabricated geography, no silent blank screen, retry where useful, structured logs, legacy fallback while rollout allows.

---

## 10. Feature flags (not implemented)

Follow existing `EXPO_PUBLIC_*` + production fail-closed (`storeProductionPolicy`). Concepts:

| Concept | Intended meaning |
|---|---|
| `MAP_V2_ENABLED` | Master; production default **false** until gates pass |
| `MAP_V2_SHADOW_ENABLED` | Validate MapData/mappings **without** new renderer UI |
| `MAP_V2_INTERNAL_ONLY` | Internal profile may show Map V2 |
| `MAP_V2_DATA_DOWNLOAD_ENABLED` | Allow on-demand packages |

Exact env names later. **Client flags are not a security boundary.** Unlocks stay server/player-authoritative.

---

## 11. Rollout sequence

1. `LEGACY_ONLY` (current production)
2. `MAP_V2_SHADOW`
3. `MAP_V2_INTERNAL`
4. `MAP_V2_PRIMARY` + `LEGACY_FALLBACK`
5. Percentage/small canary **if** infrastructure exists (today: internal builds / staged store, not EAS Update)
6. Wider rollout
7. `MAP_V2_ONLY`
8. Legacy retirement only after observation (separate asset-deletion step)

**Shadow must not:** change gameplay, write progression, change economy, override legacy UI.

---

## 12. Security

Static MapData is client-readable. Server remains authority for unlocks, purchases, ownership, economy, shipment rewards, progression.

**Renderer security importance as authority: none.** Drawing an “unlocked” country on a modified client must not grant it server-side.

**MAP_V2_DOES_NOT_REQUIRE_USER_LOCATION_PERMISSION.** Game map is not the user’s GPS. Do not add location permission for geography rendering.

---

## 13. Implementation phases (after Phase 0)

Order is a **dependency chain**. Ingestion (Phase 2) may be prepared in parallel **after** spike GO, but must not land production packages before provenance/QA.

| Phase | Name | Exit criteria (summary) |
|---|---|---|
| **1** | Renderer technical spike | Skia builds Android+iOS; synthetic poly/pan/pinch/100+ markers/paths/moving marker; a11y approach noted; mount/unmount memory; **no production wiring** |
| **2** | Core MapData ingestion pipeline | Offline pipeline + manifests; **no** live app ingest until approved |
| **3** | Projection + camera | Replaceable projection service; UI-thread camera; **projection choice after spike** |
| **4** | World geometry renderer | MAP-01 with simplified countries; LOD_WORLD |
| **5** | Country / Türkiye mapping | MAP-03 geo layer; package atomic activate |
| **6** | Legacy city mapping | Eight IDs VERIFIED or explicit UNRESOLVED + graceful hide |
| **7** | Road / current gameplay adapter | `ROUTES` remain gameplay km; optional geo polyline refs |
| **8** | Vehicle / active delivery visualization | Progress sampling; no saved pixels |
| **9** | UI integration MAP-01…MAP-04 | RN chrome; MAP-02 optional |
| **10** | Rail layer | Provenance-backed; not invented |
| **11** | Sea / ports | After `TURKEY_PORT_AUTHORITY_SOURCE` resolved |
| **12** | Air | Same rule |
| **13** | Multimodal | Legs contract only until gameplay exists |
| **14** | Performance optimization | LOD/cull/batch; quality tiers |
| **15** | Shadow / internal rollout | Diagnostics; no public renderer |
| **16** | Canary / production rollout | Flags + gates |
| **17** | Legacy retirement | After retirement gates; asset deletion **later** |

**Do not begin Phase 1 in this Step 4 deliverable.**

---

## 14. Renderer technical spike (mandatory before full impl)

Isolated app or unused screen. **Synthetic / non-geographic** geometry only.

Must exercise: Skia dependency compatibility; one country-like polygon; pan; pinch zoom; 100+ markers; several routes; one moving marker; accessibility approach (RN overlay vs canvas hit); mount/unmount memory; Android **and** iOS **development** builds.

No MapScreen replacement, no ingest, no flags in production profiles.

---

## 15. Unresolved (carry forward)

Do not hide these:

- Projection (ADR 0002)
- Final MapData distribution vs measured sizes (ADR 0003)
- Geometry encoding (ADR 0004)
- Actual benchmark device models
- Numeric memory/FPS **release** gates after spike
- MAP-04 city geometry (unique vs schematic)
- Warehouse marker behavior on map
- Whether MAP-02 Europe ships
- `TURKEY_PORT_AUTHORITY_SOURCE`
- Reference PNG files still uncommitted
- Exact Skia version / Reanimated interop until spike
- Whether store staged rollout is used as canary (no EAS Update today)

## 16. Related docs

- Performance: `docs/performance/map-v2/MAP_V2_PERFORMANCE_BUDGETS.md`
- QA: `docs/qa/map-v2/MAP_V2_TEST_STRATEGY.md`, `MAP_V2_DEVICE_MATRIX.md`
- Release: `docs/release-audit/map-v2/MAP_V2_ROLLOUT_AND_RELEASE_GATES.md`
- ADRs: `docs/architecture/map-v2/decisions/`

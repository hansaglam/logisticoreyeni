# Map V2 — Performance budgets

**Phase:** 0 Step 4 + Phase 1 update  
**Renderer:** **ACCEPT_SKIA** (Phase 1). Production MapScreen still PNG+SVG. World geometry DEV viewer uses Skia + Reanimated shared-value camera; HUD React updates are throttled (~140 ms).

**Nature:** Engineering **targets** and **budgets**, not product promises. Values stay **provisional** until device profiling of real geography.

Existing instrumentation to reuse (do not add SDKs in this step): `performanceDiagnostics`, `startupPerformance`, `renderRateInstrumentation`, `useScreenRenderProfiler`, `[tab-transition-performance]`, `[perf-map-asset]`, `[perf-long-task]`.

---

## 1. Frame targets

| Constant | Value | Meaning |
|---|---|---|
| `TARGET_INTERACTION_FPS` | **60** | Pan/pinch/idle map on **mid/high** supported devices |
| `MINIMUM_ACCEPTABLE_FPS` | **30** | Floor for **supported low** devices; still stable and tappable |

Do not use **average FPS alone**. Record **p95 / p99 frame time** and note JS vs UI stalls when tools allow.

---

## 2. Hard animation rule

Pan/zoom and continuous vehicle motion **must not** run JS every frame. See implementation plan §5.

Semantic React updates (selected country, zoom band, geographic level) may be **low frequency** (e.g. on band change, not per transform).

---

## 3. Interaction budgets (provisional)

Reference class: **PRIMARY_REFERENCE = mid-range supported Android** (exact model TBD; see device matrix).

| Scenario | Target | Budget / notes |
|---|---|---|
| Cold map open (first Harita after process start, packages local) | First **interactive** frame **~1–2 s** | Includes decode of **bundled** core (+ TR package if bundled). Not a store gate until profiled. |
| Warm map open (tab remount, packages already decoded/cached) | **Sub-second** interactive | Intentional memory cache vs leak must be distinguished |
| World → country | Camera animation **without** JS freeze; package activate **async** | Loading chrome allowed; no sync giant decode |
| Country → city | Same | MAP-04 geometry model still unresolved |
| Pan / pinch | 60 fps target / 30 fps min | UI-thread transform |
| Vehicle animation | Smooth interpolation of **precomputed** path | Offscreen: no draw; low zoom: lower update rate |
| Layer toggle | **< 100 ms** to first visual change (target) | Must not rebuild unused modes |
| Repeated enter/exit (20×, later 50×) | No **unbounded** memory growth | Cache warm-up plateau is allowed if documented |

---

## 4. Load stages (measure later)

Instrument as separate spans when implemented:

`COLD_MAP_OPEN` · `WARM_MAP_OPEN` · `COUNTRY_SWITCH` · `MAPDATA_PACKAGE_LOAD` · `GEOMETRY_DECODE` · `FIRST_INTERACTIVE_FRAME`

Do **not** hard-code release numeric gates until the spike + matrix exist.

---

## 5. Memory discipline

**No universal MB cap** before profiling.

Measure RSS/JS heap (platform tools) at:

- before Map
- after open
- after heavy zoom
- after layer on
- after World ↔ Country loops
- after leave Map
- after **20** enter/exit (engineering) and **50** (release qualification where practical)

**Hard requirements:**

- no unbounded growth
- no retained **obsolete** MapData packages
- no retained large decoded images after unmount unless **intentional** cache
- no duplicate route geometry per screen instance
- no repeated texture duplication of the same package

Baseline + **regression delta** vs last accepted profile beat a fictional global MB number.

Live lesson: a **full-country raster** is already a memory/size tax — Map V2 must prefer **vector LOD**, not a larger PNG.

---

## 6. CPU / GPU cost drivers

High cost: giant polygons, path effects, blur/glow stacks, dense text, thousands of animated markers, per-frame geometry rebuild, many translucent overlays, huge rasters.

**Optimization order (do not drop geographic integrity first):**

1. Culling  
2. LOD  
3. Geometry simplification (**preprocess**, not per frame)  
4. Caching (Pictures / atlases)  
5. Batching  
6. Visual effect reduction (quality tier)

---

## 7. LOD (not implemented)

| Level | Visibility intent |
|---|---|
| `LOD_WORLD` | Simplified country polygons; selected/global hubs; **no local roads** |
| `LOD_REGION` | Countries; limited hubs; major international routes only |
| `LOD_COUNTRY` | Playable/active cities; selected transport layers; major infra |
| `LOD_CITY` | Hubs, local ops, active vehicles/contracts |
| `LOD_LOCAL` | Detailed infra **where a package exists** |

MAP-02 Region is **optional**; LOD_REGION must not be required to play Türkiye.

---

## 8. Viewport culling

```
camera → visible geographic bounds → spatial query → visible entities → render
```

Start with **axis-aligned bounding boxes**. Add a spatial index **only after** AABB fails benchmarks. **No R-tree dependency in Phase 0–1.**

---

## 9. Labels

Staged policy (no collision engine yet):

1. Zoom-band filtering  
2. Priority: selected > playable/unlocked > decorative  
3. Cap count per frame  
4. Selected entity may **force** one label  
5. Avoid flicker (hysteresis on zoom band / hold last winner briefly)

Never draw all country+city names at world scale.

---

## 10. Geometry simplification

Ingestion generates `COUNTRY_LOD0/1/2` (and polyline variants). **On device:** pick LOD by zoom. **Not** simplify every frame.

Preserve required topology, island/critical geometry policy, and provenance linkage (Step 1).

---

## 11. Vehicles and path sampling

**Logical progress, not physics:**

```
progress = clamp((now - startAt) / (arrivalAt - startAt), 0, 1)
point = getPointAtProgress(cachedGeometry, progress)
```

`now` is **game/sim time** consistent with delivery state — not wall-clock FPS.

Preprocess: cumulative lengths, normalized progress, tangent/heading, bounds.

Hundreds of **logical** vehicles ≠ hundreds of high-cost animations. Offscreen: skip. Distant zoom: throttle.

**Do not change live delivery simulation in this step.**

Future util boundary (placeholders only later): `getPointAtProgress` / `getHeadingAtProgress` on **MapData geometry**, never treating PNG x/y as WGS84.

---

## 12. Camera

Camera state (canvas): center, zoom, viewport, bounds, target, gesture flags — **shared values**.

React receives **semantic** updates only.

---

## 13. Visual effects budget

| Class | Examples | Policy |
|---|---|---|
| ESSENTIAL | Selection clarity, transport-mode color/weight | Keep |
| OPTIONAL | Blur, glow, pulse, terrain flair | Drop on LOW tier / auto-degrade |

Cosmetic effects **must not** break interaction fps. Concept-art neon is **not** a 60 fps requirement.

---

## 14. Quality tiers (not implemented)

`AUTO` · `LOW` · `STANDARD` · `HIGH`

Differences: label density, glow, terrain, animation density.

**Core geography and gameplay information identical.** No gameplay advantage on HIGH.

**Optional auto-degrade:** if sustained frames miss budget, reduce **cosmetics/labels only** — never “correct” geography.

---

## 15. Cache classes (future)

`MEMORY` · `DISK` · `BUNDLED_FALLBACK`

Evict obsolete releases; country packs removable/re-downloadable. Integrity before use.

---

## 16. Accessibility vs canvas

Do not sacrifice a11y to shave GPU. Primary controls stay RN. Canvas hit-testing + accessibility nodes is a **spike deliverable** (overlay list vs synthetic RN views).

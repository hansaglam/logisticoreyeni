# Map V2 — Test strategy

**Phase:** 0 Step 4  
**No renderer tests required until a renderer exists.** This is the future pyramid + internal scenarios.

Current repo tests are **tsx scripts** (`npm run verify`), not Jest/Detox/Appium. Map V2 should add scripts in that style first; device FPS/memory are **operator + platform tools**.

Two QA tracks must stay separate:

| Track | Question |
|---|---|
| `VISUAL_REFERENCE_QA` | Does the screen match MAP-01…MAP-09 **intent**? |
| `GEOGRAPHIC_DATA_QA` | Is the geography **licensed, provenanced, and factually validated**? |

**Never** approve a geographically wrong map because it matches concept art. Reference PNGs are still `PENDING_REFERENCE_FILE`.

---

## 1. Test pyramid

### UNIT

Projection (once chosen), geometry refs, camera math, LOD band decisions, gameplay↔geo mappings, route sampling (`getPointAtProgress`), package schema structural checks.

### INTEGRATION

MapData validate → activate; World → Country state machine; legacy mapping adapter; delivery visualization adapter (progress → view model, **not** pixels in saves).

### UI

Screen transitions, filters/layers, sheets, loading/error/retry, back stack (sheets then geographic stack then tabs). Prefer RN Testing if introduced later; until then, script + device checklist.

### PERFORMANCE

FPS / p95 frame time, memory enter/exit, load spans, repeated navigation. Spike first.

### REGRESSION (must stay green across Map V2)

Existing contracts, warehouses (`cityId` ownership), active delivery, roadside fuel, Harita tab navigation, eight gameplay city IDs, `ROUTES` gameplay graph, map heading/tracking scripts.

Domain isolation: `scripts/map-v2-domain-architecture-regression-test.ts` — MapScreen must not import `src/mapV2` until an explicit later phase.

---

## 2. Geographic QA (ingestion phase — not now)

- Package schema + hash
- Polygon validity / duplicate IDs / country relationships
- City-in-country checks where appropriate
- Transport topology vs **gameplay** graph (they may differ; do not silently overwrite `ROUTES` km)
- Official Türkiye cross-check per Step 1 (HGM QA-only until clearance)
- No unresolved production provenance
- **No AI coordinates**
- ISO codes validated from source, never invented in repo

---

## 3. Internal test scenarios (before public renderer)

- First Map open / repeated Map open  
- World → Türkiye / Türkiye → city  
- Rapid back  
- Zoom spam / pan spam  
- Transport layer toggles  
- Active delivery overlay  
- Roadside fuel sheet  
- Contract CTA / show-on-map  
- Background / foreground / lock  
- Rotation **attempt** (app is portrait-locked — confirm no crash)  
- Low-memory restore  
- Offline / slow network  
- Simulated corrupt MapData  
- Unresolved city mapping (eight IDs until ingest)

---

## 4. Leak protocol

Loop: open Map → navigate/zoom → close Map.

- Engineering: **20** cycles  
- Release qualification: **50** where practical  

Flag **monotonic unbounded** growth. Document cache warm-up separately.

---

## 5. Lifecycle

Survive: home/background, resume, lock/unlock, process recreation where the OS allows, network change.

Camera restore is optional UX. **Rendering state must never corrupt gameplay.**

---

## 6. Shadow mode tests

Shadow may load/validate MapData, resolve mappings, compute visible sets, compare route mappings, emit diagnostics.

Assert: **legacy UI unchanged**, no progression writes, no economy change.

---

## 7. Screenshot / visual regression

When references exist: compare MAP-01…09 stills **after** geographic QA for that build’s MapData.

Do not snapshot-test invented geometry.

---

## 8. Instrumentation candidates (already in repo)

Reuse console spans; **do not** emit per-gesture analytics.

Future structured events (types later, implement with analytics architecture): see rollout doc telemetry list. High-frequency gesture events are **forbidden**.

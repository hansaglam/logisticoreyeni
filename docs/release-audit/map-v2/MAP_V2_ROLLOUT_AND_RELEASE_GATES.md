# Map V2 — Rollout, telemetry, privacy, and release gates

**Phase:** 0 Step 4  
**Modes:** documented in `docs/architecture/map-v2/MAP_V2_ROLLOUT_MODES.md`. **No flags implemented in this step.**

---

## 1. Intended sequence

1. `LEGACY_ONLY` — production today (PNG + svg)  
2. `MAP_V2_SHADOW` — validate data/mappings; **users still see legacy**  
3. `MAP_V2_INTERNAL` — internal profile renderer  
4. `MAP_V2_PRIMARY` + `LEGACY_FALLBACK`  
5. Small canary **if** the pipeline supports it (today: **no EAS Update / no eas.json**; use internal builds and store staged rollout)  
6. Wider rollout  
7. `MAP_V2_ONLY`  
8. Legacy retirement **after** gates — asset deletion is a **later** step  

Do not remove the legacy renderer early.

---

## 2. Shadow rules

May: load/validate MapData, resolve mappings, compute visibility, compare route mappings, diagnostics.

Must not: change gameplay, write progression, change economy, override legacy UI.

---

## 3. Flags (future)

Concepts: `MAP_V2_ENABLED`, `MAP_V2_SHADOW_ENABLED`, `MAP_V2_INTERNAL_ONLY`, `MAP_V2_DATA_DOWNLOAD_ENABLED`.

Production **fail-closed**. Enforce via `storeProductionPolicy`-style checks when flags exist.

Client flags **≠** security. Server/player state remains authority for unlocks and rewards.

---

## 4. Telemetry / analytics / privacy

**Crash reporting today:** none (boundary + console). Future Map V2 errors should still be structured logs; a crash SDK is **out of scope** for this step.

**Do not implement events now.** Candidate **low-volume** names (when analytics allowlist expands):

Diagnostics / errors: `map_v2_open`, `map_v2_load_failure`, `map_v2_package_invalid`, `map_v2_country_selected`, `map_v2_mapping_unresolved`, `map_v2_renderer_error`, `map_v2_fallback_legacy`, `map_v2_performance_sample` (sampled, not per frame).

Product (sparse): `map_open`, `country_selected`, `city_selected`, `transport_layer_toggled`, `show_on_map_from_contract`.

**Forbidden:** high-frequency gesture analytics; precise **user** geolocation; PII; cash/save payloads (existing V11 allowlist spirit).

Map geography is **game data**, not the player’s physical location.

### MAP_V2_DOES_NOT_REQUIRE_USER_LOCATION_PERMISSION

The logistics map must **not** request device GPS merely because boundaries use real-world geography. No location permission for Map V2 rendering unless a **separate**, justified gameplay feature is explicitly designed later.

Current repo: no `NSLocation*` / `ACCESS_FINE_LOCATION` / `expo-location` for the map.

---

## 5. Public release gates (Map V2 as player-facing)

No public Map V2 unless **all** apply:

- No known progression corruption  
- No duplicate/lost warehouse or city ownership  
- MapData package valid (schema + integrity + provenance)  
- Feature-flag rollback works  
- Legacy fallback works during migration modes  
- Supported device classes meet **minimum usability** (30 fps floor, no critical crash)  
- Attribution / licensing approved for production datasets  
- Geographic QA completed  
- Live gameplay mappings required for the eight city IDs **verified** (or an accepted explicit unresolved + hide policy that does not break contracts)  

---

## 6. Legacy retirement gates

Do **not** remove legacy map until:

- Map V2 is primary and stable  
- Fallback observation period completed  
- Active delivery visualization verified  
- Contract navigation verified  
- Warehouse interactions accounted for  
- Low-device performance accepted  
- Crash/error metrics accepted (even if only logs)  
- Operational rollback no longer required  
- Migration docs finalized  

**Legacy asset deletion** (PNGs, `TURKEY_OUTLINE`, etc.) is a **separate** future step after code retirement.

---

## 7. Authority reminder

Static MapData (client): boundaries, geo cities, transport geometry, real infra catalog.

Server/player: ownership, unlocks, upgrades, contracts, money, active shipments.

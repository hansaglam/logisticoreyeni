# Map V2 — Türkiye country operations dashboard (visual spec)

**Status:** DEV / World Experience only. Production `MapScreen` is out of scope.  
**Geography authority:** geoBoundaries country polygon, Natural Earth GeoCity points, OSM ROAD package.  
**Visual authority:** Map V2 reference composition (layout, density, hierarchy). The reference is **not** geographic truth.

---

## Layout audit (pre–Dashboard V2)

Measured from the player country implementation before this pass (not a rewrite-from-scratch):

| Zone | Before | Issue |
|---|---|---|
| Screen padding | `spacing.sm` (8) + `gap: sm` | Fine; map still lost height to chrome |
| Header | back + 32px flag + title + `StatusBadge` + “Dünya” | Too many competing chips; title not dominant |
| Tabs | bordered pill row, `minHeight` 34, selected border | Heavy segmented control |
| Map wrap | `flex: 1`, `minHeight` 220, **radius 36** (shared with world) | Cards below stole height; frame felt like the world globe clip |
| Map/content ratio | often **well under 45%** once city card + 4-stat sheet + 2×2 CTAs stacked | Map not the hero |
| Selected city card | population GIS line + full-width inspect | Debug tone |
| Summary | duplicate Türkiye identity + 4 equal stat tiles + boxed legend + 4 equal CTAs | Card-on-card clutter |
| Bottom | `useTabBarLayout().contentBottomPadding` | Keep |

---

## Dashboard V2 — final portrait hierarchy

A. Country header  
B. Country mode tabs  
C. **Hero map area** (target **45–55%** of usable country-screen content height)  
D. Selected city card (conditional, compact)  
E. Country summary  
F. Country actions (inside the summary sheet)  
G. Existing app tab bar (`useTabBarLayout`)

Map wrap: `flex: 1.45`, `minHeight` 248, radius 22. Do not let metrics/CTAs collapse the map into a 220px strip.

Spacing rhythm: theme `spacing.sm` (8) between major zones; `spacing.xs` (4) only inside compact rows. Narrow phones (`width < 360`): horizontal padding `spacing.xs`.

### Typography hierarchy

| Role | Token | Color |
|---|---|---|
| Country title | `typography.dashboardTitle` | `textPrimary` |
| Identity / status caption | `typography.caption` | `textMuted` / `primaryLight` |
| Section title | `typography.sectionTitle` | `textPrimary` |
| Body | `typography.bodySmall` | `textSecondary` |
| Metric value | `typography.dashboardMetricValue` (16 on this sheet) | `textPrimary` |
| Metric label | `typography.dashboardMetricLabel` | `textMuted` |
| City label (map) | Skia 11 | `#E2F6FF` / selected `#FFFFFF` |
| Tab | `typography.tabLabel` | muted / `primaryLight` |

---

## Header V2

- Back `IconButton`
- Compact TR flag (22px) — must not compete with the title
- Title: localized **Türkiye**
- One muted identity line: `Başlangıç Ülkesi · Operasyon Merkezi`
- No second “Dünya” text button, no large status badge, no explanatory paragraph

Background remains app navy (`colors.background`). No glow.

---

## Tabs V2

Harita / Şehirler / Sözleşmeler / Ticaret.

Compact segmented row: quiet fill, **cyan underline** on selected, no per-item border. Unselected readable muted. Touch: ~40px height + hitSlop.

---

## Map hero frame

- Dark navy outer RN container + 1px cool edge
- Inner Skia pad 8 so Türkiye does not kiss the frame
- Rounded clip r≈18 (not the world oval)
- Ocean: static 3-stop navy gradient
- Faint **screen-space** coordinate lines (4×3), opacity ≤ 0.07
- Inner rim stroke on the clip
- No blur stacks, no particles, no moving textures

Camera: overview lock. `COUNTRY_FIT_PADDING` 0.1. Min scale 1× fit, max **1.4×**. No free pan/pinch. City taps only. No ROAD runtime.

---

## Country base

Boundary authority: verified `COUNTRY_HIGH` path.

- Land gradient `#0C3048 → #1A6A88 → #178096 → #0E4C66` clipped to the path
- Dual coastline (dark under + teal) plus a hairline inner edge
- **4** large transparent tint fields clipped to the polygon — decorative, **not** admin regions
- No invented borders

Static SVG export remains review-only. Runtime stays on the Skia path.

---

## City markers (8 verified gameplay cities)

See **Map visual pass** below for the final node/label tokens.

Coordinates **unchanged**. Screen-space label offsets only (`cityDashboardLabelOffset`).

---


## Selected city card

Player-facing only:

- City display name  
- `Operasyon noktası`  
- Secondary `Şehri İncele` (existing coming-soon dialog — no City Detail screen)

No population, geo IDs, hashes, or LOD on the player card.

---

## Country summary V2

- Top: Türkiye + compact status capsule (availability fixture)
- Body: 1–2 lines (`countryOpsBody`)
- Metric row: **Şehirler 8** · **Sözleşmeler Yakında** · **Ulaşım Karayolu**
- Expansion: one muted line `Genişleme · Yakında` — not a fourth giant tile

Do not invent unlock/economy numbers.

---

## Transport legend

Compact row: dot + label + Aktif/Yakında. ROAD active treatment. Rail/sea/air muted. No implied availability.

---

## CTA hierarchy

1. Primary: **Şehirleri Gör** (cities tab)  
2. Secondary: **Ülke Detayları**  
3. Disabled: **Ağı Genişlet**  
Contracts CTA omitted — no safe destination yet.

Primary cyan `ActionButton`. Secondary dark fill + outline. Disabled low contrast. Min touch 44 via `ActionButton` compact.

---

## Animation

- Existing world→country fade (`COUNTRY_ENTER_FADE_MS`), skipped when Reduce Motion
- No pulsing nodes, no terrain animation, no looping summary motion
- Selected ring is a static emphasis (no per-frame pulse)

---

## Performance

- First paint: header + tabs + COUNTRY_HIGH path + 8 nodes + RN sheets
- No ROAD chunk/overview mount on player country
- No 4K raster, no Blur, no animated gradients
- Tint fields: 4 circles clipped once

---

## Responsive

- Compact `< 360`: reduce horizontal padding; metrics wrap (`flexBasis` 80+)
- Never shrink type below token caption/bodySmall
- Content above tab bar via `contentBottomPadding`

---

## Player vs debug

| Surface | Roads | Cities | Camera |
|---|---|---|---|
| World Experience country | none until curated set | 8 gameplay | locked overview |
| Transport Inspector / ROAD prototype | full debug network | package cities as configured | inspector zoom |

No hashes, LOD names, node counts, or package status on the player country dashboard.

---

## Road corridor design (player)

Curated OSM-derived intercity corridors. **Not** the full ROAD graph.

- Density: 10 national links among the 8 gameplay cities
- Draw order: water → land/tints/coast → **corridors** → city nodes → labels → selection
- Color: muted warm steel (`COUNTRY_CORRIDOR_MAIN` `#C9C0AE`) over a dark base. Not city cyan, not tab cyan
- Selection: connected corridors use `CONNECTED_TO_SELECTED` (slightly brighter steel, subdued tint). Unrelated corridors `DIMMED` at lower opacity. Locked/mixed stay slate; selected locked cities use `LOCKED_AND_SELECTED_CONTEXT` and never look unlocked
- Width (world units, overview camera is locked): base `0.00026`, main `0.00015`, connected `0.000175`, highlight `0.00007` — thinner than city hubs and selection rings
- Not tappable. No truck animation
- Budget: ~18 KB JSON, batched SkPaths by interaction state, geometry cache keyed by corridor id only

Contract: compact `turkey-road-corridors.json`. Empty/unresolved candidates stay invisible (no straight lines).

---

## Map visual pass (country surface + 8 nodes)

### Audit (pre-pass)

- Land still read as a single teal polygon; four equal tints felt like blobs, not depth.
- Coast mint (`#9AF0DE`) competed with city cyan.
- Nodes were generic filled dots; capital gold wash looked like a selection halo.
- İstanbul label sat west of the marker (frame-clip risk). İzmir same pattern.
- Collision could drop labels; eastern Türkiye felt empty.

### Land styling

Verified `COUNTRY_HIGH` path from `getCountryPath` (cached). Paint only.

- Fill: diagonal gradient `#082636 → #0E4A5C → #17687A → #0B3A4C`
- 4 clipped tint fields: west coast, central, **east highland**, south — not admin regions
- One low-opacity inner highlight ellipse (clipped)
- 3 clipped ridge bands in the east — stylization, not elevation data
- No rasters, blur, or extra country paths

### Coastline

Layered stroke on the same path:

1. Outer dark navy `0.00118`
2. Main cool `#7EC8D4` `0.0003` (weaker than selected city ring, stronger than ridges)
3. Inner highlight `0.00013`

### Water

Deep navy base + static radial gradient + faint screen-space grid. No animation.

### City node anatomy (screen-stable, `markerInvScale`)

Tokens in `cityPaint.ts`:

| Token | Hub | Extra |
|---|---|---|
| `CITY_NODE_DEFAULT` | 4.6 | core + cyan ring |
| `CITY_NODE_CAPITAL` | 5.35 (~16% larger) | gold outer ring + warm core; **not** a selection halo |
| `CITY_NODE_SELECTED` | same hub | white ring outside node + modest halo + short stem toward the card |

İstanbul is not sized by population.

### Labels

| Token | Fill |
|---|---|
| `CITY_LABEL_DEFAULT` | `#D5EBF6` |
| `CITY_LABEL_CAPITAL` | `#F3E4B8` |
| `CITY_LABEL_SELECTED` | `#FFFFFF` + compact backplate |

Overview: all **8** gameplay labels stay visible. Offsets: `CITY_DASHBOARD_LABEL_OFFSETS` (NAMEASCII). Connectors only when offset length ≥ 28px (Trabzon).

Western labels (İstanbul, İzmir) offset **inland** (positive X). Collision priority if ever needed: selected → Ankara → İstanbul → rest (`cityLabelPriority`).

### Selection ↔ card

Selected map-frame edge brightens. Compact card keeps a cyan left bar. Content unchanged: name / Operasyon noktası / Şehri İncele.

### Performance

Paint/style only. Country path cache unchanged. No ROAD layer, no Blur, no per-frame React city overlays.


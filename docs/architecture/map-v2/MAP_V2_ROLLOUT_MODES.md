# Map V2 — Rollout modes and fallback

**Do not implement feature flags in this step.** Meanings only.

| Mode | Intent |
|---|---|
| `LEGACY_ONLY` | Current PNG + svg map. Production default until later. |
| `MAP_V2_SHADOW` | Load/validate MapData + mappings off-UI or diagnostics; **users still see legacy map**. |
| `MAP_V2_INTERNAL` | Internal builds may show Map V2; production stays legacy. |
| `MAP_V2_PRIMARY` | Map V2 is the player map; legacy kept as fallback binary. |
| `LEGACY_FALLBACK` | Runtime switch back to legacy if MapData invalid. |
| `MAP_V2_ONLY` | After cutover; legacy renderer removable. |

`MAP_V2_SHADOW` exists specifically to validate packages **without** exposing a new renderer.

## Fallback categories

If country geometry, city mapping, transport geometry, package hash, or schema is missing/invalid:

- Do not crash
- Do not corrupt player state
- Do not fabricate geography
- Use **controlled** fallback: keep last good MapData, or `LEGACY_FALLBACK` / `LEGACY_ONLY`
- Hide unresolved geo layers; keep gameplay city graph
- Surface a safe unavailable/error state (design later), not an infinite spinner

Partial package activation is forbidden.

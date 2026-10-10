# Map V2 visual references

This folder holds **approved design documentation images** for Map V2.

They are **not** runtime assets. Do not `require()` / import them from `src/`, `App.tsx`, or any production screen.

## Status

No approved 9:16 concept files are in the repository yet.

Each `MAP-01`…`MAP-09` entry in `../map-v2-reference-manifest.json` uses:

`referenceFile`: `null`  
`status`: `PENDING_REFERENCE_FILE`

Do **not** copy `assets/maps/turkey-logistics-network-map.png` (or other live map rasters) here. Those files have unresolved provenance and are gameplay/runtime assets, not Map V2 design references.

## How to add an approved image later

1. Export a **portrait 9:16** still (PNG or WebP). Pixel size is documentary, not a layout lock.
2. Name it by stable ID, e.g. `MAP-01-world-map.png`.
3. Place it in this directory only.
4. Update the matching object in `../map-v2-reference-manifest.json`:
   - `referenceFile`: `"docs/design/map-v2/references/MAP-01-world-map.png"`
   - `status`: `"approved"`
5. Keep `REFERENCE_IMAGES_ARE_NOT_DATA_SOURCE` (see `MAP_V2_VISUAL_SPEC.md`). Geography still follows `docs/architecture/MAP_DATA_SOURCE_POLICY_V1.md`.

Do not invent placeholder PNGs to fill the folder.

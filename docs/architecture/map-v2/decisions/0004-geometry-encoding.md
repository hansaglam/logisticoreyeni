# ADR 0004 — Geometry encoding

**Status:** ACCEPTED (world boundaries v1)  
**Date:** 2026-09-16  

## Decision

Do **not** ship raw GeoJSON into React render.

World country geometry is a deterministic **WorldBoundaryPackageV1**:

- quantized projected rings (`WORLD_BOUNDARY_QUANTIZE = 100000`)
- MultiPolygon + holes
- three LOD copies generated at ingest
- provenance via existing `MapSourceManifest`
- `contentHash` over canonical JSON **excluding** `generatedAt` (build metadata is a sibling file)

Fill rule: **even-odd** so holes punch correctly. Ring vertices keep source order (`SOURCE_ORDER_EVEN_ODD_FILL`).

SkPath objects are cached by `geoCountryId + lod` and are not rebuilt every frame.

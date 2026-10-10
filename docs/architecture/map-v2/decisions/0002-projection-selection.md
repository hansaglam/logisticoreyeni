# ADR 0002 — Map projection

**Status:** ACCEPTED  
**Date:** 2026-09-16  
**Updated:** Phase 1 Step 2A

## Decision

Use **Web Mercator** with **EPSG:3857 semantics**.

Source geography: WGS84 longitude / latitude (degrees).  
Canonical persisted coordinates: WGS84.  
Generated renderer geometry: **normalized Web Mercator** world space.

```
x ∈ [0, 1]
y ∈ [0, 1]
(0,0) = northwest
(1,1) = southeast
```

### Formula

```
x = (longitude + 180) / 360

# dynamic points only:
lat = clamp(latitude, -85.05112878, +85.05112878)

# static polygons: clip rings to ±85.05112878, then project without per-vertex clamp
latRad = lat * π / 180
y = 0.5 - ln(tan(π/4 + latRad/2)) / (2π)
```

Inverse exists for debug / dynamic points. Static country geometry is projected at package generation — **not every frame**.

### Why Web Mercator

- familiar 2D world navigation
- simple pan / zoom math
- stable rectangular world bounds
- easy viewport / culling
- compatible with country → city zoom hierarchy
- cheap normalized coordinates
- WGS84 remains the source; projection can be swapped later by regenerating packages

### Polar geometry (LogistiCore V1)

**POLAR_RENDER_POLICY = OMIT_UNREPRESENTABLE_POLAR_FEATURE**

Web Mercator cannot represent the poles. Static polygon ingest:

1. WGS84 source geometry stays canonical (geoBoundaries).
2. Polygon rings are **geometrically clipped** to ±85.05112878 **before** projection. Vertices are not independently latitude-clamped.
3. Rings are split at the antimeridian. World V1 remains **CLAMPED_NO_WRAP**.
4. If a source polygon **encloses a pole** (Antarctica), clipping still produces a world-spanning strip. That feature is **omitted from the Web Mercator render layer** and listed in `omittedPolarFeatures`. It remains in source/provenance (`sourceCountryCount`).

Do **not** invent replacement Antarctica geometry. Do **not** silently switch projection. A complete pole-to-pole visual world would be `PROJECTION_RECONSIDERATION_REQUIRED` and is out of scope for this V1 Mercator layer.

Implementation: `src/mapV2/geo/wgs84Clip.ts`, `src/mapV2/geo/polarPolicy.ts`, `src/mapV2/geo/geometry.ts`.

- area distortion at high latitudes
- latitude clamp at ±85.05112878
- **not** suitable for physical distance
- **never** compute gameplay road/rail/sea distance from projected pixels

Gameplay distance stays data/network based.

### World wrapping (V1)

**CLAMPED_NO_WRAP.** No infinite horizontal wrapping. Camera pan is clamped to the unit world square.

Implementation: `src/mapV2/geo/webMercator.ts`, `src/mapV2/geo/worldCamera.ts`.

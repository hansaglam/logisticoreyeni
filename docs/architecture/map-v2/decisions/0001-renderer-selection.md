# ADR 0001 — Map V2 renderer selection

**Status:** ACCEPT_SKIA  
**Date:** 2026-09-15  
**Updated:** Phase 1 Step 2A (after EAS / dual-platform runtime verification)

## Context

Live map is PNG + svg + Reanimated 4. Skia **2.2.12** is installed. Isolated spike remains in DEV tooling. Production MapScreen is unchanged and remains the fallback.

## Decision

**ACCEPT_SKIA** as the Map V2 renderer.

Reason:

- reference iOS native build succeeded (EAS SDK 54 / Xcode 26.0 image)
- reference Android native build succeeded
- runtime interaction tests succeeded on both platforms
- pan, pinch zoom, and double-tap zoom worked
- synthetic stress (1000 markers, 50 routes, moving marker) was acceptable
- no critical crash, black screen, or blocking performance issue observed
- existing legacy MapScreen remains fallback

The isolated spike is **kept** and remains reachable from Şirket → Simülasyon Testi → Map V2 Skia Spike (`__DEV__` only).

## Consequences

Geography and production map work may use Skia. Do not replace MapScreen in this step. Re-evaluate only on a future Expo/RN upgrade if native linkage changes.

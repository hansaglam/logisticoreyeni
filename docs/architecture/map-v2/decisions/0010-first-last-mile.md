# ADR 0010 — First / last-mile abstraction

**Status:** ACCEPTED (planning only; not implemented)  
**Date:** 2026-09-20  
**Step:** Map V2 Phase 1 Step 21

## Context

DEV slices use logical ROAD local legs (`DEV_LOCAL_TRANSFER_DISTANCE`), not canonical ROAD graph paths to stations/ports/airports. `routes.ts` distances are city-to-city ROAD. Exact street routing to Yenice / Yumurtalık / IST would be a large Map V2 + live-sim coupling.

## Options

A. City-level abstract local haulage (duration from association meters or a city policy table).  
B. Canonical ROAD path from city operational node to infrastructure.  
C. Reuse `routes.ts` city-pair distance as a stand-in (incorrect for city→port).

## Decision

**Staged: A for first production multimodal; B as a later accuracy step. C is forbidden as routing truth.**

V1 last-mile: same city ROAD operational semantics as today (truck must be in origin city; progress is time-based). Transfer is a timed dwell at a Geo-infrastructure id, not a drawn city→port polyline.

Do not draw fake city-center→airport geometry. Do not treat player corridor JSON as the local ROAD path.

## Consequences

Players will not see door-to-dock polylines in V1. Association types (DIRECT vs REGIONAL) remain honest in UI copy. Canonical ROAD-to-infra routing is a follow-up after shipment persistence works.

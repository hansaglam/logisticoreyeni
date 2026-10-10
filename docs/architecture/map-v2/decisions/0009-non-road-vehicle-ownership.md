# ADR 0009 — Non-ROAD vehicle ownership (MVP)

**Status:** ACCEPTED (planning only; not implemented)  
**Date:** 2026-09-20  
**Step:** Map V2 Phase 1 Step 21

## Context

Fleet is `Truck` + optional `Trailer` + `Driver`. Marketplace and `serverState` already treat trucks as owned assets with fuel, condition, city. Trains/ships/aircraft would multiply save schema, UI, maintenance, crew, and marketplace surface.

## Options

A. Player must own a vehicle for every mode.  
B. Player owns trucks; purchases third-party RAIL/SEA/AIR capacity.  
C. Hybrid unlock (capacity first, ownership later).

## Decision

**B for multimodal MVP, with C as a later progression layer (not V1).**

- ROAD first/last mile uses existing trucks/drivers.
- Middle legs are booked capacity (`purchasedCapacityIds`), not player-owned Train/Ship/Aircraft.
- Do not introduce `Aircraft` / `Ship` / `Train` types in live save.
- Do not generalize `Truck` into a `TransportVehicle` base class.

Mode-specific owned vehicles (Option A / premature generic base) are rejected until ROAD+capacity multimodal is proven.

## Consequences

Economy needs a capacity-purchase line item, not fleet slots. UX is “book rail/sea/air” rather than park a ship. Future owned rolling stock can add a new asset class without rewriting Truck.

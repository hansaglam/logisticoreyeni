# ADR 0007 — Legacy Delivery coexistence

**Status:** ACCEPTED (planning only; not implemented)  
**Date:** 2026-09-20  
**Step:** Map V2 Phase 1 Step 21

## Context

Live `Delivery` is a truck-centric, single-progress ROAD trip (`truckId`, `driverId`, `distanceKm`, `progress`, fuel, incidents). DEV multimodal runtime is a separate five-step state machine. Existing saves contain `activeDeliveries[]`. Migrating them in place would risk save corruption and double settlement.

## Options

A. Keep ROAD `Delivery` forever as a parallel engine.  
B. Internally represent every ROAD job as a one-leg `Shipment` immediately.  
C. Gradual adapter: new code talks Shipment; old records stay Delivery until completion.

## Decision

**A for production V1, with a documented path to C later.**

- Existing and newly generated ROAD-only contracts continue to create `Delivery`.
- Multimodal jobs, when eventually enabled, create an additive `PersistedMultimodalShipment`.
- Do not convert in-flight ROAD deliveries.
- Do not require a one-time save rewrite.

Option B is rejected for first production multimodal: it couples every ROAD tick, incident, fuel, and ad-boost path to a new schema.

Option C is the long-term compatibility strategy after ROAD Delivery remains stable beside shipments for at least one release.

## Consequences

Two execution engines until a later unification step. UI must branch on job kind. Settlement idempotency keys must be namespaced (`delivery:` vs `shipment:`).

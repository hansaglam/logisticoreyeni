# ADR 0008 — Contract vs Shipment separation

**Status:** ACCEPTED (planning only; not implemented)  
**Date:** 2026-09-20  
**Step:** Map V2 Phase 1 Step 21

## Context

Today `Contract` is both the market offer and the source of Delivery fields (origin, destination, payment, deadline, `distanceKm`). `Delivery` holds runtime. DEV `MultimodalShipmentPlan` / `MultimodalShipmentRuntime` already split plan vs execution.

## Decision

**Contract = commercial offer. Shipment = execution after acceptance.**

```
Contract (available)
  → accept
  → ShipmentPlan (immutable topology + economic snapshot)
  → ShipmentRuntime (mutable progress)
```

Contract must not store leg progress, transfer status, or assigned trucks.

ROAD-only V1: Contract still materializes `Delivery` (legacy). Multimodal V1: Contract materializes `ShipmentPlan` + runtime, not a stuffed Contract.

## Consequences

New optional contract schema/version for multimodal offers. ROAD `Contract` type in `src/types/game.ts` stays as-is. Generator may later emit a parallel offer list; it must not mutate existing ROAD offers in place.

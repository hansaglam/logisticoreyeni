# ADR 0013 — Multimodal feature rollout and rollback

**Status:** ACCEPTED (planning only; not implemented)  
**Date:** 2026-09-20  
**Step:** Map V2 Phase 1 Step 21

## Context

Map V2 already has renderer rollout language (`LEGACY_ONLY`, `MAP_V2_SHADOW`, …) and city-progression modes. Multimodal gameplay must be independently killable without reverting Map V2 visuals or ROAD Delivery.

## Decision

Rollout enum (default **MULTIMODAL_OFF**):

| Mode | New offers | Execute persisted shipments | Player UI |
|---|---|---|---|
| `MULTIMODAL_OFF` | No | Load + freeze or finish already persisted only if a compat flag says so; **V1: no persisted shipments exist** | Hidden |
| `DEV_PREVIEW` | Simulator / inspector only | DEV runtime in-memory | DEV screens |
| `INTERNAL_TEST` | Yes for testers | Yes | Gated |
| `PRODUCTION_ROLLOUT` | Yes if `allowNewMultimodalContractCreation` | Yes | Visible |

Independent gates: `RAIL` / `SEA` / `AIR`.

**Rollback:** set `allowNewMultimodalContractCreation = false` without deleting `multimodalShipments[]`. Execution compatibility remains so in-flight shipments can complete. UI may hide *new* cards while showing active shipment timeline.

Do not implement flags in this audit step.

## Consequences

A bad RAIL generator can be disabled without breaking SEA types or ROAD Delivery. Persisted shipments are forward-compatible with “creation off”.

# ADR 0011 — Client vs server authority for multimodal shipments

**Status:** ACCEPTED (planning only; not implemented)  
**Date:** 2026-09-20  
**Step:** Map V2 Phase 1 Step 21

## Context

Local `SaveGamePayload` is the primary player document (`users/{uid}/saves/current`). `users/{uid}/serverState/current` is server-authoritative for cash, owned trucks, warehouses, reputation counters used by marketplace/leaderboard. Delivery completion is client-simulated with `settledAt` / `settlementId` idempotency. Offline progress already mutates money locally then syncs.

## Decision

| Event | Authority |
|---|---|
| Tick progress, pause, UI | Client (game clock + existing offline progress pattern) |
| Accept contract / create shipment | Client writes local; cloud save blob; **no** server generate |
| Capacity purchase, cash debit, reward credit | **Server-authoritative when signed in** (extend settlement / cash transaction ids). Offline: local apply + replay-safe `settlementId` |
| Shipment COMPLETED / FAILED terminal | Client proposes; settlement function must be idempotent |
| Contract expiry of unsold offers | Client (same as ROAD offers) |
| Asset availability (truck busy) | Client validated; server re-checks on marketplace mutations |

Do not make Firestore listeners the source of truth for `progress`. Do not put 5-step runtime exclusively on the server for V1.

## Consequences

Need shipment settlement ids in the same spirit as `delivery:{id}:revenue`. Future Cloud Function: `completeMultimodalShipment` (not in this step). Offline completion then reconnect must not double-pay (see idempotency ADR notes in audit).

**Step 23 implementation note:** Deterministic ids `shipment:{shipmentId}:revenue` and `shipment:{shipmentId}:completion` are defined in `src/domain/multimodalSettlementIdentity.ts`. They are not applied. `recordCanonicalDeliveryCompletion` and ROAD `delivery:{id}:revenue` are unchanged. No `completeMultimodalShipment` callable is deployed.

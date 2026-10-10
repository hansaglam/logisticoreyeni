# ADR 0012 — Multimodal schema versioning

**Status:** ACCEPTED  
**Date:** 2026-09-20  
**Step:** Map V2 Phase 1 Step 21 (planning); Step 22 implemented nested shipment persistence without bumping `SAVE_GAME_VERSION`

## Context

`SAVE_GAME_VERSION` is currently **6** on `meta.saveVersion`. Additive fields (`companyStats`, `trailers`, `activeTransfers`) already default when missing. Bumping global save version for multimodal would force a heavy migration of ROAD-only players.

## Decision

- Keep `SAVE_GAME_VERSION` unchanged until a real persist implementation step.
- Version **nested** multimodal documents:
  - `contractSchemaVersion` on multimodal offers only
  - `shipmentSchemaVersion` on each persisted shipment
- Loader: missing `multimodalShipments` ⇒ `[]`. Missing `multimodalContractOffers` ⇒ `[]`.
- Unknown future `shipmentSchemaVersion` > supported: quarantine that shipment, do not fail the whole save (same family as save recovery, not a hard crash).
- Never rewrite `Contract` / `Delivery` records to a new shape as part of multimodal enablement.

## Consequences

ROAD players never see a forced conversion. Cloud checksum still covers the additive arrays once they exist.

**Step 22 implementation note:** Live persist types live in `src/domain/multimodalShipmentPersistence.ts`. `SAVE_GAME_VERSION` remains **6**. Missing `multimodalShipments` ⇒ `[]`. `multimodalContractOffers` is still not a live save field (deferred until contract-generation steps). Prototype files under `src/mapV2/prototypes/productionMultimodal/` remain reference-only.

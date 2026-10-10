# Map V2 — Multimodal persistence foundation (Step 22)

**Status:** `MULTIMODAL_PERSISTENCE_FOUNDATION_PASS` (persistence only)  
**Date:** 2026-09-20  
**Constraints:** ADR 0007–0013. Live ROAD `Contract` / `Delivery` unchanged. Gameplay remains `MULTIMODAL_OFF`.

This step adds an additive save array. It does **not** create shipments, generate multimodal contracts, settle rewards, or change MapScreen.

---

## Save field

| Item | Value |
| --- | --- |
| Field | `multimodalShipments` |
| Type | `PersistedMultimodalShipment[]` |
| Default | `[]` |
| Missing V6 field | hydrates to `[]` |
| Live types | `src/domain/multimodalShipmentPersistence.ts` |
| Store | `StoreGameState.multimodalShipments` |
| Payload | `SaveGamePayload.multimodalShipments?` (always written as an array on serialize) |

`multimodalContractOffers` is **not** a live save field yet. ADR 0012’s “missing ⇒ []” rule for offers remains conceptual until a contract-generation step. Step 22 does not create or persist offers.

---

## Version decision — remain `SAVE_GAME_VERSION = 6`

**Choice B.** Do not bump 6 → 7.

Reasons (project convention + ADR 0012):

- Additive optional fields already default when missing (`companyStats`, `trailers`, `activeTransfers`) without a global version bump.
- ADR 0012 versions **nested** documents via `shipmentSchemaVersion`, not the envelope.
- A global bump would force every ROAD-only player through a heavy migration for an empty array.

Nested support: `SUPPORTED_MULTIMODAL_SHIPMENT_SCHEMA_VERSION = 1`.

---

## Old-save fallback

`createDefaultSaveFallbacks` / `normalizeSavePayload` / `payloadToStoreState` call `normalizeMultimodalShipments`.

- `undefined` / missing → `[]`
- non-array → `[]` (save remains loadable)
- mixed array → valid entries kept, malformed omitted

No reset. No lost `Delivery`. Offline. No network needed to initialize the field.

---

## Legacy Delivery coexistence

- `Delivery` still has no required `legs`, `transfers`, or `shipmentSchemaVersion`.
- An in-flight ROAD delivery is **not** converted into `multimodalShipments`.
- `toSimulationState` still maps `activeDeliveries` only.

---

## Serialization

`serializeGameState` always writes `multimodalShipments` as a plain JSON array after `normalizeMultimodalShipments`.

Never persisted: functions, class instances, Skia, graph edges, corridor JSON, DEV simulator speeds, pause/failure-injection UI.

Cloud path is the same blob (`users/{uid}/saves/current`) after `sanitizeForFirestore` (drops `undefined`).

---

## Deserialization

Accept missing, `[]`, or a mixed array. Validate per-entry. Do not crash the whole save because one shipment is malformed.

---

## Malformed-record policy

Invalid entry → **omit** that entry, keep the rest of the save, DEV `console.warn`.

Do not quarantine the entire player save. Do not reset cash/fleet/deliveries.

Unsupported transfer pairs (e.g. RAIL↔SEA) make that **shipment** invalid (omit), because the itinerary cannot be resumed safely.

---

## Unknown future `shipmentSchemaVersion`

If `shipmentSchemaVersion` > supported:

- Do **not** interpret or execute the record.
- **Preserve** a compact `{ unreadable: true, unreadReason: 'UNSUPPORTED_SHIPMENT_SCHEMA_VERSION', opaque }` clone (size-capped).
- `selectActiveMultimodalShipments` excludes unreadable records.

---

## Active vs history

`multimodalShipments` is the **in-flight** array.

- Intended contents: PLANNED / ACTIVE / BLOCKED (and temporarily FAILED/CANCELLED until a later cleanup step).
- Completed history must **not** grow this array forever.
- Step 22 does not implement history, pruning by status, or a second collection.
- Safety cap: `MAX_PERSISTED_MULTIMODAL_SHIPMENTS = 24`.

---

## Cloud blob

Same document `users/{uid}/saves/current`. No new collection, no Cloud Function, no `serverState` shipment objects.

Checksum covers the array once serialized (same `preparePayloadForChecksum` walk).

---

## Local / cloud merge

Sync is still whole-blob last-write-wins. This step does not redesign conflict resolution.

After serialize, local always has `multimodalShipments: []` for current live play. A cloud blob **missing** the field hydrates to `[]`, which is equivalent to local empty. A missing cloud field cannot wipe shipments that do not exist yet.

When live shipments exist (later steps): restoring an older cloud blob without the field would hydrate `[]` — same class of last-write-wins as any other additive array. Not redesigned here.

---

## New game / reset

`createInitialGameState()` sets `multimodalShipments: []`.  
`resetGame` spreads that initial state. No fixture shipment. Starter cash / fleet / home city unchanged.

---

## What remains after Step 23

Step 23 identity helpers exist; **settlement still does not execute**.

Still not this foundation: contract offers, RAIL/SEA/AIR activation, MapScreen UI, tariffs, live shipment runtime, duration policy (Step 24), reward apply.

---

## Manual QA (no multimodal UI)

A. Launch existing save  
B. Active ROAD delivery still present  
C. Contracts still appear  
D. Save  
E. Reload  
F. No multimodal UI  
G. Economy/player state unchanged by this field

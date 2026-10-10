# Map V2 — Multimodal settlement identity + idempotency (Step 23)

**Status:** identity foundation only — **no settlement executes**  
**Date:** 2026-09-21  
**Constraints:** ADR 0007–0013. `SAVE_GAME_VERSION = 6`. `MULTIMODAL_FEATURE_ROLLOUT = 'MULTIMODAL_OFF'`.

Live helpers: `src/domain/multimodalSettlementIdentity.ts`

This step answers: if the same multimodal shipment completion is processed twice, the economic identity is the same string and a future server can apply it at most once. **Cash is never moved here.**

---

## Settlement namespace

| Item | Format |
| --- | --- |
| Active kind | `revenue` only |
| Settlement id | `shipment:{shipmentId}:revenue` |
| Example | `shipment:shipment.test.001:revenue` |

Built by `getMultimodalSettlementId` / `buildMultimodalSettlementId`. Deterministic. No `Date.now()`, UUID, index, or device counter.

Documented **non-active** future kinds (identity only, from ADR 0011):

- `shipment:{shipmentId}:capacity`
- `shipment:{shipmentId}:completion-expenses`

Those strings are distinguishable from `revenue`. They must not execute.

---

## Completion identity

| Item | Format |
| --- | --- |
| Completion id | `shipment:{shipmentId}:completion` |

**Why this is separate from settlement**

Legacy ROAD already splits three concerns:

1. **Execution record** — `Delivery.id`
2. **Economic ledger keys** — `delivery:{deliveryId}:revenue` (and maintenance/penalty)
3. **Server completion receipt** — Firestore `users/{uid}/canonicalDeliveryCompletions/{deliveryId}` (document id = raw `deliveryId`)

Multimodal mirrors that split:

- `shipmentId` = execution identity
- `shipment:{shipmentId}:revenue` = economic idempotency key
- `shipment:{shipmentId}:completion` = completion receipt identity

`completionId !== settlementId` so a future completions collection cannot be confused with a cash transaction id.

**Do not write multimodal completion ids into `canonicalDeliveryCompletions`.** That collection’s document ids are un-prefixed ROAD `deliveryId` values. A shipment whose `shipmentId` happened to equal a delivery id would collide. Future analog (not in this step): a separate collection such as `canonicalMultimodalShipmentCompletions`.

---

## shipmentId requirement

Settlement identity depends only on a valid `shipmentId`.

Rejected (no replacement id): `null`, `undefined`, `''`, whitespace, leading/trailing space, ids with `:`, `/`, or other characters outside `[A-Za-z0-9._-]`, length 0 or > 128.

Do not fall back to origin, destination, `contractId`, timestamp, or `routeReference`.

---

## contractId distinction

A shipment may store `contractId`.

- `contractId` ≠ `settlementId`
- `contractId` ≠ `completionId`

One commercial contract could theoretically have multiple execution attempts later. **Contract id is not an idempotency key.**

---

## Legacy Delivery separation

| Legacy | Format | Persistence / authority |
| --- | --- | --- |
| Delivery `settlementId` | `settlement_{deliveryId}` via `buildDeliverySettlementId` | Local `Delivery` on the save blob; client `completeDeliveryById` |
| Finance ledger | `delivery:{deliveryId}:revenue` (also `:maintenance`, `:penalty`, `:completion-expenses`) | Local finance ledger |
| Reputation | `reputation:delivery:{deliveryId}:settlement` | Local reputation history |
| Completions | Firestore doc id = **raw `deliveryId`** | Server `recordCanonicalDeliveryCompletion`; client cannot write (`firestore.rules` write: false) |
| Duplicate ROAD complete | `settledAt` / `settlementId` / ledger / event id → early return, no second payout | Client store |

Multimodal ids always start with `shipment:`. They cannot equal `settlement_*`, `delivery:…`, or `reputation:delivery:…`. **Legacy formats are not renamed.**

---

## canonicalDeliveryCompletions relationship

| Question | Actual behavior |
| --- | --- |
| Key | Document path `users/{uid}/canonicalDeliveryCompletions/{deliveryId}` — **id is the delivery id**, not `delivery:{id}:revenue` |
| Who writes | Cloud Function `recordCanonicalDeliveryCompletion` → `recordCanonicalDeliveryCompletionTransaction` |
| Who checks | Same transaction: if the completion doc exists → `alreadyRecorded: true`, **does not increment** `serverState.completedDeliveries` |
| Authority | Server. Client enqueue is fail-soft (`notifyCanonicalDeliveryCompleted`) for linked accounts only |
| Save blob | **Not** part of `SaveGamePayload`. Pending queue is AsyncStorage `@logisticore/canonical_delivery_completion_pending_v1` |
| Duplicate | Idempotent increment of completed-delivery **counter**, not cash |

Multimodal Step 23 does **not** change this function, collection, or queue. Completions and cash remain different systems for ROAD; they will remain different for shipments.

---

## Server-authoritative boundary (ADR 0011)

**Client** may report: shipment X reached a terminal step.

**Server** (when signed in) owns: atomic apply of `shipment:{X}:revenue` before crediting reward.

`classifyMultimodalSettlementAttempt` can return `UNAUTHORIZED` if `requireServerAuthority: true` and `signedIn !== true`. It still sets `executed: false`. No callable is registered in this step.

Future callable shape (type only, not deployed):

```
completeMultimodalShipment({ shipmentId, settlementId, completionId })
```

---

## Offline replay

Reuse the existing ROAD pattern; do not invent a second offline engine.

1. Local progress uses game hours (same as Delivery offline catch-up).
2. When a future step actually settles, persist `settledAt` analog **and** treat `shipment:{id}:revenue` as the ledger/transaction id (same role as `delivery:{id}:revenue`).
3. After reconnect, recompute the same ids from `shipmentId` (two devices, app restart, duplicate completion events).
4. If the key is already in applied settlement ids / server receipt → `ALREADY_SETTLED`, skip money.
5. Linked-account completion receipt should enqueue a **new** collection, not `canonicalDeliveryCompletions`.

Step 23 does not apply offline rewards.

---

## Two-device determinism

`getMultimodalSettlementId('shipment.test.001', 'revenue')` is a pure function of its arguments. Device A and Device B produce the same string with no sync.

---

## Persistence interaction

Step 22 optional `settlement?: { settlementId?, settledAt? }` remains.

**Choice: derive, do not require stored copies.** If `shipmentId` is valid, identities are recomputed. Optional persisted `settlement.settlementId` is not needed for correctness and is not written by live code (no live shipments).

Unknown `shipmentSchemaVersion` → unreadable, not executable, **no settlement execution**. Malformed / missing `shipmentId` → `INVALID_IDENTITY`.

---

## Classification (no money)

`executed` is always `false` in this module.

| Result | Meaning |
| --- | --- |
| `INVALID_IDENTITY` | Cannot build a key |
| `ALREADY_SETTLED` | Key already in the provided applied set |
| `UNAUTHORIZED` | Server authority required and caller not signed in |
| `NOT_EXECUTED` | Feature off, unreadable schema, or non-active kind |
| `NOT_SETTLED` | Valid key, not in applied set, feature would allow a *future* apply — still not paid here |

Default rollout `MULTIMODAL_OFF` classifies a first attempt as `NOT_EXECUTED`.

---

## Why settlement does not execute here

Economy, inventory, fuel, XP, and reputation stay on the ROAD `Delivery` path. Step 23 is identity only so Step 24+ duration/economy work can attach to a stable key.

---

## Step 24 dependency

Production duration policy (replace DEV speeds). Still no payout. Settlement apply remains a later economy/server step after duration exists.

---

## Cloud Function / Firestore / serverState

No new collection, rules, callable, or `serverState` fields in this step.

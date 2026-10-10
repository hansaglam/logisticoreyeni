# Map V2 — Multimodal RAIL settlement / authority (Step 29B)

## 1. Purpose

Deterministic, replay-safe economics for a completed ROAD→RAIL→ROAD INTERNAL_TEST shipment. Execution still ends at `COMPLETED_UNSETTLED`; this step applies frozen **customer revenue** and **third-party rail carrier expense** only.

## 2. ROAD settlement audit

**A. Client ROAD (`completeDeliveryById`)**  
Applies cash locally via `applyCashTransaction` with `delivery:{deliveryId}:revenue` and `delivery:{deliveryId}:completion-expenses`. Writes `financeLedger`, reputation/XP, `settledAt` / `settlementId` on the Delivery. Idempotent if ledger, notification, or `settledAt` already present.

**B. Server canonical completion**  
`recordCanonicalDeliveryCompletionTransaction` writes `users/{uid}/canonicalDeliveryCompletions/{deliveryId}` and increments `serverState.completedDeliveries`. Client sends **only deliveryId**. Server does **not** move money.

**C. ROAD idempotency**  
Ledger `transactionId` + completion doc existence. Queue (`canonicalDeliveryCompletionQueue`) is for **linked** accounts’ completion **counts**, not cash.

**D. Ledger ids**  
`delivery:{id}:revenue` / maintenance / penalty / completion-expenses.

**E. Offline ROAD**  
Local cash + ledger in the save blob; guests do not enqueue canonical completion.

**F. Signed-in ROAD**  
Cash still lives in the **client save blob**. Server authority is the completion **counter**, not `player.money`.

**G. Guest**  
Local save is authoritative for money.

**H. Cloud retry**  
Canonical completion queue retries delivery **ids**. Cloud save is last-write-wins for the blob, including `player.money`.

**I. Partial failure**  
ROAD completion is a single Zustand `set` after sim success; server count is a separate Firestore transaction.

**J. Reuse**  
Deterministic `transactionId`, `addFinanceLedgerEntries` duplicate skip, integer game dollars, guest local cash.

**K. Isolate**  
Do not call `completeDeliveryById`, do not write `canonicalDeliveryCompletions`, do not reuse `delivery:` ledger prefixes.

## 3. Authority model

| Value | Meaning |
|---|---|
| `LOCAL_OFFLINE_AUTHORITATIVE` | Guest / anonymous / unlinked INTERNAL_TEST. Atomic client apply. |
| `SERVER_AUTHORITATIVE` | Reserved. **Not implemented.** |
| `SERVER_SETTLEMENT_BLOCKED_MISSING_AUTHORITATIVE_SHIPMENT_STATE` | Linked signed-in user. |
| `NOT_SETTLEABLE` | Explicit deny. |

## 4. Signed-in authority — BLOCKED

Shipment economics exist only inside the **client-controlled save blob** (LWW cloud save). There is no `users/{uid}/canonicalMultimodalShipments/{shipmentId}` record created at acceptance.

A Cloud Function that credited `request.playerPayment` would **not** be server-authoritative.

`users/{uid}.money` / `serverState.cash` are **not** a safe shipment settlement path today: a subsequent stale save can overwrite cash.

**Therefore signed-in settlement is not implemented.** No `completeMultimodalShipment` callable. No Firestore multimodal completion collection.

## 5. Guest/local authority

INTERNAL_TEST + not a linked account → `settleRailMultimodalShipmentInternal` / `commitMultimodalRailSettlement`.

## 6. Why client money is untrusted

The client can rewrite `multimodalShipments[]` and `player.money` in the save blob. Server must not trust those fields without a server-owned accepted snapshot.

## 7. Canonical shipment requirement (next architecture)

Minimum for signed-in PASS:

1. Canonical accepted shipment (frozen economics) written by Admin SDK at accept, or an equally trusted record.
2. Firestore transaction: validate completed + not settled → apply **server** cash + settlement receipt.
3. Client save **cannot** clobber that cash.
4. Client cannot write the completion collection (`allow write: if false`).

## 8. Frozen economic snapshot

Settlement reads `economicSnapshot.playerPayment` and `economicSnapshot.railCarrierCost` (cross-checked with `railTariffSnapshot.railCarrierCost` when present). Currency `USD_GAME` or `USD_GAME_INTEGER`.

Does **not** call Step 27 generator, Step 26 tariff, or Step 24 duration.

## 9–10. Revenue vs rail expense

- Gross revenue = frozen `playerPayment`
- Rail expense = frozen `railCarrierCost`
- Net = gross − expense (safe integers)

## 11. Planning ROAD opex

`estimatedRoadOperatingCost` is **PLANNING_ESTIMATE_NOT_CHARGED**. Step 29 did not consume fuel/maintenance.

## 12. Ledger transaction ids

- Revenue (also Step 23 settlement identity): `shipment:{shipmentId}:revenue`
- Rail carrier: `shipment:{shipmentId}:rail_carrier`
- Completion (not cash): `shipment:{shipmentId}:completion`

Operation identity remains the revenue id (Step 23 compatible). Sibling expense is namespaced, not a change to `getMultimodalSettlementId`.

## 13. State machine

`NOT_SETTLED` → (local commit) `SETTLED`  
`SETTLEMENT_PENDING` / `SERVER_CONFIRMATION_PENDING` reserved for a future server path.  
Eligibility: `COMPLETED_UNSETTLED` + `executionStage` match + supported schema + `ROAD_RAIL_ROAD`.

After settle: `status = COMPLETED`, `settlementState = SETTLED`. Progress and cancel are no-ops.

## 14–15. Idempotency / local atomicity

Prepare then commit next-state. Second call `ALREADY_SETTLED` (money/ledger unchanged). Simulated commit failure leaves inputs unchanged.

## 16. Server atomicity

Not implemented (blocked).

## 17–18. Pending / offline signed-in

Not implemented. Linked users remain `COMPLETED_UNSETTLED`. No local credit, no fake pending queue that would later double-pay.

## 19. Cloud money reconciliation

Cannot be guaranteed with LWW save vs hypothetical server cash → signed-in BLOCKED.

## 20. Completion namespace

ROAD `canonicalDeliveryCompletions/{deliveryId}` unused. No multimodal collection added.

## 21. Firestore rules

Unchanged. Client still cannot invent a multimodal completion path because it does not exist.

## 22. Cancellation

Cancelled shipments cannot settle. No carrier fee.

## 23. Late penalties

Deferred. Frozen `playerPayment` only.

## 24. Reputation / XP

Out of scope. Unchanged.

## 25. Existing Step 29 shipments

If frozen payment + rail cost + currency are present → settleable locally. Missing economics → `LEGACY_INTERNAL_TEST_SHIPMENT_NOT_SETTLEABLE`. No fabrication.

## 26. Failure / conflict

Ledger ids present while shipment still `NOT_SETTLED` → `SETTLEMENT_STATE_CONFLICT`. No second credit.

## 27. Known risks

- LWW two-device guest saves can still conflict (same as ROAD cash).
- Guest → later account link has **no** settlement migration.
- Auto-settle runs from `progressMultimodalShipments` only for INTERNAL_TEST **unlinked** accounts.

## 28. Next activation gate

Do **not** public-activate RAIL, SEA, or AIR. Next: canonical accepted-shipment record + server cash that cannot be overwritten by stale saves, **or** an explicit product decision that signed-in multimodal cash stays local like ROAD (that would still be documented as local authority, not server PASS).

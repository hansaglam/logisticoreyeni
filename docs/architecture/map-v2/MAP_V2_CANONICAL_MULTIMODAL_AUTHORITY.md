# Map V2 — Canonical multimodal authority (Step 29C)

**Status:** `CANONICAL_MULTIMODAL_AUTHORITY_PASS_SERVER_SETTLEMENT_DEFERRED`

This step removes the *architecture* blocker from Step 29B (no server-owned accepted shipment). It does **not** pay signed-in cash. Public RAIL / SEA / AIR stay off.

---

## 1. Why Step 29B server settlement was blocked

Guest settlement is local and valid. Signed-in settlement was blocked because:

- there was no server-owned canonical accepted shipment
- `users/{uid}/saves/current` is last-write-wins
- `player.money` inside the save blob can be stale
- a callable that trusted `playerPayment` / `railCarrierCost` would not be server authority

## 2. Signed-in money authority

**Identified field (not mutated in this step):**

`CANONICAL_SIGNED_IN_MONEY_PATH` = `users/{uid}/serverState/current.cash`

Audit:

| Location | Role | Client writable? |
| --- | --- | --- |
| `users/{uid}.money` | Profile / TEST_MONEY_SYNC console inject | **Yes** (owner `setDoc` merge). **Not** settlement authority. |
| `users/{uid}/saves/current` `player.money` | Save-blob cache used by ROAD + guest | Yes (owner save write). LWW. |
| `users/{uid}/serverState/current.cash` | Admin SDK marketplace / weekly rewards / leaderboard cash | **No** (`allow write: if false`) |

Two competing cash fields already exist (`player.money` vs `serverState.cash`). ROAD `completeDeliveryById` still mutates **local** `player.money`. Overlaying `serverState.cash` onto the save blob in this step would fight ROAD. Therefore **signed-in multimodal money settlement is deferred** until a dedicated unified-cash migration.

This step **does not** claim `player.money` is server-authoritative.

## 3. Guest money authority

`LOCAL_GUEST_AUTHORITY`: local save `player.money` is the cash ledger. Guest settlement (29B) unchanged.

## 4. Save blob authority

Signed-in save uploads still serialize `player.money` for ROAD compatibility and offline display. They write `users/{uid}/saves/current`, **not** `serverState.cash`.

`sanitizeForFirestore` / cloud profile `money` omission remains **TEST_MONEY_SYNC only**. That flag is not production multimodal authority.

## 5. Canonical shipment namespace

`users/{uid}/canonicalMultimodalShipments/{shipmentId}`

Distinct from `saves/current` and `canonicalDeliveryCompletions`.

## 6. Canonical schema

`canonicalMultimodalShipmentSchemaVersion` = **1**. Unknown versions fail closed.

## 7. Acceptance callable

`acceptCanonicalMultimodalShipment`

Auth: Firebase callable `request.auth.uid` via linked-account identity (anonymous rejected). **Never** `request.uid`.

Kill switch: `MULTIMODAL_INTERNAL_TEST_AUTHORITY=INTERNAL_TEST` on Functions. Missing/invalid → `FEATURE_DISABLED`. Existing docs are not deleted.

## 8. Server economic recomputation (Model A)

Request **allowed keys only**:

`generationSeed`, `originCityId`, `destinationCityId`, `productId`, `cargoQuantity`, `sourceOfferId`, `transportPattern`, `playerLevel`, `canonicalSchemaVersion`

`playerPayment`, `railCarrierCost`, `distanceMeters` are **rejected** by `hasOnlyKeys`. If they were present on a looser schema, compute still rejects mismatched client money (`CLIENT_PAYMENT_REJECTED` / `CLIENT_RAIL_COST_REJECTED`).

Server uses the same corridor table (Step 26), compact ROAD transfer-access artifact (Step 25), and frozen Step 27 coefficients (mirrored in `canonicalMultimodalRailEconomics.ts` with regression vs `estimateRailOfferEconomics`).

## 9–10. Route / cargo validation

Accepted RAIL corridors only. Bursa / Antalya / Trabzon unresolved → reject. Product ids and tonnes bands `[1, 5, 10, 25]`. Level gate uses the same L1 ≤ 25 t table.

## 11. Canonical snapshot

Frozen: `playerPayment`, `railCarrierCost`, `currency`, tariff/economics policy versions, rail package hash, ROAD access package id + content hash, route reference, cargo, seed, offer id, shipment id.

No money mutation at acceptance. No finance ledger at acceptance.

## 12. Idempotent acceptance

Same `shipmentId` + matching economics → existing record (`alreadyAccepted`). Conflicting payload → `CANONICAL_ACCEPTANCE_CONFLICT` (no overwrite). Network timeout → client retries the same request; server returns the existing record.

## 13. Client commit ordering

Linked INTERNAL_TEST: **prepare → callable → overlay receipt economics → commit**. Failure before confirmation: no local shipment, no reservation, no money, no ledger.

Guest: existing prepare/commit (tagged `LOCAL_GUEST_AUTHORITY`).

## 14. Completion reporting

`reportCanonicalMultimodalShipmentCompleted({ shipmentId })` — no money fields.

Marks `COMPLETION_REPORTED` idempotently. Client-reported execution is **not** cryptographic proof of gameplay.

Queue: `@logisticore/canonical_multimodal_completion_pending_v1` (not ROAD `canonicalDeliveryCompletionQueue`).

## 15. Cancellation authority

`cancelCanonicalMultimodalShipment({ shipmentId })`. Linked cancel waits for server `CANCELLED` (retry on timeout). Offline: `CANCELLATION_REQUIRES_SERVER` + queue. Cancelled records cannot complete or later settle.

## 16–18. Money reconciliation / stale-save / ledger mirror

**Not implemented** (settlement deferred). `serverState.cash` cannot be overwritten by save LWW because clients cannot write it. That is the stale-save *foundation* for a future payout. It is **not** yet wired to multimodal net cash.

## 19. Two-device behavior

Acceptance: one canonical doc per uid+shipmentId. Completion: idempotent. Settlement: not in this step.

## 20. Kill switch

No new canonical acceptance when INTERNAL_TEST authority env is off. Existing server records survive.

## 21. Guest compatibility

Local 29B settlement unchanged.

## 22. Guest → signed-in

Guest-settled shipments are **not** uploaded into canonical server state. No double-payout migration. Pre-29C signed-in local-only shipments are `LEGACY_CLIENT_ONLY_AUTHORITY` and remain ineligible for silent register-from-client-money.

## 23. Execution-authority limitation

Economics: server recomputes. Execution: client-simulated. INTERNAL_TEST may report completion. Public anti-cheat / offer issuance is **not** solved: seeds remain client-selectable among valid deterministic combinations (`INTERNAL_TEST_SERVER_AUTHORITY` ≠ public offer supply).

## 24. Anti-cheat limitations

- Client can choose any valid corridor/product/tonnage/seed.
- Completion is self-reported.
- ROAD cash and `serverState.cash` can still diverge.

## 25. Firestore rules

Owner **read** own canonical docs. **write: false**. Admin SDK / Functions only.

## 26. Internal-test scope

Requires `EXPO_PUBLIC_MULTIMODAL_ROLLOUT=INTERNAL_TEST` on client **and** `MULTIMODAL_INTERNAL_TEST_AUTHORITY=INTERNAL_TEST` on Functions.

## 27. What remains before public RAIL

- Unified signed-in cash (save blob vs `serverState.cash`) without breaking ROAD
- `settleCanonicalMultimodalShipment` using frozen canonical economics only
- Stale-save overlay of authoritative cash onto the client
- Ledger mirror repair
- Server-controlled offer issuance
- Stronger execution/timing proofs

**Public RAIL is not ready.**

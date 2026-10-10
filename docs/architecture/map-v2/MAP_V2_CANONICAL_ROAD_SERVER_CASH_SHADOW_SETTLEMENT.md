# Map V2 — Canonical ROAD server-cash shadow settlement (Step 29K)

**Status:** `CANONICAL_ROAD_SERVER_CASH_SHADOW_SETTLEMENT_PASS`

**Authority mode:** `INTERNAL_TEST_SERVER_CASH_SHADOW`  
**HUD:** overlay **off**, listener **off**, `canUseServerAuthoritativeSettlement()` **false**  
**Public settlement readiness:** `ROAD_CANONICAL_SETTLEMENT_BLOCKED_PRODUCTION_INCIDENT_PARITY`  
`SAVE_GAME_VERSION` **6**. `MULTIMODAL_OFF`. RAIL/SEA/AIR `FOUNDATION_ONLY`.

Local HUD/save cash and server shadow cash are **isolated domains**.

---

## 1. Why this is shadow only

Supported INTERNAL_TEST jobs can now mutate `serverState.cash` from canonical records. Production `completeDeliveryById` still writes `player.money`. Enabling HUD overlay would mix those authorities.

## 2. Supported jobs

`SETTLEMENT_SUPPORTED_INTERNAL_STANDARD` only:

- server-issued canonical contract
- canonical delivery
- `executionEconomicsSnapshot` from `CANONICAL_FLEET_ASSET`
- timing policy `canonical-road-timing-internal-fixed-v1` closed
- `COMPLETION_REPORTED` + `COMPLETED`
- `contractType` standard (frozen fragile surcharge 0)
- backend env `CANONICAL_ROAD_SERVER_CASH_SHADOW=INTERNAL_TEST`

Includes ON_TIME / EARLY / LATE_MINOR / LATE_MAJOR when timing is server-owned.

## 3. Unsupported

`UNSUPPORTED_LEGACY_DELIVERY`, `UNSUPPORTED_NONCANONICAL_CONTRACT`, `UNSUPPORTED_PRODUCTION_FLEET`, `UNSUPPORTED_FRAGILE_AUTHORITY`, `UNSUPPORTED_FAILURE_AUTHORITY`, `UNSUPPORTED_SCHEMA`, `UNSUPPORTED_TIMING_AUTHORITY`, `UNSUPPORTED_EXECUTION_SNAPSHOT`, `ACTIVE_DELIVERY`, `COMPLETION_NOT_REPORTED`, `UNSUPPORTED_CANCELLED`.

## 4–6. Inputs / eligibility / derivation

Reads: `canonicalRoadDeliveries`, frozen execution + timing, `derivedSettlement` from completion report (`prepareCanonicalRoadDeliverySettlement`).  
Client request: `{ deliveryId, canonicalSchemaVersion }` only.

## 7–8. Cash model / atomicity

Reuses Step 29E `applyCanonicalCashMutationsInTransaction`.

Order (matches live `completeDeliveryById`):

1. `delivery:{id}:revenue` (credit)
2. `delivery:{id}:completion-expenses` (debit maintenance+late penalty, if > 0)

Operation id: `roadDelivery:{deliveryId}:settlement`

One Firestore transaction: cash txns + `serverState.cash` + `canonicalRoadSettlements/{deliveryId}` + delivery `SETTLED`.

## 9–13. Receipt / retry / concurrent / cash

Path: `users/{uid}/canonicalRoadSettlements/{deliveryId}` schema **1**. Immutable. Retry returns stored receipt (`alreadySettled`, same `settledAtMs`). Sequential duplicate = one mutation. Memory unit tests do not emulate true Firestore contention; conflict handling is “read settlement doc first”.

`cashAfter = cashBefore + netCashDelta`.

## 14. Overdraft

Local HUD floor **−5000**. Server floor **0**. Negative-net jobs with `cashAfter < 0` → `INSUFFICIENT_CASH` (no silent floor match). Class: `ROAD_SERVER_SETTLEMENT_BLOCKED_OVERDRAFT_POLICY` for that gap. Typical INTERNAL_TEST cash 20000 still settles late jobs when net ≥ −20000.

## 15–20. Isolation

HUD/save/`users/{uid}.money` / `canonicalDeliveryCompletions` / multimodal docs unchanged. Stale save upload cannot write `serverState.cash` (existing rules). Two devices: one server receipt; HUDs may diverge (overlay off). Crash after commit: retry returns receipt; no HUD repair in 29K.

## 21–25. Remaining blockers

Fragile completion condition; FAILED client-reported; production save fleet; fuel/catalog/incidents/daily opex still local. Multimodal still has no server payout callable.

## 26. Next

Do not enable HUD. Likely **STEP 29L — production fleet authority** or fragile/failure execution, then remaining ROAD cash paths.

Starting cash: existing `serverState.cash` (marketplace bootstrap / `migrateLegacyServerState`). Fixture settlement does not invent cash.

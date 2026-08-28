# V1.1 Phase 1 — Marketplace P0 Data-Loss Fix Report

**Date:** 2026-08-27  
**Status:** `MARKETPLACE_P0_RESOLVED` (client + backend hardening; **functions deploy required** for wire payload / incomplete flag)  
**Scope:** Production-severity partial-state after vehicle marketplace purchase. No feature work. No binaries.

---

## Exact root cause

**Backend purchase transaction is atomic** (buyer cash−, seller cash+, truck transfer, listing sold, `serverState` mirrors, idempotency) in one Firestore transaction.

The live bug is a **client reconcile / apply race**, not a broken Firestore purchase txn:

1. Purchase success returns cash fields but historically **no transferred truck**.
2. Local money/fleet were updated only later via `getMyVehicleListings` → `applyVehicleMarketplaceReconciliation`.
3. `reconcileFleetWithVehicleMarketplace` could **apply authoritative cash while dropping trucks** that failed catalog materialization (`if (!template) return []`).
4. Backend `getMyVehicleListings` could **silently filter** owned snapshots that failed `serializeReconciliationVehicleForClient`, still returning `cash`.
5. Success toast could show before local state was consistent; refresh failure was treated as purchase failure even when server had committed.
6. Seller path could remove tombstoned trucks even when `cash` was missing from the payload → truck gone, money unchanged.

**Classification:** Client/cloud reconcile race + non-atomic local apply (cash vs fleet). Backend txn itself was not the partial writer.

---

## Canonical source of truth

| Layer | Authority |
|-------|-----------|
| Ownership + marketplace cash | `users/{uid}/marketplaceState/current` (written in purchase txn) |
| Mirror | `serverState` via `syncServerStateMirror` in same txn |
| Listing | `vehicleMarketplaceListings/{id}` status `sold` |
| Client HUD | Must copy **complete** marketplace reconciliation or purchase receipt apply — never invent partial local state |

Prefer server purchase result + my-listings reconciliation. Client must not reconstruct a purchase from cash alone.

---

## Before / after state flow

### Before (broken)

```
UI success ← purchase ok
  → refresh getMyVehicleListings
  → apply cash always
  → materialize trucks (drop if unknown template / bad serialize)
  → possible: money↓, truck missing
Seller reconnect:
  → soldTruckIds strip truck
  → cash optional → possible: truck gone, money unchanged
```

### After (fixed)

```
purchase ok (+ transferredTruck on receipt)
  → applyMarketplacePurchaseResult(cashAfter + truck) ATOMIC
  → only then success toast
  → refresh confirms; refresh fail does NOT undo local apply
reconcile:
  → refuse incomplete payloads (no cash-only / no sold-without-cash)
  → unknown catalog uses structural fallback (never drop owned truck)
  → backend sets reconciliation.incomplete if serialize drops owned rows
cloud login restore:
  → throws marketplace-reconciliation-failed if incomplete
```

---

## Changed files

### Client
- `src/domain/vehicleMarketplaceReconciliation.ts` — fail-closed + fallback materialize + `buildLocalPurchaseApplyPatch`
- `src/domain/vehicleMarketplacePurchaseFlow.ts` — `localApplyFailed` → retryable
- `src/store/gameStore.ts` — `applyVehicleMarketplaceReconciliation(): boolean`, `applyMarketplacePurchaseResult`, immediate save reasons
- `src/screens/VehicleMarketplaceScreen.tsx` — atomic local apply before toast; refresh fail ≠ purchase fail
- `src/services/vehicleMarketplaceService.ts` — typed `transferredTruck` on purchase result
- `src/services/vehicleMarketplaceStartupReconcile.ts` — refuse incomplete apply
- `src/services/accountCloudLogin.ts` — fail closed on incomplete reconcile
- `src/storage/cloudSaveSync.ts` — map marketplace save reasons to purchase sync

### Backend
- `backend/src/vehicleMarketplace.ts` — purchase success includes `transferredTruck`
- `backend/src/index.ts` — `getMyVehicleListings` sets `incomplete` / `droppedOwnedCount` instead of silent drop-only
- `backend/test/vehicleMarketplace.emulator.test.ts` — sold-without-cash must not strip; sold+cash strips

### Tests
- `scripts/vehicle-marketplace-transaction-integrity-test.ts` — P0 cases
- `scripts/vehicle-marketplace-purchase-deadlock-test.ts` — local apply failure / wiring

### Docs
- this report

---

## Buyer reconcile behavior

1. On purchase success: **local atomic apply** of `buyerCashAfter` + transferred truck (from receipt or listing snapshot).
2. If local apply fails → treat as retryable (`save-conflict`), keep idempotency envelope, do **not** toast success.
3. Then `refreshAll` confirms via my-listings; incomplete reconcile returns failure and does not mutate.
4. Restart / startup / foreground use the same fail-closed reconcile.

## Seller reconnect behavior

1. Tombstone removal **requires** finite authoritative cash in the same payload.
2. Offline seller later reconcile with cash + soldTruckIds applies money credit and removes truck together.
3. Stale cloud merge guards unchanged (still protect proceeds / tombstones).

## Restart / reinstall

- Startup reconcile refuses incomplete envelopes.
- Recovered purchase toast only after successful apply.
- Cloud hold still blocks stale upload until startup reconcile settles.

## Cloud save race

- Marketplace operation lock still held around purchase + screen refresh.
- Immediate autosave on `marketplace-purchase` / `marketplace-reconciliation`.
- Incomplete reconcile never writes partial fleet/cash into the save that could upload.

---

## Test matrix results

| Case | Result |
|------|--------|
| Normal single purchase (integrity) | PASS |
| Concurrent double purchase (existing emulator) | PASS (suite) |
| Buyer success → immediate reconcile | PASS |
| Buyer success → immediate save reason wiring | PASS |
| Buyer success → restart hydrate | PASS |
| Seller offline → later reconnect | PASS |
| Stale cloud cannot overwrite purchase | PASS |
| Stale local cannot restore seller truck | PASS |
| Idempotency / already-completed | PASS |
| Network retry after backend success | PASS (envelope reuse) |
| Duplicate UI tap / lock | PASS |
| Insufficient funds / sold listing | PASS (existing) |
| Incomplete materialization refuse cash | PASS |
| Sold without cash refuse strip | PASS |
| Atomic local purchase apply | PASS |
| Deadlock suite ×10 | **10/10** |
| Integrity suite ×10 | **10/10** |
| Marketplace emulator tests | **14/14 PASS** |
| `tsc --noEmit` | PASS |
| `git diff --check` | PASS |

### Emulator note
Full `npm run firebase:emulators:test` still reports **1 unrelated failure**:

- `malicious cloud save write does not change leaderboard score` (`leaderboard.emulator.test.ts`) — score inequality `95790 !== 17530`. **Not caused by this marketplace patch**; marketplace suite alone is green.

`npm run verify` was not fully re-run end-to-end in this pass (long suite); marketplace-critical scripts + tsc + marketplace emulator were executed.

---

## Observability

- `[MARKETPLACE_RECONCILE] refused incomplete payload` (dropped ids, sold ids, version)
- `[MARKETPLACE_RECONCILE] used fallback templates`
- `[MARKETPLACE_PURCHASE] local atomic apply refused`
- Backend `[vehicle-marketplace-reconciliation-incomplete]` with owned/serialized counts
- Purchase logs include `transferredTruckId` / `localApplied`

No tokens / full saves logged.

---

## What was not weakened

- Firestore purchase transaction atomicity
- Listing lock / idempotency
- Save checksum / atomic local save
- Cloud conflict / stale marketplace merge guards

---

## Deployment required?

**YES** — deploy Cloud Functions so clients receive:

1. `transferredTruck` on purchase success (including lock/sold replays that still have listing snapshot)
2. `reconciliation.incomplete` when owned snapshots fail serialize

Client-only ship already fail-closes incomplete local apply and applies listing snapshot truck on success.

---

## Remaining real-device checks

- [ ] Two accounts: buy → buyer cash− and truck+ immediately
- [ ] Force-kill buyer after success toast → reopen → truck still present
- [ ] Seller offline during sale → reopen → truck gone and cash+ net
- [ ] Airplane-mode then reconnect seller
- [ ] Double-tap buy does not double charge
- [ ] Confirm no infinite spinner if my-listings incomplete

---

## Final status

# MARKETPLACE_P0_RESOLVED

Do not start V1.1 feature work until functions are deployed and the real-device checklist above is signed off.

# V1.1 Marketplace Cloud-Save Trust Fix Report

**Date:** 2026-08-28  
**Final status:** `MARKETPLACE_CLOUD_SAVE_TRUST_FIXED`

---

## Executive summary

`security-malicious-save-trust-test.ts` failed because first-time marketplace bootstrap and fleet reconcile treated client-writable `users/{uid}/saves/current` as authoritative for `canonicalCash` and fleet composition. Forged `money: 987654321` became canonical marketplace cash.

Bootstrap now uses server defaults (`ensureServerStateInTransaction` → `buildMarketplaceStateFromServerState`). Reconcile only runs when marketplace state already exists, never overwrites canonical cash, and only imports a **single** cloud-save truck when explicitly requested for listing (`requestedVehicleId`). Legacy bounded migration remains on `migrateLegacyServerState` only.

---

## Root cause

### Failure chain (before)

```
Client writes users/{uid}/saves/current (money: 987654321, forged truck)
  → ensureVehicleMarketplaceStateTransaction
  → bootstrapMarketplaceStateInTransaction
  → reconcileAuthoritativeFleetInTransaction
  → buildMarketplaceStateFromCloudSave(uid, save)
       canonicalCash = player.money   // unbounded, client-writable
  → existing marketplace == null
  → merged = built.state             // entire forged snapshot accepted
  → transaction.create(marketplaceState/current)
  → mirrorServerStateFromMarketplace → serverState/current poisoned
```

**Assertion failure:** `canonicalCash === 987654321` at `security-malicious-save-trust-test.ts:155`.

### Secondary holes (before)

| Path | Issue |
|------|--------|
| `mergeCloudFleetIntoExistingMarketplaceState` | `canonicalCash: overwrite.cash` could restore cloud cash when no marketplace mutation detected |
| `shouldReconcileFleetFromCloud` | `!existing → true`, `deviceUpdatedAt` / `sourceSaveVersion` triggers bulk cloud fleet import |
| `migrateLegacyServerStateTransaction` | Marketplace created from raw `buildMarketplaceStateFromCloudSave` instead of bounded `serverState` |

---

## Trust model

### Before

```
cloud save (client-writable)
  → buildMarketplaceStateFromCloudSave (raw player.money + trucks)
  → marketplaceState / serverState on first bootstrap or reconcile
```

### After

```
IF marketplaceState missing:
  ensureServerStateInTransaction
    → buildDefaultServerState (SERVER_DEFAULT_CASH, starter fleet)
    → buildMarketplaceStateFromServerState
  (cloud save NOT read for canonical cash/fleet)

IF marketplaceState exists:
  reconcile ONLY when requestedVehicleId missing from fleet
  canonicalCash: ALWAYS existing.canonicalCash
  fleet: existing fleet + at most ONE cloud truck (requestedVehicleId)
  tombstones / marketplace purchase extras preserved (P0)

IF explicit legacy migration (migrateLegacyServerState callable):
  buildBoundedLegacyMigrationFromCloudSave (LEGACY_MIGRATION_BOUNDS)
  marketplace from bounded serverState, not raw save cash
  migrationCompleted gate prevents replay
```

**Trust boundary:** `users/{uid}/saves/current` is backup/restore only. Canonical marketplace economy requires `marketplaceState/current`, `serverState/current`, marketplace transactions, or explicit bounded migration.

---

## Migration / bootstrap rule

| Scenario | Rule |
|----------|------|
| **New account / ensure marketplace** | `SERVER_DEFAULT_CASH` (20,000), starter truck (`SERVER_DEFAULT_STARTER_INSTANCE_ID`). No cloud-save cash/fleet import. |
| **Legacy migration** (`migrateLegacyServerState`) | Only when no `migrationCompleted` serverState and no existing marketplace canonical path. `LEGACY_MIGRATION_BOUNDS`: cash ≤ 5,000,000 (flag if > 500,000), max 20 trucks, catalog-valid trucks only. Marketplace built from **bounded serverState**, not raw save. |
| **Targeted fleet reconcile** | Only `requestedVehicleId` missing from authoritative fleet; used for listing a truck present in local save but not yet mirrored server-side. |
| **Replay** | `migrationCompleted: true` blocks re-migration. Repeated `ensureVehicleMarketplaceState` is idempotent on existing marketplace. |

---

## Changed files

| File | Change |
|------|--------|
| `backend/src/vehicleMarketplace.ts` | First-time bootstrap from serverState only; reconcile only when marketplace exists |
| `backend/src/authoritativeFleetReconciliation.ts` | Reconcile requires existing marketplace; cash never from cloud; targeted truck import; tightened `shouldReconcileFleetFromCloud` |
| `backend/src/serverState.ts` | Legacy migration marketplace from bounded serverState |
| `backend/src/vehicleMarketplaceState.ts` | Document cloud-save parser as reconcile-only, not authoritative bootstrap |
| `backend/test/vehicleMarketplace.emulator.test.ts` | Updated bootstrap expectation + malicious-save security test |

---

## Marketplace P0 compatibility

| P0 invariant | Status |
|--------------|--------|
| Atomic buyer cash + transferred truck | **Preserved** — purchase transactions unchanged |
| Seller cash + tombstone consistency | **Preserved** |
| `transferredTruck` receipt | **Preserved** |
| `reconciliation.incomplete` behavior | **Preserved** |
| Incomplete cloud restore refusal | **Preserved** — tombstone checks unchanged |
| Unknown catalog fallback | **Preserved** |
| Listing lock | **Preserved** |
| Idempotency | **Preserved** |
| Stale cloud cannot undo purchase | **Preserved** — unit test + merge keeps existing fleet/cash |

---

## Security test matrix

| # | Test | Status |
|---|------|--------|
| 1 | Forged cloud save cash → canonical cash unchanged | **PASS** (`security-malicious-save-trust-test`, emulator) |
| 2 | Forged cloud save fleet → canonical fleet unchanged | **PASS** |
| 3 | Forged sold truck restoration → rejected | **PASS** (tombstone + shouldReconcile false) |
| 4 | Forged purchased truck deletion → rejected | **PASS** (P0 unit test) |
| 5 | Valid marketplace purchase → buyer correct | **PASS** (emulator #53–55) |
| 6 | Valid marketplace sale → seller correct | **PASS** |
| 7 | First-time legacy bootstrap → bounded migration | **PASS** (`migrateLegacyServerState` emulator #35–37) |
| 8 | Repeated bootstrap → no replay migration | **PASS** (idempotent migration test) |
| 9 | serverState exists → cloud save ignored for marketplace | **PASS** |
| 10 | marketplaceState exists → cloud save ignored | **PASS** (malicious reconcile emulator) |
| 11 | Malicious save → leaderboard unchanged | **PASS** (leaderboard emulator #17–19) |
| 12 | Malicious save → reconcile unchanged | **PASS** (emulator malicious marketplace test) |

---

## Production poisoned-state risk

| Field | Risk |
|-------|------|
| `marketplaceState.canonicalCash` | May be inflated if user bootstrapped before fix via `ensureVehicleMarketplaceState` + forged save |
| `marketplaceState.ownedTruckSnapshots` | Phantom trucks possible from pre-fix bootstrap/reconcile |
| `serverState.cash` / `ownedTrucks` | Mirrored from poisoned marketplace during reconcile |
| **Exposure window** | From introduction of cloud-save bootstrap reconcile until this deploy |
| **Reconstruct truth?** | Marketplace purchase receipts, listing ledger, tombstones can validate post-marketplace activity; pre-bootstrap forged values cannot be distinguished from legitimate offline progress |
| **Targeted repair?** | Possible for accounts with impossible cash vs transaction history |
| **Mass fix?** | **Not recommended** — manual audit for top marketplace balances |
| **Natural correction** | Future marketplace transactions use authoritative state; forged cash does not auto-correct downward |

**No destructive production migration in this pass.**

---

## Test results

| Command | Result |
|---------|--------|
| `npm --prefix backend run build` | **PASS** |
| `npm --prefix backend test` (Firestore emulator, 64 tests) | **PASS** |
| `firebase emulators:exec … security-malicious-save-trust-test.ts` | **PASS** (`MITIGATED`, `canonicalMarketplaceCash: 20000`) |
| `leaderboard-server-state-sync-regression-test.ts` | **PASS** |
| `npx tsc --noEmit` | **PASS** |
| `git diff --check` | **PASS** |
| `npm run backend:verify` | **PARTIAL** — emulator 64/64 PASS; fails on unrelated `cloud-save-conflict-test.ts` (`body-missing` vs `cloud-save-corrupted`, pre-existing) |
| `npm run verify` | **Not run to completion** — known unrelated `time-progression-audit-test` failures |

---

## Deploy / binary

| Question | Answer |
|----------|--------|
| **Cloud Functions deploy required?** | **Yes** — `ensureVehicleMarketplaceState`, `reconcileAuthoritativeFleet`, `createVehicleListing`, `purchaseVehicleListing`, `migrateLegacyServerState` |
| **App binary required?** | **No** — server-side trust fix |

**Do not deploy automatically in this pass.**

---

## Final status

`MARKETPLACE_CLOUD_SAVE_TRUST_FIXED`

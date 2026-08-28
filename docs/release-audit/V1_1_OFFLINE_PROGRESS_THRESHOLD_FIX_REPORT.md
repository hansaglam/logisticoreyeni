# V1.1 — Offline Progress Threshold Fix Report

**Date:** 2026-08-28  
**Final status:** `OFFLINE_PROGRESS_THRESHOLD_FIXED`  
**Scope:** Wire `hasActiveDeliveries` into offline threshold resolution only. No unrelated economy/marketplace behavior changed in this pass.

---

## Canonical rule

| Player state | Offline duration | Behavior |
|--------------|------------------|----------|
| **Idle** (no active delivery) | &lt; 5 min | No offline simulation, no offline summary; timestamps may still update |
| **Idle** | ≥ 5 min | Normal offline progression |
| **Active delivery** (`on_route` or `preparing`) | &lt; 15 sec | No catch-up |
| **Active delivery** | ≥ 15 sec | Delivery/offline catch-up applies |

Constants (single source of truth in `deliveryOfflineProgress.ts`):

- `DEFAULT_OFFLINE_MIN_MS = 5 * MS_PER_MINUTE` (300_000 ms)
- `ACTIVE_DELIVERY_OFFLINE_MIN_MS = 15_000` ms
- `resolveOfflineProgressMinMs(hasActiveDeliveries)` selects between them

---

## Previous production bug

`gameStore.applyOfflineProgressionIfNeeded` already computed:

```ts
const hasActiveDeliveries = countActiveRouteDeliveriesInList(state.activeDeliveries) > 0;
```

…but called `applyOfflineProgress` **without** passing that flag. As a result:

- `calculateOfflineElapsed` always used the idle 5-minute minimum
- `shouldSkipDuplicateOfflineApply` also used the idle 5-minute window
- Players with trucks on route needed **5 minutes** of background time before any catch-up — contradicting the 15-second active-delivery intent in `deliveryOfflineProgress.ts`

---

## Active delivery detection logic

Reuses the canonical lifecycle helper — no second definition introduced.

```25:31:src/simulation/deliveryOfflineProgress.ts
export function isActiveRouteDelivery(delivery: Delivery): boolean {
  return delivery.status === 'on_route' || delivery.status === 'preparing';
}

export function countActiveRouteDeliveriesInList(deliveries: Delivery[] | undefined): number {
  return (deliveries ?? []).filter(isActiveRouteDelivery).length;
}
```

**Counted as active:** `on_route`, `preparing`  
**Not counted:** `completed`, `failed`, `cancelled`, settled terminal entries (`settlementId` / `settledAt` — reconcile skips these for progress)

`gameStore` passes `hasActiveDeliveries` into `applyOfflineProgress` **before** threshold resolution.

---

## Changed files

| File | Change |
|------|--------|
| `src/simulation/offlineProgression.ts` | Added `hasActiveDeliveries?: boolean` to `applyOfflineProgress`; forwarded to `calculateOfflineElapsed` and `shouldSkipDuplicateOfflineApply` |
| `src/store/gameStore.ts` | Passes `hasActiveDeliveries` from `countActiveRouteDeliveriesInList(state.activeDeliveries)` into `applyOfflineProgress` |
| `scripts/time-progression-audit-test.ts` | Replaced stale 1-minute expectations with idle (14s–5m) and active (14s–3m) boundary matrix |
| `scripts/offline-delivery-progress-regression-test.ts` | Added threshold wiring asserts, 15s/5m boundary proofs, 16s duplicate guard, terminal→idle threshold transition |

**Unchanged (threshold constants already correct):** `src/simulation/deliveryOfflineProgress.ts`

---

## 15s active-delivery boundary proof

`time-progression-audit-test.ts` matrix (all pass):

| Elapsed | `hasActiveDeliveries: true` | Expected |
|---------|----------------------------|----------|
| 14s | `shouldApply: false`, `reason: below_minimum` | ✓ |
| 15s | `shouldApply: true` | ✓ |
| 30s | `shouldApply: true` | ✓ |
| 1m | `shouldApply: true` | ✓ |
| 3m | `shouldApply: true` | ✓ |

`offline-delivery-progress-regression-test.ts` additionally proves:

- 20s active → applies with `appliedMs === 20_000`
- 14s active → does not apply
- 16s background → applies once; immediate re-resume → `duplicatePrevented`

---

## 5m idle boundary proof

`time-progression-audit-test.ts` matrix (all pass):

| Elapsed | `hasActiveDeliveries: false` | Expected |
|---------|------------------------------|----------|
| 14s | no apply | ✓ |
| 59s | no apply | ✓ |
| 1m | no apply | ✓ |
| 3m | no apply | ✓ |
| 4m59s | no apply | ✓ |
| 5m | apply | ✓ |

Idle threshold was **not** lowered to 1 minute.

---

## Duplicate protection proof

`shouldSkipDuplicateOfflineApply` now uses `resolveOfflineProgressMinMs(hasActiveDeliveries)`:

- **Active delivery:** if `lastAppliedAt >= lastSeen` and `now - lastAppliedAt < 15s` → skip (duplicate prevented)
- **Idle:** same guard with 5-minute window

Regression coverage:

1. Immediate resume after apply (`lastAppliedAt === now`) → `duplicatePrevented`, 0 simulation hours
2. 16s active background → applies; immediate second resume → `duplicatePrevented`
3. Settled terminal delivery (`settlementId` + `status: completed`) → reconcile does not emit second `completedIds`
4. After terminal delivery, `countActiveRouteDeliveriesInList` returns 0 → idle 5m threshold on next check

---

## Offline economy invariant (unchanged)

Reconfirmed by `offline-economy-test.ts` (52/52 pass):

- 72h offline fixed operating cost = **0**
- Offline catch-up advances economy cursor without charging historical periods
- Online periodic economy (24h period charge) unchanged
- `OFFLINE_CATCHUP_MAX_COST_PERIODS` behavior unchanged

---

## Tests run

| Command / script | Result |
|------------------|--------|
| `npx tsc --noEmit` | **PASS** |
| `npx tsx scripts/offline-economy-test.ts` | **PASS** (52/52) |
| `npx tsx scripts/time-progression-audit-test.ts` | **PASS** (51/51) |
| `npx tsx scripts/offline-delivery-progress-regression-test.ts` | **PASS** (67/67) |
| `git diff --check` | **PASS** |
| `npm run verify` | **FAIL** — stops at unrelated `apple-auth-audit-test.ts` (4 UI wiring assertions) |
| `npm run firebase:emulators:test` | **PASS** (64/64 backend tests) |
| `npm run backend:verify` | **FAIL** — unrelated `cloud-save-conflict-test.ts` (`body-missing` vs `cloud-save-corrupted`) |

Threshold-specific required tests all pass. Full `verify` / `backend:verify` suites have pre-existing unrelated failures documented in prior release audits.

---

## Remaining unrelated failures

1. **`scripts/apple-auth-audit-test.ts`** — 4 failures (AuthProviderButton / iOS Apple button wiring). Not touched by threshold fix.
2. **`scripts/cloud-save-conflict-test.ts`** — expects `cloud-save-corrupted`, receives `body-missing`. Not touched by threshold fix.

---

## Binary required?

**Yes.** Threshold selection runs in client `gameStore` + `offlineProgression` at foreground/cold-start. A store update (or OTA if applicable) is required for players to receive the 15-second active-delivery catch-up behavior.

---

## Final status

**`OFFLINE_PROGRESS_THRESHOLD_FIXED`**

Active deliveries now correctly use the 15-second offline minimum; idle players remain on the 5-minute minimum. Threshold logic stays centralized in `deliveryOfflineProgress.ts` with no duplication in `gameStore`.

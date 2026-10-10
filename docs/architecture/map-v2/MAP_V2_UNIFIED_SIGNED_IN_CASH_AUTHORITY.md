# Map V2 — Unified signed-in cash authority (Step 29D)

**Status:** `UNIFIED_SIGNED_IN_CASH_AUTHORITY_BLOCKED_ROAD_ECONOMY`

This step does **not** overlay `serverState.cash` onto `player.money`.  
It does **not** add `settleCanonicalMultimodalShipment`.  
Public rollout remains `MULTIMODAL_OFF`. RAIL/SEA/AIR remain `FOUNDATION_ONLY`.

Live policy: `src/domain/cashAuthority.ts`.

---

## 1. Previous three-money architecture

| Location | Path | Client writable? |
| --- | --- | --- |
| Profile | `users/{uid}.money` | Yes (owner). TEST_MONEY_SYNC injects here. |
| Save blob | `users/{uid}/saves/current` → `player.money` | Yes. Cloud save is LWW. |
| Server state | `users/{uid}/serverState/current.cash` | **No** (`allow write: if false`). Dual-written with marketplace `canonicalCash`. |

## 2. Authority problem

If HUD/`player.money` became a live mirror of `serverState.cash` **while ROAD still credits/debits locally**:

1. ROAD `completeDeliveryById` adds revenue to save cash.  
2. Authoritative listener restores previous `serverState.cash`.  
3. Earnings disappear. Purchases (fuel, trucks, cargo) snap back similarly.

That half-state is forbidden. There is **no** generic `updateCash({ delta })` callable (that would not be server authority).

## 3. Money mutation audit

Catalog: `PRODUCTION_CASH_WRITE_AUDIT` in `cashAuthority.ts`.

**Client / local (`player.money` via `applyCashTransaction` unless noted):**

| ID | Classification | Offline | ROAD |
| --- | --- | --- | --- |
| ROAD delivery revenue / completion expenses / fail penalty | REVENUE/EXPENSE | yes | yes |
| Fuel, roadside fuel | EXPENSE | yes | yes |
| Daily operating costs | EXPENSE | yes | yes |
| Truck/trailer buy, lease, hire, fire, repair, upgrade | EXPENSE/REVENUE | yes | yes |
| Warehouse open/upgrade | EXPENSE | yes | no |
| Cargo market buy/sell | EXPENSE/REVENUE | yes | no |
| Vehicle recovery | EXPENSE | yes | yes |
| Ad / mission / milestone / client weekly objective rewards | REVENUE | mixed | no |
| Guest multimodal RAIL settle (29B) | REVENUE | yes | no |
| Debug cash tools | ADMIN_TEST | yes | no |
| Cloud save LWW blob | LEGACY_PROFILE_MIRROR | n/a | yes |
| Profile `users/{uid}.money` | LEGACY_PROFILE_MIRROR | n/a | no |
| TEST_MONEY_SYNC overlay | ADMIN_TEST | no | no |
| Marketplace reconcile overlay | TRANSFER | no | no |

**Server (`serverState.cash` + marketplace `canonicalCash`, Admin SDK):**

| ID | Classification |
| --- | --- |
| Vehicle marketplace purchase / listing fee | TRANSFER/EXPENSE |
| Weekly mission claim | REVENUE |
| Season reward claim | REVENUE |
| Challenge reward claim | REVENUE |
| One-time `migrateLegacyServerState` from cloud save (clamped) | TRANSFER bootstrap for marketplace/leaderboard — **not** HUD authority |

`recordCanonicalDeliveryCompletion` increments `completedDeliveries` only — **not** cash.

No unknown production write path was left unclassified.

## 4. Guest authority

`LOCAL_GUEST_AUTHORITY`: local `player.money` + local ledger + local save. No Firestore cash required. Guest RAIL settle (29B) unchanged.

## 5. Signed-in authority (current vs target)

**Target:** `SIGNED_IN_CASH_AUTHORITY_TARGET = SERVER_STATE_CASH`.

**Current production mode:** `SIGNED_IN_ROAD_LOCAL_SAVE_AUTHORITY` — HUD and ROAD still use save `player.money`. `serverState.cash` is authoritative for **marketplace / season / challenge / weekly-mission cash**, not for ROAD HUD.

Resolver: `getCashAuthority({ signedInLinked })`.

## 6. Profile money role

`PROFILE_MONEY_AUTHORITY = NONE`. Not settlement authority. May remain client-writable as a legacy/display/TEST inject field. Must not feed `canUseServerAuthoritativeSettlement`.

## 7. Save `player.money` role

Guest: local authority.  
Signed-in today: live ROAD economy (not yet a cache).  
After a future ROAD-canonical migration: cache/mirror only. `SAVE_GAME_VERSION` stays 6; field is not removed.

## 8. `serverState.cash` role

Admin-only writes. Safe from stale save LWW. Used by marketplace + backend reward claims. **Cannot** become HUD authority until every ROAD credit/debit is server-validated or queued with server-derived amounts.

## 9. Migration / version

`CASH_AUTHORITY_VERSION_UNMIGRATED = 0`.  
`CASH_AUTHORITY_VERSION_SERVER_STATE_V1 = 1` is defined but **not assigned** by the client or any callable in this step.

Client cannot mark itself migrated.

## 10. Bootstrap

| Case | Policy |
| --- | --- |
| A. Brand-new account | `buildDefaultServerState` cash = `SERVER_DEFAULT_CASH` (20000) for marketplace/serverState. HUD still starts from save/starter money. |
| B. Save exists, no serverState | Existing `migrateLegacyServerState` may one-time copy clamped save money into serverState for marketplace. **Not** treated as HUD authority switch. |
| C. Existing serverState.cash | Leave it. Do not reset to 20000. |
| D. TEST_MONEY_SYNC | Profile inject; must not become production overlay. |
| E. Guest → signed-in | `GUEST_TO_SIGNED_IN_CASH_MIGRATION_DEFERRED`. Do not push guest cash into server authority. |

Trusting arbitrary current client save as the new HUD authority after a switch is **rejected**.

## 11. Reconciliation

**Not enabled.** `AUTHORITATIVE_CASH_OVERLAY_ENABLED = false`.

Preferred future order (when ROAD is canonical): auth → load save → read serverState.cash → overlay mirror → block autosave from treating stale blob cash as authority.

## 12. Listener

**Not enabled.** `AUTHORITATIVE_CASH_LISTENER_ENABLED = false`. Do not reuse TEST_MONEY_SYNC as production. Two competing listeners must not exist when v1 rolls out.

## 13–14. Stale-save protection

`serverState.cash` cannot be written by the client today (low or high stale save cannot change it).  
HUD/save cash **can** still be LWW-reverted. Overlay that would make HUD follow server is **off**, so stale-save HUD tests that expect server HUD values are **not claimed**.

Simulation helper `simulateAuthoritativeCashWins` documents intended future behavior; with overlay off, displayed stays save money and server stays server.

## 15. Cloud LWW separation (future)

Save gameplay: LWW. Signed-in cash: server. Not in effect for HUD.

## 16–17. ROAD / expense compatibility

ROAD revenue, penalties, fuel, purchases remain local. Turning overlay on without migrating **credits and debits** would undo both. That is why this step is BLOCKED, not PASS.

## 18. Offline policy (explicit)

`SIGNED_IN_OFFLINE_CASH_POLICY = SIGNED_IN_ROAD_LOCAL_CASH_MUTATIONS_REMAIN_ALLOWED_UNTIL_CANONICAL_ROAD_ECONOMY`

Signed-in ROAD offline settlement **continues**. A future server-cash HUD would likely require online (or queued canonical ROAD ops) for cash-mutating actions; that UX change is **not** taken here.

## 19. TEST_MONEY_SYNC

Opt-in env only. Listens to **profile** money. Isolated. Must not override a future serverState HUD authority.

## 20. Failure mode (future migrated accounts)

Fail closed for money-changing actions if server cash cannot be fetched. Not activated.

## 21. Two-device

Today: LWW save can diverge HUD cash; marketplace cash converges on `serverState.cash`. Future: both devices overlay server cash; stale save uploads must not write server cash (already true).

## 22. Guest → signed-in

Deferred. No double payout.

## 23. Canonical multimodal readiness

Acceptance/completion (29C) unchanged: no cash at accept/complete.  
`canUseServerAuthoritativeSettlement()` is **false** (`ROAD_ECONOMY_NOT_SERVER_CANONICAL_PRODUCTION_FLEET`).  
No `settleCanonicalMultimodalShipment`. Step 29K ROAD shadow settlement does not apply to RAIL.

## 24. Remaining settlement work

Step 29AD adds an INTERNAL game-hour clock for ROAD offer expiry. Step 29AE uses that clock for the free manual refresh cooldown. Neither path moves cash. Step 29AF adds server-owned company progression and ROAD reputation for new canonical accounts; it writes no cash either. Step 29AG adds canonical driver assignment, an accept-time risk snapshot, and server-derived completion XP (INTERNAL); none of it moves cash. Step 29AH grants company XP inside the existing canonical purchase, hire, warehouse and cargo-sale transactions, with no extra cash transaction. Step 29AI grants mission, milestone and weekly XP from server-derived progress. It moves no cash except the unchanged 29W cash of `own_2_trucks` and `ms_second_truck`. Overlay still blocked (`SIGNED_IN_CASH_AUTHORITY_BLOCKED_MULTIPLE_PATHS`, 24 / 0 / 24). See `MAP_V2_CONTRACT_REFRESH_GAME_TIME_PARITY.md` and `MAP_V2_CANONICAL_COMPANY_PROGRESSION_AUTHORITY.md`.

Minimum **before** HUD overlay:

1. Canonicalize remaining `BLOCKS_HUD_AUTHORITY` paths. Fuel is INTERNAL_TEST only; public progressive consume + roadside remain.  
2. Warehouse and cargo INTERNAL_TEST only; public market/HUD unwired.  
3. Daily opex overdraft parity is INTERNAL-only. Production clock and legacy state remain. Reward attestation remains.  
4. Production incident parity remains a separate blocker for canonical ROAD settlement.  
5. Then overlay + listener (`cashAuthorityVersion=1`).  
6. Then `settleCanonicalMultimodalShipment`.

Diagnostics on `canUseServerAuthoritativeSettlement`: `ROAD_CASH_PATHS_NOT_FULLY_CANONICAL`, `FUEL_NOT_CANONICAL`, `CATALOG_PURCHASE_NOT_CANONICAL`, `WAREHOUSE_NOT_CANONICAL`, `CARGO_MARKET_NOT_CANONICAL`, `REWARD_PATH_NOT_CANONICAL`. Gate remains **false**.

## 25. Public rollout

`MULTIMODAL_OFF`. Public RAIL is not ready.

---

## Client cash mutation API

`applyCashTransaction` in `cashPolicy.ts` — local only. Kinds: income, voluntary-expense, mandatory-expense. **Not** a server delta API.

## Server cash mutation API

Operation-specific callables only (marketplace, weekly missions, seasons, challenges). No arbitrary client amount.

## Step 29E

Canonical ROAD cash **operations foundation** is documented in `MAP_V2_CANONICAL_ROAD_CASH_OPERATIONS.md`. Overlay/listener remain off. Account cash authority migration version remains **0**.



Step 29AJ/29AK: legacy progression migration is internal only. Apply uses a create-only frozen source (`MAP_V2_LEGACY_SAVE_AUTHORITY_HARDENING.md`). Public rollout remains blocked. Cash authority, ROAD settlement, and RAIL/SEA/AIR are unchanged.


Step 29AL: internal immediate progression cutover reads the save and creates the frozen source plus migration in one transaction (`MAP_V2_LEGACY_PROGRESSION_IMMEDIATE_CUTOVER.md`). Public rollout remains blocked by `PUBLIC_PROGRESSION_UI_SPLIT_BRAIN`. Cash authority and ROAD settlement are unchanged.

Step 29AM: progression read authority does not change cash. HUD cash, `cashAuthorityVersion`, and `canUseServerAuthoritativeSettlement` stay as they are (`MAP_V2_CANONICAL_PROGRESSION_READ_AUTHORITY.md`).

Step 29AN: progression eligibility does not change cash (`MAP_V2_CANONICAL_PROGRESSION_ELIGIBILITY_AUTHORITY.md`).

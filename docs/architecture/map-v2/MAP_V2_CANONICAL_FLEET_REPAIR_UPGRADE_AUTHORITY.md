# Map V2 — Canonical fleet repair / upgrade authority (Step 29N)

**Status:** `CANONICAL_FLEET_REPAIR_UPGRADE_AUTHORITY_PASS_INTERNAL_ONLY`

**Repair policy:** `canonical-fleet-repair-v1`  
**Upgrade policy:** `canonical-fleet-upgrade-v1`  
**Backend gate:** `CANONICAL_FLEET_MUTATIONS=INTERNAL_TEST`  
**Settlement readiness:** `ROAD_CANONICAL_SETTLEMENT_BLOCKED_PRODUCTION_INCIDENT_PARITY`

HUD overlay/listener **off**. `canUseServerAuthoritativeSettlement()` **false**. `SAVE_GAME_VERSION` **6**.  
Production `repairTruck` / `upgradeTruck` **unchanged**. No public UI wiring.

---

## 1. Why repair blocked the lifecycle

29M wears trusted assets. Without server repair, condition only falls. Local repair mutates save trucks and `player.money`, which must not be trusted for canonical assets.

## 2. Live repair audit

`repairTruck` (`gameStore.ts`):
- Blocked if `on_route` / `transferring`
- No-op if condition ≥ 100
- Cost: `calculateTruckRepairCost` then optional **ad maintenance discount** (canonical **ignores** discount)
- Target condition: **always 100** (no partial repair)
- Cash: `voluntary-expense` via `canAffordVoluntaryPurchase` (`money >= cost`) → cashAfter ≥ 0
- Ledger: `maintenance:{truckId}:{condition}:{currentTime}`

Formula (`delivery.ts`): if condition ≥ 100 → 0. Else `missing = 100 - condition`. If `maintenanceCost >= 5`: `missing * maintenanceCost`; else if `> 0`: `missing * 35`; else `missing * 40`. Then `max(100, round(...))`.

**Cash policy:** `REPAIR_SERVER_CASH_POLICY_MATCHED` — local voluntary repair already requires full funds; server floor 0 matches. (Mandatory ROAD penalties can use local −5000; repair does not.)

## 3. Live upgrade audit

Types: `engine`, `fuelEfficiency`, `cargo`, `durability`. Max level **3**. Independent stacking.

Price: `round(purchasePrice * typeMultiplier * (1 + currentLevel * 0.75))` with multipliers 0.08 / 0.07 / 0.09 / 0.06.

Effects: engine duration −1.5%/level; fuel −2%/level; cargo +0.5 t/level **and** `capacity *= 1.04` rounded to 0.1; durability wear −8%/level.

Blocked if leased or status ≠ idle. Ledger: `truck-upgrade:{truckId}:{type}:{cost}`.

Trailers: **no** production repair/upgrade.

## 4–16. Server operations

Callables `repairCanonicalFleetAsset` / `upgradeCanonicalFleetAsset` (gated INTERNAL_TEST). Request: ids + schema only.

Operation IDs = cash transaction IDs:
- `fleet:{assetId}:repair:{repairIntentId}`
- `fleet:{assetId}:upgrade:{upgradeType}:{upgradeIntentId}`

One transaction: derive → debit `CANONICAL_FLEET_REPAIR` / `CANONICAL_FLEET_UPGRADE` → asset mutation → revision+1 → fleet mutation receipt.

Reservation: `ASSET_RESERVED_BY_ACTIVE_DELIVERY`. Condition 100 → `REPAIR_NOT_NEEDED` (no revision). Max upgrade → `UPGRADE_MAX_LEVEL`. Insufficient cash: no mutation.

Local save/HUD/financeLedger not written. Canonical vs save may diverge.

## Remaining blockers

Production incident parity, other ROAD cash paths, legacy fleet. Production settlement stays local.

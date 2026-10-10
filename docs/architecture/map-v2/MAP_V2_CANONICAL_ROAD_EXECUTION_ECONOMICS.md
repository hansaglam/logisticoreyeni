# Map V2 — Canonical ROAD execution economics snapshot (Step 29H)

**Status:** `CANONICAL_ROAD_EXECUTION_ECONOMICS_PASS_INTERNAL_TRUCK_POLICY_ONLY`

**Truck authority:** `TRUCK_ECONOMICS_SERVER_AUTHORITY_MISSING` (live save fleet)

**Trailer authority:** `TRAILER_ECONOMICS_SERVER_AUTHORITY_MISSING` (live save trailers)

**Driver:** `DRIVER_NOT_SETTLEMENT_RELEVANT`

**Settlement readiness:** `ROAD_CANONICAL_SETTLEMENT_BLOCKED_PRODUCTION_FLEET_MIGRATION` (updated in Step 29J).

HUD overlay/listener off. `canUseServerAuthoritativeSettlement()` false. `SAVE_GAME_VERSION` **6**.  
`MULTIMODAL_OFF`. RAIL/SEA/AIR `FOUNDATION_ONLY`.  
`canUseServerAuthoritativeSettlement()` remains false. **No cash movement.**

This is **not** signed-in ROAD settlement activation and **not** public anti-cheat.

---

## 1. Why Step 29G was not settlement-ready

29G issued server-owned contract economics (route, cargo, payment, deadline, toll, planning settlement bundle). Live `createDelivery` recomputes the start bundle from the **selected truck/trailer** via `calculateContractEconomics`. Planning uses no truck (estimate maintenance per km, condition 100). Truck-true start costs diverge. That was `ROAD_CANONICAL_SETTLEMENT_BLOCKED_TRUCK_ECONOMICS`.

---

## 2. StartDelivery economics audit

Live path: `startDelivery` → `createDelivery` → `calculateContractEconomics`.

| Value entering `Delivery` | Class |
| --- | --- |
| contract payment, deadline, amount, product, origin/dest, distance, urgency | A contract-frozen (canonical if issued) |
| truck condition, `maintenanceCost` $/km, capacity, speed, class, catalog, upgrades (fuel/duration) | B truck-derived |
| trailer type + capacity bonus (trailer $/km if attached) | C trailer-derived |
| driver speed/tier (duration), fuelSaving (fuel liters) | D driver-derived — **not** completion cash |
| route distance, difficulty, `tollCost` | E route-derived |
| cargo amount (weight multipliers), perishability (late formula), contractType (trailer rate / fragile) | F cargo-derived |
| delivery id sequence | G RNG — not money |
| `currentTime` start, `startedRealAtMs` | H time-derived — progress, not completion formula inputs except reported hours |
| world events maintenance multiplier | I world-state — empty on canonical freeze |
| late/failure/fragile at `completeDeliveryById` / `failDeliveryById` | J completion-calculated |

`delivery.maintenanceCost` at start = `maintenance + trailer + toll + other` (not fuel).  
Fuel is stored on the delivery and **not** deducted again at completion (`fuelAlreadyPaid: true`).

---

## 3. Settlement-affecting input list

| FIELD | SOURCE | WHEN | SERVER VERIFY? | SERVER REPRODUCE? | MUST FREEZE? | MONEY? | UI only? | Rep/XP only? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| payment | canonical contract | issue | yes | yes | already | yes (gross) | no | no |
| deadlineHours | canonical contract | issue | yes | yes | already | via late | no | mixed |
| perishability | product catalog | issue | yes | yes | already | late | no | no |
| toll | `routes.ts` | issue/accept | yes | yes | yes | in start bundle | no | no |
| maintenance + other | truck + route + amount | accept | fixture only | fixture only | yes | yes | no | no |
| trailer $ | trailer fixture + type | accept | fixture only | fixture only | if trailer | yes | no | no |
| fuel $ | truck + route | start | n/a completion | n/a | policy only | prepaid, not completion | preview | no |
| driver wage | roster | periodic | n/a | n/a | no | **not** completion | allocated | no |
| actualTravelHours | client report | complete | bounds only | no | no | late | no | late flag |
| outcome COMPLETED/FAILED | client report | complete | enum + idempotency | no | no | fail vs complete | no | yes |
| fragile +5% | type + condition | complete live / freeze canonical | fixture start condition | fixture | if fragile | yes | no | no |
| incident cash | local incident sim | during | no | no | no | **separate ledger** | no | condition/rep |
| failure penalty | `payment*0.25+500` | fail | derive amount | yes if status trusted | no amount from client | yes | no | no |
| late penalty | payment, deadline, hours, perishability | complete | derive | hours not trusted | no amount from client | yes | no | no |
| lease / ownership / tank | truck | start readiness | no | no | no | not completion | readiness | no |

No unknown completion-cash input remains for the **supported INTERNAL_TEST fixture** path.

---

## 4. Truck economic fields

Affect start bundle / completion cash: `condition`, `maintenanceCost` ($/km).  
Affect prepaid fuel / duration (not completion cash): `fuelConsumptionPerKm`, `upgrades.fuelEfficiency`, `upgrades.engine`, capacity/speed/class.  
Not frozen for money: display name, lease, current fuel, ownership, city.  
Frozen anyway on fixture profile: `truckId`, condition, upgrades (so later settlement cannot take client upgrades).

---

## 5. Trailer economic fields

`type` changes trailer $/km (`0.025` attached standard; refrigerated/bulk rates exist but canonical issuance is standard).  
Capacity bonus affects duration, not the maintenance dollar formula directly.  
Readiness/compatibility is not frozen beyond fixture id + type + bonus.  
Live trailer condition is **not** in the start bundle.

---

## 6. Driver relevance

`DRIVER_NOT_SETTLEMENT_RELEVANT`. Allocated driver cost is informational. `completeDeliveryById` does not charge salary. Optional `selectedDriverId` is stored as an identifier only.

---

## 7. Maintenance policy

**Model A (fixtures):** server looks up `fixture-healthy` | `fixture-degraded` | `fixture-upgraded` and runs the same `calculateContractEconomics` as `createDelivery` (empty events, fuel `1.72` unless overridden).  
**Model C forbidden:** client `maintenanceCost` rejected.  
Live save trucks are **not** accepted as authority.

Policy version: `road-start-maintenance-v1`.

---

## 8–9. Toll / fuel

Toll = `Math.round(route.tollCost)` from the canonical route. Client cannot override.  
Fuel at completion = `0`. `fuelSettlementMode = PREPAID_OR_EXECUTION_CONSUMED`. Start-time fuel cash (if any) is a **separate** future authority problem.

---

## 10. Fragile surcharge

Live: if `contractType === 'fragile'` **and** truck condition **at completion** `< recommendedTruckCondition` (default 70), add `Math.round(payment * 0.05)` into the penalty used by `calculateDeliverySettlement`.

Canonical INTERNAL_TEST: freeze **start** condition + type (`road-fragile-surcharge-v1`). Issued 29G contracts are **standard** → surcharge `0`. Fragile vectors use explicit freeze type. Live can diverge if condition drops mid-trip — remaining public gap, not used on standard issued jobs.

---

## 11. Incident cash

Incidents write **separate** ledger ids, not `delivery:{id}:completion-expenses`. Completion settlement does not include incident cash. Public incident authority remains blocked for those writes.

---

## 12–14. Timing, late, failure

`actualTravelHours` is client-reported. Server checks finite, `>= 0`, `<= max(deadline*3, 168)`.  
No authoritative game-speed clock — **do not** use wall-clock `now - acceptedAt`.  
Late: `calculateLatePenalty` then `Math.round(raw * penaltyMultiplier)` (`road-late-penalty-v1`).  
Failure: `Math.round(payment * 0.25 + 500)` (`road-failure-penalty-v1`). Client penalty numbers rejected.  
Failure **status** is still client-reported.

Bands: `EARLY` (≤85% deadline), `ON_TIME` (≤ deadline), `LATE_MINOR` (≤1.5×), `LATE_MAJOR` (>1.5×), `FAILED`. Reputation thresholds are separate.

---

## 15–16. Snapshot schema / immutability

Nested on `users/{uid}/canonicalRoadDeliveries/{deliveryId}` as `executionEconomicsSnapshot`. No extra collection.

Includes: schema/policy versions, truck/trailer/route profiles, maintenance/toll/fuel/fragile snapshots, accepted travel basis, `createdAtMs`.

After accept, a second accept with a different fixture is **idempotent** on the existing snapshot (cannot rewrite economics). Local truck condition changes later do not apply.

---

## 17. Completion report trust

Allowed: `deliveryId`, `outcome`, `actualTravelHours`, `canonicalSchemaVersion`.  
Rejected: gross, maintenance, toll, fuel, penalties, fragile, net.  
Same report: idempotent. Different outcome or hours: `COMPLETION_CONFLICT`.  
Cancel: no `cancelDeliveryById` cash found — zero-economy.

---

## 18. Shadow parity

`prepareCanonicalRoadDeliverySettlement` uses the frozen bundle when present (else 29F planning fallback).  
`computeLiveParityRoadCompletion` mirrors `createDelivery` + `completeDeliveryById` / `failDeliveryById` math. Integer equality required. Mismatch codes are component-specific. Local `completeDeliveryById` still wins for the player.

---

## 19. Internal truck policy

Fixtures: `fixture-healthy` (starter condition 88), `fixture-degraded` (35), `fixture-upgraded` (condition 100, lower $/km + max upgrades), trailer `fixture-standard`. Default accept truck = `fixture-healthy`.  
**Not public-ready.** Live `ownedTrucks` / save blob / marketplace inventory are not trusted here.

---

## 20–22. Public gaps, offline, next

Public fleet condition/upgrades: save-owned.  
Timing / outcome: client.  
Fragile live uses completion condition.  
Incidents: separate cash.  
Offline canonical ROAD: still `ONLINE_ACCEPTANCE_REQUIRED`. Legacy jobs: `LEGACY_LOCAL_ONLY_DELIVERY`.

**Next:** STEP 29I — settlement shadow / server cash activation **prep**. Do not apply `serverState.cash` in 29H. Do not enable HUD.

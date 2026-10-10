# Map V2 — Canonical ROAD incident / fragile / failure authority (Step 29O)

**Status:** `CANONICAL_ROAD_INCIDENT_FRAGILE_FAILURE_AUTHORITY_PASS_INTERNAL_POLICY_ONLY`

**Incident policy:** `canonical-road-incident-v1`  
**Fragile policy:** `canonical-road-fragile-v1`  
**Failure policy:** `canonical-road-failure-v1`  
**RNG model:** `MODEL_B_SERVER_ISSUED_PLAN_AT_ACCEPT`  
**Backend gate:** `CANONICAL_ROAD_EXECUTION_AUTHORITY=INTERNAL_TEST`  
**Settlement readiness:** `ROAD_CANONICAL_SETTLEMENT_BLOCKED_PRODUCTION_INCIDENT_PARITY`

HUD overlay/listener **off**. Production `completeDeliveryById` / incident modal **unchanged**. 29K shadow remains INTERNAL_TEST.

---

## 1. Incident audit

Live incidents are **player-choice catalog events** (`incidentCatalog.ts` + `maybeRollDeliveryIncident`). They are **not** the same as live-tick `breakdown` / `accident` (`Math.random` in `gameStore` game loop). Offline catch-up does not roll new catalog incidents.

Catalog types (26): `roadwork`, `loading_queue`, `cargo_recheck`, `weather_slowdown`, `checkpoint`, `local_operation`, `unexpected_cost`, `staff_motivation`, `clear_traffic`, `fast_loading`, `discount_fuel`, `favorable_weather`, `driver_shortcut`, `market_opportunity`, `traffic`, `driver_break`, `tire_pressure`, `fuel_deviation`, `warehouse_issue`, `customer_request`, `weather_front`, `insurance_penalty`, `emergency_delivery`, `company_reputation`, `truck_failure`, `severe_weather`, `cargo_risk`.

**Trigger:** on_route/preparing, progress in [0.08, 0.9], travelHours ≥ 1.25, completedContracts ≥ 1, slot fire `hashStringToUnit(seed:roll)` vs `getSlotFireChance`. Seed includes `delivery.id`, `contractId`, `floor(startedAt/24)`, rollIndex.

**RNG:** FNV-style `hashStringToUnit` (deterministic given seed) **plus** live `randomBetween` for breakdown/accident. Client clock / local fleet weights (`getTypeSelectionWeight`) feed type pick. **Client execution cannot be production-canonical.**

**Trailer / cargo condition fields:** not mutated by catalog effects. `CARGO_CONDITION_AFFECTING = NOT_PRESENT`.  
**Catalog auto-fail:** `FAILURE_TRIGGERING = NOT_PRESENT`.

**Authority today:** local save. Server cannot replay production variety without client progress/RNG/player state.

## 2. Incident categories (by resolved catalog **choice** effects)

| Category | Example type / choice |
| --- | --- |
| TIME_ONLY | `loading_queue` / `wait_queue` |
| CASH_ONLY | `unexpected_cost` / `pay_fee` |
| CONDITION_ONLY | `cargo_recheck` / `continue` |
| CONDITION_AND_CASH | `tire_pressure` / `check` |
| NON_ECONOMIC | `fast_loading` / `double_check` |
| FAILURE_TRIGGERING | NOT_PRESENT |
| CARGO_CONDITION_AFFECTING | NOT_PRESENT |

Fuel liters / XP / reputation exist on some choices; INTERNAL canonicalization applies **cash + truck condition only**. Fuel tank and reputation remain local production.

## 3–7. Canonical incident model

INTERNAL_TEST **Model B**: at accept, if `CANONICAL_ROAD_EXECUTION_AUTHORITY=INTERNAL_TEST`, freeze `incidentPlan` (`incidentSeed = canonical-road-incident-v1:{uid}:{deliveryId}`, one event, type+choice from seed hashes over a **fixed internal type pool**, not production weights). Client cannot supply seed, type, or choice.

Gate off (default): empty plan, `incidentConditionAuthority=NONE`. 29M incident-free path unchanged.

`PRODUCTION_INCIDENT_PARITY_BLOCKED_CLIENT_EXECUTION_STATE` — live UI still rolls locally.

## 8. Timing / delay

29I INTERNAL_FIXED_SPEED wall-clock is settlement travel time. Catalog `deliveryTimeDeltaHours` is recorded on execution events as diagnostic only. **Not** added into `derivedActualTravelHours` (would double-count vs production ETA mutation). Production delay mutates `travelHours` locally.

## 9–10. Condition vs base wear

Production order: incident deltas apply **during** the trip to live truck.condition; `completeDelivery` reads that condition for **fragile**; then subtracts **precomputed** `conditionLoss` (from start-of-job truck, not current condition). Failed: `conditionLoss * 0.5`.

Canonical INTERNAL order:

1. freeze start condition at accept  
2. finalize: apply catalog condition deltas (once)  
3. `completionTruckCondition` = post-incident, pre-wear  
4. report completion / too_late class  
5. base wear (full) or failed wear (half) from frozen snapshot formula  
6. repair if needed  

Not commutative with clamps; incident then wear.

## 11. Incident cash

`getOperationChoiceNetCashDelta` = `cashDelta - fuelCostDelta`. Canonical integer `Math.round`.  
Txn type `CANONICAL_ROAD_INCIDENT`.  
ID `delivery:{deliveryId}:incident:{eventId}` (eventId `i0`).  
Not merged into completion-expenses. Production ledger uses `buildOperationResolutionId` as transactionId and reference `delivery:{id}:incident`.

Voluntary vs income follows sign. Server floor 0; insufficient cash → finalize fails, no damage.

## 12–18. Failure

| Source | Trigger | Authority | Penalty | Wear | Reservation |
| --- | --- | --- | --- | --- | --- |
| too_late | actualHours > deadline×2 (29I clock) | SERVER_DERIVED_FAILURE | `round(payment*0.25+500)` | half base | held until wear |
| breakdown / accident | `randomBetween` live ticks | CLIENT_REPORTED_UNVERIFIED | local only | none canonical | released, no trusted econ |
| client FAILED report | report outcome | CLIENT_REPORTED_UNVERIFIED | none canonical | none | released |
| cancel | cancel callable | MANUAL_CANCEL_NOT_FAILURE | none | none | released |
| fuel out | pause | not FAILED | — | — | — |
| capacity_exceeded | start | not in-flight | — | — | — |

Unverified FAILED: `derivedSettlement=null`, wear `NOT_ELIGIBLE`, `FAILED_AUTHORITY_UNRESOLVED`. Avoids client-forged wear/penalty while unlocking the truck.

## 19–22. Fragile

Production (`completeDeliveryById`): **truck.condition at complete, before `completeDelivery` wear**, vs `recommendedTruckCondition` default 70. Type `fragile` → extra **expense** `round(payment * 0.05)` added to penaltyCost (not bonus revenue).

Canonical uses `completionTruckCondition` when set, else frozen start (incident-free equivalent). Issuance remains **standard-type only**, so live INTERNAL jobs rarely hit fragile; derivation is ready. 29K allows fragile only if `completionTruckCondition` is present.

## 23–28. Events

Stored on the delivery doc (`executionEvents[]`), not a new collection. Immutable after finalize. Retry/two-device: same seed, `alreadyApplied`. Conflicting mutation receipt → `CANONICAL_FLEET_MUTATION_CONFLICT`.

Fleet receipt type `ROAD_INCIDENT_DAMAGE` when condition changes. One revision per damaging event (INTERNAL max one event).

## 29–35. Settlement / 29K

`prepareCanonicalRoadDeliverySettlement` consumes completion condition for fragile. Incident cash is **already** applied at finalize — preview does not include it.

29K INTERNAL shadow: still standard successful jobs; **plus** SERVER_DERIVED too_late if classified; fragile if completion condition frozen. Production settlement not enabled.

## 36–42. Repair / cancel / incident-free

29N repair uses post-wear canonical condition. Upgrades untouched. Cancel ≠ fail. Empty plan + 29M wear still valid.

## Remaining

Live production incident variety, player choice, driver scaling, breakdown RNG, HUD cash, fuel, marketplace, legacy fleet.

**Next:** STEP 29P — remaining ROAD cash paths **or** production incident parity (not both in one step).

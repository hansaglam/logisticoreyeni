# Map V2 — Canonical fleet condition / delivery-wear authority (Step 29M)

**Status:** `CANONICAL_FLEET_CONDITION_WEAR_AUTHORITY_PASS_SUCCESS_ONLY`

**Wear policy:** `canonical-road-delivery-wear-v1`  
**Settlement readiness:** `ROAD_CANONICAL_SETTLEMENT_BLOCKED_PRODUCTION_INCIDENT_PARITY`

HUD overlay/listener **off**. `canUseServerAuthoritativeSettlement()` **false**. `SAVE_GAME_VERSION` **6**.  
`MULTIMODAL_OFF`. RAIL/SEA/AIR `FOUNDATION_ONLY`. Wear **does not move cash**.

---

## 1. Why condition mutation blocked production canonical fleet

29L can mint `SERVER_CANONICAL` `cfa_*` assets. Accept freezes `economicCondition` / `economicRevision` into `executionEconomicsSnapshot`. Live `completeDelivery` then wears the **save** truck. The canonical doc stayed at revision 1, so the next canonical job would freeze stale economics.

## 2. Live condition mutation audit

| OPERATION | ENTITY | FUNCTION | INPUTS | FORMULA | WHEN | SERVER DERIVABLE? | IDEMPOTENT ID? | CASH? | STATUS |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Delivery complete wear | truck | `completeDelivery` + `calculateConditionLoss` | route, cargo, truck, driver.attention | `clamp(rawLoss, 1, maxLoss)` then `clamp(cond-loss, 0, 100)` | on complete | yes (driver frozen 100) | delivery id | no | **29M persist** |
| Delivery fail wear | truck | `failDelivery` | `conditionLoss * 0.5` | half of precomputed loss | on fail | no (failure client-reported) | delivery id | penalty separate | **blocked** |
| Cancel | truck | status only | — | no condition change | cancel | n/a | — | no | **release reservation, no wear** |
| Incident | truck | `truckConditionDelta` | catalog + choice | add delta, clamp 0–100 | during job | no | incident id local | sometimes | **INCIDENT_WEAR_AUTHORITY_MISSING** |
| Repair | truck | `repairTruck` | local condition | set 100; cost from gap | player | cost yes, not wired | maintenance txn | local cash | **no free repair** |
| Upgrade | truck | `upgradeTruck` | local levels | durability reduces wear | player | price yes, not wired | upgrade id | local cash | **no free upgrade** |
| Catalog buy / lease / recover | truck | template.condition | catalog | copy template | acquire | mint helper 29L | purchase id | local | not wear |
| Marketplace listing | truck | save snapshot | seller save | copy | list | identity only | listing | fee | economics untrusted |
| Trailer normalize | trailer | `trailerOps` | stored condition | clamp 0–100 | load | n/a | — | no | **no ROAD wear** |

## 3. Delivery wear formula (production)

`src/simulation/delivery.ts` `calculateConditionLoss`:

`rawLoss = baseConditionWear(1.2) * (distanceKm/500) * (1 + loadRatio*0.35) * route.difficulty * (1 + ((100-attention)/100)*0.25) * (1 - durabilityLevel*0.08)`

`loadRatio = cargoWeight / capacity`. Cap: `maxNormalConditionLoss` 18, or 20 if `loadRatio >= 0.85` or `route.difficulty >= 0.85`. Floor on raw loss: **1**. Applied: `clamp(condition - loss, 0, 100)` with **no integer round** (`src/utils/math.ts` `clamp`).

Incident damage is **separate** (`truckConditionDelta`). 29M persist is **BASE_DELIVERY_WEAR only**.

## 4–8. Trusted inputs / driver / success / fail / incident

Trusted: canonical route, cargo amount, frozen execution snapshot (capacity, durability upgrades), server asset condition/revision at accept, `STARTER_DRIVER.attention = 100`.

Untrusted: client wear/condition, live save truck, live driver attention, incident deltas, FAILED outcome.

Driver: production uses real `driver.attention` with **0.25** in `calculateConditionLoss` (the 0.35 helper is unused there). Canonical path: `CANONICAL_DELIVERY_WEAR_INTERNAL_DRIVER_POLICY_ONLY`.

Success COMPLETED, incident `NONE`: wear applied. FAILED: `FAILED_DELIVERY_WEAR_AUTHORITY_UNRESOLVED` (reservation released, no wear). Incident `UNRESOLVED`: no wear.

## 9–12. Trailer / bounds / IDs / receipts

Trailer condition is **not** changed by ROAD complete. `TRAILER_CONDITION_NOT_MUTATED_ON_ROAD_DELIVERY`.

Bounds 0–100, float clamp.

Operation id: `fleet:{assetId}:delivery-wear:{canonicalDeliveryId}`.

Receipts: `users/{uid}/canonicalFleetMutationReceipts/{operationId}` — client write false.

## 13–20. Exactly-once, revision, reservation, transaction

First wear: condition, revision+1, receipt, release reservation, mark delivery `wearApplicationState=APPLIED`. Duplicate: same receipt. Conflicting planted receipt vs asset state: `CANONICAL_FLEET_MUTATION_CONFLICT`.

Wear requires asset revision/condition to match frozen snapshot.

Accept records `activeCanonicalRoadDeliveryId` on the truck asset. Second accept of the same asset while reserved → `ASSET_RESERVED_BY_OTHER_DELIVERY`. Release on wear, cancel (ACCEPTED only), or FAILED report.

Wear is a **separate** transaction from 29K cash shadow. Settlement uses frozen start snapshot; wear does not rewrite it.

## 21–26. Local divergence, repair, upgrade, incident

Local `player.trucks[].condition` is **not** overwritten from canonical. Internal tests may diverge. Repair/upgrade remain pure intents — **no free mutation**. Incident remains missing.

## Step 29AG driver attention

Deliveries accepted with a valid `canonicalDriverSnapshot` (gate `CANONICAL_ROAD_DRIVER_RISK_AUTHORITY=INTERNAL_TEST`) use the frozen catalog driver attention in `calculateConditionLoss`. Their receipts carry policy `canonical-road-delivery-wear-v2` and `wearDriverAttention`. Deliveries without a snapshot keep `canonical-road-delivery-wear-v1` with attention 100. Existing receipts are not rewritten. Readiness: `CANONICAL_WEAR_DRIVER_ATTENTION_INTERNAL_SNAPSHOT_V2_ONLY`.

## Remaining blockers

Repair (dominant), upgrade cash, incident wear, fragile/failure, legacy fleet, other ROAD cash paths. Production ROAD settlement stays local.

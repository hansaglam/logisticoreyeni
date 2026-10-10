# Map V2 — Canonical fuel tank / price authority (Step 29Q)

**Status:** `CANONICAL_FUEL_TANK_PRICE_AUTHORITY_PASS_INTERNAL_ONLY`  
**Fuel HUD status:** `FUEL_CASH_AUTHORITY_INTERNAL_TEST_PROGRESSIVE_PUBLIC_BLOCKED`  
**Signed-in cash:** `SIGNED_IN_CASH_AUTHORITY_BLOCKED_MULTIPLE_PATHS` (24 / 0 / 24)

INTERNAL_TEST only. Public `refuelTruck` / roadside sheets unchanged. No HUD overlay.

---

## 1. Live fuel architecture

| OPERATION | FUNCTION | STATE | PRICE | LITERS | CASH | TANK | ROUNDING | OFFLINE | SERVER TODAY | 29Q |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Garage refuel | `refuelTruck` + `calculateTruckRefuelQuote` | save `currentFuelL` | `resolveFuelPriceQuote` (global snapshot) | UI 25/50/100 or max affordable | `player.money` | increase | liters 3dp; cost `toFixed(2)` | local if quote cached | none | INTERNAL `purchaseCanonicalFuel` |
| Roadside | `validateRoadsideFuelPurchase` | save + paused job | quote × 1.2 + $75 fee | remaining-route / custom | local | increase + resume | same + fee | local | none | `ROADSIDE_FUEL_AUTHORITY_BLOCKED_LOCAL_PURCHASE` |
| Delivery consume | `advanceFuelConstrainedProgress` | job + truck | n/a | proportional to progress | none at burn | decrease | 3dp | catch-up local | none | INTERNAL accept-burn (not progressive) |
| Start check | `getTruckFuelReadiness` | save tank | snapshot | `economics.fuelLiters` | none | none | round 0.1 L economics | local | none | `CANONICAL_FUEL_INSUFFICIENT` on canonical accept |
| Incident tank | `fuelLitersDelta` | save | n/a | catalog liters | separate `fuelCostDelta` is **cash** | ± liters | round | local | INTERNAL cash only | `FUEL_AUTHORITY_BLOCKED_INCIDENT_FUEL_DELTA` |
| Recovery | `resolveVehicleStateIssue` | save | n/a | emergency liters | recovery cash | may add fuel | local | local | none | later |

Completion settlement does **not** charge fuel (`PREPAID_OR_EXECUTION_CONSUMED`, `completionFuelCharge=0`).

## 2–6. Tank / capacity / initial / revision / legacy

Capacity: `getDefaultFuelTankCapacityL(capacity tons)` — 120 / 180 / 400 / 520. Not client.

Initial `currentFuelL`: `round(capacity * getDefaultFuelFillRatio(assetId))` (65–95%), matching `normalizeTruckFuel` when save fuel is missing.

Schema on `canonicalFleetAssets` (trucks): `fuelStateSchemaVersion`, `currentFuelL`, `fuelCapacityL`, `fuelRevision`, `fuelPolicyVersion` (`canonical-fuel-state-v1`). **`fuelRevision` is independent of `economicRevision`.**

Legacy save trucks: `LEGACY_CLIENT_UNVERIFIED`. No `syncFuelFromSave`.

## 7–11. Price

`globalEconomy/current.fuelPricePerLiter` is server-written (client write false). Production HUD uses the same field via snapshot, plus city-unrelated sanitize ($0.5–$5). Roadside multiplier is **not** applied to garage purchase.

Policy `canonical-fuel-price-v1`. Purchase re-reads server price (or INTERNAL fallback `1.72`). Receipt freezes `pricePerLiter`. Client quote is not authority.

## 12–21. Purchase

Callable `purchaseCanonicalFuel` (gate `CANONICAL_FUEL_AUTHORITY=INTERNAL_TEST`).

Request: `assetId`, `fuelPurchaseIntentId`, `mode` (`FILL_TO_CAPACITY` | `BUY_LITERS`), optional `requestedLiters`, `canonicalSchemaVersion`.

Forbidden: currentFuelL, capacity, price, cost, cashDelta, …

Cost: `Math.round(Number((liters * price).toFixed(2)))` integer USD for `serverState.cash`.

Id: `fuel:{assetId}:{intentId}`. Receipts: `canonicalFuelReceipts` (write false).

Full tank: `FUEL_PURCHASE_NOT_NEEDED` (no debit). Insufficient cash: reject, tank unchanged. No partial fill.

## 22–23. Roadside

Requires paused `out-of-fuel` job. Blocked.

## 24–31. Consumption

Production is **progressive**. Canonical ROAD has no tick loop.

INTERNAL model: **burn `calculateContractEconomics.fuelLiters` at canonical accept** (`fuel:{assetId}:delivery:{deliveryId}`), no cash. Cancel/fail does **not** refund (matches “no invented refund”; diverges from mid-route leftover). Gate off → accept unchanged.

## 32–34. Incident / recovery

`fuelCostDelta` = cash. `fuelLitersDelta` = tank, not applied on canonical tank. Recovery may add emergency liters locally — not canonicalized.

## 35–46. Quote / race / concurrency

Pure `quoteCanonicalFuelPurchase`. Purchase uses live server price. Transactions re-read tank/cash. Cloud save must not write canonical assets (rules already deny).

## 47–52. Coverage

Fuel remains **BLOCKS_HUD_AUTHORITY** because public progressive consume + roadside + HUD cash are not switched. Counts unchanged: 24 / 0 / 24.

## Next

**STEP 29R — CORE VEHICLE / STAFF CASH AUTHORITY** (lease / hire / fire / sale / recovery) or warehouse/world depending on product priority. Fuel still blocks HUD until public consume + overlay.

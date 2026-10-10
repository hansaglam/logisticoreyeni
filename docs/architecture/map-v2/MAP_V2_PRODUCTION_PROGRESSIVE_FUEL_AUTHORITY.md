# Map V2 — Production progressive fuel authority (Step 29X)

**Status:** `PRODUCTION_PROGRESSIVE_FUEL_AUTHORITY_PASS_INTERNAL_ONLY`

**Readiness:** `FUEL_PROGRESSIVE_INTERNAL_ONLY`

**Public blocker:** `FUEL_PROGRESSIVE_BLOCKED_PUBLIC_REFUEL`

Gate `CANONICAL_PROGRESSIVE_FUEL_AUTHORITY=INTERNAL_TEST` (missing = OFF). Public ROAD, garage refuel, and roadside UI stay local. HUD coverage stays **24 / 0 / 24**.

This step does not treat Step 29I fixed-speed timing as production parity.

## Production formula

`updateDeliveryProgressWithFuel` turns game hours into a progress delta (`hours / travelHours`) and calls `advanceFuelConstrainedProgress`.

Consumed liters for a progress point are `fuelLitersTotal * progress`, rounded to 0.001 L by `roundFuelValue`. `fuelLitersTotal` is `calculateContractEconomics.fuelLiters`, which is canonical distance fuel (`L/km × load × route × driver`) rounded to 0.1 L.

Load multiplier is `1 + (cargo / capacity) × 0.25`. Route multiplier is `1 + difficulty × 0.45`. Driver multiplier is `clamp(1 - fuelSaving / 100, 0.35, 1)`. Fuel-efficiency upgrades scale L/km. Trailer changes duration and trailer cash, not liters. Condition changes maintenance and duration, not liters. Game speed changes `getMsPerGameHour` buckets (15000 / 7500 / 1000 ms), not liters per kilometre. The same completed route burns the same liters at 1× and 8×.

Accept requires `currentFuel >= fuelLiters`. The trip is not burned at accept. A tank can still hit zero mid-route if liters are removed later. Out-of-fuel pauses the job. Manual `isPaused` stops `advanceTime`. Offline and background catch-up use the device clock and last speed, then the same progressive burn, capped at 24 game hours.

Cancel keeps liters already burned. Completion does not charge fuel cash again.

## Canonical model

When the progressive gate is on, accept still requires a full-trip tank and writes `progressiveFuel` on the delivery. It does not write an accept-burn receipt. With the gate off, Step 29Q accept-burn is unchanged.

`advanceCanonicalRoadExecution` sends only `deliveryId` and `canonicalSchemaVersion`. The server closes the open segment at `Date.now`, maps elapsed wall time through `realMsToGameHours` at the stored speed, then applies one cumulative production fuel step from progress 0. Repeated ticks and one large tick land on the same liters.

Speed and manual pause are separate requests. The server settles the previous segment first, then timestamps the new one. Out-of-fuel pause is server-derived. An empty tank cannot be unpaused.

Burn updates `fuelRevision` and `progressRevision`. It does not write `serverState.cash` or a cash transaction.

## What is not production-ready

Offline and background still use the device baseline. Canonical advance runs only when called. Driver `fuelSaving` is not on the canonical roster, so INTERNAL liters match the existing null-driver economics. Incident `discount_fuel` still has `fuelLitersDelta: 28` and is not applied to the canonical tank. Roadside purchase, surcharge, and ad help stay local: `ROADSIDE_FUEL_AUTHORITY_BLOCKED_LOCAL_PURCHASE`. Legacy trucks are not imported. Public refuel stays on `player.money`.

## Step 29AG driver fuel saving

`CANONICAL_DRIVER_FUEL_SAVING_ABSENT` is resolved for new INTERNAL deliveries accepted with `CANONICAL_ROAD_DRIVER_RISK_AUTHORITY=INTERNAL_TEST`. The frozen catalog `fuelSaving` of the canonical driver feeds `calculateContractEconomics` liters, the 29Q accept-burn requirement, and progressive `fuelLitersTotal`. The audit row is now `CANONICAL_DRIVER_FUEL_SAVING_INTERNAL_SNAPSHOT_ONLY`. Deliveries without a driver snapshot keep null-driver liters. Out-of-fuel keeps the driver assigned, as in production. Public fuel stays `FUEL_PROGRESSIVE_BLOCKED_PUBLIC_REFUEL`.

## Next

**STEP 29Y — PRODUCTION ROAD TIMING AND OFFLINE EXECUTION AUTHORITY.** Large server gaps now use the production 24-game-hour cap when the execution-timing policy is stamped. Public fuel stays blocked by local refuel, roadside purchase, and legacy tanks. Manual pause during a real offline catch-up still differs from production.

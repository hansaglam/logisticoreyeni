# Map V2 — Production ROAD timing and offline execution (Step 29Y)

**Status:** `PRODUCTION_ROAD_TIMING_OFFLINE_EXECUTION_AUTHORITY_PASS_INTERNAL_ONLY`

**Timing readiness:** `ROAD_TIMING_INTERNAL_ONLY`

**Offline readiness:** `PRODUCTION_OFFLINE_TIMING_BLOCKED_APP_STATE_AUTHORITY`

Gate `CANONICAL_ROAD_TIMING_AUTHORITY=INTERNAL_TEST` (missing = OFF). This is separate from the Step 29I client flag `EXPO_PUBLIC_CANONICAL_ROAD_TIMING`. Public ROAD stays on the local game clock. HUD coverage stays **24 / 0 / 24**.

## Production clocks

Online ROAD progress comes from `useGameLoop` calling `advanceTime` every 1000 ms while the app is active and `isPaused` is false. `setGameSpeed` clamps 0.25–8. `getMsPerGameHour` is not linear:

| Speed | Milliseconds per game hour |
| --- | --- |
| below 1.5 | 15000 |
| 1.5 up to but not including 6 | 7500 |
| 6 through 8 | 1000 |

One account `gameSpeed` drives every active delivery. Manual pause stops the online loop. Offline catch-up sets `offlineProgressionActive`, and `advanceTime` then ignores `isPaused`. Catch-up uses the device baseline, last speed, a 24-real-hour window, then a 24-game-hour cap. The cursor moves to now, so the same absence is not applied twice.

Driver speed and tier change travel duration. Trailer type changes duration. Condition and engine upgrades are frozen at accept because a reserved asset cannot be upgraded. Incident `deliveryTimeDeltaHours` still is not added to canonical hours.

Daily opex, market ticks, and offer expiry are different clocks and are unchanged.

## Canonical model

New INTERNAL deliveries accepted with both the progressive-fuel gate and this timing gate stamp `canonical-road-execution-timing-internal-v1` on the delivery fuel/progress state. That state is the only clock for progress, fuel, and deadline hours.

`advanceCanonicalRoadExecution` still takes only `deliveryId` and `canonicalSchemaVersion`. Elapsed time is server now minus `lastProgressedAtServerMs`. A manual pause adds zero game hours and still moves the cursor. A gap inside the production caps converts with `realMsToGameHours`. A larger gap grants at most 24 game hours, then the cursor jumps to server now. The next call cannot reclaim that cap.

When progress reaches 1, `completedAtServerMs` is the segment start plus the real milliseconds for the remaining game hours at the active bucket. It is not the call time if the interval was longer than the route. Deadline bands use `classifyDeliveryPunctuality`. Too-late remains `actualTravelHours > deadlineHours * 2`.

Step 29I snapshots (`canonical-road-timing-internal-fixed-v1`) stay on the delivery and are used only when the new policy is absent. They are not reinterpreted.

Fuel burn uses the same game-hour total. An empty tank stops the route, sets `OUT_OF_FUEL`, and discards the rest of that interval. A later refuel does not replay it.

Timing calls do not write cash.

## Public limits

Production offline still progresses while the game is paused, because catch-up bypasses `isPaused`. Canonical manual pause always adds zero hours. Matching that split would require a trusted foreground/background signal. A voluntary client app-state ping can be omitted, so it is not used. Multiple production deliveries share one global speed; canonical speed remains per delivery. Driver duration is not production-parity. Public refuel and roadside fuel stay local, so fuel remains `FUEL_PROGRESSIVE_BLOCKED_PUBLIC_REFUEL`.

## Step 29AG driver timing

Driver timing status: `PRODUCTION_TIMING_DRIVER_AUTHORITY_INTERNAL_SNAPSHOT_ONLY`. When `CANONICAL_ROAD_DRIVER_RISK_AUTHORITY=INTERNAL_TEST`, accept passes the frozen canonical driver's speed and tier to `calculateContractEconomics`. `acceptedTravelBasis.expectedDurationHours`, and therefore `plannedTravelGameHours`, now include the production driver duration effect. The driver blocker is removed only for that INTERNAL path. Deliveries without a driver snapshot keep null-driver duration. Multi-delivery global speed, incident delay and public wiring stay blocked. See `MAP_V2_CANONICAL_DELIVERY_RISK_DRIVER_AUTHORITY.md`.

## Next

**STEP 29Z — PRODUCTION MARKET TICK AUTHORITY.** Incident delay, driver timing, multi-delivery speed, and public wiring stay separate blockers.

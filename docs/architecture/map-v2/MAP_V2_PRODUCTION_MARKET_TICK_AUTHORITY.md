# Map V2 — Production market tick authority (Step 29Z)

**Status:** `PRODUCTION_MARKET_TICK_AUTHORITY_PASS_INTERNAL_ONLY`

**Ownership:** `GLOBAL_SHARED_MARKET`

**Road contracts:** `ROAD_CONTRACT_MARKET_STATE_INTERNAL_ONLY`

**Public market:** `PUBLIC_MARKET_NOT_READY`

**Gate:** `CANONICAL_PRODUCTION_MARKET_TICK_AUTHORITY=INTERNAL_TEST` (missing = OFF). The Step 29U cargo gate stays separate and still defaults OFF.

This step owns an INTERNAL dynamic clock for canonical city/product rows that have been stamped with `canonical-production-market-tick-internal-v1`. It does not wire the public cargo screen, HUD overlay, cash listener, or production ROAD settlement.

## 1. Production market clock

Live play does not run `updateCityProductEconomy`. `runEconomyTick` only calls `refreshMarketSnapshot`, which reads `globalEconomy/current`. That document is written by `runGlobalEconomyEpoch`. The epoch is `floor(serverNowMs / 30 minutes)`.

`updateCityProductEconomy` still exists and uses `Math.random` via `createRandomFactor`. The game loop does not call it. It is not the production tick.

## 2. Market ownership model

`GLOBAL_SHARED_MARKET`.

`globalEconomy/current` is one world snapshot. `canonicalWorldMarkets/{cityId}_{productId}` is the same shape: one row per city and product, not per user. Save `city.products` is a per-player cache. This step does not import that cache and does not treat it as canonical stock.

## 3. Tick cadence

One global epoch every 30 real minutes (`MARKET_TICK_INTERVAL_MS`). Not the ROAD execution clock. Not the 24-game-hour opex clock. Not per city and not per product: one epoch index, applied independently to each stamped row.

## 4. Tick clock authority

`advanceCanonicalProductionMarketInternal` uses `Date.now()` on the server. The body may contain only `canonicalSchemaVersion`. `tickCount`, `elapsedMs`, `deviceNow`, `periodIndex`, price, stock, surplus, shortage, event multiplier, and seed are rejected.

## 5. Stock evolution

The live snapshot does not add `productionPerDay - consumptionPerDay` onto yesterday’s stock. Each epoch regenerates supply:

`round(targetStock * (0.65 + seededUnit * 0.8))`, then `max(0, …)`.

Demand is `round((consumptionPerDay or targetStock * 0.08) * (0.8 + nextUnit * 0.5) * eventMultiplier)`, minimum 1.

Canonical **tradable** stock is the Step 29U stock mutated by buy and sell. A tick does not replace it. Epoch supply and demand are stored as `supplyIndex`, `demandIndex`, `epochSupply`, and `epochDemand`.

## 6. Production / consumption

Catalog fields on `CITIES` (`productionPerDay`, `consumptionPerDay`, `targetStock`, `basePrice`). Not client-sent.

## 7. Stock floor / cap

Epoch supply is clamped at 0. There is no extra maximum. Tradable stock is not given a new cap. Buy still cannot drive tradable stock below 0.

## 8. Price formula

`basePrice * (1 + slowWave + productWave + jitter) * eventMultiplier`, then clamp to `[basePrice * 0.4, basePrice * 2.5]`.

Waves are `sin` of the epoch mixed with a city or product hash. Jitter is the first sample of the market seed. This is `buildGlobalEconomySnapshot`, the same function the client uses for the global snapshot.

## 9. Price rounding

The epoch price is not rounded to cents. `clampPrice` is the only bound. Buy and sell totals stay `Math.round` of the 3% fee formulas. That fee is not part of the market price.

## 10. Surplus / shortage

Epoch classification, from supply / targetStock:

- shortage: ratio `< 0.7`
- surplus: ratio `> 1.2`
- balanced (neutral): otherwise, including 0.7 and 1.2

Contract surplus is a different function: `max(0, tradableStock - targetStock)` and `max(0, targetStock - tradableStock)`, with a 20-ton generation floor in `contracts.ts`. The tick stores the epoch status. It does not pretend that status is the contract-ton surplus.

## 11. RNG

`createMarketSeededRng` with seed `logisticore-global-market-v2|{configVersion}|{epoch}|{city}|{product}`. The client cannot choose it.

## 12. Global economy

Product price does not read a client `globalEconomy` multiplier. Fuel price on the tick manifest is the snapshot’s `fuelPricePerLiter` for that epoch (`ECONOMY_CONFIG_VERSION` 1).

## 13. World events

Model A. `buildGlobalEventsForEpoch` is a pure function of epoch and config. A 24-epoch cycle may open a 6-epoch `fuel_crisis` (fuel × 1.12) or `city_demand_boom` (product demand × 1.08). Same tick id, same events. Local `worldEvents.ts` used by contract generation is a different source and is not trusted here.

## 14. Offline / catch-up

The worker publishes the current epoch. Missed epochs are not replayed as additive stock days. A canonical advance applies the current epoch once. Jumping from epoch 10 to epoch 40 ends on the epoch-40 quote. Applying 11, then 12, then 40 ends on the same price and the same tradable stock, because price and epoch supply depend only on the epoch.

## 15. Tick identity

`marketTick:{epoch}`.

## 16. Tick manifest

`canonicalMarketTicks/{tickId}`: tick id, policy, time, status, expected dynamic row count, applied count, seed, config version, fuel price, event ids, authority mode. A replay of a finished epoch does not rewrite that manifest.

## 17. Partial failure recovery

Rows are updated one by one under `lastAppliedTickIndex`. A crash after 20 of 56 leaves those 20 stamped. Retry plans only the rest. The manifest stays incomplete until every stamped row carries that epoch. There is no single 56-document transaction.

## 18. Per-record idempotency

`lastAppliedTickIndex === epoch` skips the row. `marketRevision` does not increase again.

## 19. Trade concurrency

The tick update does not write `stock`. Buy and sell re-read `currentPrice` and `stock` inside their own transaction. A tick cannot restore stock that a buy already removed. A stale quote cannot set the buy price.

## 20. Market revision

Trades and successful ticks each add 1. Revision is not the tick count.

## 21. Old 29U compatibility

Rows with `authorityMode` `INTERNAL_TEST_FIXED_MARKET_SNAPSHOT` and no `tickPolicyVersion` are skipped. Stamp is explicit (`stampCanonicalProductionMarketTickPolicyTransaction`) and does not copy a save. Unknown tick policies fail closed.

## 22. Public migration limitations

Public prices and stock are still the save. The public screen is not pointed at `canonicalWorldMarkets`. Epoch supply and tradable stock are different numbers. That split is not a public migration.

## 23. Contract issuance impact

An INTERNAL stamped market can supply epoch price, epoch supply/demand, epoch status, event ids, and tradable stock. `generateContracts` is not wired to those fields.

## 24. Remaining contract blockers

`ROAD_CONTRACT_ISSUANCE_REMAINING_BLOCKERS`:

- save city stock is still the generator input
- contract world events come from the local event module
- player level, fleet, and drivers
- `randomBetween` amounts
- public market UI is unwired

## 25. Cash coverage impact

A tick writes no `serverState.cash`, no `canonicalCashTransactions`, and no `users/{uid}.money`. Coverage stays **24 / 0 / 24**. Readiness stays `SIGNED_IN_CASH_AUTHORITY_BLOCKED_MULTIPLE_PATHS`.

## 26. Remaining blockers

Public market wiring, save-city migration, contract generator parity, local contract events, and HUD cash authority.

## 27. Next step

**STEP 29AC — FLEET LOCATION AUTHORITY.** Step 29AB owns contract-template events on a separate real-day schedule. The 30-minute epoch events are still not contract payment or duration modifiers. Do not wire the public contract screen.

## Public criteria

Passed internally: shared ownership matches the live snapshot, cadence is the 30-minute epoch, server clock replaces the client, epoch price and supply match `buildGlobalEconomySnapshot`, RNG is the snapshot seed, events are the epoch schedule, catch-up is jump-to-current, buy/sell read the same row.

Blocked for public: save cities still diverge from tradable canonical stock, public UI is local, contract generation is not on this clock, and the unused `Math.random` city loop is not the live formula. Do not mark `PUBLIC_AUTHORITY_READY`.

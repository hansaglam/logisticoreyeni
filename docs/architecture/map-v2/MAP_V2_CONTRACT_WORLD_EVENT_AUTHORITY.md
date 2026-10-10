# Map V2 — Contract world-event authority (Step 29AB)

**Status:** `CONTRACT_WORLD_EVENT_AUTHORITY_PASS_INTERNAL_ONLY`

**Diagnostic:** `CONTRACT_WORLD_EVENT_INTERNAL_ONLY`

**Event policy:** `canonical-road-contract-world-event-internal-v1`

**Issuance policy when a snapshot is applied:** `canonical-road-contract-issuance-internal-production-parity-v2`

**29AA policy kept:** `canonical-road-contract-issuance-internal-production-parity-v1` (event multiplier 1, not reinterpreted)

**Gates:** issuance `CANONICAL_ROAD_CONTRACT_ISSUANCE_AUTHORITY=INTERNAL_TEST` and events `CANONICAL_CONTRACT_WORLD_EVENT_AUTHORITY=INTERNAL_TEST`. Either missing stays OFF. Event gate OFF keeps the v1 empty-event path.

**Issuance readiness:** `ROAD_CONTRACT_ISSUANCE_BLOCKED_PUBLIC_PROGRESSION`

Public Contracts UI is unchanged. Production ROAD settlement stays off. Step 29Z market events are not contract events.

## 1. Production contract event system

Contract modifiers are the templates in `src/data/worldEvents.ts`, applied by `src/simulation/worldEvents.ts`.

`generateWorldEventsForDay` / `processWorldEventsForDayRange` build that schedule. The game store imports the range helper and does not call it. After a market sync the store assigns `worldEvents: snapshot.activeEvents`. Those snapshot events are the Step 29Z epoch pair (`fuel_crisis`, `city_demand_boom`) and do not carry `contractPaymentMultiplier` or `deliveryDurationMultiplier`.

`buildContractRefreshParams` still passes `getActiveWorldEvents(state.worldEvents, gameDayFromTime(state.currentTime))` into `generateContracts`. On the live path, after sync, that list is the epoch list, so the production applicator returns payment ×1 and duration ×1.

`forceGenerateWorldEvent` is dev-only.

## 2. Event catalog

Ten templates. No new events. Policy on every row: `canonical-road-contract-world-event-internal-v1`.

| Event | Scope | Payment | Duration | Other contract effect | Cities / products | Duration days | Weight |
| --- | --- | --- | --- | --- | --- | --- | --- |
| fuel_crisis | global | none | none | fuel price 1.15–1.35 (viability) | — | 1–3 | 6 |
| industrial_support | city_product | none | none | price 0.9–0.96, spawn 1.1–1.15 | ankara, bursa × steel, machinery | 2–4 | 10 |
| harvest_surplus | city_product | none | none | price 0.82–0.92 | antalya × fruit | 1–3 | 10 |
| electronics_boom | product | none | none | price 1.12–1.28 | electronics | 1–2 | 9 |
| port_congestion | city | 1.05–1.15 | 1.1–1.25 | none | istanbul, izmir | 1–3 | 8 |
| road_work | city | none | 1.1–1.2 | none | istanbul, ankara, izmir, bursa, antalya | 1–2 | 12 |
| cold_chain_demand | product | 1.1–1.25 | none | spawn 1.1–1.2 | fruit, beverage | 2–3 | 8 |
| maintenance_campaign | global | none | none | maintenance 0.75–0.9 | — | 2–3 | 10 |
| city_demand_boom | city | none | none | price 1.08–1.18, spawn 1.05–1.12 | five cities | 1–3 | 9 |
| city_supply_shortage | city | none | none | price 1.1–1.22 | five cities | 1–2 | 7 |

Only `port_congestion`, `road_work`, and `cold_chain_demand` change contract payment or deadline. Spawn, fuel, price, and maintenance still go into `generateContracts` because production passes the same active list into scoring and `calculateContractEconomics`.

## 3. Ownership

`GLOBAL_CONTRACT_EVENT`.

The seed key is the event policy version. It does not include a user id. Two devices reading `canonicalRoadContractEvents/current` see one schedule. The public save still stores its own `worldEvents` array; that array is not imported.

## 4. Clock

`CONTRACT_EVENT_CLOCK_INTERNAL_REAL_DAY`.

Day index is `max(1, floor(serverNowMs / 86400000))`. That is a real-day index, not game hours, not the 30-minute market epoch, and not `gameDayFromTime`.

Production's unused generator stamps `startsAt` from `getEconomyNow()` unless a caller passes `nowMs`. Canonical calls pass server time. The live refresh path's activity check uses game day plus `getEconomyNow()` when `startsAt` exists. Those clocks are not unified here.

At the time of this step, offer expiry was still the 3-real-hour issuance window and refresh was a separate blocker. Steps 29AD and 29AE later moved INTERNAL expiry and refresh onto the account game clock. This event schedule is still a real-day clock.

## 5. Lifecycle

- Start: first observation of a real day replays missed days, then generates that day.
- Duration: `round(pickRange(durationDays))` real days. `endsAt = nowMs + durationDays * 24h`.
- End: `nowMs >= startsAt && nowMs <= endsAt` (both ends inclusive). Without wall-clock stamps, production falls back to an inclusive game-day range. Canonical events always have stamps.
- Overlap: up to 4 active events. Up to 2 new events per day (`floor(random * 3)`, so a day can add zero).
- Restart: the Firestore doc is the schedule. Same day returns the stored list and does not reroll. Mid-day expiry is not re-checked after the day's snapshot is stored.
- Offline: days after `lastGeneratedDay` are replayed. Past days use that day's start as `nowMs`. The current day uses `serverNowMs`.

## 6. RNG

Production event rolls use `createSeededRandom(hashSeed("global-market:${seedKey}:${currentDay}:spawn"))`, not `Math.random`.

Canonical generation calls that function. The historical device sequence is not that schedule, because the store never calls it and instead copies epoch events. Classification: `PRODUCTION_CONTRACT_EVENT_RNG_SERVER_CANONICAL_DIFFERENT_SEQUENCE`.

The 29AA offer seed stays `v1-policy|uid|windowIndex|marketEpoch`. Event state is not part of the seed. A changed event list would change offers, so the list is frozen on the batch instead of being mixed into the seed.

## 7. Repeat rules

While an event is active, the same conflict key `type:city|global:product|all` cannot spawn again. After it expires, the same template can spawn again. There is no extra cooldown counter and no separate anti-repeat history.

## 8. Scope

Payment and duration: a city filter matches origin or destination; an empty city matches every city. A product filter must equal the contract product; an empty product matches every product. Global events match every contract.

Spawn weight uses a stricter rule: the event must name a city or a product. Global events do not add spawn weight.

The server evaluates scope. The client cannot send an "event applies" flag.

## 9. Payment

Order inside `generateContractForProduct`:

1. `calculateContractPayment`
2. contract-type multiplier, already `Math.round`ed
3. `paymentMultiplier` from `applyWorldEventImpactToContract`
4. `Math.round`
5. `min(absolutePaymentMax, …)`

The event multiplier is applied to the typed payment, then rounded again. It is not applied to the unrounded base and then left unrounded.

## 10. Duration

1. `calculateDeadlineHours` (already clamped)
2. type adjustment, which may clamp again
3. multiply by `durationMultiplier`
4. clamp to `minDeadlineHours` / `maxDeadlineHours` (4 and 168)

## 11. Stacking

Matching events multiply, in array order. Multiplication is commutative. The product is then clamped to `[1, 1.25]` for both payment and duration. There is no strongest-only, first-match, or last-match rule. A product above 1.25 becomes 1.25. A value below 1 becomes 1.

## 12. Market events

Step 29Z `buildGlobalEventsForEpoch` stays the market schedule: 24-epoch cycle, fuel ×1.12 or demand ×1.08, no contract payment or duration fields. Issuance still stores those ids as `eventIdsAuditOnly`. They are not passed as `activeWorldEvents`.

## 13. Incidents

Step 29O delivery incidents are a different system. This step does not read or write them. Season and challenge reward claims are also not contract events.

## 14. Canonical state

Path: `canonicalRoadContractEvents/current`.

Client read and write are false. The doc holds the policy, day index, seed key, full event list, and active ids. Issuance copies the active list onto the batch as `contractEventSnapshot` before offer writes.

## 15. Batch and offer snapshots

One batch uses one snapshot. Slots do not re-read the live schedule.

Each offer stores `contractEventIds`, `contractEventPolicyVersion`, `contractEventSnapshotId`, `paymentEventMultiplier`, and `durationEventMultiplier`.

v1 offers omit the snapshot and keep multiplier 1. They are not recomputed when the event gate is later turned on. A completed batch short-circuits. A partial v2 batch keeps the original snapshot even if the global doc changes before the retry.

## 16. Idempotency

Same issuance window, same snapshot, same seed, same offers. A completed batch is not regenerated when the event day advances. Acceptance reads the stored offer payment and deadline. It does not read `canonicalRoadContractEvents`.

## 17. Integrity

Unknown event types, non-finite multipliers, non-positive payment or duration multipliers, and `startsAt > endsAt` fail closed with `CONTRACT_WORLD_EVENT_STATE_INVALID`. A stored day index ahead of server time fails with `CONTRACT_EVENT_CLOCK_REGRESSION`. There is no silent ×1 for a corrupt active event.

## 18. Cash

The event doc and the offer batch do not write `serverState.cash`, `users.money`, or `canonicalCashTransactions`. Coverage stays 24 / 0 / 24.

## 19. Public migration

Do not copy the device's current `worldEvents` into the canonical doc. A later public switch needs a clean boundary: new batches use the server schedule, old local offers stay local. The public store continues to assign epoch events onto `worldEvents`.

## 20. Remaining issuance blockers

- `PLAYER_PROGRESSION_NOT_PUBLIC` (current readiness)
- `CONTRACT_EXPIRY_CLOCK_INTERNAL_ONLY`
- `CONTRACT_HOME_CITY_WEIGHT_NOT_A_SEPARATE_SCORE`
- `REPUTATION_NOT_PUBLIC`
- `LEGACY_FLEET_UNVERIFIED`
- `PUBLIC_CONTRACTS_UI_UNWIRED`
- `CONTRACT_EVENT_SCHEDULE_INTERNAL_REAL_DAY` (this schedule is forward authority, not the live game-day clock)

`canUseServerAuthoritativeSettlement` stays false. HUD overlay and the cash listener stay off. `cashAuthorityVersion` stays 0.

## 21. Next step

**STEP 29AF — PUBLIC PROGRESSION AUTHORITY.** INTERNAL refresh now uses the account game clock. Do not wire the public Contracts screen.

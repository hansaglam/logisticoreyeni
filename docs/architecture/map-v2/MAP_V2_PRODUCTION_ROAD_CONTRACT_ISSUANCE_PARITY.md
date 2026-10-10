# Map V2 — Production ROAD contract issuance parity (Step 29AA)

**Status:** `PRODUCTION_ROAD_CONTRACT_ISSUANCE_PARITY_PASS_INTERNAL_ONLY`

**Readiness:** `ROAD_CONTRACT_ISSUANCE_BLOCKED_PUBLIC_PROGRESSION` (set in Step 29AE, kept by 29AF, 29AG, 29AH and 29AI: public progression is not migrated, non-delivery operation XP and client reward XP are INTERNAL canonical only, and rewards with unsupported progress stay client-owned)

**Policy:** `canonical-road-contract-issuance-internal-production-parity-v1`

**Gate:** `CANONICAL_ROAD_CONTRACT_ISSUANCE_AUTHORITY=INTERNAL_TEST` (missing = OFF). Step 29G `canonical-road-contract-issuance-internal-v1` stays a separate simplified policy.

Public Contracts UI is unchanged. Production ROAD settlement stays off.

## 1. Production generator

`generateContracts` → `generateContractsCore` in `src/simulation/contracts.ts`.

Live calls:

- new game: `createInitialGameState`
- replenish: `replenishContractsIfNeeded` → `applyContractReplenishment`
- manual: `refreshContractsFromMarket`, cooldown `manualRefreshCooldownHours` = 3 game hours, free, and it does reroll after the cooldown because `Math.random` runs again

Automatic generation uses `contractBalance.maxContractsPerTick` = 10. Manual refresh adds at most `manualRefreshMaxContracts` = 3 and does not replace still-valid offers. The canonical initial batch still uses the 10 cap. A canonical manual refresh uses the 3 cap.

## 2. Dependencies

| Input | Source | Use | RNG | Server today | Canonical substitute | Blocker |
| --- | --- | --- | --- | --- | --- | --- |
| City stock | After snapshot sync, `materializeSnapshotCities` sets `stock` from epoch **supply** | `calculateSurplus` / `calculateShortage`, floor 20 tons | no | epoch snapshot | `epochSupply` on canonical rows | tradable buy/sell stock is a different ledger |
| Price | snapshot `cityMarketPrices` | 8% destination premium, urgency | no | epoch quote | row `currentPrice` | none for stamped rows |
| World events | local `worldEvents.ts` templates | payment, duration, spawn, fuel, price, maintenance | seeded template roll | live store copies epoch events instead | v1 passes `[]` (×1). v2 uses the server template schedule | fleet location is now the readiness blocker; event clock is still INTERNAL real day |
| Player level | save `player.level` | tier, tonnage, required level, type weights | tier roll | `SERVER_CANONICAL_PROGRESSION` doc for new canonical accounts (29AF) | `canonicalCompanyProgression.level`, derived from server XP | delivery XP server-derived for INTERNAL canonical drivers (29AG); truck/hire/warehouse/zero-decay cargo XP server-derived INTERNAL (29AH); mission/milestone/weekly XP server-derived INTERNAL where progress is verifiable (29AI); unsupported-progress rewards and decaying-trade XP client-owned; public progression |
| Reputation | save | type weights, high-reputation contracts | no | same doc, mutated by canonical completion/cancel/server failure (29AF) | required field, no silent 0 | public reputation sources still local |
| Fleet capacity | owned / idle truck tons | tonnage cap | capacity profile roll | canonical truck `capacity` | max canonical truck | location/idle unknown |
| Drivers | not read by the generator | `requiredDriverLevel` is frozen later from the type | no | n/a at generation | not an input | assignment still separate |
| Home city | idle-origin weights | score bonus only | no | not server-owned | weights omitted | scoring parity |
| Route | `routes.ts` | distance, difficulty, toll via economics | no | registry | same module | none |
| Amount | surplus, shortage, level range, capacity | `randomBetween` then tenth-ton round | yes | seeded `Math.random` | server seed | sequence differs from device RNG |
| Payment | `calculateContractPayment` then type and event multipliers | integer cap | type multiplier seed | production helpers | v1 event × 1; v2 production applicator on the frozen snapshot | public UI |
| Deadline | `calculateDeadlineHours` then type and event | clamp to balance min/max | expiry lifetime | same | game-hour `expiresAt` frozen; accept uses server window end | game clock |
| Fuel | `globalEconomy.fuelPrice` | trip cost inside payment viability | no | epoch fuel quote | frozen on the batch inputs | none |

No unknown rows. Company score, cash, and warehouse value are not generator inputs.

## 3. Market binding

Surplus and shortage use epoch supply tons against catalog `targetStock`:

`max(0, epochSupply - targetStock)` and `max(0, targetStock - epochSupply)`.

That is the stock production puts on the city after a snapshot sync. The 0.7 / 1.2 supply **ratio** is not this test. Canonical buy/sell `stock` is not the generator input. A row without `epochSupply` contributes 0, so catalog start stock is not reused.

## 4. World events

29Z events are `fuel_crisis` (fuel × 1.12) and `city_demand_boom` (demand × 1.08). They stay audit-only (`eventIdsAuditOnly`).

Step 29AB did not treat them as contract modifiers. Contract payment and duration come from the `worldEvents.ts` templates, on a separate server schedule, and only when `CANONICAL_CONTRACT_WORLD_EVENT_AUTHORITY=INTERNAL_TEST`. That path writes issuance policy v2 and freezes the snapshot. Calls without a snapshot stay on v1 with multiplier 1. See `MAP_V2_CONTRACT_WORLD_EVENT_AUTHORITY.md`.

## 5. Player, reputation, fleet, driver, home city

Generation reads `users/{uid}/canonicalCompanyProgression/current` through `resolveCanonicalProgressionForIssuance` (Step 29AF). `SERVER_CANONICAL_PROGRESSION` is trusted. Missing, legacy, unknown-policy, and invalid docs fail closed. Pre-29AF fixture docs are accepted only while `CANONICAL_COMPANY_PROGRESSION_AUTHORITY` is OFF. The client cannot send level, XP, reputation, or score fields. See `MAP_V2_CANONICAL_COMPANY_PROGRESSION_AUTHORITY.md`.

Fleet input without a runtime snapshot is still max truck capacity (`CAPACITY_ONLY_LOCATION_UNVERIFIED`). Step 29AC adds an INTERNAL runtime document and idle-origin weights when `CANONICAL_FLEET_RUNTIME_LOCATION_AUTHORITY=INTERNAL_TEST`. Home city is not a separate score. See `MAP_V2_CANONICAL_FLEET_RUNTIME_LOCATION_AUTHORITY.md`.

Drivers are not a generation input. Fragile offers can still freeze `requiredDriverLevel` from the production type rules. Since Step 29AG, canonical accept rejects `requiredDriverLevel > 1` with `CANONICAL_DRIVER_LEVEL_AUTHORITY_UNAVAILABLE` (driver level is client-owned). The generator is unchanged. Public blockers `COMPANY_XP_DELIVERY_RISK_INTERNAL_CANONICAL_DRIVER_ONLY` and `COMPANY_XP_NON_DELIVERY_SOURCES_CLIENT_OWNED` replace `COMPANY_XP_DELIVERY_RISK_TIER_UNTRUSTED`. See `MAP_V2_CANONICAL_DELIVERY_RISK_DRIVER_AUTHORITY.md`. Step 29AH replaces `COMPANY_XP_NON_DELIVERY_SOURCES_CLIENT_OWNED` with `COMPANY_XP_NON_DELIVERY_OPERATIONS_INTERNAL_CANONICAL_ONLY` and `COMPANY_XP_CLIENT_REWARD_SOURCES_CLIENT_OWNED`. Readiness is unchanged (`MAP_V2_CANONICAL_NON_DELIVERY_COMPANY_XP_AUTHORITY.md`). Step 29AI replaces `COMPANY_XP_CLIENT_REWARD_SOURCES_CLIENT_OWNED` with `COMPANY_XP_CLIENT_REWARD_SOURCES_INTERNAL_PARTIAL` and `COMPANY_XP_UNSUPPORTED_REWARD_PROGRESS_CLIENT_OWNED`. Readiness is still unchanged (`MAP_V2_CANONICAL_CLIENT_REWARD_XP_AUTHORITY.md`).

## 6. RNG and windows

Seed: `policy|uid|windowIndex|marketEpoch`. `Math.random` is replaced only for the synchronous `generateContracts` call and then restored.

Window: 3 real hours, a separate clock from the 30-minute market epoch. It is not the 3 game-hour cooldown. Same window returns the same offers. A later window is a new seed. There is no paid refresh.

Offer id: `rcprod_{uid}_{window}_{slot}`. Slot index is stable, so a partial write retries the same slots.

## 7. Freeze

Payment, deadline, amount, product, type, urgency, distance, and game-hour `expiresAt` are copied off the production contract and not recomputed when the market, level, or fleet changes. Acceptance keeps using the stored contract. Server accept expiry is the window end (`expiresAtMs`), which is not production game time.

## 8. What stays blocked

Public progression and reputation are not migrated from the save. Legacy fleets and the public Contracts screen stay local. Game-time expiry and the 3-game-hour refresh exist for INTERNAL accounts. The contract-event schedule uses a real-day clock. Settlement stays off. Coverage stays 24 / 0 / 24.

## 9. Next step

**STEP 29AC — FLEET LOCATION AUTHORITY.** See `MAP_V2_CONTRACT_WORLD_EVENT_AUTHORITY.md`. Do not wire the public Contracts screen.


Step 29AJ/29AK: legacy progression migration is internal only. Apply uses a create-only frozen source (`MAP_V2_LEGACY_SAVE_AUTHORITY_HARDENING.md`). Public rollout remains blocked. Cash authority, ROAD settlement, and RAIL/SEA/AIR are unchanged.


Step 29AL: internal immediate progression cutover reads the save and creates the frozen source plus migration in one transaction (`MAP_V2_LEGACY_PROGRESSION_IMMEDIATE_CUTOVER.md`). Public rollout remains blocked by `PUBLIC_PROGRESSION_UI_SPLIT_BRAIN`. Cash authority and ROAD settlement are unchanged.

Step 29AM: the Contracts screen still uses the local player for eligibility. Canonical display elsewhere is internal-only (`MAP_V2_CANONICAL_PROGRESSION_READ_AUTHORITY.md`). Public issuance stays blocked. Cash authority and ROAD settlement are unchanged.

Step 29AN: contract eligibility stays `CONTRACTS_ELIGIBILITY_BLOCKED_LOCAL_CONTRACT_SOURCE` (`MAP_V2_CANONICAL_PROGRESSION_ELIGIBILITY_AUTHORITY.md`). Public issuance stays blocked.

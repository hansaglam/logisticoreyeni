# Map V2 — Contract refresh game-time parity (Step 29AE)

**Status:** `CONTRACT_REFRESH_GAME_TIME_PARITY_PASS_INTERNAL_ONLY`

**Refresh policy:** `canonical-road-contract-refresh-game-time-v1`

**Issuance policy when the refresh gate is on:** `canonical-road-contract-issuance-internal-production-parity-v5`

**Gate:** `CANONICAL_ROAD_CONTRACT_REFRESH_AUTHORITY=INTERNAL_TEST` (missing = OFF). Refresh also requires issuance and `CANONICAL_ROAD_CONTRACT_GAME_TIME_EXPIRY`. Event and fleet-runtime gates stay optional snapshots. A missing refresh gate leaves v1–v4 window issuance unchanged.

**Readiness:** `ROAD_CONTRACT_ISSUANCE_BLOCKED_PUBLIC_PROGRESSION`

## 1. Production refresh

`gameStore.refreshContractsFromMarket` is the player action. Cooldown field is `lastManualContractRefreshTime` (default 0). Unit is account game hours: `currentTime - lastManualContractRefreshTime`. Duration is `contractGenerationBalance.manualRefreshCooldownHours` = 3. The store blocks when `hoursSinceManual < 3`, so eligibility is `>= 3`.

The clock is the same account `currentTime` used for offer expiry. Pause stops it. Speed shortens the real time needed to reach 3 game hours. Unpaused offline catch-up advances `currentTime`, so it counts. Restart persists the field. Device time is not the clock.

A non-emergency refresh calls `refreshContractsFromMarket` in `src/simulation/contracts.ts`. That expires available offers whose `expiresAt` has passed and appends at most `manualRefreshMaxContracts` (3). It does not wipe still-valid offers and it does not cancel accepted deliveries. If the available pool is already at `maxAvailableContracts` (24), it adds nothing, but the store still stamps `lastManualContractRefreshTime`.

`contractBalance.maxContractsPerTick` (10) is the automatic generation cap, not the manual refresh cap.

Emergency and bootstrap paths can bypass the cooldown (`bypassCooldown` / empty playable pool) and still stamp the timestamp. Automatic replenishment is not this manual action.

The refresh is free. No cash debit.

`contract_refresh` rewarded ads set `contract_refresh_bypass` and can set `shouldRefreshContracts`. That bypass is not server-verified. Canonical classification: `REFRESH_AD_OVERRIDE_BLOCKED_VERIFICATION`. It is not implemented.

## 2. Expiry vs refresh

Offer expiry is each offer's `expiresAt` lifetime. Refresh cooldown is when a manual roll is allowed. An expired offer does not by itself satisfy the cooldown.

## 3. Shared clock

Refresh reads `users/{uid}/canonicalContractClock/current`. There is no second refresh clock. Pause, speed buckets, the 24-real-hour then 24-game-hour unpaused cap, and the paused-background limitation are the Step 29AD clock. Class remains `INTERNAL_ONLINE_PAUSE_STOPS_ACCRUAL_BACKGROUND_WHILE_PAUSED_NOT_PUBLIC`.

A server timestamp behind the cursor does not rewind hours. Client device time is not an input.

## 4. Refresh state

`users/{uid}/canonicalRoadContractRefresh/current`

Fields: `schemaVersion`, `policyVersion`, `refreshSequence`, `lastRefreshGameHours`, `lastBatchId`, `lastRefreshAtServerMs`, `authorityMode`.

Client write is false. Receipts live at `users/{uid}/canonicalRoadContractRefreshReceipts/{intentId}` and are also client write false.

The first canonical batch is sequence 0 and sets `lastRefreshGameHours` to the issued game hour. At a new clock that is 0, so a manual refresh is blocked until game hour 3. That matches a new production save whose `lastManualContractRefreshTime` and `currentTime` both start at 0.

## 5. Eligibility

The server advances the contract clock, then requires `currentGameHours - lastRefreshGameHours >= 3`. The client cannot send elapsed hours, last refresh, cooldown, sequence, seed, or `eligible`.

Below 3 returns `CONTRACT_REFRESH_COOLDOWN_ACTIVE` and may include remaining game hours. That rejection does not consume a sequence.

## 6. Refresh action

Callable `refreshCanonicalRoadContractBatchInternal`. Request keys are `canonicalSchemaVersion` and `refreshIntentId` only. The intent correlates a retry. It is not the sequence.

A new eligible intent increments `refreshSequence` by 1, freezes the current market epoch, contract-event snapshot, fleet runtime summary, and progression, and generates at most 3 new offers. Seed is `v5-policy|uid|refreshSequence|marketEpoch`. Batch id is `rcbatch_{uid}_r{sequence}`. Offer id is `rcprod_{uid}_r{sequence}_{slot}`.

The same intent returns the same batch. A second intent before the next 3 game hours is blocked. Two sequential eligible calls therefore produce one sequence increment.

A partial batch (crash after the manifest and some slots, modeled by the in-memory fake that keeps writes) retries the same intent, same sequence, same seed, and does not move `lastRefreshGameHours` again.

## 7. Old offers and accepted work

Still-valid available offers stay `AVAILABLE`. Production does not replace them, so canonical refresh does not mark them `SUPERSEDED`.

Available game-time offers with `expiresAtGameHours <=` the refresh hour become `EXPIRED`. Payment and deadline stay frozen.

`ACCEPTED` contracts are not updated. Active deliveries are not cancelled.

If an offer is already `SUPERSEDED`, acceptance returns `CONTRACT_SUPERSEDED`. The manual refresh path does not set that status.

## 8. v1–v4

Refresh gate OFF keeps window identity and policies v1–v4. v5 is only used when the refresh gate stamps a sequence. Old batches are not rewritten.

## 9. Cash and public surface

No `serverState.cash` write. No canonical cash transaction. Coverage stays 24 / 0 / 24. HUD overlay off. Cash listener off. `cashAuthorityVersion` 0. `canUseServerAuthoritativeSettlement` false. The public Contracts button still calls the local store.

## 10. Remaining blockers

Public Contracts UI, public progression, public reputation, legacy fleet, the contract-event real-day schedule, and the paused-background clock limitation. ROAD settlement stays off.

Dominant issuance blocker: `ROAD_CONTRACT_ISSUANCE_BLOCKED_PUBLIC_PROGRESSION`. The public Contracts screen is still local, and that stays a separate blocker. The server rejects a batch before UI wiring matters when `canonicalCompanyProgression/current` is missing.

## 11. Next step

Step 29AF (`CANONICAL_COMPANY_PROGRESSION_AUTHORITY_BLOCKED_XP_SOURCE`) added the server-owned progression doc, new-account initialization, and exact ROAD reputation mutations. A progression change leaves an existing batch frozen and does not bypass this cooldown; the next eligible refresh reads the new level and reputation. Completion XP is still blocked on an untrusted delivery risk tier, so readiness stays `ROAD_CONTRACT_ISSUANCE_BLOCKED_PUBLIC_PROGRESSION`. See `MAP_V2_CANONICAL_COMPANY_PROGRESSION_AUTHORITY.md`.

**Next: STEP 29AG — CANONICAL DELIVERY RISK-TIER / DRIVER ASSIGNMENT AUTHORITY.** Do not wire the public Contracts screen. Do not enable production ROAD settlement. Do not activate SEA or AIR.

Step 29AH (`CANONICAL_NON_DELIVERY_COMPANY_XP_AUTHORITY_PASS_PARTIAL`) adds exact XP from canonical truck purchase, driver hire, warehouse open/upgrade and zero-decay cargo sales. An XP grant does not unfreeze an existing batch and does not bypass the cooldown. The next eligible refresh reads the new level (tested: 100 XP from hire, open and two upgrades reaches level 2 at the next refresh). Catalog-purchased trucks still mint no `canonicalFleetRuntime` doc, so refresh with the runtime gate ON needs one (`FLEET_RUNTIME_LOCATION_UNAVAILABLE`). This gap predates 29AH. Readiness stays `ROAD_CONTRACT_ISSUANCE_BLOCKED_PUBLIC_PROGRESSION`. See `MAP_V2_CANONICAL_NON_DELIVERY_COMPANY_XP_AUTHORITY.md`.

Step 29AI (`CANONICAL_CLIENT_REWARD_XP_AUTHORITY_PASS_PARTIAL`) adds XP from canonical mission, milestone and weekly claims. The same rule applies: the existing batch keeps its frozen `playerLevel`, and the next eligible refresh reads the new level (tested: a 200 XP mission claim levels up and the next refresh uses it). The weekly objective cycle is a separate server clock (ISO week, UTC) and does not interact with the game-hour refresh clock. See `MAP_V2_CANONICAL_CLIENT_REWARD_XP_AUTHORITY.md`.

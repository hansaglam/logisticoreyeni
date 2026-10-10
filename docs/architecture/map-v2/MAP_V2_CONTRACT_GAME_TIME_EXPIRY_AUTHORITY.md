# Map V2 — Contract game-time expiry (Step 29AD)

**Status:** `CONTRACT_GAME_TIME_EXPIRY_AUTHORITY_PASS_INTERNAL_ONLY`

**Clock policy:** `canonical-road-contract-expiry-game-clock-internal-v1`

**Issuance policy when the expiry gate is on:** `canonical-road-contract-issuance-internal-production-parity-v4`

**Gate:** `CANONICAL_ROAD_CONTRACT_GAME_TIME_EXPIRY=INTERNAL_TEST` (missing = OFF). Issuance still requires `CANONICAL_ROAD_CONTRACT_ISSUANCE_AUTHORITY`.

**Readiness:** `ROAD_CONTRACT_ISSUANCE_BLOCKED_PUBLIC_PROGRESSION` (set in Step 29AE, unchanged by Step 29AF)

## 1. Production offer expiry

`Contract.expiresAt` is game hours on the account `currentTime`, not wall-clock milliseconds. `calculateContractExpiresAt(currentTime, deadlineHours, urgency)` adds a random lifetime:

- urgency ≥ 0.65: 6 to 10 game hours
- otherwise deadline ≥ 18: 18 to 30
- otherwise: 12 to 20

That lifetime is not the 3-game-hour manual refresh cooldown.

## 2. Offer expiry vs delivery deadline

`expiresAt` is how long the offer stays available. `deadlineHours` is the delivery limit after acceptance. They are different numbers.

## 3. Clock

`currentTime` advances from `useGameLoop` while the app is active and not paused. Each 1-second tick adds `realMsToGameHours(1000, gameSpeed)`.

Speed buckets are `getMsPerGameHour`: below 1.5 → 15000 ms, from 1.5 up to 6 → 7500 ms, 6 and above → 1000 ms. `setGameSpeed` clamps to 0.25–8.

## 4. Pause

`pauseGame` sets `isPaused`. The loop stops, and `advanceTime` returns immediately unless offline catch-up is running. A paused foreground session does not expire offers.

## 5. Offline and background

Leaving the app stops the loop. Returning runs offline catch-up: real elapsed is capped at 24 hours, then game hours are capped at 24. That catch-up calls `advanceTime` even if the game was paused. The server cannot see app foreground state, so the INTERNAL clock treats an explicit pause as zero accrual, including across a long gap. Unpaused gaps use the 24/24 cap. Class: `INTERNAL_ONLINE_PAUSE_STOPS_ACCRUAL_BACKGROUND_WHILE_PAUSED_NOT_PUBLIC`.

## 6. Comparison

Production and the v4 accept check use `currentGameHours >= expiresAtGameHours`. One step before that instant the offer is still valid. Expired offers are marked `expired` / `EXPIRED`. They are not deleted. Payment and deadline stay as issued.

## 7. Canonical clock

`users/{uid}/canonicalContractClock/current`

Fields: `currentGameHours`, `lastAdvancedAtServerMs`, `gameSpeed`, `manualPaused`, `clockRevision`, `policyVersion`, `authorityClass`.

Client write is false. There is no client timestamp. A server time behind the cursor does not rewind hours. The baseline for a new clock is game hour 0 at the server time of first use. Save `currentTime` is not imported.

v4 batches freeze `issuedAtCanonicalGameHours`. Each offer stores `expiresAtGameHours` from `generateContracts` at that hour, so urgent, normal, and long offers keep their own lifetimes. A partial retry in the same issuance window reuses the frozen hour. v1, v2, and v3 offers keep `expiresAtMs` and are not reinterpreted.

## 8. What stays separate

Step 29AE puts manual refresh on this same clock. Market epoch, contract-event snapshots, and fleet runtime summaries do not change an issued expiry. Expiry writes no cash.

## 9. Global clock

**YES.** Production has one `currentTime` and one `gameSpeed`. ROAD delivery timing, offer expiry, and refresh cooldown should later share one server-owned account clock. This step does not move Step 29Y per-delivery timing onto that clock.

## 10. Next step

Step 29AF added server-owned progression and ROAD reputation for new canonical accounts. Progression changes do not alter an issued expiry. Completion XP is blocked on the delivery risk tier (`CANONICAL_COMPANY_PROGRESSION_AUTHORITY_BLOCKED_XP_SOURCE`). See `MAP_V2_CANONICAL_COMPANY_PROGRESSION_AUTHORITY.md`.

**STEP 29AG — CANONICAL DELIVERY RISK-TIER / DRIVER ASSIGNMENT AUTHORITY.** Do not wire the public Contracts screen.

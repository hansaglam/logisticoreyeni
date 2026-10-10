# Map V2 — Canonical company progression / reputation authority (Step 29AF)

**Status:** `CANONICAL_COMPANY_PROGRESSION_AUTHORITY_PASS_INTERNAL_ONLY` (Step 29AG; was `BLOCKED_XP_SOURCE` in 29AF)

**Progression readiness:** `CANONICAL_PROGRESSION_BLOCKED_UNSUPPORTED_REWARD_PROGRESS` (Step 29AI; was `CANONICAL_PROGRESSION_BLOCKED_CLIENT_REWARD_XP_SOURCES` in 29AH and `CANONICAL_PROGRESSION_BLOCKED_NON_DELIVERY_XP_SOURCES` in 29AG)

**ROAD reputation:** `CANONICAL_ROAD_REPUTATION_PASS_INTERNAL_ONLY`

**Policies:** `canonical-company-progression-v1`, `canonical-road-reputation-v1`. Any other policy string fails closed (`CANONICAL_PROGRESSION_POLICY_UNKNOWN`).

**Gate:** `CANONICAL_COMPANY_PROGRESSION_AUTHORITY=INTERNAL_TEST` (missing = OFF). The gate does not touch local save progression.

**Issuance readiness:** `ROAD_CONTRACT_ISSUANCE_BLOCKED_PUBLIC_PROGRESSION` (unchanged).

The server can now own reputation for canonical ROAD delivery outcomes. In 29AF it could not derive production completion XP, so the outcome was `BLOCKED_XP_SOURCE`. Step 29AG freezes a server-derived risk tier at accept from a trusted canonical driver and truck, so completion XP is now server-derived for new-policy INTERNAL deliveries (`MAP_V2_CANONICAL_DELIVERY_RISK_DRIVER_AUTHORITY.md`). Deliveries without a risk snapshot stay XP-blocked.

## 1. Production progression fields

`Player` in `src/types/game.ts`: `level`, `companyLevel` (mirror of `level`), `xp` (XP inside the current level, not total), `xpToNextLevel`, `totalXp`, `reputation`. The store also keeps `reputationHistory` (max 20 entries, idempotency by entry id).

Separate domains, not touched here: driver XP/level (`calculateDriverDeliveryXp`, driver records), season, challenge, mission, milestone, weekly objective, and achievement progress. Those only matter here where they grant company XP or reputation (table below).

| FIELD | SOURCE | INITIAL VALUE | MUTATION FUNCTION | TRIGGER | DELTA FORMULA | ROUNDING | CLIENT OWNED TODAY? | SERVER-DERIVABLE? | CANONICAL STATUS |
|---|---|---|---|---|---|---|---|---|---|
| level / companyLevel | `applyXpToPlayer` (`src/simulation/leveling.ts`) | 1 | `addCompanyXp` → `applyXpToPlayer` | any XP grant | derived from XP carry-over, `levelConfig.maxLevel` 30 | integer | yes | yes, from trusted XP | server-derived from canonical XP; stuck at 1 while XP sources are blocked |
| xp / xpToNextLevel / totalXp | `applyXpToPlayer` | 0 / 100 / 0 | `applyXpToPlayer` | any XP grant | `xp += amount`; while `xp >= xpToNextLevel && level < 30`: `xp -= xpToNextLevel`, `level++`; at 30 `xp = 0`, `totalXp` keeps growing; negative is a no-op | inputs are already integers | yes | yes, given trusted amount | reused production helper |
| XP: delivery completed | gameStore 8250 / 8487 | — | `calculateDeliveryXp(distanceKm, netProfit, riskTier)` | `completeDelivery` | `round(25 + distance/20 + max(0,netProfit)/1000 + {low 0, medium 10, high 25})`, clamp 20–150 | `Math.round` | yes | yes when the 29AG risk snapshot and driver-aware economics are present | `SERVER_DERIVED` for 29AG deliveries; `PROGRESSION_XP_BLOCKED_RISK_SNAPSHOT_MISSING` otherwise |
| XP: delivery failed / cancelled | `failDeliveryById` | — | none | failure / cancel | 0 | — | yes | yes | exact: 0 XP |
| XP: trade sale | gameStore 10688 / 10765 | — | `calculateTradeSaleXp(profit)` | local warehouse sale | `profit <= 0` → 2; else `round(10 + profit/1500)` clamp 10–100 | `Math.round` | yes | 29AH: yes with trusted cost basis and zero-decay product/warehouse pair | `CARGO_SALE_XP_CANONICAL_INTERNAL_ZERO_DECAY_ONLY`; otherwise `CARGO_SALE_XP_BLOCKED_COST_BASIS_AUTHORITY` / `CARGO_SALE_XP_BLOCKED_QUALITY_AUTHORITY` |
| XP: truck purchase | gameStore 9003 | — | `addCompanyXp` | local purchase | +30 | none | yes | 29AH: canonical catalog TRUCK purchase | `TRUCK_PURCHASE_XP_CANONICAL_INTERNAL` |
| XP: driver hire | gameStore 9325 | — | `addCompanyXp` | local hire | +10 | none | yes | 29AH: canonical driver hire | `DRIVER_HIRE_XP_CANONICAL_INTERNAL` |
| XP: warehouse open / upgrade | gameStore 10234 / 10432 | — | `addCompanyXp` | local warehouse | +40 / +25 per tier | none | yes | 29AH: canonical warehouse open/upgrade | `WAREHOUSE_OPEN_XP_CANONICAL_INTERNAL` / `WAREHOUSE_UPGRADE_XP_CANONICAL_INTERNAL` |
| XP: mission / milestone / weekly reward | gameStore 3540 / 3702 / 3840 | — | `addCompanyXp` | local claim | reward table value | none | yes | 29AI: server catalog + server-derived progress for 7/12 missions, 30/41 milestones, 5/5 weekly slots (server weekly missions have no XP) | `MISSION_/MILESTONE_/WEEKLY_OBJECTIVE_XP_CANONICAL_INTERNAL`; the rest `CLIENT_REWARD_XP_BLOCKED_*` |
| XP: operation choice | gameStore ~9998 | — | `applyXpToPlayer` | incident choice | `effects.playerXpDelta` if > 0 (no current catalog entry sets it) | none | yes | canonical 29O pool has none | exact 0 for canonical pool; public `CLIENT_OWNED_UNTRUSTED` |
| reputation | `reputationBalance.initial` | 50 | `applyReputationChange` | see rows below | `next = clamp(clamp(prev) + delta, 0, 100)`, applied = `next − prev`, skipped if key already applied or requested delta is 0 | none (float kept) | yes | per source | per row |
| rep: early / on-time | `calculateDeliveryReputationResult` | — | `mergeReputationIntoStore` (8302) | completion | +3 / +2, plus +1 if contract type `high_reputation` and not late | none | yes | yes (29I/29Y server timing + frozen contract type) | canonical exact |
| rep: late-minor / late-major | same | — | same | completion | −2 if `(actual−deadline)/deadline <= 0.1`, else −4 | none | yes | yes | canonical exact |
| rep: delivery failed | `deliveryFailureReasonToReputationDelta` | — | `mergeReputationIntoStore` (8650) | too_late / breakdown / accident / capacity_exceeded | −6 | none | yes | too_late yes (> 2× deadline); breakdown/accident are client random rolls | too_late canonical exact; others `PROGRESSION_BLOCKED_UNVERIFIED_FAILURE` |
| rep: contract cancelled | same | — | same | `failDeliveryById(id,'cancelled')` (debug screen only in production) | −6 | none | yes | yes (canonical cancel) | canonical exact |
| rep: operation choice | gameStore 10004 | — | `mergeReputationIntoStore` | incident choice | catalog `reputationDelta` (customer_request +1, company_reputation +2) | none | yes | canonical 29O pool contains neither | canonical 0; public `CLIENT_OWNED_UNTRUSTED` |
| rep: mission / milestone / weekly reward | gameStore 3499 / 3657 / 3795 | — | `mergeReputationIntoStore` | local claim | reward value | none | yes | 29AI: same claim and receipt as the XP (reasons `mission-reward` / `milestone-reward` / `weekly-reward`) | canonical for the canonical rewards; otherwise `CLIENT_OWNED_UNTRUSTED` |
| rep: vehicle recovery | gameStore 8873 | — | `mergeReputationIntoStore` | local recovery | `reputationCost` (key includes currentTime) | none | yes | no | `CLIENT_OWNED_UNTRUSTED` |
| serverState.companyLevel / reputation | `backend/src/serverState.ts` | 1 / 50 or copied from save | legacy migration | save migration | copied from client save, clamped | floor level | copied from client | no | `LEGACY_CLIENT_UNVERIFIED`, never read by 29AF |

Prior docs said failed delivery was −8. Production code is −6 (`REPUTATION_RULES.deliveryFailed`). Late-major has no upper bound below 2×; above 2× deadline production fails the delivery as `too_late` (−6).

## 2. XP model

XP is stored as "XP inside the current level" plus `totalXp`. Canonical reuses `applyXpToPlayer` through `applyCanonicalCompanyXp`, so carry-over, multi-level jumps, and the max-level reset match production.

## 3. Level derivation

Level is derived from XP and the threshold curve. There is no prestige and no score input. The server never accepts a level.

## 4. Level thresholds

`calculateXpToNextLevel(level) = round(100 × max(1, level)^1.45)`: level 1 → 100, 2 → 273, 3 → 492. Max level 30. At 30, `xp` is set to 0, `xpToNextLevel = calculateXpToNextLevel(30)`, and `totalXp` still accumulates (XP is not discarded from the total).

## 5. Reputation model

Range 0–100, initial 50, float. `clampReputation` from `src/domain/reputationModel.ts`. No rounding.

## 6. Reputation deltas

From `REPUTATION_RULES`: early +3, on-time +2, high-reputation-contract bonus +1 (early or on-time only), late-minor −2, late-major −4, cancelled −6, failed −6. Early is `actual <= planned × 0.92`. Late-minor is lateness ratio ≤ 0.1.

## 7. Trusted mutation sources

- Canonical ROAD completion: reputation from the server-derived timing band (`classifyDeliveryPunctuality` via `calculateDeliveryReputationResult`) and the server-issued `contractType` frozen on the delivery. The band must match the production classifier or the call fails with `CANONICAL_PROGRESSION_TIMING_MISMATCH`.
- Canonical ROAD cancel: −6, 0 XP.
- Canonical server-derived failure (`actual > deadline × 2`): −6, 0 XP.

## 8. Untrusted mutation sources

Client `FAILED` without a server cause. Breakdown and accident failures (client random rolls; the 29O catalog has no failure-triggering incidents). All local XP grants. Mission, milestone, weekly, operation-choice, and vehicle-recovery reputation. Save and serverState progression values.

Completion XP needs a risk tier and a trusted netProfit. Since 29AG, accept with `CANONICAL_ROAD_DRIVER_RISK_AUTHORITY=INTERNAL_TEST` freezes both. Without them, XP is recorded as 0 with the exact reason:

- `PROGRESSION_XP_BLOCKED_RISK_SNAPSHOT_MISSING`: no snapshot (old delivery or gate OFF).
- `PROGRESSION_XP_BLOCKED_RISK_POLICY_UNKNOWN`: unknown risk policy.
- `PROGRESSION_XP_BLOCKED_RISK_SNAPSHOT_INVALID`: the stored tier does not match a recompute of the stored inputs.
- `PROGRESSION_XP_BLOCKED_NET_PROFIT_AUTHORITY`: driver economics, fuel price or world events are untrusted.
- `PROGRESSION_XP_BLOCKED_INCIDENT_ECONOMICS`: fragile contract with an unresolved incident.

No partial or guessed XP is granted.

## 9. New-account initialization

`initializeCanonicalCompanyProgressionForNewAccount` (server transaction) and callable `initializeCanonicalCompanyProgressionInternal` (keys: `canonicalSchemaVersion` only; rate-limit key `canonicalCompanyProgressionInit`). It writes production defaults: level 1, xp 0, xpToNextLevel 100, totalXp 0, reputation 50, `progressionRevision` 1. Repeat calls return `alreadyInitialized`.

## 10. Legacy account behavior

Initialization refuses when `users/{uid}/saves/current` exists (`CANONICAL_PROGRESSION_LEGACY_SAVE_PRESENT`) or when `serverState/current` exists with a non-`default` migration source or any delivery counts (`CANONICAL_PROGRESSION_LEGACY_SERVER_STATE_PRESENT`). Nothing is imported. A user with save level 20 / reputation 100 and no canonical doc stays blocked for canonical issuance.

Future options, not implemented: rebuild from authoritative history, verified one-time migration, clean authority cutover, or canonical-only new accounts.

## 11. Progression schema

`users/{uid}/canonicalCompanyProgression/current`: `schemaVersion` 1, `progressionPolicyVersion`, `reputationPolicyVersion`, `authorityClass`, `ownerUid`, `level`, `xp`, `xpToNextLevel`, `totalXp`, `reputation`, `progressionRevision`, `initializationSource`, `initializedAtMs`, `updatedAtMs`. Validation also checks `xpToNextLevel` against the curve and `xp < xpToNextLevel` below max level, so a forged level fails.

## 12. Authority classes

`SERVER_CANONICAL_PROGRESSION`, `INTERNAL_TEST_PROGRESSION_FIXTURE` (pre-29AF `{ level, reputation }` test docs with no schema fields), `LEGACY_CLIENT_UNVERIFIED`, `UNINITIALIZED`, `UNSUPPORTED`.

## 13. Revision

`progressionRevision` starts at 1 and increments when level, xp, totalXp, or reputation actually changes. A clamped no-op (e.g. +3 at 100) still writes a receipt but keeps the revision. The client cannot send it.

## 14. Mutation identity

`progression:delivery:{deliveryId}:completion`, `progression:delivery:{deliveryId}:cancel`, `progression:delivery:{deliveryId}:failure`. No timestamp in the identity.

## 15. Receipt

`users/{uid}/canonicalProgressionReceipts/{operationId}`: `operationId`, `sourceType`, `sourceId`, `xpDelta`, `xpAuthority`, `requestedReputationDelta`, `reputationDelta` (applied), `reputationReasons`, `xpBefore/After`, `totalXpBefore/After`, `levelBefore/After`, `reputationBefore/After`, `progressionRevisionBefore/After`, `policyVersion`, `reputationPolicyVersion`, `createdAtMs`. Client write is false for both collections.

## 16. Completion integration

Inside `reportCanonicalRoadDeliveryCompletedTransaction`. Progression doc and both possible receipts are read before any write. Mutation, receipt, and delivery lifecycle update commit in one transaction. Cash settlement is not required first (production applies reputation in `completeDelivery` alongside settlement; canonical settlement stays off). The delivery doc records `progressionApplication` and `progressionOperationId`.

## 17. Cancel integration

Inside `cancelCanonicalRoadDeliveryTransaction`, atomic with the `ACCEPTED → CANCELLED` transition. Retry returns `alreadyCancelled` without a second −6.

## 18. Failure integration

`SERVER_DERIVED_FAILURE` applies −6 under the failure identity. `CLIENT_REPORTED_UNVERIFIED_FAILURE` writes no receipt and marks the delivery `PROGRESSION_BLOCKED_UNVERIFIED_FAILURE`. `SERVER_VERIFIABLE_FAILURE` is not produced today (29O catalog has no failure-triggering incidents), so incident failures apply nothing.

## 19. Idempotency

A completed, failed, or cancelled delivery is terminal, so replays return early and never reach the progression write. If a receipt already exists with the same operation and requested deltas, the result is `ALREADY_APPLIED`. Different deltas return `CANONICAL_PROGRESSION_RECEIPT_CONFLICT` and nothing is overwritten.

## 20. Two-device

Two completion requests: the second sees the terminal lifecycle and returns `alreadyReported`. One receipt, one mutation. Verified with sequential in-memory transactions; `FIRESTORE_EMULATOR_BLOCKED_NO_JAVA`.

## 21. Contract generator integration

`resolveCanonicalProgressionForIssuance` replaces the raw `level` / `reputation` read. `SERVER_CANONICAL_PROGRESSION` is trusted. `LEGACY_CLIENT_UNVERIFIED` returns `ROAD_CONTRACT_ISSUANCE_BLOCKED_LEGACY_PROGRESSION`. Missing returns `ROAD_CONTRACT_ISSUANCE_BLOCKED_PLAYER_PROGRESSION`. Unknown policy or invalid state fails closed. Fixture docs are accepted only while the progression gate is OFF; with the gate ON they return `CANONICAL_PROGRESSION_FIXTURE_NOT_TRUSTED`. The generator never reads the save or serverState. Issuance keys now also reject `level`, `xp`, `experience`, `reputationDelta`, `xpDelta`, `newLevel`, `companyLevel`, `companyXp`, `progressionRevision`, `score`, `companyScore`.

## 22. Refresh integration

An existing batch keeps its frozen `playerLevel` / `playerReputation`. The next eligible 29AE refresh reads the new values. A progression change does not bypass the 3-game-hour cooldown and does not trigger a reroll. Level 4 → 5 plus reputation change was verified with a server-side planner mutation, because canonical delivery XP is blocked.

## 23. Public migration limitation

Public progression, HUD, and UI stay on the save. No listener, no mirror write, no dual authority. `SAVE_GAME_VERSION` stays 6. Public progression is not `PUBLIC_AUTHORITY_READY`: XP sources are not trusted, public reputation has client-owned sources, and legacy migration is undefined.

## 24. Cash separation

No `serverState.cash`, no `canonicalCashTransactions`, no `users/{uid}.money`, no `player.money`, no `financeLedger`. Coverage stays 24 / 0 / 24. `canUseServerAuthoritativeSettlement` stays false.

## 25. Issuance readiness impact

Readiness stays `ROAD_CONTRACT_ISSUANCE_BLOCKED_PUBLIC_PROGRESSION`. Reputation alone is server-owned for canonical deliveries, but level is not, so the combined blocker is not removed and `BLOCKED_PUBLIC_REPUTATION` would understate it. 29AF added the public blocker `COMPANY_XP_DELIVERY_RISK_TIER_UNTRUSTED`. 29AG replaced it with `COMPANY_XP_DELIVERY_RISK_INTERNAL_CANONICAL_DRIVER_ONLY` and `COMPANY_XP_NON_DELIVERY_SOURCES_CLIENT_OWNED`. 29AH replaced the latter with `COMPANY_XP_NON_DELIVERY_OPERATIONS_INTERNAL_CANONICAL_ONLY` and `COMPANY_XP_CLIENT_REWARD_SOURCES_CLIENT_OWNED`. 29AI replaced `COMPANY_XP_CLIENT_REWARD_SOURCES_CLIENT_OWNED` with `COMPANY_XP_CLIENT_REWARD_SOURCES_INTERNAL_PARTIAL` and `COMPANY_XP_UNSUPPORTED_REWARD_PROGRESS_CLIENT_OWNED`.

## 26. Remaining blockers

- Delivery risk tier: resolved for INTERNAL canonical drivers in 29AG. Legacy save drivers and driver level stay client-owned.
- Non-delivery operation XP: resolved in 29AH for canonical truck purchase, driver hire, warehouse open/upgrade and zero-decay cargo sales (`MAP_V2_CANONICAL_NON_DELIVERY_COMPANY_XP_AUTHORITY.md`). Decaying cargo sales stay blocked on the missing quality clock.
- Mission, milestone and weekly XP/reputation: canonical in 29AI for server-derivable progress (`MAP_V2_CANONICAL_CLIENT_REWARD_XP_AUTHORITY.md`). Rewards with unsupported progress, operation choices and recovery reputation stay local (`CANONICAL_PROGRESSION_REMAINING_CLIENT_XP_SOURCES`).
- `CANONICAL_PROGRESSION_REMAINING_BLOCKERS`: `UNSUPPORTED_REWARD_PROGRESS`, `CARGO_QUALITY_AUTHORITY`, `LEGACY_PROGRESSION_MIGRATION`, `PUBLIC_PROGRESSION_UI`.
- Legacy progression migration.
- Public Contracts UI, legacy fleet, contract-event real-day schedule, paused-background clock.

## 27. Next step

Done in 29AG (see `MAP_V2_CANONICAL_DELIVERY_RISK_DRIVER_AUTHORITY.md`). The fixed non-delivery grants were done separately in 29AH (`PASS_PARTIAL`, see `MAP_V2_CANONICAL_NON_DELIVERY_COMPANY_XP_AUTHORITY.md`). Client reward XP was done in 29AI (`PASS_PARTIAL`, see `MAP_V2_CANONICAL_CLIENT_REWARD_XP_AUTHORITY.md`). Original plan:

**STEP 29AG — CANONICAL DELIVERY RISK-TIER / DRIVER ASSIGNMENT AUTHORITY.** Freeze a server-derived `breakdownChance + accidentChance` risk tier at canonical accept from trusted driver and fleet state, then grant exact production completion XP. Consider wiring the fixed XP grants on the existing canonical purchase, hire, warehouse, and cargo-sale operations in the same step only if each is exact. Do not wire public Contracts UI, do not enable production ROAD settlement, do not activate SEA or AIR.


Step 29AJ/29AK: legacy progression migration is internal only. Apply uses a create-only frozen source (`MAP_V2_LEGACY_SAVE_AUTHORITY_HARDENING.md`). Public rollout remains blocked. Cash authority, ROAD settlement, and RAIL/SEA/AIR are unchanged.


Step 29AL: internal immediate progression cutover reads the save and creates the frozen source plus migration in one transaction (`MAP_V2_LEGACY_PROGRESSION_IMMEDIATE_CUTOVER.md`). Public rollout remains blocked by `PUBLIC_PROGRESSION_UI_SPLIT_BRAIN`. Cash authority and ROAD settlement are unchanged.

Step 29AM: internal UI read authority for that doc is `CANONICAL_PROGRESSION_READ_AUTHORITY_PASS_INTERNAL_ONLY` (`MAP_V2_CANONICAL_PROGRESSION_READ_AUTHORITY.md`). Public clients still show the local save while the read gate is off. Cash authority and ROAD settlement are unchanged.

Step 29AN: shop and warehouse client eligibility can use the same doc behind a second internal gate (`MAP_V2_CANONICAL_PROGRESSION_ELIGIBILITY_AUTHORITY.md`). Server validation is unchanged. Cash authority and ROAD settlement are unchanged.

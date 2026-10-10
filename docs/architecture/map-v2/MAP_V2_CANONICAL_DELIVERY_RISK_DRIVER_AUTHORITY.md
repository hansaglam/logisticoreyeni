# Map V2 — Canonical delivery risk tier / driver assignment authority (Step 29AG)

**Status:** `CANONICAL_DELIVERY_RISK_DRIVER_AUTHORITY_PASS_INTERNAL_ONLY`

**Policies:** `canonical-road-delivery-risk-tier-v1`, `canonical-road-driver-snapshot-v1`, `canonical-driver-runtime-v1`, `road-execution-economics-driver-v2`. An unknown risk policy fails closed (`PROGRESSION_XP_BLOCKED_RISK_POLICY_UNKNOWN`).

**Gate:** `CANONICAL_ROAD_DRIVER_RISK_AUTHORITY=INTERNAL_TEST` (missing = OFF). With the gate OFF, canonical accept is byte-for-byte the 29AF behaviour: no driver is read, no snapshot is written, completion XP stays blocked.

**Progression readiness:** `CANONICAL_PROGRESSION_BLOCKED_NON_DELIVERY_XP_SOURCES` at 29AG; `CANONICAL_PROGRESSION_BLOCKED_CLIENT_REWARD_XP_SOURCES` in Step 29AH; `CANONICAL_PROGRESSION_BLOCKED_UNSUPPORTED_REWARD_PROGRESS` since Step 29AI.

The server now binds a trusted canonical driver at accept, freezes the production risk tier from server-owned driver and truck state, and grants exact production completion XP once through the 29AF receipt. Public driver, progression, and Contracts UI are unchanged, so the outcome is `PASS_INTERNAL_ONLY`.

Code: `src/domain/canonicalDeliveryRiskDriver.ts`, `backend/src/canonicalDeliveryRiskDriver.ts`, and the accept/complete/cancel transactions in `backend/src/canonicalRoadDelivery.ts`.

## 1. Production risk formula

`createDelivery` (`src/simulation/delivery.ts`) computes both chances once at start and stores them on the delivery. `completeDelivery` reads `getDeliveryRiskTier(delivery)` for XP. With `load = cargo / max(capacity, 1)` and `cargo = contract.cargoWeight ?? contract.amount`:

- `breakdownChance = clamp(0.02 + (100−condition)/100·0.18 + (100−reliability)/100·0.12 + difficulty·0.1 + load·0.06 + (100−attention)/100·0.1, 0, 0.85)`
- `accidentChance = clamp(0.01 + max(0, speed/100)·0.12 + (100−attention)/100·0.14 + difficulty·0.11 + (100−condition)/100·0.08 + load·0.04, 0, 0.85)`

Canonical calls the same two production functions (`deriveCanonicalRoadRiskFromInputs`). The product argument is not used by either formula.

`PRODUCTION_RISK_TIER_AUDIT` in the domain module holds the full input table (INPUT / SOURCE / TYPE / RANGE / DEFAULT / FORMULA USE / WHEN READ / WHEN MUTATED / CLIENT OWNED / SERVER OWNED / CANONICAL STATUS). It has no UNKNOWN rows; the regression suite asserts this.

## 2. Risk tiers

`getDeliveryRiskTier`: combined `< 0.1` low, `< 0.25` medium, otherwise high. Exactly 0.1 is medium and exactly 0.25 is high.

## 3. Risk bonuses

`levelConfig.deliveryXp.riskBonus`: low 0, medium 10, high 25.

## 4. Driver fields

Risk reads `attention` and `speed`. Economics reads `speed`, `tier` (duration) and `fuelSaving` (liters). These are static catalog values in `DRIVER_POOL` / `STARTER_DRIVER`; production never mutates them. Driver level and XP are client-owned (`DRIVER_LEVEL_AUTHORITY_CLIENT_OWNED`) and are not risk inputs.

## 5. Truck reliability

A static catalog value, copied from the template when a truck is bought. No production code mutates it; upgrades change wear and duration, not reliability. Canonical resolves it from the fixture template, then the truck catalog, with no default (`CANONICAL_TRUCK_RELIABILITY_UNAVAILABLE`).

## 6. Driver assignment lifecycle

Production `startDelivery`: the driver must be selectable (`getDriverOperationalState`, otherwise `DRIVER_BUSY`) and meet `requiredDriverLevel` when it is above 1. Production has no driver location check; the driver travels with the truck. The driver becomes idle on completion, cancel and failure, and stays on the route while out of fuel. `canFireDriver` blocks firing a driver on an active delivery. `PRODUCTION_DRIVER_ASSIGNMENT_AUDIT` records each rule next to its canonical counterpart.

## 7. Driver authority classes

`SERVER_CANONICAL_DRIVER` (hired through the 29-series canonical hire, `authoritySource = DRIVER_POOL_CATALOG`), `INTERNAL_TEST_DRIVER_FIXTURE` (server-only bootstrap, `INTERNAL_TEST_FIXTURE`), `LEGACY_CLIENT_UNVERIFIED` (no canonical doc; save drivers are never imported), `DRIVER_RUNTIME_UNINITIALIZED`, `UNSUPPORTED`.

## 8. Driver runtime state

Stored on the existing `users/{uid}/canonicalDrivers/{driverId}` doc (client write false): `assignedCanonicalDeliveryId`, `driverRuntimeRevision` (+1 per assign or release), `driverRuntimePolicyVersion`, `lastAssignedAtMs`, `lastReleaseReason`, `lastReleasedDeliveryId`, `lastReleasedAtMs`. No generic `setDriverBusy` callable exists.

## 9. Accept validation

The accept request may carry `selectedDriverId`. Everything else about the driver comes from the server. Check order in `classifyCanonicalDriverForAssignment`: doc exists (else `LEGACY_DRIVER_UNVERIFIED`), schema 1, owner, id match, offer policy, authority source, `status = hired`, catalog stats available, `attentionBaseline` matches the catalog, not assigned to another delivery (`DRIVER_NOT_AVAILABLE`), `requiredDriverLevel` valid. A level above 1 fails with `CANONICAL_DRIVER_LEVEL_AUTHORITY_UNAVAILABLE`, because driver level is not canonical. The driver doc, `globalEconomy/current` and the contract-events doc are all read before the first write. The driver update commits in the same transaction as the delivery, contract and truck reservation.

## 10. Driver snapshot

`canonicalDriverSnapshot` on the delivery: `snapshotPolicyVersion`, `driverId`, `poolId`, `authorityClass`, `statsSource`, `attention`, `speed`, `fuelSaving`, `tier`, `driverLevelAuthority`, `driverRuntimeRevisionAtAssign`, `frozenAtMs`. Stats come from the catalog; stat fields on the driver doc are ignored.

## 11. Truck reliability snapshot

`deliveryRiskSnapshot` records `truckAssetId`, `truckEconomicRevision`, `reliabilitySource`, and every formula input in `inputs`, together with `breakdownChance`, `accidentChance`, `combinedRisk`, `riskTier`, `riskBonus`, `riskPolicyVersion`, `riskSnapshotAuthority = SERVER_DERIVED_AT_ACCEPT` and `frozenAtMs`.

## 12. Condition ordering

Production reads condition at start, before completion wear. The snapshot uses the asset's `economicCondition` at accept (`conditionStage = ACCEPT_TIME_PRE_WEAR`). Later wear, repair, or reliability edits do not change it.

## 13. Wear interaction

Deliveries that carry a valid driver snapshot use the frozen driver attention in `calculateConditionLoss` and write `canonical-road-delivery-wear-v2` receipts with `wearDriverAttention`. Deliveries without one keep `canonical-road-delivery-wear-v1` with attention 100. Existing receipts are not rewritten. Readiness: `CANONICAL_WEAR_DRIVER_ATTENTION_INTERNAL_SNAPSHOT_V2_ONLY`.

## 14. Fuel-saving interaction

The frozen `fuelSaving` feeds `calculateContractEconomics` (liters and fuel cost), the 29Q accept-burn requirement, and 29X progressive fuel liters. Readiness: `CANONICAL_DRIVER_FUEL_SAVING_INTERNAL_SNAPSHOT_ONLY`. Public refuel still blocks public fuel (`FUEL_PROGRESSIVE_BLOCKED_PUBLIC_REFUEL`). Known gap from earlier steps: the accept-burn requirement passes `trailer: null`, while v2 economics include the trailer.

## 15. Timing interaction

`acceptedTravelBasis.expectedDurationHours` is `economics.estimatedDurationHours`, which now includes driver speed and tier. The frozen `plannedTravelGameHours` therefore uses the trusted driver. Readiness: `PRODUCTION_TIMING_DRIVER_AUTHORITY_INTERNAL_SNAPSHOT_ONLY`. Multi-delivery global speed and incident delay stay separate blockers.

## 16. Risk policy

`canonical-road-delivery-risk-tier-v1`. `validateCanonicalRoadDeliveryRiskSnapshot` handles three failure cases: a missing snapshot gives `PROGRESSION_XP_BLOCKED_RISK_SNAPSHOT_MISSING`; any other policy gives `PROGRESSION_XP_BLOCKED_RISK_POLICY_UNKNOWN`; non-finite inputs, or a stored tier or bonus that differs from a recompute of the stored inputs, give `PROGRESSION_XP_BLOCKED_RISK_SNAPSHOT_INVALID`.

## 17. Completion XP formula

`calculateDeliveryXp(distanceKm, netProfit, riskTier) = clamp(round(25 + km/20 + max(0, netProfit)/1000 + bonus), 20, 150)`. Negative profit adds 0. The 20 floor is never reached, because the base is 25.

## 18. Net profit authority

Production `netProfit = payment − (fuelCost + maintenance bundle + penalty)`. XP is granted only when the delivery's economics snapshot has all of the following:

- `driverEconomicsPolicyVersion = road-execution-economics-driver-v2`: trusted driver speed, tier and fuelSaving, server contract type and penalty multiplier.
- `fuelPriceAuthority = SERVER_GLOBAL_ECONOMY`: sanitized `globalEconomy/current`, as production `getSafeFuelPrice`.
- `maintenanceEventAuthority = CANONICAL_CONTRACT_WORLD_EVENTS`: active `maintenance_campaign` events from the canonical contract-events doc, as production `activeWorldEvents`.

Anything else gives `PROGRESSION_XP_BLOCKED_NET_PROFIT_AUTHORITY`. A fragile contract whose incident state is `UNRESOLVED` gives `PROGRESSION_XP_BLOCKED_INCIDENT_ECONOMICS`, because the fragile surcharge depends on completion condition.

## 19. Completion integration

`reportCanonicalRoadDeliveryCompletedTransaction` reads the driver (lifecycle `ACCEPTED` only) before any write. `deriveCanonicalRoadCompletionXpForDelivery` computes XP from the frozen tier and the server-derived settlement. The 29AF receipt `progression:delivery:{deliveryId}:completion` now also stores `xpEvidence` (`distanceKm`, `netProfit`, `riskTier`, `riskBonus`, `riskPolicyVersion`). The driver is released in the same transaction. Risk and XP write no cash.

## 20. Idempotency

Terminal deliveries return early, before any progression or driver write. The receipt identity has no timestamp. A release only happens while the driver is still assigned to this delivery, so a second release writes nothing.

## 21. Retry

Accept retry returns `alreadyAccepted` with no second assignment and no revision change. Completion retry returns `alreadyReported`: XP is unchanged and there is still one receipt.

## 22. Two-device

A second device accepting the same contract with a different driver gets `alreadyAccepted`; the other driver stays free. Two concurrent accepts of different contracts with one driver produce exactly one winner; the loser gets `DRIVER_NOT_AVAILABLE` and its contract stays `AVAILABLE`. When accept and fire race, only one can win (the fire guard returns `DRIVER_ASSIGNED_TO_CANONICAL_DELIVERY`). This was verified with a serialized, buffered in-memory Firestore; the emulator is blocked (`FIRESTORE_EMULATOR_BLOCKED_NO_JAVA`).

## 23. Legacy driver behavior

A save driver id with no canonical doc is rejected with `LEGACY_DRIVER_UNVERIFIED` / `LEGACY_CLIENT_UNVERIFIED`. Nothing is imported. The contract stays `AVAILABLE`.

## 24. Old delivery behavior

Deliveries accepted before 29AG, or with the gate OFF, have no risk snapshot. They stay XP-blocked (`PROGRESSION_XP_BLOCKED_RISK_SNAPSHOT_MISSING`), keep v1 wear, and never touch driver docs. No retro snapshot is written.

## 25. Public parity limitations

Public deliveries use save drivers and trucks. Driver level is client-owned, so contracts requiring driver level 2 cannot be accepted canonically. Breakdown and accident rolls stay client-side. No public UI reads the new fields.

## 26. Remaining XP blockers

Non-delivery XP at 29AG: trade sale, truck purchase, driver hire, warehouse open/upgrade, missions, milestones, weekly rewards, operation choices, vehicle recovery. Legacy progression migration. Fragile deliveries with unresolved incidents.

Step 29AH made truck purchase, driver hire, warehouse open/upgrade and zero-decay cargo sales server-derived (INTERNAL). `CANONICAL_PROGRESSION_REMAINING_CLIENT_XP_SOURCES` is now: decaying trade sales, missions, milestones, weekly rewards, operation choices, vehicle recovery. See `MAP_V2_CANONICAL_NON_DELIVERY_COMPANY_XP_AUTHORITY.md`. 29AG delivery completion XP is unchanged.

Step 29AI made mission, milestone and weekly XP server-derived for rewards with verifiable progress. Delivery-based rewards count canonical deliveries with `completionOutcome === 'COMPLETED'`; weekly on-time uses the frozen `deadlineHours` against the derived `actualTravelHours`. Completion XP and the driver snapshot are unchanged. See `MAP_V2_CANONICAL_CLIENT_REWARD_XP_AUTHORITY.md`.

## 27. Remaining driver blockers

Legacy save drivers (`PUBLIC_DRIVER_RISK_BLOCKED_LEGACY_SAVE_DRIVERS`), driver level/XP authority, public driver UI, and driver recovery (`DRIVER_RECOVERY_NOT_CANONICAL_VEHICLE_RECOVERY_CLIENT_OWNED`).

## 28. Readiness impact

- Company progression: `CANONICAL_COMPANY_PROGRESSION_AUTHORITY_PASS_INTERNAL_ONLY`; readiness `CANONICAL_PROGRESSION_BLOCKED_NON_DELIVERY_XP_SOURCES`.
- Issuance: `ROAD_CONTRACT_ISSUANCE_BLOCKED_PUBLIC_PROGRESSION` (unchanged). The `COMPANY_XP_DELIVERY_RISK_TIER_UNTRUSTED` blocker is replaced by `COMPANY_XP_DELIVERY_RISK_INTERNAL_CANONICAL_DRIVER_ONLY` and `COMPANY_XP_NON_DELIVERY_SOURCES_CLIENT_OWNED`.
- Timing, fuel and wear: see sections 13–15.
- Unchanged: coverage 24 / 0 / 24, `canUseServerAuthoritativeSettlement` false, `SAVE_GAME_VERSION` 6, RAIL/SEA/AIR `FOUNDATION_ONLY`, `MULTIMODAL_OFF`.

## 29. Next step

Picked from the 29AG report. The dominant remaining progression blocker is non-delivery XP (fixed grants on existing canonical purchase, hire, warehouse and cargo-sale operations, plus client-only missions and milestones). Public rollout also still needs legacy state migration and public Contracts wiring.

Done as Step 29AH — canonical non-delivery company XP authority (`CANONICAL_NON_DELIVERY_COMPANY_XP_AUTHORITY_PASS_PARTIAL`).


Step 29AJ/29AK: legacy progression migration is internal only. Apply uses a create-only frozen source (`MAP_V2_LEGACY_SAVE_AUTHORITY_HARDENING.md`). Public rollout remains blocked. Cash authority, ROAD settlement, and RAIL/SEA/AIR are unchanged.

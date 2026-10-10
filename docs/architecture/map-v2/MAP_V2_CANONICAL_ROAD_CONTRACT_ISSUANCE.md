# Map V2 — Canonical ROAD contract issuance (Step 29G)

**Status:** `CANONICAL_ROAD_CONTRACT_ISSUANCE_PASS_INTERNAL_POLICY_ONLY`

**Production parity:** `PRODUCTION_PARITY_BLOCKED_WORLD_STATE_AUTHORITY`

Live `generateContracts` is **unchanged**. Public default remains local ROAD offers.  
HUD overlay/listener off. `canUseServerAuthoritativeSettlement()` false. `SAVE_GAME_VERSION` **6**.  
`MULTIMODAL_OFF`. RAIL/SEA/AIR `FOUNDATION_ONLY`.

This is **not** server ROAD settlement activation.

---

## Live generator dependency audit

`generateContracts` → city nested loops → `shouldGenerateContract` (surplus/shortage) → `randomBetween` amounts → `calculateContractPayment` (city markets + fuel) → `applyContractTypeToContract` → world-event multipliers.

| Input | Class |
| --- | --- |
| `ROUTES` / products catalog | STATIC_TABLE — server has copy |
| City stock / surplus / shortage | WORLD_STATE_LOCAL_ONLY (save `player` cities) |
| Client-uploaded save markets | **not** server authority |
| `globalEconomy.fuelPrice` | SERVER_CAN_DERIVE (`globalEconomy/current.fuelPricePerLiter`) |
| World events on local sim | CLIENT_ONLY / mixed with worker events |
| `randomBetween` / type mix | RNG |
| Game `currentTime` / expiry hours | TIME (game clock, not wall clock) |
| Player level / reputation / fleet capacity | PLAYER_STATE (`serverState.companyLevel` exists but is not ROAD live HUD authority) |

**World-state authority:** Step 29Z can serve epoch price and epoch supply for stamped canonical rows. Live `generateContracts` still reads save cities. Exact production offer replay is still blocked.

---

## Step 29Z market-state note

`ROAD_CONTRACT_MARKET_STATE_INTERNAL_ONLY`. Step 29AA can generate INTERNAL offers from epoch supply and production payment/deadline helpers. Step 29AB applies `worldEvents.ts` contract modifiers from a server schedule when the event gate is on, and leaves 29Z epoch events as audit-only. Live `generateContracts` is still the public path. Readiness is `ROAD_CONTRACT_ISSUANCE_BLOCKED_PUBLIC_PROGRESSION`. Do not switch the public generator.

---

## Issuance model

**INTERNAL_TEST simplified Model B/A hybrid:** server owns a versioned issuance economy (`canonical-road-contract-issuance-internal-v1`):

- Seeded PRNG from `policy|uid|windowId` (client cannot choose seed)
- 8 offers per 15-minute window
- Routes from `routes.ts`, products from a fixed band, amounts `{10,12,25}`
- Payment/deadline via existing 29F `issueCanonicalRoadContractFromTrustedState` + **internal fixture markets** (not live city stock)
- Optional fuel from `globalEconomy/current`, else `1.72`
- Wall-clock `issuedAt` / `expiresAt` (30 min TTL)
- Standard contract type only; **no** world-event or type-mix parity

Gate: `EXPO_PUBLIC_CANONICAL_ROAD_CONTRACTS=INTERNAL_TEST` (missing → OFF).  
Contracts screen is **not** wired in this step (no device QA).

---

## Paths

- `users/{uid}/canonicalRoadContractBatches/{batchId}`
- `users/{uid}/canonicalRoadContracts/{contractId}`
- `users/{uid}/canonicalRoadDeliveries/{deliveryId}`

Client write **false**.

**Callable:** `getOrIssueCanonicalRoadContracts`  
Request: `canonicalSchemaVersion` (+ optional `refreshReason`). No money fields.

**Accept:** `acceptCanonicalRoadDelivery` with `contractId` (identity extras optional, must match). Reads payment from the issued doc. AVAILABLE + not expired → create delivery + `ACCEPTED` atomically. Expired → `CONTRACT_EXPIRED`. Duplicate delivery → `alreadyAccepted`.

No cash on issue/accept/report.

---

## Settlement readiness

`ROAD_CANONICAL_SETTLEMENT_BLOCKED_PRODUCTION_FLEET_MIGRATION` (updated in Step 29J).

Step 29I derives INTERNAL_TEST travel hours from a frozen 1x server wall-clock. Live fleet economics remain save-owned.

See `MAP_V2_CANONICAL_ROAD_TIMING_AUTHORITY.md`.

---

## Offline

Canonical issuance/accept: **ONLINE_ACCEPTANCE_REQUIRED**. Default production offline ROAD unchanged.

## Next

**STEP 29H — CANONICAL ROAD EXECUTION ECONOMICS SNAPSHOT** (truck-true vs planning bundle) before shadow settlement activation.

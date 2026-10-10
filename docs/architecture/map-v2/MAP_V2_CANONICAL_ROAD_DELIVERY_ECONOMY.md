# Map V2 — Canonical ROAD delivery economy (Step 29F)

**Status:** `CANONICAL_ROAD_DELIVERY_ECONOMY_PASS_SHADOW_ONLY`

Live HUD cash, overlay, listener, and `completeDeliveryById` are **unchanged**.  
Public `MULTIMODAL_OFF`. RAIL/SEA/AIR `FOUNDATION_ONLY`. `SAVE_GAME_VERSION` **6**.  
`canUseServerAuthoritativeSettlement()` remains **false**.

This is **not** unified cash authority and **not** public anti-cheat.

---

## Audit (production)

### Contract generation

`generateContractForProduct` in `src/simulation/contracts.ts`:

- Amount from surplus/shortage × 0.7, often `randomBetween` in a tonnage band
- Urgency from destination **city market** (stock, consumption, price)
- Payment from `calculateBalancedContractPayment` (route + markets + fuel + level)
- Deadline from duration × urgency/perishability buffers
- `expiresAt` uses `randomBetween`
- Contract id includes `createdAt` + sequence (`contract_{origin}_{dest}_{product}_{time}_{seq}`)
- Then `applyContractTypeToContract` (seeded type mix), world-event multipliers, occasional controlled-risk margin crush

**Classification:** `CLIENT_WORLD_STATE_DEPENDENT` / not server-reproducible for live offers.  
Live offer authority blocker: `CANONICAL_ROAD_CONTRACT_ISSUANCE_REQUIRED`.

Chosen model: **B for fixtures** (server-owned `canonicalRoadContracts` from **trusted issuance inputs**). Model A for live `generateContracts` is **not** claimed. Model C (trust client payment) is **forbidden**.

### Settlement (complete / fail)

`completeDeliveryById`:

- `grossRevenue` = frozen `contract.payment`
- Fuel: `fuelAlreadyPaid: true` — **not** deducted again at completion (paid via tank/refuel gameplay)
- Expenses: `delivery.maintenanceCost` (start-time bundle: maintenance + trailer + toll + other) + late penalty
- Late penalty: `payment * latenessRatio * (0.25 + perishability * 0.55)`
- Fragile extra 5% if truck condition below recommended — **local-only**, not in canonical derivation
- Ledger: `delivery:{id}:revenue` and combined `delivery:{id}:completion-expenses` (debug helper also names `:maintenance` / `:penalty`)

`failDeliveryById`: `payment * 0.25 + 500` as `delivery:{id}:failure-penalty`

Driver wages: **not** in completion cash (periodic opex).

### Delivery identity

`createDeliveryId(contractId, startedAt, sequence)` is **not** retry-stable. Canonical delivery id is separate: `crd_{canonicalContractId}` and does **not** replace save `Delivery.id`.

---

## What 29F added

| Path | Role |
| --- | --- |
| `users/{uid}/canonicalRoadContracts/{contractId}` | Server-issued **standard** contract snapshot |
| `users/{uid}/canonicalRoadDeliveries/{deliveryId}` | Accepted delivery economics; client write **false** |

Issuance is **backend-internal** (`issueCanonicalRoadContractTransaction`) with markets + fuel supplied by **server tests**, not a client money API.

Callables (auth required; no uid-as-authority; money keys rejected):

- `acceptCanonicalRoadDelivery` — no cash; requires issued contract; else `CANONICAL_ROAD_CONTRACT_ISSUANCE_REQUIRED`
- `reportCanonicalRoadDeliveryCompleted` — derives settlement **descriptor**; **does not** mutate `serverState.cash`

`canonicalDeliveryCompletions` remains count-only.

Gate: `EXPO_PUBLIC_CANONICAL_ROAD_ECONOMY=INTERNAL_TEST` (missing → **OFF**). Production `startDelivery` does **not** call these.

---

## Cost classes

| Component | Class |
| --- | --- |
| Completion fuel | `NOT_CHARGED` (already paid in play) |
| Planning maintenance+toll+other | `ACCEPTANCE_FROZEN` on issued snapshot |
| Driver at completion | `NOT_CHARGED` |
| Late / failure cash penalty | `COMPLETION_DERIVED` from `actualTravelHours` (**client execution**, not anti-cheat) |
| Fragile condition surcharge | `LOCAL_ONLY` |

**Economic input authority (issued snapshot):** server  
**Execution progress authority:** client

---

## Offline / legacy

Offline ROAD complete/progress **unchanged**. Canonical accept is online-only; no risky accept queue. Offline local jobs stay `LEGACY_LOCAL_ONLY_DELIVERY` if never issued.

---

## Shadow parity

Fixture issuance → local helper vs `prepareCanonicalRoadDeliverySettlement` → **MATCH** on gross / expenses / penalty / net / fuel-on-completion=0.

Live city-stock contracts are **not** claimed MATCH (issuance missing).

---

## Next

**STEP 29G — CANONICAL ROAD CONTRACT ISSUANCE** (server-owned live offers, likely from a market epoch), then settlement activation. Do not enable HUD overlay until live issuance + execution policy are explicit.

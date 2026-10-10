# Map V2 — Multimodal RAIL offer generation foundation (Step 27)

## 1. Purpose

Deterministic, isolated **offer candidates** for future ROAD→RAIL→ROAD contracts.

Not live Contracts UI. Not acceptance. Not shipment creation. Not money.

Live modules: `src/domain/multimodalRailOffer.ts`, `src/domain/multimodalRailOfferEconomics.ts`

## 2. Offer vs Contract vs Shipment

| Concept | Meaning |
|---|---|
| ROAD `Contract` | Live player-facing ROAD job in `availableContracts` |
| `MultimodalRailOffer` | Pre-acceptance commercial intent (this step) |
| `PersistedMultimodalShipment` | Future accepted execution (Step 22 schema, still unused) |
| `Delivery` | Live ROAD execution only |

Offers are never appended to `availableContracts`.

## 3. Existing ROAD generator audit

`src/simulation/contracts.ts` `generateContracts` / `generateContractForProduct`:

- Origin/destination from city pairs + `routes.ts`
- Cargo: `ProductId`; **tonnes** = `amount` = `cargoWeight`
- Amount from surplus/shortage × 0.7, clamped to truck/level bands; `randomBetween` / `randomIntBetween` for IDs and ranges
- Payment: `calculateContractPayment` via `contractEconomics` (trip cost + target margin + caps)
- Deadline: `calculateDeadlineHours` = estimated duration × urgency/perishability buffers, clamped 4–168 h
- IDs: `contract_{origin}_{dest}_{product}_{createdAt}_{sequence}` (uses game time)
- Expiry: `calculateContractExpiresAt` (market listing lifetime)
- Level: `getRequiredLevelForTonnage`; playability is a **UI filter**, not a generation requirement
- Must stay untouched. Step 27 does not call it.

## 4. Transport pattern

Exactly `ROAD_RAIL_ROAD`. No SEA/AIR/ROAD-only multimodal offers.

## 5. Supported RAIL routes

Same Step 26 corridors: Adana↔Ankara, Adana↔Diyarbakır, Ankara↔İstanbul, Ankara↔İzmir, İstanbul↔İzmir. Both commercial directions.

## 6. Unresolved RAIL

Bursa, Antalya, Trabzon — never generated.

## 7. Structural eligibility

Gameplay cities + accepted corridor + Step 25 READY ROAD access + valid cargo tonnes + READY duration + READY tariff + READY economics.

No “resolve later.”

## 8. Fleet feasibility

Live ROAD offers appear even when the perfect truck is busy. Step 27 mirrors that:

- Generator is **structural** (no fleet input).
- `evaluateRailMultimodalOfferAcceptance` optionally runs Step 25 planning.
- `canAcceptNow` is **always false** in Step 27 (no accept implementation; `MULTIMODAL_OFF`).
- Future acceptance **must revalidate** (`PLANNING_ONLY_REVALIDATE_AT_ACCEPTANCE`). Offers do not freeze truck ids.

## 9–10. Cargo

Production `ProductId` + tonnes bands **1, 5, 10, 25**. Starter truck capacity 25 t. No RAIL-only cargo. No fake units.

## 11. Deterministic generation

Explicit `generationSeed` (`[A-Za-z0-9._-]{1,64}`). Mulberry32 shuffle for selection. No `Math.random` / `Date.now`.

## 12. Offer identity

`railOffer:{seed}:{origin}:{dest}:{productId}:{tonnes}`

Not a shipment id. Not `shipment:{id}:revenue`.

## 13. Schema

`RAIL_MULTIMODAL_OFFER_SCHEMA_VERSION = 1`. Unknown schema fail-closed.

## 14–16. Payment / tariff / ROAD opex

Economics policy: `multimodal-rail-offer-economics-v1`

```
roadAccessOpex = fuel + maintenance on Step 25 access km
  using STANDARD_ROAD_ACCESS_COST_PROFILE (estimateFuelPerKm, baseFuelPrice)
  NO routes.ts city-pair tolls, no cargo handling, no driver wages
expenses = railCarrierCost + roadAccessOpex
playerPayment = round(expenses × 1.22 + 180)
expectedGrossMargin = playerPayment − expenses
```

Reject if margin ≤ 0, margin < $80, or margin/payment < 8%, or payment = carrier cost, or payment > absolute max.

## 17. Gross margin

READY ⇒ `expectedGrossMargin > 0` and floors above. 25 t long routes must not silently go negative — they either READY with positive margin or reject `UNSAFE_ECONOMICS` / `NON_POSITIVE_MARGIN`.

## 18. Deadline

`multimodal-deadline-policy-v1`: integer game seconds.

`deadline = planned + max(7200, round(planned × 0.20))` (perishable ≥ 0.7 uses 0.12). Cap 168 game hours. Must be > planned. Not DEV playback.

## 19. Offer expiry

`DEFERRED_NOT_IN_LIVE_POOL`. Isolated generator is not a market listing.

## 20. Progression

`getRequiredLevelForTonnage` vs optional `playerLevel` (default 1). No extra RAIL reputation gate. Feature rollout is separate (`MULTIMODAL_OFF`).

## 21. Supply/demand

Not wired. Isolated candidate grid (corridors × products × bands). Live surplus/shortage stays in `contracts.ts`. Avoids a second economy and `Math.random` amount bands.

## 22–25. Snapshots (offer object only, not save)

- Duration: policy, total/movement/transfer game seconds
- Tariff: Step 26 snapshot
- Economics: payment, rail cost, ROAD opex, margin, currency, policy
- ROAD access: route refs, metres, infra ids — **not** truck ids

## 26. Settlement accounting (future, not implemented)

**NET AT FINAL SETTLEMENT** for the third-party RAIL carrier cost (one idempotent `shipment:{id}:revenue` breakdown). ROAD fuel/maintenance on first/last mile should later follow live ROAD execution semantics. No cash in Step 27.

## 27. Feature rollout

`isRailMultimodalOfferGenerationAvailable()` is false while `MULTIMODAL_FEATURE_ROLLOUT === MULTIMODAL_OFF`. DEV inspector calls the generator directly. Production Contracts UI must not.

## 28. Fail-closed

Invalid seed, unsupported route, unresolved cities, missing ROAD access, bad cargo, duration/tariff/economics failure, unknown schema.

## 29. Non-goals

Accept, persist offers, live pool, MapScreen, Firestore, SEA/AIR offers, train ownership, 5 km stub.

## 30. Step 28 handoff

Production-facing multimodal **UI foundation** may render these offers behind flags. Must not accept or settle.

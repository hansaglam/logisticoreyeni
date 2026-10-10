# Map V2 — Multimodal RAIL tariff foundation (Step 26)

## 1. Purpose

Deterministic **third-party RAIL carrier COST** for future ROAD→RAIL→ROAD shipment planning.

This is not live RAIL activation, not contract generation (Step 27), not acceptance, not settlement, not payout, not truck reservation, and not a save write.

Live module: `src/domain/multimodalRailTariff.ts`  
Policy: `multimodal-rail-tariff-v1`

## 2. Existing production economy audit

| Area | Code current value |
|---|---|
| Player cash | integer dollars (`player.money`). `STARTING_MONEY = 20_000` in `gameStore.ts`; `STARTER_MONEY = 20_000` in `localSaveMeaning.ts` |
| Contract payment | integer `$` (`Contract.payment`), `Math.round` throughout `contractEconomics.ts` |
| L1 payment band | `paymentMin: 2_000`, `paymentMax: 8_000` (`contractPaymentBalance`) |
| Absolute payment max | `65_000` |
| Starter truck | `STARTER_TRUCK.purchasePrice = 45_000`, capacity **25 t** |
| Fuel estimate | `estimateFuelPerKm: 0.32`, `baseFuelPrice: 1.72` $/L, `fuelCostMultiplier: 1.25` |
| Maintenance estimate | `estimateMaintenancePerKm: 0.4`, `maintenanceCostMultiplier: 1.35` |
| Cargo handling (ROAD) | `cargoHandlingCostPerTon: 18` in `contractEconomics.ts` |
| ROAD city-pair km | `src/data/routes.ts` (e.g. Ankara–İstanbul **450 km**, İzmir–Ankara **585**) |
| Driver wages | not a per-delivery ledger line; drivers belong to ROAD execution |
| Cargo type | `ProductId` for warehouse/market; **no** RAIL-specific handling surcharge in live contracts |

**Historical prompt values vs code:** starting cash ~$20k, L1 ~$2–8k, starter truck ~$45k — **match current code**. Code wins.

## 3. Cargo quantity basis

Production `Contract.amount` and `Contract.cargoWeight` are **tonnes** (see `src/types/game.ts`).

Step 26 uses `cargoQuantityUnit: 'tonnes'`. No invented kg→capacity conversion. kg, pallets, and load-units are **unsupported** (fail closed).

This is gameplay mass already used for truck capacity, not a real freight quotation.

## 4. Third-party rail carrier model

The player does not own locomotives, wagons, or track. The tariff is a **booked carrier charge** for the accepted RAIL line-haul.

No `trainId`, `railFuel`, `railMaintenance`, `wagonId`, `railDriverId`.

## 5. No official TCDD prices

Coefficients are **GAMEPLAY_BALANCE_CONSTANT**. Geography may be OSM source-backed. Money is not TCDD, not scraped, not licensed commercial tariff.

## 6. Tariff equation (v1)

```
distanceKm = distanceMeters / 1000
lineHaul   = Math.round(distanceKm × cargoTonnes × 0.08)
gross      = 350 + lineHaul + 0
carrierCost = max(500, gross)
```

One short equation. No city, cargo-type, level, or reputation multipliers.

`carrierCost ≠ playerReward ≠ profit ≠ shipment:{id}:revenue`

## 7. Constants

| Symbol | Value | Role |
|---|---|---|
| `RAIL_TARIFF_BASE_FEE_DOLLARS` | 350 | booking / handling |
| `RAIL_TARIFF_RATE_DOLLARS_PER_TONNE_KM` | 0.08 | line-haul |
| `RAIL_TARIFF_MINIMUM_CHARGE_DOLLARS` | 500 | floor |
| `RAIL_TARIFF_TERMINAL_HANDLING_DOLLARS` | 0 | explicit v1 zero |

## 8. Policy version

`multimodal-rail-tariff-v1` on every result.

Later `v2` must not reprice an accepted shipment. Future acceptance snapshots the estimate (`snapshotReadyRailTariff`). Step 26 does **not** persist that snapshot.

## 9. Money unit

Integer game dollars (`USD_GAME_INTEGER`), same as `player.money` / `Contract.payment`. No cents ledger.

## 10. Rounding

`math-round-half-toward-plus-infinity-integer-dollars` via `Math.round` (production convention). Line-haul is rounded; base/min/terminal are already integers.

## 11. RAIL distance authority

Only `SOURCE_BACKED_RAIL_LENGTH` plus the **frozen** diagnostic metre length for that canonical pair.

Not used: straight-line, `routes.ts` km, ROAD access km, SkPath, screen pixels, duration×rate, visual corridors.

No runtime Dijkstra. Domain does not import the RAIL graph.

## 12. Accepted priced RAIL corridors

| Pair | Canonical reference | Metres |
|---|---|---|
| Adana ↔ Ankara | `domain.canonical.rail.adana.ankara` | 624830 |
| Adana ↔ Diyarbakır | `domain.canonical.rail.adana.diyarbakir` | 968295 |
| Ankara ↔ İstanbul | `domain.canonical.rail.ankara.istanbul` | 559329 |
| Ankara ↔ İzmir | `domain.canonical.rail.ankara.izmir` | 812366 |
| İstanbul ↔ İzmir | `domain.canonical.rail.istanbul.izmir` | 874998 |

Undirected overview ⇒ **symmetric** A→B / B→A (sorted reference).

## 13. Transfer monetary fee

`RAIL_TRANSFER_MONETARY_FEE = 0` in v1. Step 24 dwell (2700 g-s) is time only.

## 14. Minimum charge

$500 after summing components. Small 1 t Ankara–İstanbul line-haul + base is below the floor ⇒ total $500.

## 15. Cargo-type modifiers

**None** in v1. `ProductId` / fragile / hazardous do not change RAIL carrier cost.

## 16. City / route modifiers

**None**. City ids only validate the accepted pair.

## 17. Capacity abstraction

Accepted RAIL service is assumed to have abstract third-party capacity if cargo quantity is finite and `> 0`. No wagon allocation.

## 18. Calibration

See `scripts/map-v2/rail-tariff-calibration.ts` and `src/mapV2/generated/multimodal/turkey-rail-tariff-calibration.report.json`.

10 t Ankara–İstanbul carrier cost is hundreds of dollars vs L1 payments $2k–$8k and $20k starting cash — meaningful, not free, not fatal.

First/last-mile ROAD fuel/toll/maintenance stay **out** of this tariff.

## 19. Freeze-at-acceptance

Once a future multimodal contract is accepted, `economicSnapshot.railCarrierCost` + `railTariffPolicyVersion` are frozen. Reload uses the snapshot, not the latest policy.

## 20. Settlement relationship

Step 23 identity `shipment:{shipmentId}:revenue` is unchanged and unused here. Step 26 does not write `financeLedger`, cash, or `canonicalDeliveryCompletions`.

## 21. Persistence

`SAVE_GAME_VERSION` remains **6**. Optional comment-only fields exist on the Step 21 prototype `ProductionEconomicSnapshot`. Live `multimodalShipments[]` is not written.

## 22. Fail-closed statuses

`READY`, `INVALID_INPUT`, `INVALID_DISTANCE`, `INVALID_CARGO_QUANTITY`, `UNSUPPORTED_CARGO_UNIT`, `MISSING_ROUTE_REFERENCE`, `UNSUPPORTED_RAIL_ROUTE`, `UNRESOLVED_RAIL_INFRASTRUCTURE`, `UNSUPPORTED_SCHEMA`, `NOT_EXECUTABLE`, `UNSAFE_ARITHMETIC`.

No silent 1-tonne default. `intent: 'CHARGE'` → `NOT_EXECUTABLE`.

## 23. Explicit non-goals

Live RAIL, Step 27 offers, MapScreen, `routes.ts`, Firestore, Cloud Functions, train ownership, SEA/AIR tariffs, ROAD opex folded into RAIL cost.

## 24. Future Step 27

Offer generation may combine: Step 24 duration + Step 25 assignment feasibility + this carrier cost. Step 26 does **not** emit offers or player rewards.

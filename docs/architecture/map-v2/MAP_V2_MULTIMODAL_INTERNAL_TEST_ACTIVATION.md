# Map V2 — Multimodal INTERNAL_TEST activation (Step 29)

## 1. Purpose

Controlled ROAD→RAIL→ROAD acceptance and persisted execution for **INTERNAL_TEST only**. Public production stays ROAD-first. Settlement, player payment, and rail carrier expense are **not** executed.

## 2. INTERNAL_TEST rollout gate

Env: `EXPO_PUBLIC_MULTIMODAL_ROLLOUT`

- `INTERNAL_TEST` → mutation + new RAIL offers allowed
- missing / any other value → `MULTIMODAL_OFF`

Resolver: `src/domain/multimodalFeatureRollout.ts`

Launch:

```bash
EXPO_PUBLIC_MULTIMODAL_ROLLOUT=INTERNAL_TEST npx expo start --clear
```

No `__DEV__` requirement (TestFlight-capable). No settings toggle. No hidden tap sequence.

## 3. Default OFF

`MULTIMODAL_FEATURE_ROLLOUT` resolves at import to OFF unless the env is exactly `INTERNAL_TEST`. Public builds without that env are OFF.

## 4. Preview vs mutation

- `EXPO_PUBLIC_MAP_V2_MULTIMODAL_UI_PREVIEW=true` + `__DEV__` + OFF → visual Raylı preview, CTA **Yakında**, no accept.
- Preview alone **cannot** call prepare/commit.
- INTERNAL_TEST enables CTA **Teklifi Kabul Et** when prepare returns `READY_TO_COMMIT`.

## 5. Offer acceptance

`acceptRailMultimodalOfferInternal` in `gameStore` (not `startDelivery`). Isolated `MultimodalRailOffer` → `PersistedReadableMultimodalShipment` in `multimodalShipments[]`. Never inserted into `Contract[]` / `Delivery[]`.

## 6. Prepare / commit

- Prepare (pure): `prepareRailMultimodalAcceptance`
- Commit (next-state): `commitRailMultimodalAcceptance`

Prepare does not mutate fleet. Commit builds the next player + shipment array, then the store applies one `set`. Simulated throw → original state.

## 7. Acceptance idempotency

Same `sourceOfferId` already in `multimodalShipments` → `OFFER_ALREADY_ACCEPTED`. UI pending flag + domain idempotency.

## 8. Shipment ID

`mls.` + offerId with `:` → `.`  
`offerId ≠ shipmentId ≠ settlementId ≠ completionId`

Settlement/completion still derived: `shipment:{shipmentId}:revenue` / `:completion`.

## 9. Resource reservation

Optional `assignedMultimodalShipmentId` on Truck / Driver / Trailer.

- Origin first-mile: truck `on_route` (active)
- Destination: truck stays `idle` but reserved (not driving)
- ROAD `startDelivery` / transfer / `isTruckIdle` reject reserved assets

`transferring` is **not** reused (that is city-to-city truck transfer).

## 10–13. First-mile / rail / last-mile / driver / trailer

Cargo transfers. Vehicles do not board the train.

- First-mile truck/driver/trailer: origin city → origin terminal abstraction → remain **origin city** after first-mile (city-level model; no new geo save field).
- Destination resources reserved at accept, activate only at `LAST_MILE_ROAD`, remain **destination city**.
- Trailers do not travel by RAIL.

## 14. Snapshot freeze

Duration (v1 + per-stage seconds), rail tariff, economics, deadline, ROAD access, assignment IDs. Reload must not recompute.

## 15–16. Duration / offline

`multimodal-execution-v1` consumes frozen **integer game seconds**. Live ticks use `advanceTime` hours → `floor(hours * 3600)`. Mapping: `getMsPerGameHour` / `realMsToGameHours` (same as ROAD). Not `DEV_PLAYBACK_REAL_MS_PER_GAME_HOUR`.

Offline catch-up reuses ROAD `advanceTime` hours, including overflow into later stages. Excess time after total duration completes **once** → `COMPLETED_UNSETTLED`.

## 17. Kill switch

OFF: `allowNewMultimodalContractCreation = false` (no new offers/accept). In-flight executable v1 shipments still progress. Array is never deleted.

UI: Raylı tab remains if persisted executable shipments exist; copy explains no new offers.

## 18. Cancellation

`cancelMultimodalShipmentInternal` (INTERNAL_TEST gated). Marks `CANCELLED`, releases remaining reservations, no money/reputation/XP.

## 19. COMPLETED_UNSETTLED

Final ROAD leg done. `settlementState = NOT_SETTLED`. No `player.money` change, no ledger, no `canonicalDeliveryCompletions`, no reputation/XP.

## 20–21. No settlement / money

Rail carrier cost remains NET AT FINAL SETTLEMENT (later step). Acceptance does not debit carrier or credit `playerPayment`.

## 22. Persistence / cloud

`SAVE_GAME_VERSION` remains **6**. Nested shipment schema v1 with additive execution fields. Same save blob / `sanitizeForFirestore`. No new Firestore collection.

## 23. LWW / two-device

Cloud save is last-write-wins. Concurrent devices can conflict on reservations. INTERNAL_TEST accepted risk. No server reservation. No double money yet because settlement is not live.

## 24. Manual QA

Required on iOS (iPhone 17e / available simulator). Automated tests do not replace it.

INTERNAL_TEST fleet fixture (QA only): `applyInternalTestMultimodalFleetFixture` adds production-typed idle trucks/drivers at origin and destination. Does not change new-game starter fleet. Re-using the same fixture IDs across different destination cities can collide; add a city-specific truck or rely on an idle truck already at that city.

iOS QA (iPhone 17e, `com.ethemsincar.logisticore`, 2026-09-22):

- OFF: Raylı hidden (`qa-step29-02-contracts-off.png`).
- INTERNAL_TEST: accept Adana→Ankara electronics; duplicate accept `OFFER_ALREADY_ACCEPTED`; money `$20,000` unchanged (`qa-step29-03-internal-rail.png`).
- Restart: same `shipmentId` `mls.railOffer.internal-test-qa.adana.ankara.electronics.5`, frozen `$943`, progress resumed (`qa-step29-04-restart-resume.png`).
- Completion: `COMPLETED_UNSETTLED` / “Tamamlandı · ödeme bekliyor”; ledger/XP/reputation unchanged (`qa-step29-05-completed.png`).
- Cancel: fruit shipment `CANCELLED`, reservations released, money unchanged.
- Kill switch OFF: no new offers, copy “Yeni teklif yok. Mevcut sevkiyat devam edebilir.”; Ankara→İzmir remained `ACTIVE` / `RAIL_LINEHAUL` (`qa-step29-06-kill-switch-off.png`).

Android: `ANDROID_MANUAL_QA_BLOCKED_TOOLCHAIN` (`adb` missing, JRE absent).

## 25. Known limitations

- Max **1** active INTERNAL_TEST shipment (`MAX_ACTIVE_MULTIMODAL_SHIPMENTS_INTERNAL`).
- Fuel: **VALIDATED_NOT_CONSUMED** (sufficiency at accept; no live deduction).
- City-level location only after first-mile.
- No MapScreen overlay.
- No SEA/AIR acceptance.
- RAIL/SEA/AIR remain `FOUNDATION_ONLY`.
- Android toolchain may still be blocked (`adb` / JRE).

## 26. Next step

**MULTIMODAL RAIL SETTLEMENT / AUTHORITY FOUNDATION** — do not pay `playerPayment` or post `shipment:{id}:revenue` as applied until that step. Do not jump to SEA.

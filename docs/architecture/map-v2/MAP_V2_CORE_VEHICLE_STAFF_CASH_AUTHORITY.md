# Map V2 — Core vehicle / staff cash authority (Step 29R)

**Status:** `CORE_VEHICLE_STAFF_CASH_AUTHORITY_PASS_FOUNDATION`

**Families:**

| Family | Status |
| --- | --- |
| LEASE | `LEASE_START_INTERNAL_TEST_CANONICAL_PUBLIC_UNWIRED` |
| DRIVER_HIRE | `DRIVER_HIRE_AUTHORITY_INTERNAL_POLICY_ONLY` |
| DRIVER_FIRE | `DRIVER_FIRE_INTERNAL_TEST_CANONICAL_ROSTER` |
| VEHICLE_SALE | `VEHICLE_SALE_INTERNAL_TEST_CANONICAL_PUBLIC_UNWIRED` |
| VEHICLE_RECOVERY | `VEHICLE_RECOVERY_BLOCKED_CLIENT_EXECUTION_STATE` |

HUD overlay/listener remain **off**. `cashAuthorityVersion` **0**. Public lease/hire/fire/sale/recovery UI **unwired**. Critical HUD coverage remains **24 / 0 / 24**.

Gate: `CANONICAL_CORE_VEHICLE_STAFF_CASH=INTERNAL_TEST` (missing = OFF). Not Expo.

---

## 1. Lease audit

Public `leaseTruck(catalogId, period)`:

- Entity: new local `Truck` (`${catalogId}-lease-${Date.now()}`).
- Offer: `TRUCK_MARKET.weeklyLeaseCost` required.
- Immediate debit: `resolveLeaseOfferCost(weekly, weekly|monthly)` — monthly = `round(weekly * 3.5)`.
- Duration: 7 days / 30 days (game hours via `getLeaseDurationHours`). Starting condition/fuel from catalog + `normalizeTruckFuel`. Upgrades none. `ownershipType: leased`. Cannot sell leased trucks (`canSellTruck`).
- Recurring: **not** charged daily. `chargedTruckLeaseTotal = 0`. `leaseDailyCost` is UI accrual only.
- Return/expiry: `processExpiredTruckLeases` / rental lifecycle uses **client** `currentTime` and local deliveries. No buyout. No early-return fee in domain.

## 2–3. Lease authority + recurring

INTERNAL `createCanonicalVehicleLease` derives prepaid from the same catalog helper. Client cannot submit price.

`LEASE_RECURRING_COST_BELONGS_TO_DAILY_OPEX`: do **not** debit recurring here (would double-count a future opex step). V1 production daily charge is already 0 because prepaid.

Return/expiry: `LEASE_RETURN_BLOCKED_CLIENT_CLOCK`. No canonical return callable.

## 4–6. Canonical lease path

`users/{uid}/canonicalVehicleLeases/{leaseId}` schema v1: leaseId, assetId, catalogModelId, period, prepaidCost, recurringCost (daily equivalent for later opex), weeklyLeaseCost, status ACTIVE, ownerUid, timestamps.

Mints `cfa_lease_*` fleet asset `ownershipType: leased`, `lifecycleStatus: LEASE_ACTIVE`.

Receipts: `canonicalLeaseReceipts/{leaseIntentId}`. Cash id: `fleet:{assetId}:lease:{leaseIntentId}`.

## 7. Driver-pool audit

Live hire is **not** a random client-generated pool. `DRIVER_POOL` in `src/data/drivers.ts` is a static catalog. `hireDriver(poolId)` uses `findDriverPoolItem`; instance `id === poolId`. Signing fee = `hiringFee`. Salary frozen as `salaryPerDay`. Coming-soon rows rejected.

Step 29P `DRIVER_HIRE_BLOCKED_CLIENT_POOL_IDENTITY` was too strong: identity is catalog. Remaining INTERNAL gap: **company level is save-owned**, so hire skips level (INTERNAL_POLICY_ONLY).

## 8–10. Canonical driver offers / roster / hire

Offers freeze `DRIVER_POOL` as `canonical-driver-offer-v1` (deterministic catalog, no RNG). `hireCanonicalDriver(poolId, hireIntentId)`:

- validates unexpired catalog row (no comingSoon)
- derives hiringFee
- debits `serverState.cash`
- creates `canonicalDrivers/{poolId}` status hired, salary frozen
- increments `canonicalDriverRosterMeta/current.activeCount`
- cash txn + `canonicalDriverReceipts`

No client driver object. Hire once per poolId.

## 11–12. Fire + salary

Public `fireDriver`: cannot fire last local driver; cannot fire if driving / active delivery; severance = `round(dailySalary * driverSeveranceDays)` (2 days). Immediate debit.

`fireCanonicalDriver` uses roster only. Rejects `driver-starter-1` (legacy). Last canonical driver blocked. Assigned canonical delivery (`assignedCanonicalDeliveryId`) blocked. Canonical ROAD does not assign these drivers yet, so INTERNAL hires stay idle unless that field is set.

Salary is **not** debited at hire. `DRIVER_SALARY_BELONGS_TO_DAILY_OPEX`. Step 29S INTERNAL `settleCanonicalDailyOpexInternal` now charges hired canonical salaries on a server 24h cursor. Public daily opex still local.

## 13–17. Sale, mileage, receipts

Public `sellTruck` uses `calculateTruckResaleValue` → `calculateCanonicalTruckResaleValue(basePrice, condition, totalMileageKm, upgradeValue, isLeased)`. Fuel does **not** affect value. Leased = 0 / unsellable. Active delivery/transfer blocks. Last owned truck UX is **local-only** (not ported).

Mileage **does** affect sale. Canonical assets now store `mileageKm` / `mileageRevision` (init 0 at mint). Successful canonical ROAD wear applies `round(distanceKm)` once in the wear transaction. `SERVER_DERIVED_FAILURE` / non-SUCCESS: increment **0** (partial distance not guessed).

`sellCanonicalFleetAsset`: SERVER_CANONICAL / catalog / starter / fixture-with-catalog-price. Rejects legacy ids, leased, reserved (`activeCanonicalRoadDeliveryId`), already SOLD, trailers. Server derives sale value. Credit + tombstone SOLD + cash txn + `canonicalVehicleSaleReceipts`. Id: `fleet:{assetId}:sale:{saleIntentId}`.

Marketplace listing query is **not** implemented (INTERNAL catalog assets are not listed). Last-truck UX not server-enumerated.

## 18–20. Recovery

Public `resolveVehicleStateIssue` uses `detectVehicleStateIssue` from **local** truck location/fuel/status, local deliveries/transfers/warehouse transfers, and `vehicleRecovery` usage. Cost from `vehicleStateRecoveryConfig` (first free, subsequent cash + reputation). May park truck, cancel delivery, grant emergency liters.

Eligibility is client execution state. `recoverCanonicalVehicle` **fail-closed**: `VEHICLE_RECOVERY_BLOCKED_CLIENT_EXECUTION_STATE`. No cash, fuel, condition, or location mutation.

## 21–25. IDs, receipts, concurrency, legacy

| Op | Transaction id |
| --- | --- |
| Lease start | `fleet:{assetId}:lease:{leaseIntentId}` |
| Hire | `driver:{driverId}:hire:{hireIntentId}` |
| Fire | `driver:{driverId}:fire:{fireIntentId}` |
| Sale | `fleet:{assetId}:sale:{saleIntentId}` |
| Mileage | applied with wear (`delivery:{id}:mileage` identity reserved; not a second cash debit) |

Receipts immutable (create-once). Retry same intent → same receipt. Conflicting payload → conflict. Reservation blocks sale. Legacy fleet/staff rejected. `users/{uid}.money`, save `player.money`, `financeLedger` unchanged.

Public UI: local. Divergence intentional.

## 26. Coverage / next

Fuel still HUD-blocks. Daily opex still blocked (now has canonical roster + lease recurring fields to consume later). Warehouse/cargo/rewards/production ROAD/incident parity unchanged.

**Recommended Step 29S:** canonical daily opex / staff+lease+warehouse clock — **or** warehouse state authority if opex still lacks a trusted period clock.

**Stop:** no HUD, no public wiring, no multimodal settlement, no SEA/AIR.

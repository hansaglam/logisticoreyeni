# Map V2 — Canonical fleet runtime location (Step 29AC)

**Status:** `CANONICAL_FLEET_RUNTIME_LOCATION_AUTHORITY_PASS_INTERNAL_ONLY`

**Policy:** `canonical-fleet-runtime-location-internal-v1`

**Gate:** `CANONICAL_FLEET_RUNTIME_LOCATION_AUTHORITY=INTERNAL_TEST` (missing = OFF)

**Issuance when a runtime summary is present:** `canonical-road-contract-issuance-internal-production-parity-v3`

**Issuance readiness:** `ROAD_CONTRACT_ISSUANCE_BLOCKED_PUBLIC_PROGRESSION`

v1, v2, and v3 batches stay immutable. v4 uses the INTERNAL game-time clock. Public Contracts UI and production ROAD settlement stay off.

## 1. Production runtime model

Truck fields live on the save truck: `currentCityId`, `homeCityId`, `status`.

`isTruckIdle` is `status === 'idle'` and no multimodal reservation. `getIdleTruckOriginCityIds` collects those cities. `getMaxIdleTruckCapacity` is the max capacity among idle trucks. Owned capacity still includes busy trucks for unreachable-tonnage checks.

Origin score uses `contractGenerationBalance.originCityWeights`: idle 45, active-delivery destination 30, busy 15, market opportunity 20, other 5. The highest matching weight wins. There is no separate home-city weight. `homeCityId` is only a fallback when `currentCityId` is missing (`resolveTruckCityId`).

## 2. Status values

`idle`, `on_route`, `maintenance`, `transferring`, `out_of_fuel`, `marketplace_locked`.

## 3. City semantics

- Accept: status becomes `on_route`. City stays the current city. The truck is not moved to the contract origin.
- Accept requires the truck already be in the contract origin (`isTruckAtContractOrigin`).
- Success: `applyTruckArrivalAtCity` sets status `idle` and city to the destination.
- Cancel and `failDelivery`: status `idle` and city back to the delivery origin.
- Out of fuel: status `out_of_fuel`. City is not changed. The truck is not idle.
- Roadside refuel resumes `on_route`. City is not changed.
- Transfer is a separate client feature: status `transferring`, then idle at the destination city. It is not canonical.
- Recovery still depends on client execution state.

## 4. Initial location

Catalog purchase and lease in the save use `player.homeCityId ?? 'izmir'`. The catalog template used by the canonical asset builder hardcodes `izmir` and does not store a runtime city on the economic asset.

Home city is save-owned. Canonical runtime does not read it. INTERNAL fixtures start at `izmir` with class `INTERNAL_TEST_RUNTIME_FIXTURE`. That is `FLEET_RUNTIME_INITIAL_LOCATION_BLOCKED_HOME_CITY_AUTHORITY` for public purchase and lease.

## 5. Schema

`users/{uid}/canonicalFleetRuntime/{assetId}`

Fields: `currentCityId`, `runtimeStatus`, `activeCanonicalRoadDeliveryId`, `routeOriginCityId`, `routeDestinationCityId`, `runtimeRevision`, `runtimePolicyVersion`, `authorityClass`, `failureLocationClass`.

Client write is false. There is no `setTruckLocation` callable. `runtimeRevision` is separate from economic and fuel revisions.

While `on_route` or `out_of_fuel`, `currentCityId` remains the last city (the origin). The route endpoints are stored beside it. Idle-origin scoring uses only `idle` trucks.

Server-derived failure and cancel return the truck to `routeOriginCityId`. A client-reported failure sets `failureLocationClass = CLIENT_REPORTED_UNVERIFIED` and does not invent a new city. That truck is excluded from idle scoring.

## 6. Generator

When the runtime gate is on, issuance builds a sorted availability summary and passes idle, busy, and active-destination cities plus idle max capacity into `generateContracts`. The batch freezes `fleetRuntimeSummary`. A later city change does not rewrite the batch.

Acceptance, when the runtime gate is on, requires the selected truck to be idle in the contract origin, then sets `on_route` without changing city.

## 7. Still blocked

Transfer is client-owned. Recovery is client execution state. Lease return is still a game-time clock. Legacy trucks are not imported. Assets minted before this step without a runtime document fail closed (`FLEET_RUNTIME_LOCATION_UNAVAILABLE`). Step 29AD moved supported canonical offer expiry onto an INTERNAL game-time clock. Step 29AE moved manual refresh onto that clock. Public progression and the Contracts screen stay local.

## 8. Next step

Step 29AF added the server-owned `canonicalCompanyProgression/current` doc for new canonical accounts. Runtime behavior is unchanged. Completion XP needs a frozen delivery risk tier (driver attention/speed, truck reliability), which the fleet/accept path does not provide yet.

**STEP 29AG — CANONICAL DELIVERY RISK-TIER / DRIVER ASSIGNMENT AUTHORITY.** Do not wire the public Contracts screen.

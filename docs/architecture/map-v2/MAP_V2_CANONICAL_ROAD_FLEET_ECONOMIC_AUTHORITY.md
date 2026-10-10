# Map V2 — Canonical ROAD fleet economic authority (Step 29J)

**Status:** `CANONICAL_ROAD_FLEET_ECONOMIC_AUTHORITY_PASS_INTERNAL_FIXTURES`

**Internal fixtures:** `INTERNAL_FIXTURE_AUTHORITY_READY`  
**Production fleet:** `PRODUCTION_FLEET_AUTHORITY_BLOCKED_LEGACY_SAVE_STATE`  
**Settlement readiness:** `ROAD_CANONICAL_SETTLEMENT_BLOCKED_PRODUCTION_INCIDENT_PARITY`

HUD overlay/listener off. `canUseServerAuthoritativeSettlement()` false (`ROAD_ECONOMY_NOT_SERVER_CANONICAL_PRODUCTION_FLEET`). `SAVE_GAME_VERSION` **6**.  
`MULTIMODAL_OFF`. RAIL/SEA/AIR `FOUNDATION_ONLY`. **No cash.**

Live `player.trucks` / `player.trailers` remain the runtime/UI source.

---

## 1. Why truck authority blocked settlement

29H/29I can derive start bundle and timing for INTERNAL_TEST **in-memory fixtures**. Live condition, `maintenanceCost`, and upgrades live in the save blob. A client could pick those numbers. That is not server authority.

---

## 2. Fleet-state audit (summary)

| FIELD | ENTITY | MONEY? | AUTHORITY | MUTATION | SERVER COPY | VALIDATE? | SETTLEMENT? | EXEC ONLY? | MIGRATION |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| condition | Truck | yes (maintenance, fragile start) | save | complete/incident/repair | marketplace `ownedTrucks.condition` not ROAD live | no | yes | no | unverified |
| maintenanceCost $/km | Truck | yes | catalog/save | buy | catalog in client | no | yes | no | unverified |
| upgrades | Truck | fuel/duration; maintenance via other fields | save | upgradeTruck | marketplace upgrades snapshot | no | freeze modifiers | fuel prepaid | unverified |
| class/capacity/speed/consumption | Truck | duration/fuel | catalog/save | buy/upgrade | templateId only | partial | freeze | fuel | unverified |
| currentFuelL, city, status, lease | Truck | not completion | save / marketplace lock | play | marketplace status | n/a | no | yes | skip |
| type, capacityBonusTons | Trailer | trailer $/km | save | buy/attach | ownedTrailerIds only | no | if selected | attach local | unverified |
| trailer condition | Trailer | not start bundle | save | wear | no | no | no | yes | skip |
| salary/skill | Driver | periodic | save | hire | no | n/a | **no** | identity | skip |

---

## 3. Economic vs execution split

29J owns **economic profiles** (model, condition, upgrades, maintenance $/km, trailer type/bonus).  
Does **not** own location, fuel tank, job status, or driver assignment.

---

## 4–6. Truck / trailer / driver

Settlement fields: condition, `maintenanceCost`, consumption/capacity/speed/class (duration/fuel preview), upgrade levels.  
Not settlement: name, lease, tank, city, `assignedMultimodalShipmentId`.  
Trailer: type + capacity bonus → `$/km`. Attachment stays local; accept freezes **selected** trailer asset.  
Driver: `DRIVER_NOT_SETTLEMENT_RELEVANT`.

---

## 7. Current server vehicle state

Marketplace `serverState.ownedTrucks` has identity, template, snapshot condition/upgrades for **marketplace cash**, not live ROAD wear. Catalog `buyTruck` is local. Do not reuse those snapshots as ROAD economic authority.

---

## 8–12. Canonical schema / identity / ownership

Path: `users/{uid}/canonicalFleetAssets/{assetId}`  
Schema **1**. Owner read, client write **false**.  
Asset IDs for INTERNAL_TEST = fixture keys (`fixture-healthy`, `fixture-degraded`, `fixture-upgraded`, `fixture-standard`).  
Ownership = path + `ownerUid`. Cross-user: other uid’s collection → `CANONICAL_TRUCK_NOT_FOUND`.

---

## 11–16. Bootstrap / legacy

Callable `bootstrapInternalCanonicalFleetFixtures`  
Request: `{ canonicalSchemaVersion: 1 }` only.  
Backend env **`CANONICAL_ROAD_INTERNAL_TEST=INTERNAL_TEST`**. Missing → `FLEET_AUTHORITY_NOT_AVAILABLE`.  
Idempotent. Conflicting existing doc → `CANONICAL_FLEET_ASSET_CONFLICT`. No cash.

Live save trucks: `LEGACY_CLIENT_FLEET_UNVERIFIED`. No generic `registerMyTruck`.

---

## 13–15. Condition / upgrades / trailer

INTERNAL_TEST: **immutable fixture** values (Model C). No `setTruckCondition` / `setUpgrades`.  
Public condition/upgrade mutations remain save-local. Future: operation-specific server events.

---

## 16. Revision

`economicRevision` on the asset. Frozen on `executionEconomicsSnapshot` as `truckEconomicProfile.economicRevision` / trailer revision. Later dump edits do not rewrite accepted deliveries.

---

## 17–18. Accept integration

Client: `canonicalTruckAssetId` / `selectedTruckId` (default `fixture-healthy`), optional trailer ids, optional driver id.  
No condition/upgrades/maintenance/toll/net.  
Server loads assets, `freezeExecutionEconomicsFromCanonicalFleet`.  
Errors: `CANONICAL_TRUCK_NOT_FOUND`, `_NOT_OWNED`, `_SCHEMA_UNSUPPORTED`, `_ECONOMICS_INVALID`, trailer equivalents, `LEGACY_CLIENT_FLEET_UNVERIFIED`, `FLEET_AUTHORITY_NOT_AVAILABLE`.

---

## 19. Maintenance parity

Same `calculateContractEconomics` as 29H fixtures. Integer exact for healthy/degraded/upgraded/trailer/no-trailer.

Toll from canonical route. Fuel completion still 0. Driver not charged.

---

## 20–22. Marketplace / catalog / legacy

Marketplace: cash-canonical, **not** ROAD wear authority.  
Catalog buy: still `CANONICAL_READY_WITH_SMALL_SERVER_PORT` — hook later at purchase, not wired.  
Legacy save: not auto-migrated.

---

## 23–25. Gaps

Fragile uses **frozen start** condition; live complete uses completion-time condition.  
Incidents/wear not written to canonical assets.  
FAILED still client-reported.  
Public fleet authority missing.

---

## 26. Next

Do not apply `serverState.cash`. Next likely **STEP 29K — INTERNAL_TEST server-cash shadow** (standard jobs) **or** fragile/failure execution authority, with production fleet migration remaining.

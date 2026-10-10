# Map V2 — Production fleet authority migration (Step 29L)

**Status:** `PRODUCTION_FLEET_AUTHORITY_MIGRATION_PASS_NEW_ASSETS_ONLY`

**Legacy policy:** `NO_AUTOMATIC_LEGACY_MIGRATION`  
**Settlement readiness:** `ROAD_CANONICAL_SETTLEMENT_BLOCKED_PRODUCTION_INCIDENT_PARITY`

HUD overlay/listener off. `canUseServerAuthoritativeSettlement()` false. `SAVE_GAME_VERSION` **6**.  
`MULTIMODAL_OFF`. RAIL/SEA/AIR `FOUNDATION_ONLY`. **No cash from this step.**

---

## 1. Why production fleet blocks settlement

29K can pay `serverState.cash` for INTERNAL_TEST fixture jobs. Live `player.trucks` / `player.trailers` still carry client/save condition, upgrades, and maintenance. Uploading those fields must never mint a trusted asset.

## 2. Lineage audit

| SOURCE | SERVER? | PRICE | MODEL | ID | INIT CONDITION | INIT UPGRADES | SAFE CANONICAL? | TRUST |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Starter `STARTER_TRUCK` | no (local clone) | n/a | catalog constant | `truck-starter-1` | template 88 | none | **new-account helper only** | existing = LEGACY |
| Catalog `buyTruck`/`buyTrailer` | no | local | client catalog | `catalogId-Date.now()` | template | none | helper foundation, **not wired** | LEGACY until server purchase |
| Lease | no | local | catalog | local | template | none | no | LEGACY |
| Marketplace purchase | **cash yes** | listing price | templateId checked | transferred truckId | **listing snapshot** | **listing snapshot** | identity only | economics **client-originated** |
| Marketplace listing create | fee yes | seller | from save snapshot | save truckId | **save** | **save** | no | MARKETPLACE_ECONOMICS_CLIENT_ORIGINATED |
| Save recover starter | no | n/a | STARTER_TRUCK | starter id | clone | clone | no | LEGACY |
| Debug / DEV fleet | no | n/a | local | local | local | local | no | UNSUPPORTED |
| 29J fixtures | INTERNAL_TEST | none | fixture | fixture-* | fixture | fixture | yes | INTERNAL_TEST_FIXTURE |

## 3. Trust classes

`SERVER_CANONICAL` · `SERVER_CANONICAL_PENDING_MIGRATION` · `LEGACY_CLIENT_UNVERIFIED` · `INTERNAL_TEST_FIXTURE` · `UNSUPPORTED`

Local `fleetAuthorityClass` is cache only and **ignored**.

## 4–7. Accounts / migration

**A. New signed-in:** `issueCanonicalStarterFleetAsset` can mint `cfa_starter_v1` with server-chosen model/condition/upgrades. **Not wired** to public signup.

**B. Existing:** save fleet stays `LEGACY_CLIENT_UNVERIFIED`. No overwrite.

**Policy MODEL A:** no automatic legacy migration. Expensive old trucks cannot join canonical settlement until replaced via trusted acquisition or a future explicit (non-silent) migration. Product tradeoff documented: safer than trusting wear history.

**MODEL D (trust save):** forbidden.

## 8–12. Schema / IDs / linkage / ownership

Path remains `users/{uid}/canonicalFleetAssets/{assetId}`. Schema **1**. Production IDs: `cfa_{kind}_{key}` server-derived. Local optional `canonicalFleetAssetId` / `fleetAuthorityClass` / `canonicalEconomicRevision` are cache. Owner = path + `ownerUid`. Transfer: **not implemented** (marketplace economics blocked). Per-user copy+tombstone would be future A.

## 13–22. Mutation authority

| OP | CLASS |
| --- | --- |
| Delivery wear | Pure `deriveCanonicalDeliveryWear` + persist `applyCanonicalRoadDeliveryWear`. SUCCESS_ONLY. Reservation on accept. |
| Incidents | INTERNAL_TEST catalog finalize; production UI local |
| Repair | Pure + INTERNAL_TEST `repairCanonicalFleetAsset`. Production UI local. |
| Upgrade | Pure `deriveCanonicalUpgradeIntent`. Not wired. Cash still local. |
| Fuel / location / status | Out of scope |

Revision: mint starts at 1; `applyTrustedCanonicalFleetRevision` for tests. Old delivery snapshots stay frozen.

Mutation receipt type exists; collection `canonicalFleetMutationReceipts` write-false. No generic mutation callable.

## 23–26. Settlement compatibility

29K fixture shadow still works. Save-owned trucks remain `LEGACY_CLIENT_FLEET_UNVERIFIED` at accept. `cfa_*` + `SERVER_CANONICAL` may be accepted for freeze, but live wear still diverges → public settlement not enabled. Fragile/FAILED unchanged. Fuel and other ROAD cash paths remain local.

## Public implications

Players keep using local fleet. Canonical mint is foundation-only. Do not enable HUD.

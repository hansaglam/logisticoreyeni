# Production fleet authority matrix (Step 29L)

Source of truth: `src/domain/canonicalProductionFleet.ts`.

| FIELD / OP | CURRENT AUTHORITY | TARGET AUTHORITY | CANONICAL SOURCE | SERVER VALIDATION | MUTATION AUTHORITY | MIGRATION STATUS | BLOCKER |
| --- | --- | --- | --- | --- | --- | --- | --- |
| truck identity | save id / Date.now catalog | server `cfa_*` | mint helper | ownerUid + path | create only | NEW_ASSETS_ONLY | legacy ids |
| model / catalogModelId | client catalog | server catalog template | STARTER_TRUCK / TRUCK_MARKET | known template | none | FOUNDATION | catalog not a production debit |
| ownership | save | per-user canonical doc | mint | uid | transfer missing | BLOCKED transfer | marketplace economics |
| condition | save | canonical economicCondition | template at mint | 0–100 | wear/repair not persisted | WEAR missing | delivery + incident |
| maintenance profile | catalog/save | maintenanceCostPerKm at mint | template | >= 0 | upgrade not persisted | UPGRADE missing | local upgradeTruck |
| upgrades | save | economicUpgradeIds at mint = 0 | server | 0–3 | not persisted | UPGRADE missing | local cash |
| trailer identity | save | `cfa_trailer_*` | TRAILER_MARKET | template id | create only | NEW_ASSETS_ONLY | legacy |
| trailer profile | type + bonus | frozen on asset | catalog | type | attachment local | FOUNDATION | |
| delivery wear | completeDelivery local | `canonical-road-delivery-wear-v1` | route+frozen snapshot+attention 100 | server derive | **persisted once** on success | SUCCESS_ONLY | incident/fail/repair |
| incident wear | client incident UI | INTERNAL_TEST catalog plan + finalize | catalog effects | server seed | **INTERNAL_TEST persist** | INTERNAL_POLICY_ONLY | PRODUCTION_INCIDENT_PARITY |
| repair | repairTruck local | deriveCanonicalFleetRepair + INTERNAL_TEST debit | condition gap | server cost | **persisted INTERNAL_TEST** | INTERNAL_ONLY | production UI local |
| upgrade purchase | upgradeTruck local | deriveCanonicalFleetUpgrade + INTERNAL_TEST debit | next level | server price | **persisted INTERNAL_TEST** | INTERNAL_ONLY | production UI local |
| catalog purchase | buyTruck local | INTERNAL purchaseCanonicalCatalogAsset | catalog | price+model | INTERNAL cash+mint | INTERNAL_TEST | public HUD |
| fuel tank | save currentFuelL | INTERNAL fuelState on canonical asset | capacity from catalog tons | server | purchase + accept-burn INTERNAL | INTERNAL_ONLY | public progressive + roadside |
| sale | local sellTruck | INTERNAL sellCanonicalFleetAsset | condition+mileageKm+upgrades | resale helper | **INTERNAL_TEST credit** | INTERNAL_TEST | public UI local |
| marketplace transfer | server cash + snapshot | identity yes / economics no | listing snapshot | templateId | economics client-originated | BLOCKED | MARKETPLACE_ECONOMICS_CLIENT_ORIGINATED |
| lease | local leaseTruck | INTERNAL createCanonicalVehicleLease prepaid | TRUCK_MARKET weeklyLeaseCost | catalog | **INTERNAL_TEST debit + leased asset** | INTERNAL_TEST | return/expiry client clock; recurring opex |
| mileage | save totalMileageKm | canonical mileageKm on wear success | delivery.distanceKm | server | wear txn once | FOUNDATION | failure distance not guessed |
| recovery | local starter clone | none | client issues | — | fail-closed | BLOCKED | VEHICLE_RECOVERY_BLOCKED_CLIENT_EXECUTION_STATE |
| save import | save blob | forbidden | — | reject | — | REJECTED | |

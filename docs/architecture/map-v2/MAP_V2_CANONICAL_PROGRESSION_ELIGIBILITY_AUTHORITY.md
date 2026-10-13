# Map v2 — Canonical progression eligibility authority (Step 29AN)

Client read policy `canonical-progression-eligibility-read-v1`. Gate `CANONICAL_PROGRESSION_ELIGIBILITY_AUTHORITY=INTERNAL_TEST`. The gate does nothing unless `CANONICAL_PROGRESSION_READ_AUTHORITY=INTERNAL_TEST` is also set. Missing either gate leaves every eligibility decision on the local save.

Status: `CANONICAL_PROGRESSION_ELIGIBILITY_AUTHORITY_PASS_PARTIAL`.

Readiness: `PROGRESSION_ELIGIBILITY_INTERNAL_PARTIAL`.

This policy decides which company level and reputation a client gate may read. It is not server authorization. Backend callables keep their own checks.

## 1. Eligibility audit

| File | Function / component | Eligibility type | Fields | Current source when both gates are on | Player-facing | Mutates gameplay | Backend also validates | Safe to switch | Target | Blocker / result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ShopScreen / shop cards | truck, trailer, driver level lock | presentation lock and client purchase gate | company level | effective projection | yes | yes, local purchase | no required-level check on canonical catalog purchase | yes, client gate only | canonical level | `SWITCHED_CANONICAL` |
| gameStore buyTruck / buyTrailer / leaseTruck / hireDriver | purchase reject | client gameplay gate | company level | same projection, no second listener | yes | yes | no | yes | canonical level | `SWITCHED_CANONICAL` |
| WarehouseScreen / warehouse view model | city unlock, slot count, upgrade level | client gameplay gate | company level | effective projection | yes | yes, local warehouse | canonical warehouse uses frozen internal level 10, not this doc | yes, level input only | canonical level | `SWITCHED_CANONICAL` |
| gameStore openWarehouse / upgradeWarehouse | open and upgrade reject | client gameplay gate | company level | same projection | yes | yes | no | yes | canonical level | `SWITCHED_CANONICAL` |
| MapV2WorldScreen | city progression snapshot | internal preview input | level, reputation | effective projection | internal | preview mode only | no | yes | canonical level and reputation | `SWITCHED_CANONICAL` |
| ContractsScreen | offer filter and requirements | local contract filter | level, reputation | local player | yes | yes | canonical issuance does, public screen does not | no | local | `BLOCKED_LOCAL_DOMAIN` / `CONTRACTS_ELIGIBILITY_BLOCKED_LOCAL_CONTRACT_SOURCE` |
| gameStore contract accept | start local contract | client gameplay gate | level | local player | yes | yes | no on the public path | no | local | `BLOCKED_LOCAL_DOMAIN` |
| GameTabBar | playable-contract badge | same local contract filter | level, reputation | local player | yes | no | no | no | local, same as Contracts | `BLOCKED_LOCAL_DOMAIN` |
| ContractAssignmentModal / ContractQuickActionSheet | assignment availability | local contract lifecycle | level, reputation | local player | yes | yes | no | no | local | `BLOCKED_LOCAL_DOMAIN` |
| MapScreen | opportunity and contract matching | local contract selection | level, reputation | local player | yes | yes | no | no | local | `BLOCKED_LOCAL_DOMAIN` |
| DashboardDailyOpsBonusCard | reward amount | fleet operating cost | not company level | local fleet | yes | yes, cash | separate daily-ops path | n/a | unchanged | `NOT_PROGRESSION_ELIGIBILITY` |
| DashboardDailyOpsBonusCard / AdRewardButton | ad slot level gate | reward grant gate | company level | local player | yes | yes, reward cash | ad reward authority stays local | no | local | `BLOCKED_SERVER_PARITY` |
| DeliveryBoostPanel | ad grant context for a duration boost | reward and delivery timing | company level | local player | yes | yes, duration | no canonical boost | no | local | `BLOCKED_SERVER_PARITY` |
| DebugSimulationScreen | dev level tools | debug | level | local player | dev | yes | no | no | local | `DEBUG_ONLY` |
| company score / leaderboard | score | composite | level, reputation | local player | yes | no | no | no | local | `NOT_PROGRESSION_ELIGIBILITY` |
| reputation history | past deltas | history | n/a | local history | yes | no | no | no | local | `NOT_PROGRESSION_ELIGIBILITY` |
| mission progress | claim progress | mission state | n/a | local | yes | yes | canonical claims are separate | no | local | `NOT_PROGRESSION_ELIGIBILITY` |

Audit count: 17. No unknown rows.

## 2. Eligibility classes

- Presentation lock and client purchase gate: shop cards, and the matching `gameStore` purchase rejects.
- Client gameplay gate switched: warehouse city, slot count, and upgrade level.
- Internal preview input: Map v2 city progression snapshot. Default mode remains `LEGACY_ALL_UNLOCKED`, which does not read the level.
- Local contract domain, left unchanged: Contracts screen, contract accept, tab badge, assignment sheet, map matching.
- Economy parity, left unchanged: ad slot level gate and delivery boost.
- Not a progression eligibility decision: daily-ops cash amount (fleet cost), company score, reputation history, mission progress.

## 3. Effective authority

`resolveProgressionEligibilityAuthority` returns level, reputation, source, status, `canEvaluate`, and reason. Screens that already call `useEffectiveCompanyProgression` pass that projection in. `readProgressionEligibility` / `requireClientProgressionLevel` read the same in-memory snapshot for `gameStore`. They do not call `onSnapshot`.

## 4. Guest

Eligibility gate on or off: guest uses the local save. There is no canonical loading lock.

## 5. Legacy signed-in

A confirmed missing canonical doc, with no trusted doc seen for that uid, keeps local eligibility.

## 6. Canonical signed-in

New canonical accounts and migrated accounts use the canonical level and reputation for the switched gates. Local tamper does not unlock them.

## 7. Loading and unavailable

`canEvaluate` is false. Shop locks treat the level as 0, which fails every positive required level. Warehouse sets `lockProgressionEligibility`, so cities and extra slots stay closed even though the warehouse formula would otherwise floor a missing level to 1. Purchases and warehouse opens return a loading or unavailable message. The local save is not the fallback.

## 8. Offline cache

`CANONICAL_CACHE` is evaluable. Switched gates use the cached canonical numbers. No cache for a canonical account stays locked.

## 9. Shop locks

Public purchase is still the local `gameStore` action. The card and that action now share the effective level, so the button and the reject agree. Canonical catalog purchase does not recheck the catalog required level. This is not server purchase authorization.

## 10. Contracts

The contract list stays the local set. Filtering it by canonical level would disagree with offers generated from the local level. Status: `CONTRACTS_ELIGIBILITY_BLOCKED_LOCAL_CONTRACT_SOURCE`.

## 11. Contract assignment

Assignment and the local accept path stay on the local level and reputation, for the same reason.

## 12. Tab badge

The badge counts local contracts that `getContractAvailability` accepts with the local level and reputation. It stays aligned with the Contracts screen.

## 13. Warehouse slots

`canOpenMoreWarehouses`, `isWarehouseCityUnlocked`, and upgrade required level now receive the effective level. Warehouse documents, inventory, and money stay on the local save. The canonical warehouse module still uses its frozen internal level and is not wired to this UI.

## 14. Map progression

Map screen recommendations stay on the local player. Map v2 preview snapshot uses the effective level and reputation. The public default mode still unlocks the legacy city set and does not activate RAIL, SEA, or AIR.

## 15. Daily ops

The cash amount is fleet operating cost, not company level. The level passed into the ad grant stays local.

## 16. Ads

`canGrantAdReward` still receives the local level. AdMob verification and reward amounts are unchanged.

## 17. Delivery boost

The boost still changes delivery timing through the existing local ad grant. Its level input stays local.

## 18. Reputation gates

Switched reputation input: Map v2 preview requirements. Contract reputation filters stay local. Reputation history stays local. Company score stays local.

## 19. Local write divergence

Step 29AO stops canonical accounts from advancing those save fields when the write gate is on. Switched eligibility gates already ignore the local numbers. See `MAP_V2_CANONICAL_PROGRESSION_WRITE_AUTHORITY.md`.

## 20. UI security versus server authorization

A client lock is not a security boundary. Issuance, reward claims, and other server operations keep validating canonical progression on their own. Shop and public warehouse actions do not gain a new server level check in this step.

## 21. Migration readiness impact

`LEGACY_PROGRESSION_MIGRATION_PUBLIC_ROLLOUT` stays blocked. The read gate and the eligibility gate both default off. Public migration UI is unwired. Contract eligibility is still local, so a public cutover would still show a contract-domain split.

## 22. Remaining blockers

`CONTRACTS_ELIGIBILITY_BLOCKED_LOCAL_CONTRACT_SOURCE`. `PROGRESSION_ELIGIBILITY_BLOCKED_ECONOMY_PARITY` for ads and delivery boost. `PUBLIC_MIGRATION_UI_UNWIRED`. Local company writes for a canonical account are gated in Step 29AO.

## 23. Next step

Do not switch contract filters, ad grants, or delivery boost in the next step. Do not enable public migration or ROAD settlement.

Step 29AO landed the internal write gate. The next domain gap is contract eligibility, which still reads the local save. Leave cash and RAIL/SEA/AIR unchanged.

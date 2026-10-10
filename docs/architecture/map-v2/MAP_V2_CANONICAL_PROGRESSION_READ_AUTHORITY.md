# Map v2 — Canonical progression read authority (Step 29AM)

Signed-in display of company level, XP, and reputation can follow `users/{uid}/canonicalCompanyProgression/current`. The gate is `CANONICAL_PROGRESSION_READ_AUTHORITY=INTERNAL_TEST`. Missing or any other value leaves the public UI on the local save. This step does not write the save, does not subscribe to cash, and does not run migration.

Status: `CANONICAL_PROGRESSION_READ_AUTHORITY_PASS_INTERNAL_ONLY`.

UI readiness: `PROGRESSION_UI_CANONICAL_READ_INTERNAL_ONLY`.

## 1. Current split-brain

After 29AL the server document is the authority for a cut-over account, and the public UI still reads `player.level`, `player.xp`, and `player.reputation` from the save. Those numbers can diverge. 29AM closes that display split only while the read gate is on. With the gate off, public clients still show the save. That is `PROGRESSION_UI_CANONICAL_READ_INTERNAL_ONLY`, not a public cutover.

## 2. Read-authority policy

`resolveEffectiveCompanyProgression` in `src/domain/canonicalProgressionReadAuthority.ts` is the only display decision.

| Class | When | Display |
| --- | --- | --- |
| `GUEST_LOCAL` | Guest, or gate off and the session is anonymous | Local save |
| `SIGNED_IN_LEGACY_LOCAL` | Gate off and not a guest, or gate on and the canonical doc is confirmed missing for an account that has never had a trusted canonical doc in this process | Local save |
| `SIGNED_IN_CANONICAL_SERVER` | Gate on, signed in, trusted `SERVER_CANONICAL_PROGRESSION` doc | Canonical fields |
| `SIGNED_IN_CANONICAL_LOADING` | Gate on, auth still resolving, or the snapshot is idle/loading, or the snapshot belongs to another uid | No numbers |
| `SIGNED_IN_CANONICAL_UNAVAILABLE` | Read error, invalid doc, or missing after a trusted doc was already seen | No numbers |
| `UNSUPPORTED` | Unknown schema, fixture, `LEGACY_CLIENT_UNVERIFIED`, or any authority class other than `SERVER_CANONICAL_PROGRESSION` | No numbers |
| `SIGNED_IN_MIGRATION_PENDING` | Reserved. The client does not subscribe to the migration doc | Not emitted |

Trusted initialization sources are `NEW_CANONICAL_ACCOUNT_DEFAULTS` and `LEGACY_MIGRATION_BASELINE`. A migration record is not required when the canonical doc itself is trusted. `INTERNAL_TEST_PROGRESSION_FIXTURE` and `LEGACY_CLIENT_UNVERIFIED` are rejected.

## 3. Guest behavior

Guest sessions never subscribe. Level, XP, and reputation stay on the local player, including after `addCompanyXp`.

## 4. Legacy signed-in behavior

A signed-in account with a confirmed missing canonical doc, and no trusted doc seen for that uid in this process, keeps today's local progression UI.

## 5. Canonical signed-in behavior

A new canonical account and a migrated account both display the canonical doc. The listener does not need the migration document. Local save mutations after that do not change the displayed numbers.

## 6. Service/subscription

`src/services/canonicalProgressionService.ts` subscribes with Firestore `onSnapshot` (`includeMetadataChanges: true`) to `users/{uid}/canonicalCompanyProgression/current`. It normalizes nothing beyond the snapshot status and does not write. There is no `setCanonicalLevel`, `setCanonicalXp`, or `setCanonicalReputation`. It does not import the game store or the cash listener.

`metadata.fromCache` is the cache signal. A cached canonical snapshot is `CANONICAL_CACHE`. It is not the legacy save. If a listener error arrives while a ready doc is already held, that doc stays and is marked cached. If there is no ready doc, the status is `error`.

Firestore already delivers listener snapshots in commit order. A snapshot whose `progressionRevision` is lower than the revision already held for that uid is ignored.

## 7. Effective progression projection

The store player object is not overwritten. The hook `useEffectiveCompanyProgression` reads auth plus the subscription and returns:

`level`, `xp`, `xpToNextLevel`, `totalXp`, `reputation`, `source` (`LOCAL_GUEST`, `LOCAL_LEGACY`, `CANONICAL_SERVER`, `CANONICAL_CACHE`, `UNAVAILABLE`), `status` (`ready`, `loading`, `unavailable`), `revision`, `reason`.

XP bars use the server `xp` and `xpToNextLevel`. They do not rebuild the threshold from the local level.

## 8. Loading

Gate on and signed in: the first paint is loading until auth and the snapshot resolve. Displayed level/XP/reputation are null. The UI shows “Şirket ilerlemesi yükleniyor”, not level 1 and not the local save.

## 9. Errors

A failed read, an invalid doc (`CANONICAL_PROGRESSION_INVALID`), or an unknown schema (`CANONICAL_PROGRESSION_UNSUPPORTED_SCHEMA`) shows “Şirket ilerlemesi şu an gösterilemiyor”. Numbers are null. The local save is not used as authority.

## 10. Offline/cache

Firestore `onSnapshot` can emit the persistence cache first. A cached trusted doc is displayed as `CANONICAL_CACHE`. If a migrated account has no cached doc, the UI stays loading or unavailable. It does not fall back to the save.

## 11. Sign-out

Leaving a signed-in session clears the subscription and the in-memory snapshot. The next guest frame reads only the local player.

## 12. Account switch

A snapshot for uid A is not applied to uid B. The resolver treats a uid mismatch as loading and drops the document. User B then follows B's own doc, or the local save if B has no canonical doc and was never canonical in this process.

## 13. Local tamper

With a trusted canonical doc at level 5, xp 20, reputation 60, a local player at level 30 with a large XP and reputation 100 still displays 5 / 20 / 60.

## 14. Canonical updates

A newer canonical snapshot updates the projection. The listener does not call `saveGame`.

## 15. No save mirror

Canonical values are not copied onto `player` and are not written back to `saves/current`.

## 16. UI surfaces audited

| File / component | Field | Purpose | Player-facing | Gameplay decision | Current source | Canonical after cutover | Safe to switch | Blocker |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| DashboardScreen resource bar | level, xp progress | Header resources | yes | no | effective projection | yes | yes | none |
| DashboardHeroCard | level, xp, xpToNext, reputation | Company hero | yes | no | effective projection | yes | yes | none |
| ReputationDetailSheet | current reputation score | Reputation sheet | yes | no | effective projection when ready | yes | yes | history rows stay local |
| MoreScreen CompanyProfileCard | level, reputation | Company profile | yes | no | effective projection | yes | yes | none |
| MoreScreen CompanyGrowthCard | level, xp bar | Growth card | yes | no | effective projection | yes | yes | none |
| ShopScreen ShopResourceBar | level, xp progress | Shop header | yes | no | effective projection | yes | yes | none |
| AccountCenter ProfileHeroCard | level | Profile stat | yes | no | effective projection | yes | yes | none |
| AccountProfileTab | company level | Profile subtitle | yes | no | effective projection | yes | yes | none |
| LeaderboardScreen entries | level, reputation | Weekly board rows | yes | no | server leaderboard payload | no | no | `LEADERBOARD_ROWS_ARE_SERVER_PAYLOAD` |
| LeaderboardScreen score explainer | level, reputation inside company score | Local score breakdown | yes | no | local player via company score | no | no | `COMPANY_SCORE_STILL_LOCAL` |
| FinanceScreen | reputation score line | Company score component | yes | no | local player | no | no | `COMPANY_SCORE_STILL_LOCAL` |
| cloudSaveSummary | level, xp | Save conflict identity | yes | no | save blob | no | no | save identity, not company authority |
| Reputation history list | past deltas | Sheet history | yes | no | local reputation history | no | no | `REPUTATION_HISTORY_STILL_LOCAL` |
| ShopScreen market locks | playerLevel | Truck, trailer, driver locks | yes | yes | local player | no | no | `PROGRESSION_UI_ELIGIBILITY_STILL_LOCAL` |
| ContractsScreen | playerLevel, reputation | Offer visibility and requirements | yes | yes | local player | no | no | `PROGRESSION_UI_ELIGIBILITY_STILL_LOCAL` |
| GameTabBar | level, reputation | Contract-start badge | yes | yes | local player | no | no | `PROGRESSION_UI_ELIGIBILITY_STILL_LOCAL` |
| ContractQuickActionSheet | reputation | Assignment eligibility | yes | yes | local player | no | no | `PROGRESSION_UI_ELIGIBILITY_STILL_LOCAL` |
| ContractAssignmentModal | reputation | Assignment eligibility | yes | yes | local player | no | no | `PROGRESSION_UI_ELIGIBILITY_STILL_LOCAL` |
| WarehouseScreen | playerLevel | Slot and upgrade gates | yes | yes | local player | no | no | `PROGRESSION_UI_ELIGIBILITY_STILL_LOCAL` |
| MapScreen | level, reputation | Opportunity and contract matching | yes | yes | local player | no | no | `PROGRESSION_UI_ELIGIBILITY_STILL_LOCAL` |
| MapV2WorldScreen | level, reputation | City progression preview | yes | yes | local player | no | no | `PROGRESSION_UI_ELIGIBILITY_STILL_LOCAL` |
| DashboardDailyOpsBonusCard | level | Bonus eligibility | yes | yes | local player | no | no | `PROGRESSION_UI_ELIGIBILITY_STILL_LOCAL` |
| AdRewardButton | level | Ad eligibility | yes | yes | local player | no | no | `PROGRESSION_UI_ELIGIBILITY_STILL_LOCAL` |
| DeliveryBoostPanel | level | Boost eligibility | yes | yes | local player | no | no | `PROGRESSION_UI_ELIGIBILITY_STILL_LOCAL` |
| gameStore addCompanyXp / checkLevelUp | xp, level | Local XP mutation | no | yes | local player | no | no | `POST_MIGRATION_LOCAL_PROGRESSION_WRITES_NON_AUTHORITATIVE` |
| gameStore reputation settlement | reputation | Local reputation mutation | no | yes | local player | no | no | `POST_MIGRATION_LOCAL_PROGRESSION_WRITES_NON_AUTHORITATIVE` |
| notifyLevelUps | level-up toast | Local animation/toast | yes | no | local XP commit | no | no | `POST_CUTOVER_LOCAL_XP_TOAST_NON_AUTHORITATIVE` |
| reputation notification | reputation toast | Local toast | yes | no | local reputation patch | no | no | `POST_CUTOVER_LOCAL_XP_TOAST_NON_AUTHORITATIVE` |
| incidentProbability | level | Incident roll | no | yes | local player | no | no | out of scope |
| starterContracts | level | Local contract seeding | no | yes | local player | no | no | out of scope |
| companyStats | reputation peak | Local stats | no | yes | local player | no | no | mission/stats stay local |
| contextualGuide | playerLevel | Guide hints | yes | no | local player | no | no | not company authority UI |
| saveGame meta | level, xp, totalXp | Save payload | no | no | local player | no | no | save compatibility |
| MissionsScreen reward copy | reward xp/reputation | Reward definition text | yes | no | mission config | no | no | not current company progression |
| DebugSimulationScreen | level, xp | Dev controls | dev only | no | local player | no | no | `DEBUG_ONLY` |
| canonical issuance | level, reputation | Server contract batch | no | yes | canonical doc | already canonical | n/a | none |
| canonical delivery XP | xp, level | Server completion | no | yes | canonical doc | already canonical | n/a | none |
| canonical non-delivery XP | xp, level | Server grants | no | yes | canonical doc | already canonical | n/a | none |
| canonical reward claims | xp, reputation | Server claims | no | yes | canonical doc | already canonical | n/a | none |

Audit count: 39. Display-only reads: 17, of which 8 now use the projection when the gate is on (dashboard bar, dashboard hero, reputation sheet score, More profile, More growth, shop bar, account hero, account subtitle). Eligibility reads left local: 11. Local gameplay and save reads left unchanged: 6. Canonical backend reads already server-owned: 4. Debug-only: 1.

## 17. Eligibility reads

Production unlocks that still read the local level or reputation are listed above with `PROGRESSION_UI_ELIGIBILITY_STILL_LOCAL`. 29AM does not switch them. A migrated account can show canonical level 5 while the shop still unlocks from the local level.

## 18. Remaining local write behavior

`addCompanyXp` and reputation mutations still update the save for guest and pre-migration accounts. After cutover they are `POST_MIGRATION_LOCAL_PROGRESSION_WRITES_NON_AUTHORITATIVE`. The canonical UI ignores them. Level-up and reputation toasts still fire from those local commits: `POST_CUTOVER_LOCAL_XP_TOAST_NON_AUTHORITATIVE`. Mission and milestone progress UI stays local. That is a remaining partial split: company level/XP/reputation display can be canonical while mission progress is not.

## 19. Migration readiness impact

`LEGACY_PROGRESSION_MIGRATION_PUBLIC_ROLLOUT` stays blocked. The public UI split is closed only behind the internal read gate. Public clients with the gate off still show the save. There is still no public migration screen and no startup cutover (`PUBLIC_MIGRATION_UI_UNWIRED`). The migration callable stays `INTERNAL_TEST`.

## 20. Contract issuance impact

Public contract issuance stays blocked. Issuance already reads canonical progression on the server. The Contracts screen still reads the local player for eligibility. This step does not change the contract source.

## 21. Public rollout limitation

`CANONICAL_PROGRESSION_READ_AUTHORITY` missing means the public UI is unchanged. Cash authority is unchanged: `cashAuthorityVersion` 0, `canUseServerAuthoritativeSettlement` false, critical cash paths 24 / 0 / 24. `SAVE_GAME_VERSION` stays 6. RAIL, SEA, and AIR stay foundation-only.

## 22. Next step

Do not enable public migration, public Contracts, or ROAD settlement from this result.

The dominant remaining blocker, once the internal read gate is on, is `PROGRESSION_UI_ELIGIBILITY_STILL_LOCAL`: displayed company level can be canonical while warehouse, shop, contract, map, and ad gates still follow the local save. Local progression writes and their toasts are the adjacent write-authority gap (`POST_MIGRATION_LOCAL_PROGRESSION_WRITES_NON_AUTHORITATIVE`). Public migration UI stays unwired until those are explicit.

Step 29AN switched shop and warehouse client level gates, plus the Map v2 preview snapshot, behind `CANONICAL_PROGRESSION_ELIGIBILITY_AUTHORITY=INTERNAL_TEST` (`MAP_V2_CANONICAL_PROGRESSION_ELIGIBILITY_AUTHORITY.md`). Contracts, the tab badge, ads, and delivery boost stay local. Status `CANONICAL_PROGRESSION_ELIGIBILITY_AUTHORITY_PASS_PARTIAL`. Cash authority and ROAD settlement are unchanged.

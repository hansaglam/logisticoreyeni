# LogistiCore V1.1 Feature Phase 3 — Achievements, Season History, Inbox

## Status

`V1_1_FEATURE_PHASE_3_FOUNDATION_VERIFIED`

This phase adds an additive, internal-only progression foundation. Achievements are informational unlocks with no rewards. Season history is projected from owner-readable canonical backend documents. The inbox is a bounded local informational cache. No push delivery, backend mutation, leaderboard/economy change, or production UI enablement was introduced.

## Authority map

| Source / metric | Classification | Phase 3 use |
|---|---|---|
| `users/{uid}/seasonProgress/*` | Trusted backend | Season points and completed-season history. Client read only. |
| `users/{uid}/challengeClaims/*` | Trusted backend | Completed-season claim count. Client read only. |
| Current challenge progress callable | Trusted backend projection | Current completed-challenge achievement progress. |
| Leaderboard entries | Trusted backend | Not copied into history because no trusted final-rank snapshot contract currently exists. |
| Marketplace canonical cash/fleet/history | Trusted backend | Existing authority unchanged. CompanyStats purchase/sale counters remain informational projections. |
| CompanyStats delivery/market counters | Client-local canonical, informational | Non-competitive achievements only; never grants rewards. Historically incomplete fields retain V1.1 labeling. |
| Driver XP/level | Client-local canonical | Driver-level informational achievement only. XP curve/balance unchanged. |
| Fleet, warehouse and reputation current values | Derived informational | Non-competitive achievements only. |
| In-app achievement messages | Client-local informational | Persisted with deterministic dedupe keys. |
| Season/challenge inbox mirrors | Server-derived mirror | Created only after owner-verified server reads; still not treated as a server message record. |
| Final season rank/score history | Unsafe/deferred | Omitted until the backend persists an immutable final snapshot. |

No achievement or inbox value is a leaderboard input, challenge authority, cash source, unlock for paid content, or premium entitlement.

## Achievement catalog and model

The catalog is typed and data driven in `src/domain/progressionFoundation.ts`.

`AchievementDefinition` contains:

- stable ID, category, title and description
- metric and integer target
- bronze/silver/gold tier
- hidden/enabled controls
- definition version
- explicit authority classification
- `trackedFromV11` coverage marker where history is incomplete

`AchievementProgress` contains current/target, completion state and optional completion time. `claimed` is fixed to `false`; it is reserved only for a future separately-authorized reward phase.

Initial metrics cover completed deliveries, driver level, fleet size, warehouse count, reputation, marketplace purchases/sales, canonical season points and canonical completed challenges. The hidden reputation achievement is excluded until unlocked.

The catalog grants no cash, reputation, season points, premium currency, or other reward.

## Achievement evaluation and duplicate safety

Evaluation is pure and deterministic from current canonical/informational read models. UI taps never increment progress. Over-target progress is capped for display. Once unlocked, an achievement remains unlocked even if a current derived value later decreases.

Completion timestamps are persisted by achievement ID. Unlock inbox keys use `achievement:<achievementId>`. Reload/evaluation retries therefore do not duplicate completion or the notification. Existing delivery and marketplace idempotency remains owned by the settlement/transaction paths established in Phase 2; Phase 3 does not add another event counter.

Historically incomplete marketplace activity is explicitly labeled “V1.1’den itibaren”. Reliable current/legacy totals such as completed deliveries may unlock conservatively from their existing state.

## Season history model

`SeasonHistoryEntry` includes:

- season key and display name
- canonical season points
- canonical challenge-claim count
- deterministic ISO-week end timestamp
- a permanent read-only marker
- optional final rank/score fields, currently omitted

The client reads only the signed-in owner’s existing `seasonProgress` and `challengeClaims` subcollections. Reads are bounded to 53 progress documents and 500 latest claims. Single-field ordering is used, so no new composite index is required.

The backend-returned active season key is the authority for current/previous separation. ISO-week boundaries are derived deterministically from that key; device time does not select or close a season. The active season is never inserted into completed history. When the canonical active key changes, the previous key becomes read-only and deterministic `season-ended:<key>` / `season-started:<key>` inbox items are produced once.

No seasons are invented for periods lacking canonical documents. Historic final rank/score remains deferred rather than inferred from a mutable leaderboard.

## Inbox architecture

`InboxItem` supports:

- achievement unlock
- challenge completed
- challenge reward claimed
- season started/ended
- marketplace alert
- system

Each item includes a stable ID, title/body, timestamps, optional supported route, optional expiry, dedupe key and explicit local/server-derived-mirror authority. Sensitive payloads, UIDs, credentials and save contents are not stored.

The current foundation emits achievement and season lifecycle messages. Other types are modeled for future canonical integrations but are not fabricated from local interaction events.

Retention is capped at 150 newest unique items. Normalization prunes expired items, invalid values and duplicate dedupe keys. Supported internal navigation currently opens Seasons & Challenges; achievement items remain in the already-open Progress & History screen. Read and mark-all-read actions are persisted.

## Persistence and account isolation

`progressionFoundation` is an optional additive field in `StoreGameState` and `SaveGamePayload`. Save version remains unchanged. Legacy saves normalize to:

- no completed achievements
- no fabricated season history
- empty inbox
- no current season cache

The persisted server-read snapshot contains only season key, points, completed challenge count and load time. It is informational and cannot create a reward or backend mutation.

The existing cloud-save owner-UID invariant and account-switch restore flow scope the entire payload, including this field. No module-global account cache or cross-user AsyncStorage key was added. Fresh/reset game state creates a fresh independent foundation object. Therefore inbox/history cannot move between accounts unless the user explicitly selects the existing whole-save transfer flow already protected by account ownership rules.

The feature creates no new backend documents. Existing recursive deletion of `users/{uid}` already covers the canonical `seasonProgress` and `challengeClaims` documents it reads. Local progression data is removed/reset through the existing local account deletion/session reset behavior. Account deletion code and rules were not changed.

## Minimal internal UI

One lazy-loaded Company/More subroute was added:

`Company → İlerleme ve Geçmiş`

It provides:

- compact achievement/unread/season summary
- locked/unlocked progress cards and tier badges
- hidden-achievement behavior
- up to six previous read-only seasons
- bounded inbox list, unread indicators, mark-read and mark-all-read
- supported Seasons & Challenges navigation
- guest/local achievement display with server history unavailable gracefully
- cached-data message when canonical refresh fails

No bottom tab, polling loop, Firestore listener or global game-tick subscription was added. Canonical season data is fetched once on screen entry and request-deduped. The presentational screen uses only narrow Zustand subscriptions for its foundation state and three stable actions; player/stat evaluation uses a one-time store snapshot during derivation.

## Feature flags

Added:

- `EXPO_PUBLIC_ENABLE_ACHIEVEMENTS`
- `EXPO_PUBLIC_ENABLE_SEASON_HISTORY`
- `EXPO_PUBLIC_ENABLE_INBOX`

Internal profile values are `true`. Production values and `.env.example` defaults are `false`. Store production validation rejects any of the three flags when enabled. The Company entry requires all three flags, so a partially configured build fails closed.

## Push notification decision

The repository already has local OS gameplay-notification infrastructure, but Phase 3 intentionally does not add remote push registration, delivery, token handling or inbox-to-push mirroring. The new inbox type/dedupe/route model can become the local mirror target of a future server-authored push phase without changing its core schema.

No ATT/IDFA, privacy, ad-consent or account-deletion behavior changed.

## Files changed for Phase 3

- `.env.example` plus local internal/production profile values
- `app.config.js`
- `src/config/backendRoadmap.ts`
- `src/config/storeProductionPolicy.ts`
- `src/domain/progressionFoundation.ts`
- `src/features/progression/ProgressHistoryScreen.tsx`
- `src/features/seasons/periods.ts`
- `src/services/challengeService.ts`
- `src/types/game.ts`
- `src/storage/saveGame.ts`
- `src/store/gameStore.ts`
- `src/screens/MoreScreen.tsx`
- `scripts/achievements-season-history-inbox-test.ts`
- `scripts/seasons-challenges-ui-regression-test.ts` (internal flag fixture only)

The working tree already contained prior Phase 1/2/2C/2D work. Those changes were preserved. No Phase 3 backend source, Firestore rule, dependency, economy, reward, leaderboard or marketplace-authority change was made.

## Validation results

| Validation | Result |
|---|---|
| `npx tsc --noEmit` | PASS |
| `npm run validate:store-production` | PASS |
| `npm run backend:verify` | PASS; 69 backend/emulator tests, no missing/wrong-region functions |
| `git diff --check` | PASS; repository line-ending warnings only |
| `scripts/achievements-season-history-inbox-test.ts` | PASS |
| Driver progression / CompanyStats | PASS |
| Seasons/challenges foundation | PASS, 26 assertions |
| Seasons/challenges UI | PASS, 32 assertions |
| Leaderboard regression and eligibility | PASS |
| Marketplace regression and startup reconciliation | PASS |
| Offline delivery settlement/progression/smoke | PASS |
| Account sign-out/deletion | PASS, 41 assertions |
| App Store privacy/account | PASS, 18 assertions |
| Cloud save conflict/production audit | PASS |
| Cloud save size | PASS, 29 assertions; normal payload about 15.2 KB in fixture |
| Tab navigation performance | PASS |
| Store production config security | PASS |
| Phase 3 existing game smoke | PASS, 115 assertions |

## Remaining risks and deferred work

- Real-device internal Android/iOS visual QA is still required for 360 px, font scaling and long inbox content.
- Final season rank/score needs an immutable backend season-close snapshot before it can be shown.
- Canonical history reads currently retain the latest 52 completed seasons and count up to 500 recent claims; a future backend history callable may provide cheaper aggregation for very long-lived accounts.
- Achievement timestamps created from pre-existing local totals represent the first V1.1 evaluation time, not the unknown historical event time.
- Local/informational achievements are unsuitable for rewards or competitive systems.
- Remote push, push tokens, delivery receipts and server-generated important inbox records are intentionally deferred.

## Next phase recommendation

Run the combined V1.1 internal build with all Phase 1–3 flags enabled on linked and guest Android/iOS accounts. Validate season rollover, account switching, cloud restore, unread behavior and compact layouts. After that, add a backend season-close snapshot/read API before polished season history or rank rewards, and design remote push as a separate privacy/security-reviewed phase.

V1_1_FEATURE_PHASE_3_FOUNDATION_VERIFIED

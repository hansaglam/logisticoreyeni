# V1.1 Phase 7 Step 1 — Immutable Season Close Snapshot Audit

**Date:** 2026-09-09  
**Status:** `PHASE_7_STEP_1_AUDIT_COMPLETE`  
**Scope:** Audit + design only. No implementation, deploy, rewards logic, or formula changes.

---

## Verified vs assumed

| Statement | Truth |
|---|---|
| Weekly seasons + leaderboard exist | Yes (`YYYY-Www` UTC ISO week) |
| `seasonProgress` / `challengeClaims` | Yes (owner-scoped) |
| History omits fabricated final rank/score | Yes (optional fields reserved) |
| Immutable close snapshot | **Does not exist** |
| Final rank rewards | **Do not exist** (`rewardsEnabled: false`) |
| Trusted challenge claim backend | Yes |

---

## A. CURRENT SEASON ARCHITECTURE

- **Key:** `YYYY-Www` (UTC ISO-8601 week year + week).
- **Sources:** `backend/src/leaderboardSeason.ts`, `backend/src/seasonPeriods.ts`, client mirrors `src/utils/leaderboardSeason.ts`, `src/features/seasons/periods.ts`.
- **Active season:** server `Date.now()` → `getLeaderboardSeasonKey` / `getSeasonDefinition`.
- **Boundaries:** week starts Monday 00:00 UTC. Challenges use half-open `[startsAt, endsAt)`. Leaderboard display end is inclusive last ms of week (`start + 7d - 1`).
- **Authoritative season document:** none beyond `leaderboards/{seasonKey}` seed meta (`seedCompletedAt`, etc.). No `status: closed` freeze doc.
- **Creation:** lazy/eager mix — seed cron + on-get seed for **current** season only.

## B. CURRENT LEADERBOARD AUTHORITY

| Question | Answer |
|---|---|
| Score origin | `serverState` via `calculateLeaderboardScore` (v2) — client score rejected |
| Who writes entries | Admin SDK only (`submitLeaderboardScore`, seed job) |
| Client direct write | Denied by rules |
| Backend validates | Yes — auth, username, serverState, eligibility |
| Collections | `leaderboards/{seasonKey}`, `.../entries/{uid}`, `leaderboardIdempotency/*` |
| Rules | signed-in read entries; create/update/delete false |
| Functions | `submitLeaderboardScore`, `getLeaderboard`, `seedWeeklyLeaderboard` |
| Ranking | `companyScore` DESC + `uid` ASC; `countBetterScores` |
| Cap | page max 100; config `leaderboardSize: 100` |
| Period reset | new season key; old entries remain in Firestore |
| Past weeks via callable | **Rejected** (`season-closed`) |

## C. SEASON KEY / TIME BOUNDARIES

- Timezone: **UTC only**.
- Client/backend key parity covered by foundation tests (~400 UTC days).
- Do not use device local time as season authority.

## D. MUTABILITY AFTER SEASON END

| Data | Classification |
|---|---|
| Active-season entry score/rank | 1 — MUTABLE DURING ACTIVE (expected) |
| Submit path for past keys | Does not write past — submit always uses **current** key |
| Past `entries` docs | **3 — STILL MUTABLE AFTER CLOSE** via Admin/seed/force |
| Challenge claims for past period | Frozen (period-closed) |
| `seasonProgress` points | Persist; no final rank |
| Live board as historical authority | **Unsafe** — must not be used for rewards |

## E. CURRENT SEASON HISTORY

- UI: Progress History — prior seasons show **season points + challenge completion count** only.
- Load: `getCanonicalSeasonHistory` from owner `seasonProgress` + `challengeClaims`; skips active season.
- Deliberately omits final rank/score until trusted snapshot (`SeasonHistoryEntry` optional fields).
- No client-side fabricated ranks from live boards.

## F. CURRENT RANKING / TIE SEMANTICS

- **Server:** competition-style rank = 1 + count(strictly better). Ties broken by **lexicographically smaller uid wins**.
- **Client:** trusts server ranks; does not re-rank.
- **Recommendation for snapshot:** preserve this exact deterministic order at close time; store `finalRank` + `finalScore` + `uid` on each result doc. Do not invent a new tie policy in Phase 7.

## G. PARTICIPANT ELIGIBILITY

**Current leaderboard participation:**
- Non-anonymous auth
- Username setup completed
- Valid `serverState`
- Ranked visibility: lifetime completed deliveries ≥ 3 (`rankedEligible`); else entry deleted on submit
- Guests excluded
- Client UI also requires Google/Apple link for submit eligibility

**Product decisions still needed for rewards:** reward only ranked-eligible? top N only? exclude internal/test? deleted users?

## H. BACKEND WORKER / SCHEDULER OPTIONS

Existing `onSchedule` (UTC, `us-central1`):
- `seedWeeklyLeaderboard` — `5 0 * * *` (Mon–Sun 00:05), 540s, 512MiB, maxInstances 1
- `generateGlobalEconomy`, `expireVehicleMarketplace`

**Recommendation:** **C — Hybrid**  
1. Scheduled closer shortly after UTC Monday boundary (extend or sibling of seed job).  
2. Idempotent lazy finalize on first trusted post-season read if schedule missed.  
Do not rely on lazy-only (reward fairness / clock skew). Do not rely on schedule-only (retries/timeouts).

## I. RECOMMENDED IMMUTABLE SNAPSHOT MODEL

Conceptual (implement later):

```
seasons/{seasonKey}
  seasonKey, startsAt, endsAt, status: open|closing|closed,
  closedAt, participantCount, snapshotVersion, scoreVersion

seasons/{seasonKey}/results/{uid}
  uid, seasonKey, finalScore, finalRank, participantCount,
  rewardTier?, rewardAmount?, rewardStatus: none|pending|claimed|ineligible,
  snapshottedAt, version
```

Alternative: nest finals under `leaderboards/{seasonKey}/finalResults/{uid}` — either works if **create-once** and rules deny client write. Prefer a clear `closed` meta doc separate from mutable live entries.

**Source at close:** paginated read of current-score-version entries for the **ended** seasonKey, sorted identically to `getLeaderboardSnapshot`, write create-once results. Never recompute from a later mutable board.

## J. IMMUTABILITY GUARANTEE

- Firestore rules: client write false on season/results.
- Backend: `transaction.create` / exists-check — refuse overwrite of `finalScore`/`finalRank`/`rewardTier`.
- Status machine: `closing` → `closed`; closed rejects re-rank.
- Live `entries` may remain for debug but **must not** be product history authority after close.
- Optional later: restrict client read of live past entries; serve finals only via callable.

## K. REWARD AUTHORITY PATTERN

Reuse **challenge claim** pattern:
- Server catalog defines tier → cash (or other gameplay reward)
- Callable accepts only `{ seasonKey, idempotencyKey }` (no rank/score/amount from client)
- Server loads immutable `results/{uid}` and derives eligibility
- Apply cash via existing marketplace/`serverState` atomic update
- `transaction.create` claim receipt under user or on result doc

Never: `claimSeasonReward({ rank, score, reward })`.

## L. CLAIM VS AUTOMATIC DISTRIBUTION

| | Auto at close | Snapshot + manual claim |
|---|---|---|
| Idempotency | Harder mid-batch | Matches challenges |
| Inactive/deleted | Must skip carefully | Claim only if account exists |
| UX | Instant | Explicit claim |
| Audit | Batch logs | Per-claim receipt |

**Recommend B — immutable snapshot + manual claim** for V1.1, aligned with `claimChallengeRewardTransaction`. Auto-distribute later only if product insists.

## M. IDEMPOTENCY / RETRY DESIGN

- Season meta `status` + `closeAttemptId` / `snapshotVersion`
- Cursor/page progress fields while `closing`
- Result docs create-once (duplicate close no-ops)
- Claim docs create-once with idempotency key
- Scheduler `retryCount` + `maxInstances: 1` (like seed)
- Resumable: re-enter `closing` continues from cursor; never rewrite existing results

## N. SCALE / BATCHING

- Do not one-transaction all participants.
- Paginate entries (≤100/page already used); batched writes ≤500 ops.
- Seed already uses long timeout (540s) + paging — mirror that.
- Store `participantCount` from ranked filter at close.

## O. ACCOUNT DELETION / PRIVACY

Today: `deleteLeaderboardEntriesForUid` + recursive `users/{uid}` delete (drops `seasonProgress` / claims).

**Integration requirements:**
- If results live under global `seasons/.../results/{uid}`: deletion must delete or anonymize those docs (extend deletion job).
- If claim receipts are under user tree: recursive delete removes them (OK if global results remain anonymized).
- Product decision: keep anonymized historical rank vs hard-delete.

## P. FEATURE FLAG STRATEGY

Reuse fail-closed extras pattern (`SEASONS_ENABLED`, `SEASON_HISTORY_ENABLED`, etc.).

Suggested additive flags (names TBD):
- `EXPO_PUBLIC_ENABLE_SEASON_CLOSE_SNAPSHOT` (or server-only config)
- `EXPO_PUBLIC_ENABLE_SEASON_LEADERBOARD_REWARDS`

Internal QA: true; store production: false until verified (`storeProductionPolicy` pattern).

Do not enable now. Do not invent a parallel flag system.

## Q. BACKEND / DEPLOYMENT CONSTRAINTS

- Runtime: **Node 20** (`firebase.json`) — known debt; do not mix Node migration into Phase 7
- Region: **us-central1**
- Schedulers already supported
- Indexes: entries already have `scoreVersion + companyScore + __name__`; finals may need new indexes if queried by rank
- Emulators: auth/firestore/functions present

## R. TEST STRATEGY (later)

Cover: single close; duplicate close; immutable score/rank; deterministic ties; participant count; late writes cannot mutate finals; server-derived tiers; no client fabrication; double claim safe; timeout/resume; active season unaffected; history reads finals; A≠B claim; guest/auth; deletion; flags.

## S. LIKELY FILES TO CHANGE (later)

- `backend/src/index.ts` (schedule + callables)
- New `backend/src/seasonClose*.ts` (or similar)
- `firestore.rules` / `firestore.indexes.json`
- `src/domain/progressionFoundation.ts`, `challengeService` / history UI
- `src/config/backendRoadmap.ts`, store production policy
- Emulator + regression scripts
- Release audit docs

## T. FILES / SYSTEMS TO PROTECT

- `leaderboardScore.ts` formula / v2 balance
- Active-season submit path semantics (except freeze gate after close)
- Challenge claim economy
- Marketplace / economy schedulers
- Account deletion core flow (extend carefully, don’t weaken)
- Phase 6 guide / `onboarding.completed` ads gate

## U. PRODUCT DECISIONS REQUIRED

1. Reward tiers & amounts (cash only? top 3? top 10? percentile?)
2. Eligibility: rankedEligible only vs any entry vs score>0
3. Claim UX vs auto-pay
4. Deleted-account historical results: anonymize vs delete
5. Whether prestige-only UI remains until rewards flag on
6. Whether live past entry reads should be restricted after snapshot

## V. BLOCKERS / RISKS

1. No close writer yet  
2. Past live entries Admin-mutable  
3. Callable blocks closed-season reads — need finals API  
4. Client can still read mutable past entries via rules  
5. Rewards amounts undefined  
6. Half-open vs inclusive end — keep Monday UTC boundary consistent  
7. `SEASONS_*` fail-closed vs leaderboard `__DEV__` on — don’t assume both always on in prod  

## W. RECOMMENDED IMPLEMENTATION ORDER

1. **Step 2:** Immutable close writer + meta/results schema + rules (no rewards)  
2. **Step 3:** Trusted read of finals + season history rank/score fields  
3. **Step 4:** Late-write rejection / freeze gates for closed keys  
4. **Step 5:** Reward tier catalog + claim callable (server-derived)  
5. **Step 6:** Flags, canary, device QA, production enablement  

Never ship rewards before immutable snapshot + idempotent close.

---

## Report path

`docs/release-audit/V1_1_PHASE_7_STEP_1_SEASON_CLOSE_SNAPSHOT_AUDIT.md`

# V1.1 Phase 7 Step 2 — Immutable Season Close Snapshot Foundation

**Date:** 2026-09-09  
**Status:** Backend source implemented — **production deployment NOT performed**

## Architecture

Server-authoritative season close creates immutable canonical results after a UTC ISO week ends.

Shared service: `finalizeSeason(seasonKey)` in `backend/src/seasonClose.ts`.

Entry points:
- Scheduled: `finalizeWeeklySeasonClose` — daily `10 0 * * *` UTC (targets **previous** week)
- Lazy: callable `ensureSeasonFinalizedCallable` `{ seasonKey }`
- Trusted read: callable `getSeasonResult` `{ seasonKey }` → auth uid only

## Collections

### `seasons/{seasonKey}`
- `seasonKey`, `startsAt`, `endsAt`
- `status`: `closing` | `closed`
- `participantCount`, `processedCount`
- `snapshotVersion` (1), `scoreVersion` (leaderboard v2)
- `closeCursor` `{ companyScore, uid } | null`
- `closeStartedAt`, `closedAt`
- `rewardsEnabled: false` (reserved)

### `seasons/{seasonKey}/results/{uid}`
- `uid`, `seasonKey`, `finalScore`, `finalRank`, `participantCount`
- `snapshottedAt`, `snapshotVersion`, `scoreVersion`
- Reserved nulls: `rewardTier`, `rewardAmount`, `rewardStatus`

## Status transitions

`absent` → `closing` → `closed`

- Closed seasons never reopen
- Repeat finalize → `already-closed` (no rewrite)

## Source leaderboard

`leaderboards/{seasonKey}/entries` filtered by current `scoreVersion`, ordered:

`companyScore DESC`, `uid ASC` (`FieldPath.documentId`)

Matches live `getLeaderboardSnapshot` / `countBetterScores` semantics.

## Ranking semantics

Ordinal position in that ordered stream (1-based). Ties: lower uid ranks higher.

## Participant count

Firestore aggregation `.count()` on ranked source at close init. Empty boards close with count 0.

## Scheduler

`finalizeWeeklyLeaderboard` sibling: `finalizeWeeklySeasonClose` at **00:10 UTC** daily.  
Uses `getPreviousLeaderboardSeasonKey(now)`.  
Gated by `SEASON_CLOSE_SNAPSHOT_ENABLED=true`.  
`maxInstances: 1`, 540s, 512MiB, retryCount 2. Partial close throws to allow retry/resume.

## Lazy fallback

`ensureSeasonFinalizedCallable` / `ensureSeasonFinalized` — same finalizer. Rate-limited. Rejects fabricated rank/score/uid fields.

## Idempotency / resume

- Meta create-once
- Result `create()`; existing compatible → skip; mismatch → `integrity-conflict`
- Cursor + `processedCount` resume
- Timeout → `timeout-partial` while `closing`

## Immutability

Ordinary retries never change `finalScore` / `finalRank` / `participantCount` / `snapshotVersion` on existing results.

## Security rules

`seasons/{seasonKey}` and `results/{uid}`: **deny all client read/write**. Callable/Admin only.

## Indexes

Reuses existing `entries` composite (`scoreVersion` + `companyScore` DESC + `__name__`). No new index required for Step 2.

## Account deletion

`deleteSeasonCloseResultsForUid` hooked into account deletion leaderboard stage. Deletes `seasons/*/results/{uid}` for known week keys + listed seasons.

## Feature flags

| Flag | Default | Role |
|---|---|---|
| `SEASON_CLOSE_SNAPSHOT_ENABLED` (backend env) | unset/false | Schedule + callables finalize/read |
| `EXPO_PUBLIC_ENABLE_SEASON_CLOSE_SNAPSHOT` / `SEASON_CLOSE_SNAPSHOT_ENABLED` (client) | false | Future UI; store production forbids true |

## Tests

- `backend/test/seasonClose.unit.test.ts` — pure timing/order/flag tests (**pass**)
- `backend/test/seasonClose.emulator.test.ts` — finalize/idempotency/rules (**requires Java + Firestore emulator**; not run in this environment)
- `scripts/season-close-foundation-regression-test.ts` — wiring/authority regression (**pass**)

## Production deployment

**NOT performed.** Do not claim canary.

## Client UI

Not wired in Step 2.

## Deferred (later steps)

- Reward tiers/amounts/claim
- Season history UI binding to finals
- Restrict live past entry reads (optional)
- Production enablement / canary

---

## PHASE 7 STEP 3 — HISTORY / TRUSTED FINALS INTEGRATION

**Date:** 2026-09-09  
**Status:** Client source integration complete — **live backend NOT verified** (Step 2 not deployed)

### Client service

`src/services/seasonCloseService.ts`

- `getSeasonResult(seasonKey)` → callable `getSeasonResult` with `{ seasonKey }` only
- `enrichSeasonHistoryWithCloseResults(entries)` — bounded (6 seasons, concurrency 3)
- Uses `withCallableTimeout`
- Gated by `SEASON_CLOSE_SNAPSHOT_ENABLED`
- Rejects anonymous; auth uid derived server-side
- **Never** reads `leaderboards/{seasonKey}/entries`

### Result types / states

`SeasonHistoryFinalLeaderboard.state`:

| State | Meaning |
|---|---|
| `available` | Canonical finalRank / finalScore / participantCount |
| `not_ranked` | Backend `not-participated` |
| `pending` | Backend `finalization-pending` |
| `unavailable` | Errors / timeouts / malformed |

Missing result is **never** rank 0 or fabricated score.

### History domain

Additive `finalLeaderboard` on `SeasonHistoryEntry` (+ legacy rank/score fields when available).  
Normalize strips malformed `available` payloads.

### Canonical authority

Finals: backend immutable snapshot only.  
Points/claims: existing `seasonProgress` / `challengeClaims` unchanged.

### No live-leaderboard fallback

On API failure: keep points/claims; show unavailable/pending hint; **do not** query mutable historical entries.

### UI behavior (`ProgressHistoryScreen`)

Flag ON: enrich after history load; show Sıralama `#N / P` + Final Skor.  
Flag OFF: existing points/claims UI only.  
Active season still excluded from history list.  
No reward/prize/claim UI.

### Feature flags

- Client: `SEASON_CLOSE_SNAPSHOT_ENABLED` / `EXPO_PUBLIC_ENABLE_SEASON_CLOSE_SNAPSHOT` (extras in `app.config.js`)
- Store production: fail-closed
- Production remains disabled

### Guest / account isolation

Guests skip enrich (no anonymous callable). Linked refresh uses current auth. Finals live in per-save `progressionFoundation` (account switch changes save). No global result cache.

### Error / pending

Soft-fail enrichment; existing history preserved; pending/not-ranked/unavailable copy; no polling.

### Tests

`scripts/season-history-finals-regression-test.ts`  
(+ Step 2 foundation unit/regression; achievements/season history suite)

### Emulator status

Step 2 Firestore emulator suite still **pending** — Java runtime still unavailable in this environment (`/usr/bin/java` present but no JRE; Firestore emulator cannot start). Do **not** install broad system dependencies automatically. No backend canary/deploy until this gap is addressed.

### Backend deployment status

Step 2 source implemented, **not deployed**. Live E2E **not verified**.

### Reward work

Still deferred (Step 4+).

### Device QA pending

Listed in Step 3 checklist (flag on/off, ranked/not-ranked/pending, guest, A→B→A, offline).

---

## PHASE 7 STEP 3.5 — BACKEND VERIFICATION / CANARY READINESS

**Date:** 2026-09-09  
**Status:** Local verification + hardening complete — **no deployment performed**

### Java / emulator availability

| Dependency | Status |
|---|---|
| Java runtime | **Unavailable** (`/usr/bin/java` stub; no JRE / no Homebrew OpenJDK) |
| Firebase CLI (npx) | Available (14.27.0) |
| Firestore emulator | **Cannot start** without Java |
| Functions emulator | Not required for current suite |

**Emulator suite:** `backend/test/seasonClose.emulator.test.ts` **not executed**. Do not fabricate results.

### Hardenings applied in this step

1. **Strict result parse** (`parseSeasonCloseResultDocument`) — rejects missing/`finalRank < 1`; never coerces to rank 1 or invents score 0 from NaN.
2. **Score-version empty guard** — if current `LEADERBOARD_SCORE_VERSION` count is 0 but any `leaderboards/{season}/entries` exist, finalize throws `integrity-conflict: score-version-filter-excludes-existing-entries` (only on **new** meta create).
3. **Pure pagination helpers** + expanded UTC / pagination / parse unit tests.
4. **Canary readiness regression script** — `scripts/season-close-canary-readiness-regression-test.ts`.

### Idempotency verification (source + unit)

| Scenario | Behavior |
|---|---|
| Duplicate scheduler | `already-closed` / create-once skips |
| Duplicate lazy ensure | Same shared `finalizeSeason` |
| Scheduler + lazy race | create-once + compatible skip; conflict → `integrity-conflict` |
| Timeout / partial | `closing` + cursor + `timeout-partial`; resume continues |
| Compatible existing result | skip |
| Conflicting existing result | no overwrite; `integrity-conflict` |
| Meta closed | never reopens |

### Pagination / cursor

Order: `companyScore DESC`, `uid` (`__name__`) `ASC`.  
Cursor: `{ companyScore, uid }` via `startAfter`.  
Composite index already present in `firestore.indexes.json`.  
Pure unit tests cover ties across page boundaries, empty/one/exact/page+1.

### Participant count

`.count()` uses **identical** `rankedSourceEntries` filter as the writer (`scoreVersion == LEADERBOARD_SCORE_VERSION`).  
No separate eligibility field beyond scoreVersion (matches live leaderboard ranked set).

### Score version policy

**Canonical:** Snapshot the same set live leaderboard uses — current `LEADERBOARD_SCORE_VERSION` (v2).  
**Safety:** Refuse silent empty close when other-version entries exist.  
**Canary rule:** Only finalize seasons that have current-version entries (or truly empty boards).  
Do **not** change score formula.

### UTC / season boundaries

Unit-tested: Sunday 23:59:59.999 still active; Monday 00:00 previous ended; scheduler 00:10 uses previous key; ISO week 52/53 → week 1 year boundary. Timezone = UTC only.

### Lazy fallback safety

- Auth required; anonymous rejected  
- `seasonKey` only; rejects uid/rank/score  
- Active/future rejected  
- Rate limit `seasonCloseEnsure` 20/hour  
- `maxDurationMs` 45s; closed short-circuit  
- Shared finalizer  

### Trusted read safety

Explicit reasons: success / not-participated / finalization-pending / active / future / unauthenticated / anonymous / rate-limited / feature-disabled / malformed → unavailable.  
Strict parse prevents fake rank 0.

### Account deletion

`deleteSeasonCloseResultsForUid` in LEADERBOARD stage: lists `seasons` docs + recent week keys; deletes `results/{uid}` only; does not delete season meta; retry-safe (missing docs no-op). No collectionGroup index required.

### Security rules

`seasons/{seasonKey}` and `results/{uid}`: `allow read, write: if false`. Emulator rules assertions present but not run (Java).

### Feature flags

| Flag | Prod | Internal |
|---|---|---|
| Backend `SEASON_CLOSE_SNAPSHOT_ENABLED` | unset/false (scheduler no-op) | may set true intentionally |
| Client `EXPO_PUBLIC_ENABLE_SEASON_CLOSE_SNAPSHOT` | **must remain false** (store policy) | may enable for QA |

### Internal environment / alias audit

`.firebaserc` default only: **`logisticore-53ab4`**.  
No staging/internal Firebase alias.  
**Default: NO DEPLOY** from this step.

### Prepared canary plan (DO NOT EXECUTE YET)

1. Deploy rules/indexes if needed  
2. Deploy functions with backend flag **OFF**  
3. Verify function presence/region (`us-central1`)  
4. Enable backend `SEASON_CLOSE_SNAPSHOT_ENABLED=true` intentionally  
5. Finalize one known **closed** historical test season  
6. Inspect `seasons/{key}` + `results/{uid}`  
7. `getSeasonResult` for test account  
8. Compare rank/score vs source `leaderboards/{key}/entries` (current scoreVersion)  
9. Re-run finalize → `already-closed`  
10. Confirm active season unaffected  
11. Keep **client** production flag OFF  
12. Later: internal/TestFlight client flag only  

### Historical canary season selection criteria

- Not active / not future  
- Prefer previous UTC ISO week or older with **current scoreVersion** entries  
- Prefer small participant set  
- Known test account present if possible  
- No reward implications  
- Acceptable to create immutable results  
- Do **not** auto-pick if ops cannot confirm scoreVersion coverage  

### Full regression (local)

See Step 3.5 RESULT section in chat / CI logs. Emulator still pending.

### Deployment / live E2E

**Not deployed. Live E2E not verified.**

### Blockers before reward design

1. Java + Firestore emulator green (or equivalent live canary proof)  
2. Backend deploy to a controlled environment + one closed-season finalize verified  
3. Client internal flag QA against live callables  
4. Production client flag remains off until then  

Reward work remains **deferred**.

---

## PHASE 7 STEP 3.6 — CONTROLLED CANARY EXECUTION PACK

**Date:** 2026-09-09  
**Status:** Execution pack prepared — **DO NOT EXECUTE** (no deploy, no finalize, no flag enable in this step)

**Project:** `logisticore-53ab4` (only alias; no staging)  
**Region:** `us-central1`  
**Runtime:** `nodejs20` (`firebase.json`)

### Deployable Phase 7 function exports

| Export name | Trigger | Region | Runtime | Mutates prod? | Flag required |
|---|---|---|---|---|---|
| `finalizeWeeklySeasonClose` | Scheduler `10 0 * * *` UTC | us-central1 | nodejs20 | **Yes** (when flag ON) — writes `seasons/**` | `SEASON_CLOSE_SNAPSHOT_ENABLED=true` |
| `ensureSeasonFinalizedCallable` | HTTPS callable | us-central1 | nodejs20 | **Yes** (when flag ON) | same |
| `getSeasonResult` | HTTPS callable | us-central1 | nodejs20 | **Yes** (lazy ensure may finalize when flag ON) | same |

Source: `backend/src/index.ts` + `backend/src/seasonClose.ts`.

#### Shared code also requiring selective redeploy

| Export | Why |
|---|---|
| `prepareVehicleMarketplaceAccountDeletion` | Imports `deleteLinkedAccount` → now calls `deleteSeasonCloseResultsForUid` |

Unrelated functions are **not** updated by a selective `--only` deploy (Phase 1B precedent). Each selected function receives its own compiled bundle.

### Minimum deploy scope

**A. Rules (required for seasons deny-all):**

```bash
npx firebase-tools deploy --only firestore:rules --project logisticore-53ab4
```

**B. Functions (narrowest Phase 7 set):**

```bash
FUNCTIONS_DISCOVERY_TIMEOUT=60 npx firebase-tools deploy \
  --only functions:finalizeWeeklySeasonClose,functions:ensureSeasonFinalizedCallable,functions:getSeasonResult,functions:prepareVehicleMarketplaceAccountDeletion \
  --project logisticore-53ab4
```

**C. Indexes:** not required for new `seasons/**` paths. Existing leaderboard composite index (`scoreVersion` + `companyScore` + `__name__`) already supports the finalizer source query. Optional verify-only:

```bash
npx firebase-tools firestore:indexes --project logisticore-53ab4
```

**Do not** run bare `firebase deploy`.

### Backend flag mechanism (repository truth)

`isSeasonCloseSnapshotEnabled()` reads:

```ts
process.env.SEASON_CLOSE_SNAPSHOT_ENABLED === 'true'
```

Not `defineSecret` / not `functions.config()` / not client Expo env.

Repo-documented Gen2 inject path (see `APPLE_SIGNIN_SECRET_PREFLIGHT.md`):

- Firebase loads `backend/.env` and `backend/.env.<projectId>` into Gen2 function environment **at deploy time**.
- Alternative: set/update env vars on each function’s Cloud Run service (Console or `gcloud run services update`) — **no code change required**, but must target **each** of the three season-close functions (+ deletion if desired).

Default when unset: **OFF** (safe inert).

### Scheduler canary safety

- Deploying scheduler with flag OFF: function exists and fires at 00:10 UTC but **no-ops** (`feature-disabled` log).
- Enabling flag does **not** instantly run the schedule; next run is next `00:10 UTC`.
- Risk window: if flag is ON before 00:10 UTC, scheduler finalizes **previous** ISO week automatically.

**Preferred order:**

1. Deploy with flag OFF  
2. Verify functions present  
3. Enable flag during a daytime UTC window (avoid ~00:00–00:30 UTC)  
4. Manually finalize **one** selected ended season via callable  
5. Verify  
6. Decide whether to leave flag ON before next 00:10 UTC  

### Read-only ops scripts (added)

| Script | Purpose |
|---|---|
| `backend/scripts/inspectSeasonCloseCandidate.ts` | List/inspect candidate seasons (entries, scoreVersion, meta absence) |
| `backend/scripts/verifySeasonCloseSnapshot.ts` | Compare source leaderboard vs `seasons/{key}/results` |

Both: Firebase CLI ADC read-only REST; **no writes**; abort if project ≠ `logisticore-53ab4`.

### Canary finalization method (recommended)

**Preferred:** authenticated callable `ensureSeasonFinalizedCallable` with body `{ "seasonKey": "<KEY>" }` only.

- Same auth/rate-limit/validation path as production clients  
- No client uid/rank/score  
- Matches Phase 1B callable canary style  

**Not preferred in this pack:** local Admin `finalizeSeason` write script (intentionally not added).

**Known constraint (Phase 1B):** disposable linked-account canary may be blocked if Email/Password disabled and `signBlob` unavailable. Operator must use an existing **internal linked test account** they control — value: `<REQUIRES_OPERATOR_VALUE: TEST_ACCOUNT_ID_TOKEN_OR_LOGIN>`.

### Pre-deploy gate (must all pass)

- [ ] `firebase use` / `.firebaserc` → `logisticore-53ab4`  
- [ ] Intended git commit understood (working tree may contain unrelated client changes)  
- [ ] `npm --prefix backend run typecheck` PASS  
- [ ] `npx tsc --noEmit` PASS  
- [ ] `npx tsx --test backend/test/seasonClose.unit.test.ts` PASS  
- [ ] `npx tsx scripts/season-close-foundation-regression-test.ts` PASS  
- [ ] `npx tsx scripts/season-close-canary-readiness-regression-test.ts` PASS  
- [ ] `npx tsx scripts/season-close-canary-pack-regression-test.ts` PASS  
- [ ] `npx tsx scripts/season-history-finals-regression-test.ts` PASS  
- [ ] Leaderboard + challenges foundation scripts PASS  
- [ ] Account deletion regression scripts PASS (code-level)  
- [ ] `SEASON_CLOSE_SNAPSHOT_ENABLED` **not** set true in deploy env files before Phase B  
- [ ] `EXPO_PUBLIC_ENABLE_SEASON_CLOSE_SNAPSHOT` production remains false  
- [ ] Emulator gap acknowledged (Java) — live canary substitutes  

If any fail → **deploy blocked**.

### Abort conditions

Stop if: wrong project; backend flag ON unexpectedly before controlled enable; active/future season selected; mixed unsupported scoreVersions with zero current-version entries; canonical meta already exists; participant/result/score/rank mismatch; rules allow client writes; active leaderboard/challenge regression; wrong region/runtime; unrelated mass redeploy; P0/P1 backend regression.

### Success criteria

Deploy to `logisticore-53ab4`; correct region/runtime; inert with flag OFF; one ended season finalizes; counts/scores/ranks match; ties uid ASC; duplicate finalize idempotent; `getSeasonResult` correct for participant; active season unaffected; no rewards; production client flag still OFF; no P0/P1 regression.

### Rollback / kill switch

1. Set `SEASON_CLOSE_SNAPSHOT_ENABLED` ≠ `true` on the three season-close function runtimes (redeploy with env unset/`false`, or Cloud Run env clear).  
2. Scheduler becomes no-op.  
3. Keep client production flag OFF.  
4. **Do not delete** already-created immutable canary snapshot to “undo”.  
5. If code regression: redeploy previous known-good commit for the same `--only` function list.  

Flag toggle via env **does not** require deleting results.

### Deployment status (this step)

**NOT executed.** Rewards still **blocked**.

### COMMAND PACK — DO NOT EXECUTE

#### PHASE A — READ-ONLY PRECHECK

```bash
cd /path/to/logisticoreyeni
npx firebase-tools use --project logisticore-53ab4
npx firebase-tools projects:list
test "$(node -pe "require('./.firebaserc').projects.default")" = "logisticore-53ab4"

npm --prefix backend run typecheck
npx tsc --noEmit
npx tsx --test backend/test/seasonClose.unit.test.ts
npx tsx scripts/season-close-foundation-regression-test.ts
npx tsx scripts/season-close-canary-readiness-regression-test.ts
npx tsx scripts/season-close-canary-pack-regression-test.ts
npx tsx scripts/season-history-finals-regression-test.ts
npx tsx scripts/leaderboard-regression-test.ts
npx tsx scripts/seasons-challenges-foundation-test.ts

# Candidate discovery (read-only)
npx tsx backend/scripts/inspectSeasonCloseCandidate.ts
# Optional with known test uid:
# npx tsx backend/scripts/inspectSeasonCloseCandidate.ts --uid=<REQUIRES_OPERATOR_VALUE: TEST_UID>
```

Confirm deploy env will ship flag OFF:

```bash
# Must NOT contain SEASON_CLOSE_SNAPSHOT_ENABLED=true
grep -R "SEASON_CLOSE_SNAPSHOT_ENABLED" backend/.env backend/.env.logisticore-53ab4 2>/dev/null || true
```

#### PHASE B — DEPLOY WITH FLAG OFF

```bash
FUNCTIONS_DISCOVERY_TIMEOUT=60 npx firebase-tools deploy \
  --only firestore:rules \
  --project logisticore-53ab4

FUNCTIONS_DISCOVERY_TIMEOUT=60 npx firebase-tools deploy \
  --only functions:finalizeWeeklySeasonClose,functions:ensureSeasonFinalizedCallable,functions:getSeasonResult,functions:prepareVehicleMarketplaceAccountDeletion \
  --project logisticore-53ab4
```

#### PHASE C — VERIFY DEPLOY

```bash
npx firebase-tools functions:list --project logisticore-53ab4
npm run production:backend-check

# Unauthenticated callable probes (expect auth failure reasons, proves routing)
# <REQUIRES_OPERATOR_VALUE: curl/callable probe tooling matching Phase 1B>
```

Confirm env inert:

```bash
# For each new function Cloud Run service name from Console / gcloud:
# gcloud run services describe <REQUIRES_OPERATOR_VALUE: SERVICE_NAME> \
#   --region=us-central1 --project=logisticore-53ab4 \
#   --format='yaml(spec.template.spec.containers[0].env)'
# Expect SEASON_CLOSE_SNAPSHOT_ENABLED absent or not equal to true
```

#### PHASE D — ENABLE BACKEND CANARY FLAG

Choose **one** mechanism:

**D1 — Redeploy with env file (Firebase-documented):**

```bash
# Create/update backend/.env.logisticore-53ab4 locally (DO NOT commit secrets):
# SEASON_CLOSE_SNAPSHOT_ENABLED=true
FUNCTIONS_DISCOVERY_TIMEOUT=60 npx firebase-tools deploy \
  --only functions:finalizeWeeklySeasonClose,functions:ensureSeasonFinalizedCallable,functions:getSeasonResult \
  --project logisticore-53ab4
```

**D2 — Runtime env update without code change:**

```bash
# <REQUIRES_OPERATOR_VALUE: exact Cloud Run service names>
gcloud run services update <SERVICE_finalizeWeeklySeasonClose> \
  --region=us-central1 --project=logisticore-53ab4 \
  --update-env-vars=SEASON_CLOSE_SNAPSHOT_ENABLED=true
gcloud run services update <SERVICE_ensureSeasonFinalizedCallable> \
  --region=us-central1 --project=logisticore-53ab4 \
  --update-env-vars=SEASON_CLOSE_SNAPSHOT_ENABLED=true
gcloud run services update <SERVICE_getSeasonResult> \
  --region=us-central1 --project=logisticore-53ab4 \
  --update-env-vars=SEASON_CLOSE_SNAPSHOT_ENABLED=true
```

Prefer daytime UTC; avoid enabling immediately before 00:10 UTC until manual canary verified.

#### PHASE E — SELECT / FINALIZE ONE CLOSED SEASON

```bash
npx tsx backend/scripts/inspectSeasonCloseCandidate.ts --seasonKey=<REQUIRES_OPERATOR_VALUE: ENDED_SEASON_KEY>
# Abort unless canaryHints include eligibility OK and meta absent / current scoreVersion clean
```

Finalize via authenticated callable only:

```text
Callable: ensureSeasonFinalizedCallable
Body: { "seasonKey": "<ENDED_SEASON_KEY>" }
Auth: <REQUIRES_OPERATOR_VALUE: LINKED_NON_ANONYMOUS_ID_TOKEN>
```

#### PHASE F — VERIFY SNAPSHOT

```bash
npx tsx backend/scripts/verifySeasonCloseSnapshot.ts --seasonKey=<ENDED_SEASON_KEY>
# Optional:
# npx tsx backend/scripts/verifySeasonCloseSnapshot.ts --seasonKey=<ENDED_SEASON_KEY> --uid=<TEST_UID>
```

Expect: `ok: true`, status closed, counts match, no reward fields.

#### PHASE G — IDEMPOTENCY RETEST

Re-invoke `ensureSeasonFinalizedCallable` with same `{ seasonKey }`.

Expect: `already-closed` (or success no-op semantics), then re-run verify script — fingerprint/ranks unchanged.

#### PHASE H — TRUSTED READ TEST

```text
Callable: getSeasonResult
Body: { "seasonKey": "<ENDED_SEASON_KEY>" }
```

Expect participant success payload; active/future rejected; anonymous rejected; no uid field accepted.

#### PHASE I — ACTIVE SEASON REGRESSION

Read-only compare before/after:

- active season key unchanged  
- active leaderboard entry for test uid unchanged  
- `submitLeaderboardScore` / `getLeaderboard` still healthy  
- challenges callables still healthy  

```bash
npx tsx backend/scripts/inspectSeasonCloseCandidate.ts --seasonKey=<ACTIVE_KEY>
# Must remain timing=active; must not create seasons/{active}
```

#### PHASE J — LEAVE ENABLED OR KILL SWITCH

If canary green and before next 00:10 UTC decision is intentional: leave backend flag ON **or** disable:

```bash
# Kill switch example (Cloud Run):
gcloud run services update <SERVICE_...> \
  --region=us-central1 --project=logisticore-53ab4 \
  --update-env-vars=SEASON_CLOSE_SNAPSHOT_ENABLED=false
# Repeat for all three season-close services
```

**Production client flag stays OFF** (`EXPO_PUBLIC_ENABLE_SEASON_CLOSE_SNAPSHOT=false`).

### Internal client QA (later; not now)

Internal/TestFlight build only with `EXPO_PUBLIC_ENABLE_SEASON_CLOSE_SNAPSHOT=true`. Production/store builds remain false. Device checklist: Progress History finals, active no finals, guest, A→B→A, offline, pending, no leaderboard fallback.

### Account deletion

Code path + unit/regression only for initial canary. **Do not** delete a real production account. Optional later disposable-account test if operator has one.

### Security rules check (safe)

After rules deploy: unauthenticated REST write probes to `seasons/{key}` expect HTTP 403 (same style as Phase 1B). Avoid noisy authenticated write spam.

### Reward status

**Still blocked.** Zero reward work in this pack.

---

## PHASE 7 STEP 3.7 — CONTROLLED LIVE CANARY

**Date:** 2026-09-09  
**Operator authorization:** Yes (this step)  
**Status:** **BLOCKED before deploy**

### Blocker

Firebase CLI authentication unavailable in the execution environment:

```text
Error: Failed to authenticate, have you run firebase login?
```

Confirmed via `npx firebase-tools projects:list` against project intent `logisticore-53ab4`.

**No deploy was performed.**  
**No rules were released.**  
**No functions were deployed.**  
**No backend flag was enabled.**  
**No season was finalized.**  
**No production data was mutated.**

### Pre-deploy gate (completed before stop)

| Check | Result |
|---|---|
| Firebase project in `.firebaserc` | `logisticore-53ab4` |
| Branch | `main` |
| Commit (HEAD) | `b2c80789d0cd6a186d6022bec1730a728ac8647a` |
| Working tree | Dirty (Phase 6/7 source present; understood) |
| Backend typecheck | PASS |
| Root `tsc` | PASS |
| Backend build | PASS |
| Season close unit | PASS (13) |
| Foundation regression | PASS (39) |
| Canary readiness | PASS (50) |
| Canary pack | PASS (21) |
| History finals | PASS (46) |
| Leaderboard regression | PASS |
| Seasons/challenges foundation | PASS (26) |
| Account deletion regression | PASS (44) |
| `git diff --check` | PASS |
| Client prod snapshot flag | OFF (`EXPO_PUBLIC_ENABLE_SEASON_CLOSE_SNAPSHOT=false`) |
| Backend deploy env files | Absent → flag would deploy OFF |
| Deploy scope exports | Confirmed 4 names unchanged |
| UTC at gate | `2026-09-08T21:35:15Z` (away from 00:10) |
| Full `backend:verify` / emulator | Not runnable (Java + Firebase login) |
| `functions:list` consistency | Failed: Firebase not logged in |

### Required operator action to unblock

1. On a workstation with Firebase CLI login for `logisticore-53ab4`:  
   `npx firebase-tools login` (or refresh existing login)
2. Re-run Step 3.7 from pre-deploy gate through post-canary kill switch
3. Follow Step 3.6 command pack exactly

### Production client flag

Remains **OFF**. Not touched.

### Reward status

Still **blocked**.

---

## PHASE 7 STEP 3.7B — AUTHENTICATED LIVE CANARY

**Date:** 2026-09-09  
**Status:** **BLOCKED — Firebase CLI authentication still unavailable**

### Auth check

```bash
npx firebase-tools projects:list
```

Result:

```text
Error: Failed to authenticate, have you run firebase login?
```

**Operator action required (interactive):**

```bash
npx firebase-tools login
```

Then re-run Step 3.7B from the auth check.

### Production mutation

**None.** No deploy, no flag enable, no finalize.

### Production client flag

Remains **OFF**.

### Rewards

Still **blocked**.

---

## PHASE 7 STEP 3.7B — AUTHENTICATED LIVE CANARY (RESUME)

**Date:** 2026-09-09  
**Status:** **BLOCKED after successful narrow deploy** — authenticated callable finalization unavailable

### Auth / project

- `npx firebase-tools projects:list` → success  
- `logisticore-53ab4` visible and **current**  
- CLI logged in (account redacted)  
- `.firebaserc` default = `logisticore-53ab4`

### Pre-deploy gate

PASS (typecheck, unit, foundation, readiness, pack, history finals, leaderboard, challenges, account deletion, `git diff --check`).  
Client flag OFF. Backend env files absent → deploy flag OFF.  
Commit HEAD: `b2c80789d0cd6a186d6022bec1730a728ac8647a` (dirty working tree with Phase 6/7 source).

### Rules deployment

```bash
npx firebase-tools deploy --only firestore:rules --project logisticore-53ab4
```

**SUCCESS** — `firestore.rules` released (includes `seasons/**` deny all).

### Function deployment (flag OFF)

```bash
FUNCTIONS_DISCOVERY_TIMEOUT=60 npx firebase-tools deploy \
  --only functions:finalizeWeeklySeasonClose,functions:ensureSeasonFinalizedCallable,functions:getSeasonResult,functions:prepareVehicleMarketplaceAccountDeletion \
  --project logisticore-53ab4
```

**SUCCESS**

| Function | Action | Version | Trigger | Region | Runtime |
|---|---|---|---|---|---|
| `finalizeWeeklySeasonClose` | create | v2 | scheduled | us-central1 | nodejs20 |
| `ensureSeasonFinalizedCallable` | create | v2 | callable | us-central1 | nodejs20 |
| `getSeasonResult` | create | v2 | callable | us-central1 | nodejs20 |
| `prepareVehicleMarketplaceAccountDeletion` | update | v2 | callable | us-central1 | nodejs20 |

No bare `firebase deploy`. No backend `.env` → `SEASON_CLOSE_SNAPSHOT_ENABLED` unset (OFF).

### Flag-OFF verification

- Unauthenticated `ensureSeasonFinalizedCallable` / `getSeasonResult` → `reason: unauthenticated` (no finalize)  
- Inspect `2026-W34` / active `2026-W37`: **no** canonical `seasons/{key}` meta created by deploy  
- Backend flag **never enabled** in this attempt

### Selected canary season (not finalized)

**CANARY_SEASON_KEY = `2026-W34`**

| Field | Value |
|---|---|
| timing | ended |
| active | `2026-W37` |
| participants (scoreVersion 2) | 3 |
| scoreVersionCounts | `{ "2": 3 }` only |
| canonical meta | absent |
| sample | #1 89110, #2 45031, #3 25408 (uid prefixes only) |
| hints | OK eligible |

Also eligible (not chosen): `2026-W35` (5), `2026-W36` (5). Rejected: W33/W32 (v1-only), empty older weeks.

### Authenticated finalize — BLOCKER

Same as Phase 1B linked-account canary:

1. Custom token via `iam.serviceAccounts.signBlob` → **Permission denied**  
2. Email/Password signup fallback → **OPERATION_NOT_ALLOWED**

Per canary rules: **STOP** — do not Admin-bypass finalize; do not enable backend flag without callable auth path.

### Not executed (blocked)

- Backend flag enable  
- `ensureSeasonFinalizedCallable` finalize  
- Snapshot verify / fingerprint / idempotency  
- Authenticated `getSeasonResult` participant proof  
- Live rules write probe (auth identity unavailable)  
- Post-canary flag toggle  

### Safety after stop

- Backend flag remains **OFF/unset**  
- Client production flag remains **OFF**  
- No season finalized  
- No reward work  
- Local regressions still green after stop  

### Operator unblock options

1. Grant CLI account `iam.serviceAccounts.signBlob` on `363783837598-compute@developer.gserviceaccount.com`, **or**  
2. Provide a disposable linked non-anonymous test ID token / enable a safe auth provider for canary, **or**  
3. Explicitly authorize a separate Admin finalizer ops path (not in current pack)

Then resume from Phase 9 (flag enable) with `CANARY_SEASON_KEY=2026-W34`.

### Rewards

Still **blocked**.

---

## PHASE 7 STEP 3.7C — DEV AUTHENTICATED CANARY HARNESS

**Date:** 2026-09-09  
**Status:** Historical — temporary DEV harness **removed 2026-09-10** after successful live W34 verification (see “TEMPORARY DEV CANARY HARNESS REMOVAL” below). Evidence and operator steps below are retained for audit.

### Why

Custom-token / email-password canary auth failed (signBlob denied; password provider disabled).  
This step adds a **DEV-only** operator surface that uses the LogistiCore app’s **existing linked Firebase Auth session** so Firebase Callable SDK attaches auth automatically — **without exposing ID tokens**.

### Guards

- `isSeasonCloseCanaryHarnessEnabled()` → `__DEV__ === true` only (fail-closed)
- MoreScreen route `season-close-canary` only when `__DEV__`
- Entry row only in `__DEV__` module list
- Guest / missing auth cannot finalize
- Fixed candidate only: `2026-W34`
- Blocks if active season key == `2026-W34`
- No polling (`setInterval` absent)
- Never reads/logs/stores ID tokens

### Files

- `src/dev/seasonCloseCanary.ts` — precheck + callable helpers (bypass client snapshot flag; backend flag still operator-owned)
- `src/screens/SeasonCloseCanaryScreen.tsx` — DEV UI
- `src/screens/MoreScreen.tsx` — DEV entry + route
- `scripts/season-close-dev-canary-harness-regression-test.ts`

### Actions (operator, later)

1. Canary Ön Kontrol  
2. Finalize Canary Season (Alert confirm → `{ seasonKey: '2026-W34' }` only)  
3. Verify My Season Result (`getSeasonResult` same key)

### Explicit non-actions in this step

- Backend `SEASON_CLOSE_SNAPSHOT_ENABLED` **not** enabled  
- Client `EXPO_PUBLIC_ENABLE_SEASON_CLOSE_SNAPSHOT` **unchanged OFF**  
- No snapshot created  
- No rewards  
- Harness must be removed/disabled after canary

### Next operator step

1. Open DEV build → Şirket → Phase 7 Canary with **linked** account  
2. Run precheck  
3. Operator enables backend flag separately  
4. Confirm Canary finalize for `2026-W34` only  
5. Verify + idempotency + flag OFF

---

## PHASE 7 STEP 3.7D — MANUAL CANARY WINDOW

**Date:** 2026-09-09 (UTC gate `2026-09-08T22:02:21Z`)  
**Status:** **BLOCKED — UTC scheduler timing risk** (backend flag **not** enabled; finalize **not** executed)

### Candidate recheck (`2026-W34`)

| Field | Result |
|---|---|
| Project | `logisticore-53ab4` |
| timing | ended |
| active season | `2026-W37` (≠ W34) |
| previous (scheduler target) | `2026-W36` |
| canonical meta | **absent** |
| canonical results | **0** |
| scoreVersion | clean `{ "2": 3 }` |
| participants | 3 |
| top scores | 89110 / 45031 / 25408 (prefixes xNnEmI / obUFeK / V2Ef9R) — matches prior 3.7B evidence |
| hints | OK eligible |

Active `2026-W37`: timing=active, canonical meta absent. No unexpected source drift.

### Deployed Phase 7 functions (confirmed)

`finalizeWeeklySeasonClose`, `ensureSeasonFinalizedCallable`, `getSeasonResult`, `prepareVehicleMarketplaceAccountDeletion` — present (us-central1, nodejs20).

### UTC scheduler safety

| Item | Value |
|---|---|
| Scheduler | `10 0 * * *` UTC |
| Gate UTC | `2026-09-08T22:02:21Z` |
| Next fire | `2026-09-09T00:10:00Z` (~**129 minutes**) |
| If flag ON at fire | would auto-finalize **`2026-W36`** (unauthorized vs canary-only `2026-W34`) |

**Decision:** do **not** enable `SEASON_CLOSE_SNAPSHOT_ENABLED` in this window. Manual canary + kill-switch cannot safely complete before the scheduler without risk of finalizing W36.

### Backend flag enable method (prepared, not executed)

Audited mechanism (D1): local `backend/.env.logisticore-53ab4` (gitignored via `.env.*`) containing only:

```text
SEASON_CLOSE_SNAPSHOT_ENABLED=true
```

Then narrow redeploy:

```bash
FUNCTIONS_DISCOVERY_TIMEOUT=60 npx firebase-tools deploy \
  --only functions:finalizeWeeklySeasonClose,functions:ensureSeasonFinalizedCallable,functions:getSeasonResult \
  --project logisticore-53ab4
```

(`gcloud` not available on this workstation — D2 Cloud Run env update deferred.)

**At end of this step:** backend env file still **absent**; flag remains **OFF/unset**.

### Production client flag

`EXPO_PUBLIC_ENABLE_SEASON_CLOSE_SNAPSHOT=false` — **untouched**.

### Pre-button write check

- `2026-W34` still no snapshot  
- `2026-W37` still no snapshot  
- No finalize invoked from Cursor  

### Exact operator instructions (after flag is enabled in a safe window)

Do **not** press Finalize while backend flag is OFF (expect `feature-disabled`).

When Step 3.7D is re-run **after** `00:10 UTC` (prefer daytime UTC) and flag enable succeeds:

1. Sign in with an existing **linked non-anonymous** account (DEV app).  
2. Open: **Şirket → Phase 7 Canary**  
3. Press: **Canary Ön Kontrol**  
4. Confirm all checks pass.  
5. **DO NOT** press Finalize if precheck reports: guest / auth missing / candidate equals active / client production snapshot flag ON.  
6. If precheck passes, press: **Finalize Canary Season**  
7. Confirm the production canary Alert once.  
8. Copy the SAFE harness response back to Cursor.  
9. Do not press Finalize a second time yet.

### Post-button verification ready (do not run until operator reports first finalize response)

```bash
npx tsx backend/scripts/inspectSeasonCloseCandidate.ts --seasonKey=2026-W34
npx tsx backend/scripts/verifySeasonCloseSnapshot.ts --seasonKey=2026-W34
npx tsx backend/scripts/inspectSeasonCloseCandidate.ts --seasonKey=2026-W37
```

Expect: W34 meta closed + 3 results + rewards null; W37 unchanged / no snapshot; fingerprint via verify script.

### Kill switch

On integrity-conflict / wrong season / unexpected error / rank-score mismatch / active-season mutation — immediately:

```bash
# Set SEASON_CLOSE_SNAPSHOT_ENABLED=false in backend/.env.logisticore-53ab4 then redeploy the three functions
# OR clear env and redeploy without the true flag
FUNCTIONS_DISCOVERY_TIMEOUT=60 npx firebase-tools deploy \
  --only functions:finalizeWeeklySeasonClose,functions:ensureSeasonFinalizedCallable,functions:getSeasonResult \
  --project logisticore-53ab4
```

Do not attempt manual repair of `seasons/**`.

**Also:** after a successful W34 canary, disable the flag **before the next** `00:10 UTC` unless intentionally authorizing automatic previous-week finalize.

### Live finalize status

**Not executed.** No callable finalize from Cursor. Operator button not pressed in this step.

### Rewards

Still **blocked**.

### Resume

Re-run Step 3.7D **after** `2026-09-09T00:10:00Z` (scheduler will no-op while flag OFF), then enable backend flag and open the operator window.

---

## PHASE 7 STEP 3.7D-R2 — OPEN SAFE MANUAL CANARY WINDOW

**Date:** 2026-09-09 (UTC gate `2026-09-08T22:04:22Z`)  
**Status:** **BLOCKED — next scheduler still ~2h away (not ~24h)**  
Backend flag **not** enabled. Finalize **not** executed.

### Clarification

Local wall clock (~01:04 TR / UTC+3) is still **2026-09-08 evening UTC**. The blocking fire is the **upcoming** `2026-09-09T00:10:00Z`, not a fire that already passed tonight.

### Current UTC / scheduler

| Item | Value |
|---|---|
| Gate UTC | `2026-09-08T22:04:22Z` |
| Last `00:10` UTC | `2026-09-08T00:10:00Z` (passed; flag was OFF) |
| Next `00:10` UTC | `2026-09-09T00:10:00Z` (~**125 minutes** / **2.09h**) |
| Requirement | next run ≈ **24h** away |
| Decision | **STOP** — do not enable flag |

Safe reopen: after **`2026-09-09T00:15:00Z`** (post no-op scheduler), then next fire ≈24h.

### Post-scheduler no-write check (last fire while flag OFF)

| Season | Canonical meta | Results | Notes |
|---|---|---|---|
| `2026-W36` | absent | 0 | no scheduler write |
| `2026-W34` | absent | 0 | unchanged |
| `2026-W37` | absent | 0 | active; no snapshot |

### W34 recheck

Unchanged: ended; 3 participants; `{2:3}`; scores 89110 / 45031 / 25408; meta/results absent; eligible.

### Active season recheck

`2026-W37` ≠ W34; participants **5** (scoreVersion 2); canonical snapshot **absent**.

### Backend flag enable

**Not performed.** `backend/.env.logisticore-53ab4` still absent. Client `EXPO_PUBLIC_ENABLE_SEASON_CLOSE_SNAPSHOT=false` untouched.

### Operator window

**Not opened.** Do not press Finalize while flag OFF.

### Resume (R3)

1. Wait until after `2026-09-09T00:15:00Z`.  
2. Re-run Step 3.7D-R3: confirm next `00:10` ≈24h away.  
3. Enable backend flag + verify deployed env.  
4. Immediate no-write check.  
5. Open operator DEV finalize window for `2026-W34` only.

---

## PHASE 7 STEP 3.7D-R3 — OPEN SAFE MANUAL CANARY WINDOW

**Date:** 2026-09-09 (UTC gate `2026-09-08T22:06:40Z`)  
**Status:** **BLOCKED — next scheduler ~2.06h away (need ≈24h)**  
Backend flag **not** enabled. Finalize **not** executed from Cursor.

### Current UTC / next scheduler

| Item | Value |
|---|---|
| Gate UTC | `2026-09-08T22:06:40Z` |
| Local TR (UTC+3) | ~01:06 — still **2026-09-08 evening UTC** |
| Last `00:10` | `2026-09-08T00:10:00Z` (passed; flag OFF) |
| Next `00:10` | `2026-09-09T00:10:00Z` (~**123 min** / **2.06h**) |
| Decision | **STOP** |

**Do not resume again until after `2026-09-09T00:15:00Z` (= ~03:15 Turkey).**  
Then next scheduler ≈ `2026-09-10T00:10:00Z` (~24h).

### Rechecks (read-only)

| Season | Result |
|---|---|
| W34 | ended; 3; `{2:3}`; 89110/45031/25408; meta absent; results 0 |
| W36 | meta absent; results 0 |
| W37 | active; meta absent; results 0; participants 5 |

### Flag / client / operator

- Backend flag: still OFF (`backend/.env.logisticore-53ab4` absent)  
- Client prod flag: OFF (untouched)  
- Operator window: **not opened**  
- Rewards: still blocked  

---

## PHASE 7 STEP 3.7D-R4 — OPEN MANUAL CANARY WINDOW

**Date:** 2026-09-09 (UTC gate `2026-09-08T22:08:37Z`)  
**Status:** **BLOCKED** — `after_safe_0015=false`; next scheduler ~**2.02h** (need ≈24h)  
Backend flag **not** enabled. Finalize **not** executed.

| Check | Result |
|---|---|
| UTC ≥ `2026-09-09T00:15:00Z` | **NO** (now `2026-09-08T22:08:37Z`) |
| Next `00:10` ≈24h | **NO** (`2026-09-09T00:10:00Z`, ~121 min) |
| Flag enable | **skipped** |
| Client prod flag | OFF (untouched) |

**Wall clock:** wait until **~03:15 Turkey (UTC+3)** / after **`2026-09-09T00:15:00Z`**, then re-run as R5.

Do not press Finalize while flag OFF.

---

## PHASE 7 STEP 3.7D-R5 — OPEN MANUAL CANARY WINDOW

**Date:** 2026-09-09 (UTC gate ~`2026-09-09T03:59:01Z`)  
**Status:** **OPERATOR WINDOW OPEN** — backend flag **ON**; live finalize **not** executed from Cursor

### Scheduler

| Item | Value |
|---|---|
| Gate UTC | `2026-09-09T03:59:01Z` (after `00:15`) |
| Last `00:10` | `2026-09-09T00:10:00Z` (passed; flag was OFF → no scheduler write) |
| Next `00:10` | `2026-09-10T00:10:00Z` (~**20.2h**) |

### Recheck before enable

W34: ended; 3; `{2:3}`; 89110/45031/25408; meta absent; results 0.  
W36/W37: meta absent; results 0; W37 active.

### Backend flag enable

1. Wrote gitignored `backend/.env.logisticore-53ab4` with `SEASON_CLOSE_SNAPSHOT_ENABLED=true`  
2. Narrow redeploy:

```bash
FUNCTIONS_DISCOVERY_TIMEOUT=60 npx firebase-tools deploy \
  --only functions:finalizeWeeklySeasonClose,functions:ensureSeasonFinalizedCallable,functions:getSeasonResult \
  --project logisticore-53ab4
```

Deploy log: `Loaded environment variables from .env.logisticore-53ab4` → **Deploy complete** (three updates successful).

### Deployed flag verification (Cloud Run runtime)

| Service | `SEASON_CLOSE_SNAPSHOT_ENABLED` |
|---|---|
| `finalizeweeklyseasonclose` | `true` |
| `ensureseasonfinalizedcallable` | `true` |
| `getseasonresult` | `true` |

Client `EXPO_PUBLIC_ENABLE_SEASON_CLOSE_SNAPSHOT=false` **untouched**.

### Immediate no-write after enable

W34/W36/W37: still meta absent, results 0 — **no automatic write**.

### Operator DEV steps (manual)

1. Sign in linked non-anonymous account  
2. Şirket → Phase 7 Canary  
3. Canary Ön Kontrol → require PASS  
4. Stop if guest/auth missing/candidate active/client prod flag ON  
5. Finalize Canary Season → confirm Alert **once**  
6. Do not press again  
7. Copy SAFE response back  

### Kill switch

Before next `00:10` UTC (or on any error): set flag `false` in env file + redeploy the same three functions. No manual `seasons/**` repair.

### Rewards

Still **blocked**. Finalize from Cursor: **not done**.

---

## PHASE 7 STEP 3.7E — POST-FINALIZE SNAPSHOT INTEGRITY

**Date:** 2026-09-09 (UTC `2026-09-09T20:46:59Z`)  
**Status:** **VERIFIED** — read-only; no second finalize; no Firestore repair

### Operator finalize (prior)

```text
ok: true
reason: success
seasonKey: 2026-W34
status: closed
participantCount: 3
processedCount: 3
```

### Verification commands

```bash
npx tsx backend/scripts/inspectSeasonCloseCandidate.ts --seasonKey=2026-W34
npx tsx backend/scripts/verifySeasonCloseSnapshot.ts --seasonKey=2026-W34
```

### Results

| Check | Outcome |
|---|---|
| Meta status | `closed` |
| participantCount / processedCount | 3 / 3 |
| snapshotVersion | 1 |
| scoreVersion | 2 |
| closedAt | present (`1788986735015`) |
| rewardsEnabled | false |
| Result docs | 3 |
| missing / extra / mismatch | 0 / 0 / 0 |
| Source scores | 89110 / 45031 / 25408 |
| Verifier `ok` | **true** |
| Fingerprint (read-only) | `ea2310b854f11eb4` |
| W36 snapshot | absent |
| W37 snapshot | absent (active) |
| Backend flag | still **ON** (canary window) |
| Client prod flag | OFF |
| Idempotency / getSeasonResult | **not run yet** |
| Rewards | still blocked |

---

## PHASE 7 STEP 3.7F — IDEMPOTENCY + TRUSTED RESULT + FLAG OFF

**Date:** 2026-09-09 (started UTC `2026-09-09T20:49:19Z`)  
**Status:** **COMPLETE** (idempotency + getSeasonResult done; flag closed in 3.7G)

### Pre-retry baseline (read-only)

| Item | Value |
|---|---|
| Fingerprint before | `ea2310b854f11eb4` |
| Verifier `ok` | true |
| Backend flag | ON |
| Client prod flag | OFF |
| Next scheduler | ~3.3h (`2026-09-10T00:10:00Z`) — complete flag OFF before then |

### Operator actions required (not done by Cursor)

1. Finalize Canary Season **once more** → paste SAFE response (`already-closed` expected)  
2. After Cursor confirms fingerprint unchanged: **Verify My Season Result** → paste SAFE response  

Then Cursor will: re-verify fingerprint, inspect W36/W37, set backend flag OFF + redeploy three functions, run post-canary regressions, document completion.

### 3.7F-A — Post-idempotency verification (UTC `2026-09-09T20:52:21Z`)

| Item | Result |
|---|---|
| Second finalize | `ok: true`, `reason: already-closed`, status closed, counts 3/3 |
| Verifier `ok` | **true** |
| Fingerprint before | `ea2310b854f11eb4` |
| Fingerprint after | `ea2310b854f11eb4` (**unchanged**) |
| Result count | 3; missing/extra/mismatch 0 |
| Meta | closed; snapshotVersion 1; rewardsEnabled false; closedAt unchanged |
| W36 / W37 | no snapshots |
| Backend flag | still ON |
| Client prod flag | OFF |
| getSeasonResult | not run yet |
| Rewards | blocked |

### 3.7F — Trusted getSeasonResult (operator)

```text
ok: true
reason: success
seasonKey: 2026-W34
status: closed
participantCount: 3
finalRank: 2
finalScore: 45031
resultParticipantCount: 3
```

Auth-derived uid only; no reward grant. Client production snapshot flag remained OFF.

---

## PHASE 7 STEP 3.7G — LIVE CANARY CLOSED

**Date:** 2026-09-09 (UTC gate ~`2026-09-09T20:55:14Z`)  
**Status:** **LIVE CANARY VERIFIED** — backend flag OFF; fingerprint unchanged

### getSeasonResult live result

| Field | Value |
|---|---|
| reason | success |
| seasonKey | 2026-W34 |
| status | closed |
| participantCount | 3 |
| finalRank | 2 |
| finalScore | 45031 |
| resultParticipantCount | 3 |

### Backend flag OFF method

1. `backend/.env.logisticore-53ab4` → `SEASON_CLOSE_SNAPSHOT_ENABLED=false` (gitignored)  
2. Narrow redeploy:

```bash
FUNCTIONS_DISCOVERY_TIMEOUT=60 npx firebase-tools deploy \
  --only functions:finalizeWeeklySeasonClose,functions:ensureSeasonFinalizedCallable,functions:getSeasonResult \
  --project logisticore-53ab4
```

Deploy complete (three Successful update operations). Log: Loaded environment variables from `.env.logisticore-53ab4`.

### Deployed flag verification (Cloud Run)

| Service | `SEASON_CLOSE_SNAPSHOT_ENABLED` |
|---|---|
| `finalizeweeklyseasonclose` | `false` |
| `ensureseasonfinalizedcallable` | `false` |
| `getseasonresult` | `false` |

### Final fingerprint / W34

Verifier `ok: true`; fingerprint **`ea2310b854f11eb4`** (unchanged); status closed; counts 3/3; reward fields null; `rewardsEnabled=false`. W34 snapshot **retained** (not deleted).

### Neighbor safety

| Season | State |
|---|---|
| W36 | no canonical snapshot |
| W37 | active; no snapshot |

### Client production flag

`EXPO_PUBLIC_ENABLE_SEASON_CLOSE_SNAPSHOT=false` — **unchanged OFF**

### Post-canary regression

| Suite | Result |
|---|---|
| `seasonClose.unit.test.ts` | 13 pass |
| season-close-foundation | 39/0 |
| canary-readiness | 50/0 |
| canary-pack | 21/0 |
| season-history-finals | 46/0 |
| leaderboard-regression | PASS |
| seasons-challenges-foundation | 26/0 |
| account-deletion-cross-platform | 30/0 |
| season-close-dev-canary-harness | 34/0 |
| backend typecheck | PASS |
| root `tsc --noEmit` | PASS |
| `git diff --check` | PASS |

### DEV harness

Temporary DEV-only diagnostic tooling retained. Hidden when `__DEV__ === false` (Yönetim card + harness + route). Removal deferred to cleanup / after reward work.

### Reward readiness

**Step 4 policy/catalog landed (source).** Still no claim/payout/UI/production enablement.

### Live E2E evidence summary

Narrow functions + rules deployed; flag OFF→ON for controlled W34 finalize; integrity + idempotency + fingerprint stable; linked-user `getSeasonResult` verified; W36/W37 untouched; no rewards; backend flag returned OFF; client prod flag OFF.

---

## PHASE 7 STEP 4 — SEASON REWARD POLICY + SERVER CATALOG

**Date:** 2026-09-10  
**Status:** **POLICY VERIFIED (source)** — no payouts, no claims, no W34 mutation, flags OFF

### Economy audit

| Signal | Approx |
|---|---|
| Starting cash | $20,000 |
| L1 contract gross | $2k–$8k (~$5k typical) |
| Challenge cash | $500–$2,000 |
| Starter / mid truck | $45k / ~$85k |
| Warehouse open | ~$8k × city modifier |
| W34 size | 3 participants |

Proposed #1 **$100k** ≈ ~20 L1 deliveries / ~2 mid trucks → **too high** weekly. Moderated catalog implemented.

### Catalog v1 + min participants

`SEASON_REWARD_MINIMUM_PARTICIPANT_COUNT = 10`  
If `participantCount < 10`: history/results valid; **no cash rewards** (covers W34).

| Tier | Ranks | Cash |
|---|---|---|
| rank_1 | 1 | 60,000 |
| rank_2 | 2 | 40,000 |
| rank_3 | 3 | 25,000 |
| rank_4_10 | 4–10 | 12,000 |
| rank_11_25 | 11–25 | 7,500 |
| rank_26_50 | 26–50 | 4,000 |

### Implementation (source only)

- `backend/src/seasonRewardTypes.ts`
- `backend/src/seasonRewardCatalog.ts`
- `backend/src/seasonRewardResolve.ts` (`resolveSeasonReward`, entitlement draft)
- `backend/test/seasonReward.unit.test.ts`
- `scripts/season-reward-policy-regression-test.ts`
- Client `SEASON_REWARDS_ENABLED` / `EXPO_PUBLIC_ENABLE_SEASON_REWARDS` fail-closed

### Freeze / entitlement design

Keep create-once `results/{uid}` immutable. Future: freeze `rewardCatalogVersion` on meta; create-once `rewardEntitlements/{uid}`. Do not rewrite W34 null reward fields.

### Future claim (not implemented)

`claimSeasonReward({ seasonKey, idempotencyKey })` — auth uid; server resolves entitlement; cash via `claimChallengeReward`-style transaction.

### Flags

Backend `SEASON_REWARDS_ENABLED` OFF; client `EXPO_PUBLIC_ENABLE_SEASON_REWARDS=false`; independent of snapshot flag.

---

## PHASE 7 STEP 5 — REWARD ENTITLEMENT + CLAIM BACKEND

**Date:** 2026-09-10  
**Status:** **SOURCE IMPLEMENTED** — not deployed; production reward flags remain OFF; no UI; W34 untouched

### Entitlement schema

Path: `seasons/{seasonKey}/rewardEntitlements/{uid}` (Admin/callable only)

| Field | Notes |
|---|---|
| uid, seasonKey | Identity |
| resultSnapshotVersion | Must match close snapshot v1 |
| rewardCatalogVersion | Frozen from season meta |
| finalRank, participantCount | From canonical `results/{uid}` only |
| tierId, cashAmount | Immutable after create |
| status | `unclaimed` \| `claimed` |
| createdAt, claimedAt | claimedAt null until claim |
| claimIdempotencyKey | Set on successful claim |
| version | Entitlement schema v1 |

Create-once via `.create()`. Compatible retry skips; conflicting frozen fields → `integrity-conflict`.

### Materializer

`materializeSeasonRewardEntitlements(seasonKey)` — **shared backend service only**.

**Step 6 hardening:** public `materializeSeasonRewardEntitlementsCallable` **removed**. Ordinary players cannot trigger materialization. Trusted path: Admin SDK / `backend/scripts/materializeSeasonRewards.ts`.

Requires: season closed + ended, `rewardsEnabled===true`, supported frozen `rewardCatalogVersion`, backend `SEASON_REWARDS_ENABLED=true`.

Reads only `seasons/{seasonKey}/results` (paginated by `__name__`, page size 50). Never reads live leaderboards / seasonProgress / challengeClaims. Does not mutate cash.

Eligible ranks only → entitlement docs. Rank >50 or `participantCount < 10` → skip (no doc).

Progress: `rewardMaterializationCursorUid` / `rewardMaterializationComplete` on season meta.

### Catalog freeze

Reward-enabled closed seasons must have meta:

- `rewardsEnabled: true`
- `rewardCatalogVersion: 1` (frozen before/at materialization)

W34 / default finalize still create meta with `rewardsEnabled: false` (catalog unset). Later catalog releases cannot change existing entitlement amounts.

### Entitlement read API

`getSeasonRewardEntitlement({ seasonKey })` — auth uid only.

Reasons: `eligible_unclaimed` | `claimed` | `no_reward` | `rewards_disabled` | `season_pending` | `season_active` | `season_future` | `feature-disabled` | …

### Claim callable

`claimSeasonReward({ seasonKey, idempotencyKey })` — rejects client authority fields (uid/rank/score/tier/cash/catalog).

Authority: frozen entitlement + challenge-style cash transaction:

1. Verify closed + rewards enabled + entitlement unclaimed  
2. Integrity-check amount via `resolveSeasonReward` against entitlement fields (not leaderboard)  
3. Atomically: `canonicalCash` += amount, `serverState.cash` mirror, entitlement → claimed, create-once `rewardClaims/{uid}`

### Idempotency / double claim

- Same idempotency key after commit → success replay from claim receipt  
- Different key after claim → `already-claimed`, no second payout  
- Concurrent: single create-once claim doc + transaction

### Claim receipt

`seasons/{seasonKey}/rewardClaims/{uid}` — uid, seasonKey, tier, cashAmount, versions, finalRank, idempotencyKey, claimedAt, cashBefore/After, version.

### Account deletion

`deleteSeasonRewardDataForUid` in LEADERBOARD stage alongside season-close results. Deletes caller entitlement + claim docs only; preserves season meta and other users.

### Security rules

`rewardEntitlements` / `rewardClaims`: `allow read, write: if false` (callable/Admin only). `seasons/**` not weakened.

### Feature flags

| Flag | State |
|---|---|
| Backend `SEASON_REWARDS_ENABLED` | OFF (fail-closed) |
| Client `EXPO_PUBLIC_ENABLE_SEASON_REWARDS` | false |
| Snapshot flag | Independent |

Claim + materialize fail closed when backend flag OFF.

### W34 safety

W34 has `rewardsEnabled=false` → materialize returns `rewards-disabled-for-season`; no entitlements; no claims; no payout. Snapshot fields untouched by this step.

### Client service (no UI)

`src/services/seasonRewardService.ts` — `getSeasonRewardEntitlement` / `claimSeasonReward` wrappers only. No claim button, no auto-claim, no polling.

### Tests

- `backend/test/seasonReward.unit.test.ts` (policy + parse/match)
- `backend/test/seasonRewards.unit.test.ts` (flag fail-closed + drafts)
- `backend/test/seasonRewards.emulator.test.ts` (full materialize/claim; requires Java/emulator)
- `scripts/season-reward-claim-regression-test.ts`
- Updated policy / canary / account-deletion regressions

### Deployment status

**NOT deployed.** Production reward backend **NOT enabled**. Source only.

### Emulator status

Emulator suite authored; local Java runtime unavailable → emulator not claimed green in this environment.

### No UI / no production enablement

No reward UI in Step 5. No production flag enablement. No W34 mutation. No deploy.

---

## PHASE 7 STEP 6 — REWARD AUTHORITY HARDENING + INTERNAL UI

**Date:** 2026-09-10  
**Status:** **SOURCE + INTERNAL UI** — not deployed; production reward flags OFF; W34 untouched

### Materialization authority hardening (Decision A)

Repository has **no** strong server-side admin/operator authorization (no custom claims / ALLOWED_UIDS).

Therefore:

- **Removed** public `materializeSeasonRewardEntitlementsCallable`
- Shared `materializeSeasonRewardEntitlements(...)` remains for Admin SDK / ops script
- Ops entry: `backend/scripts/materializeSeasonRewards.ts` (requires explicit `SEASON_REWARDS_ENABLED=true`)
- Players never see a “generate reward” action

### Player reward authority

| Action | Who |
|---|---|
| Materialize entitlements | Ops / Admin SDK only |
| `getSeasonRewardEntitlement` | Authenticated linked player (self) |
| `claimSeasonReward` | Authenticated linked player (self) |

Claim payload: `seasonKey` + `idempotencyKey` only.

### Internal reward UI

`ProgressHistoryScreen` season cards, gated by `SEASON_REWARDS_ENABLED` (`EXPO_PUBLIC_ENABLE_SEASON_REWARDS`). Independent of snapshot flag.

When flag OFF: no fetch, no card, no claim.

### Entitlement UI states

| State | Behavior |
|---|---|
| eligible_unclaimed | Server amount + “Ödülü Al” |
| claimed | Amount + “✓ Alındı” |
| no_reward | Friendly no-reward copy |
| insufficient_participants | “yeterli katılımcı yoktu” |
| pending | Preparing copy |
| unavailable | Safe retry/error copy |
| rewards_disabled | **Hidden** (W34) |
| guest | Hidden; no noisy claim |

### Claim UX

Confirmation dialog: “Sezon ödülün hesabına eklenecek.” → `season-reward-{uuid}` idempotency → `claimSeasonReward`. No auto-claim.

Timeout: refetch entitlement; if claimed → success + reconcile; if unclaimed → retain key for retry.

### Cash sync

Reuse `reconcileChallengeClaimCash` via marketplace reconciliation. **No** local `player.money += amount`.

### Feature flags

Production: both reward flags OFF. Snapshot ON alone does not show rewards.

### DEV mock surface

`__DEV__ && SEASON_REWARDS_ENABLED`: local mock state chips (`src/dev/seasonRewardUiMocks.ts`). No Firestore writes. No W34 mutation.

### Performance

Bounded enrich (6 seasons, concurrency 3). No polling/timers. Local component state (not Zustand). Keyed by auth uid.

### Tests

- `scripts/season-reward-ui-regression-test.ts`
- Updated claim/policy/history finals regressions
- Step 5 backend unit tests remain

### Deployment / production rewards

**NOT deployed. NOT enabled.** No production entitlements created.

---

## TEMPORARY DEV CANARY HARNESS REMOVAL

**Date:** 2026-09-10  
**Status:** Temporary DEV canary harness removed after successful live verification.

The live immutable season-close canary for **2026-W34** completed and verified (finalize, fingerprint/idempotency, `getSeasonResult`, W36 untouched, W37 active untouched, snapshot flags OFF). The temporary operator UI is no longer needed.

### Removed (client DEV-only)

- `src/dev/seasonCloseCanary.ts`
- `src/screens/SeasonCloseCanaryScreen.tsx`
- Management / Yönetim “Phase 7 Canary” / “Season Close DEV” card
- MoreScreen `season-close-canary` route + DEV module row
- Quick-access / App navigation branches for `seasonCloseCanary`
- `scripts/season-close-dev-canary-harness-regression-test.ts`

### Preserved

- All Phase 7 **production** backend/client architecture (`finalizeSeason`, `getSeasonResult`, seasonCloseService, Season History finals, reward policy/source, feature flags OFF)
- Historical evidence in this document (fingerprint, W34 verification, deployment, idempotency, getSeasonResult)
- Production architecture readiness/pack regression scripts (not the deleted UI harness test)

---

## PHASE 7 STEP 7 — REWARD BACKEND FAIL-CLOSED LIVE CANARY

**Date:** 2026-09-10  
**Status:** Superseded — see **PHASE 7 STEP 7 — REWARD BACKEND FAIL-CLOSED VERIFIED** below. Historical deploy/block notes retained for audit trail.

### Intent

Deploy minimum reward backend to `logisticore-53ab4` with **`SEASON_REWARDS_ENABLED=false`**, prove fail-closed get/claim on W34, zero payout / entitlements / cash change.

### A. Firebase project

- Authenticated: **yes** (`ethemsincarbusiness@gmail.com`)
- Project: **`logisticore-53ab4`** (visible + current)

### B. Reward export audit

| Export | Status |
|---|---|
| `getSeasonRewardEntitlement` | Exported + **created** in us-central1 nodejs20 |
| `claimSeasonReward` | Exported + **created** in us-central1 nodejs20 |
| `prepareVehicleMarketplaceAccountDeletion` | Exported + **updated** (reward cleanup) |
| `materializeSeasonRewardEntitlementsCallable` | **ABSENT** |

### C. Materialization callable status

**Confirmed absent** from Cloud Functions list and source exports.

### D. Pre-deploy gate

PASS: root `tsc`, `git diff --check`, seasonReward unit (33), reward policy/claim/UI, season-close foundation/readiness, history finals, account deletion, leaderboard, seasons-challenges foundation. Local flags both season OFF; client production EXPO flags OFF.

### E. Deploy scope (executed)

```text
firestore:rules
functions:getSeasonRewardEntitlement
functions:claimSeasonReward
functions:prepareVehicleMarketplaceAccountDeletion
```

No bare deploy. No season-close finalize functions redeployed.

### F. Rules deployment

Rules compiled; released to cloud.firestore (deny-all on `rewardEntitlements` / `rewardClaims`).

### G. Reward function deployment

**Deploy complete** (2026-09-10):

- `getSeasonRewardEntitlement` — Successful **create**
- `claimSeasonReward` — Successful **create**
- `prepareVehicleMarketplaceAccountDeletion` — Successful **update**
- Log: `Loaded environment variables from .env.logisticore-53ab4`

### H. Deployed runtime flags (Cloud Run env inspected)

| Service | `SEASON_REWARDS_ENABLED` | `SEASON_CLOSE_SNAPSHOT_ENABLED` |
|---|---|---|
| getseasonrewardentitlement | **false** | **false** |
| claimseasonreward | **false** | **false** |
| preparevehiclemarketplaceaccountdeletion | **false** | **false** |

### I. W34 baseline (read-only)

- status=`closed`, `rewardsEnabled=false`, `rewardCatalogVersion=null`
- resultsCount=3, entitlements=0, claims=0
- Official snapshot fingerprint: **`ea2310b854f11eb4`** (`verifySeasonCloseSnapshot` ok:true)
- Active season remains W37 (untouched)

### J. Cash before

Captured for W34 sample result uidHash `d59ef7e84edd`:

- canonicalCash=`56248.59`
- serverState.cash=`56248.59`

(Live claim not executed — auth blocked.)

### K. GET entitlement live result

**NOT COMPLETED** — cannot mint Firebase ID token:

- Google IdP exchange: `INVALID_IDP_RESPONSE` (CLI access_token audience not for this Firebase app)
- Custom token: `iam.serviceAccounts.signBlob` **denied**

DEV harness: Şirket → DEV Araçları → **Reward Fail-Closed** → Get Reward Entitlement  
Expected with flag OFF: **`feature-disabled`**

### L. CLAIM fail-closed live result

**NOT COMPLETED** (same auth block). Expected: **`feature-disabled`**, no cash.

### M. Cash after

**N/A** (no authenticated claim executed). Post-deploy entitlement/claim counts still 0; fingerprint unchanged.

### N. Entitlement / claim counts

After deploy + re-check: entitlements=**0**, claims=**0**.

### O. W34 final fingerprint

**`ea2310b854f11eb4`** (unchanged; verifier ok:true).

### P. Security rules

Anonymous client PATCH probes:

- `seasons/2026-W34/rewardEntitlements/<anon>` → **403 PERMISSION_DENIED**
- `seasons/2026-W34/rewardClaims/<anon>` → **403 PERMISSION_DENIED**

### Q. Account deletion status

`prepareVehicleMarketplaceAccountDeletion` **updated** successfully. No production account deleted.

### R. Client production flags

`EXPO_PUBLIC_ENABLE_SEASON_REWARDS=false`  
`EXPO_PUBLIC_ENABLE_SEASON_CLOSE_SNAPSHOT=false`

### S. Backend final flags

`SEASON_REWARDS_ENABLED=false`  
`SEASON_CLOSE_SNAPSHOT_ENABLED=false`  
(runtime Cloud Run env matches)

### T. DEV harness status

Kept DEV-only (`seasonRewardFailClosedCanary` + screen + MoreScreen entry).  
SAFE Metro log tag: `[REWARD_FAILCLOSED_SAFE]`.  
Ops script accepts `LOGISTICORE_ID_TOKEN` / `--idToken=` for resume.

### U. Post-deploy tests

PASS: seasonReward units, reward policy/claim/UI, season-close foundation, history finals, account deletion, leaderboard, seasons-challenges foundation, root `tsc`, `git diff --check`.

### V. Payout status

**NOT tested.** No materialize / enable / cash grant.

### W. Next step (resume to VERIFIED)

1. DEV iOS build, linked non-anonymous: Şirket → Reward Fail-Closed  
2. Tap Get Reward Entitlement + Attempt Reward Claim  
3. Paste SAFE reasons **or** set `LOGISTICORE_ID_TOKEN` and re-run `verifySeasonRewardFailClosed.ts --confirm-live-callables`  
4. Confirm cash equality + counts 0 + fingerprint `ea2310b854f11eb4`  
5. Mark Step 7 VERIFIED

### Supporting build note

`backend/package.json` sync uses `node --import tsx`. Added `backend/src/rn-globals.d.ts` for `__DEV__` during Functions compile.

---

## PHASE 7 STEP 7 — REWARD BACKEND FAIL-CLOSED VERIFIED

**Date:** 2026-09-10  
**Project:** `logisticore-53ab4`

Authenticated DEV harness live results confirmed fail-closed. Post-check cash/W34/fingerprint/runtime flags unchanged. Temporary DEV fail-closed harness **removed** after successful verification.

### Deployed surface (narrow; no broad deploy)

- Firestore rules (deny client writes to `rewardEntitlements` / `rewardClaims`)
- `getSeasonRewardEntitlement` (created)
- `claimSeasonReward` (created)
- `prepareVehicleMarketplaceAccountDeletion` (updated; reward cleanup path)
- Materialization public callable: **absent**

### Backend runtime flags (Cloud Run env)

| Service | `SEASON_REWARDS_ENABLED` | `SEASON_CLOSE_SNAPSHOT_ENABLED` |
|---|---|---|
| getseasonrewardentitlement | **false** | **false** |
| claimseasonreward | **false** | **false** |
| preparevehiclemarketplaceaccountdeletion | **false** | **false** |

### Client production flags

- `EXPO_PUBLIC_ENABLE_SEASON_REWARDS=false`
- `EXPO_PUBLIC_ENABLE_SEASON_CLOSE_SNAPSHOT=false`

### W34 baseline (unchanged)

- status=`closed`
- `rewardsEnabled=false`
- canonical results count=`3`
- rewardEntitlements count=`0`
- rewardClaims count=`0`
- fingerprint=`ea2310b854f11eb4` (`verifySeasonCloseSnapshot` ok:true; ranks/scores/reward fields unchanged)

### Cash (sample uidHash `d59ef7e84edd`)

| | canonicalCash | serverState.cash |
|---|---|---|
| Before | `56248.59` | `56248.59` |
| After GET+CLAIM | `56248.59` | `56248.59` |

### Authenticated live results (DEV harness)

**GET** `getSeasonRewardEntitlement({ seasonKey: '2026-W34' })`:

- ok=`false`
- reason=`feature-disabled`
- seasonKey=`2026-W34`
- status=`no-entitlement`

**CLAIM** `claimSeasonReward({ seasonKey: '2026-W34', idempotencyKey })`:

- ok=`false`
- reason=`feature-disabled`
- seasonKey=`2026-W34`
- status=`no-entitlement`

No entitlement or claim documents created. No cash grant.

### Security rules

Anonymous client writes to reward entitlement/claim paths → **403** (prior probe retained).

### Account deletion

`prepareVehicleMarketplaceAccountDeletion` remains deployed with safe env (reward flags OFF).

### Payout

**NOT tested.** No materialize / enable / payout canary.

### Temporary DEV harness cleanup

Removed after successful verification:

- Yönetim “Reward Fail-Closed / Phase 7 DEV” card
- `SeasonRewardFailClosedCanaryScreen`
- `season-reward-failclosed-canary` route / MoreScreen DEV entry
- `src/dev/seasonRewardFailClosedCanary.ts`
- App / quick-access / management panel wiring
- `scripts/reward-fail-closed-harness-regression-test.ts`

Preserved: production reward client services, reward UI behind production flags, reward backend, Phase 7 audit tests, season-close production source. Ops script `backend/scripts/verifySeasonRewardFailClosed.ts` retained (not UI).

### Verdict

**PHASE_7_STEP_7_REWARD_BACKEND_FAIL_CLOSED_VERIFIED**

### Next step

Phase 7 Step 8 / subsequent reward enablement only under explicit controlled gate (do not enable rewards or snapshot flags without a new canary plan).

---

## PHASE 7 STEP 8 — PAYOUT CANARY READINESS AUDIT

**Date:** 2026-09-10  
**Project:** `logisticore-53ab4`  
**Mode:** READ-ONLY / plan-building only  
**Payout executed:** **NO**

### Intent

Determine whether a safe production season exists for a real reward payout canary (catalog freeze → materialize → claim → cash mutation → idempotency) without corrupting historical authority. **W34 permanently protected** (fingerprint `ea2310b854f11eb4`).

### Reward enablement model (repository truth)

| Topic | Finding |
|---|---|
| `rewardsEnabled` freeze point | Set **only** at season-close meta creation in `initializeClosingMeta` → always **`false`**. Close progress / mark-closed merges do not change it. No production writer sets `true`. |
| `rewardCatalogVersion` freeze | **Not written by close.** Materializer **requires** it already on meta and matching `SEASON_REWARD_CATALOG_VERSION` (1). Not stamped by materialize. |
| Closed-season retrofit | **Not safe / not intentional.** Historical closed seasons with `rewardsEnabled=false` must **not** be retrofitted. Get/claim/materialize all gate on `rewardsEnabled === true`. |
| Designation path | **BLOCKER:** architecture lacks a first-class way to designate a season reward-enabled before/during close. Finalize always creates `false`. |

Documented ideal (incomplete in code): designate `rewardsEnabled=true` + `rewardCatalogVersion=1` on meta **before** materialize → close → ops materialize → get/claim. Code does not implement the designate step.

### Recent season candidate table (read-only)

| seasonKey | ended/active (meta) | snapshot status | snapVer | scoreVer | participants (meta / LB entries) | processed | rewardsEnabled | catalogVer | results | entitlements | claims |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-W33 | no meta | none | — | — | — / 3 | — | false | null | 0 | 0 | 0 |
| 2026-W34 | **closed** (protected) | closed | 1 | 2 | **3** / 3 | 3 | **false** | null | 3 | 0 | 0 |
| 2026-W35 | no meta | none | — | — | — / **5** | — | false | null | 0 | 0 | 0 |
| 2026-W36 | no meta | none | — | — | — / **5** | — | false | null | 0 | 0 | 0 |
| 2026-W37 | no meta | none | — | — | — / **5** | — | false | null | 0 | 0 | 0 |
| 2026-W38+ | absent | — | — | — | — | — | — | — | — | — | — |

W34 fingerprint reaffirmation target: `ea2310b854f11eb4` (do not mutate).

### Participant threshold

Policy: `SEASON_REWARD_MINIMUM_PARTICIPANT_COUNT = 10`.

**No inspected season has ≥10 ranked participants.** Max observed leaderboard entry count in window: **5** (W35–W37). W34 closed with **3**.

→ **NO SAFE CURRENT PAYOUT CANDIDATE** on participant gate alone.

### Linked test account (uidHash `d59ef7e84edd`)

| Season | Canonical result | Notes |
|---|---|---|
| W34 | finalRank=**3**, finalScore=**25408**, participants=3 | Protected; rewards off; would be `insufficient_participants` under V1 even if enabled |
| W35–W37 | no immutable result docs | No closed snapshot; cannot compute catalog reward from finals |

**Expected reward for any current candidate:** none (no qualifying season). Cash planning N/A beyond baseline `56248.59`.

### Materialization safety

- Public materialize callable: **absent**
- Ops: `backend/scripts/materializeSeasonRewards.ts` (Admin SDK; requires process `SEASON_REWARDS_ENABLED=true`)
- Reads immutable `seasons/{key}/results` only
- Entitlement create-once; amount from catalog resolver; seasonKey-only script input
- Idempotent re-run; cursor resume; conflicting entitlement → `integrity-conflict`
- Weaknesses: no rewardsEnabled writer; ops = GCP Admin trust only; cursor progress not transactional with page creates

### Claim transaction safety

`claimSeasonReward` / `claimSeasonRewardTransaction`:

- Linked non-anonymous auth; payload `seasonKey` + `idempotencyKey` only
- Requires backend `SEASON_REWARDS_ENABLED` + meta `rewardsEnabled===true` + closed season + unclaimed entitlement
- Atomic: canonicalCash + serverState.cash + entitlement claimed + create-once receipt
- Same idempotency key → success replay; different key after claim → `already-claimed` (no double payout)

### Scheduler interaction

| Function | Cadence | Target | Rewards? |
|---|---|---|---|
| `finalizeWeeklySeasonClose` | `10 0 * * *` UTC | previous ISO week | Close only; meta `rewardsEnabled:false` |
| `seedWeeklyLeaderboard` | `5 0 * * *` UTC | current week seed | No |
| Materialize | **none** | — | **Manual ops only** |

`SEASON_CLOSE_SNAPSHOT_ENABLED=true` can auto-finalize previous week — **does not** materialize or enable rewards.  
`SEASON_REWARDS_ENABLED=true` unlocks get/claim/materialize service paths — **does not** schedule materialize or flip per-season flags.

### Proposed future flag sequence (do not execute now)

At start (current): all snapshot/reward backend + client flags **false**.

For a future legitimate reward canary season (after designation path exists + ≥10 participants):

1. Keep snapshot/reward **OFF** until preflight complete  
2. Close season with intended meta `rewardsEnabled=true` + `rewardCatalogVersion=1` (**requires future designation capability**)  
3. Temporarily set process/runtime `SEASON_REWARDS_ENABLED=true` for ops materialize:  
   `SEASON_REWARDS_ENABLED=true npx tsx backend/scripts/materializeSeasonRewards.ts <seasonKey>`  
4. Keep client reward UI OFF until backend get/claim proven  
5. Authenticated get → claim → cash/idempotency verify  
6. Return all production flags **OFF** (or leave backend reward ON only under explicit product decision — default canary: OFF after)

Materialize script **does** check `SEASON_REWARDS_ENABLED`. Snapshot flag not required for materialize/get/claim.

### Safe candidate

**NO.** Reasons:

1. No season with participantCount ≥ 10  
2. No closed non-W34 season with immutable snapshot authority ready for payout  
3. **BLOCKER:** no clean code path to designate `rewardsEnabled=true` / freeze catalog before/during close  
4. W34 must never be used for successful payout

### Proposed Step 8B runbook

**Not prepared for execution** — no safe candidate. Placeholder recommendation only:

1. Implement first-class reward-enable designation (meta before/at close) — separate engineering step  
2. Wait for a naturally qualifying future season (≥10 legitimate participants)  
3. Do **not** change W34, fake participants, or lower the minimum  
4. Then author Step 8B with seasonKey, rank, amount, cash before/after, flag sequence, materialize command, claim + retry checks, flags OFF

### Audits / tests (this step)

PASS: season-reward-policy (20), season-reward-claim (42), season-close foundation (39), season-history finals (47), account deletion (30), leaderboard regression (20).  
W34 `verifySeasonCloseSnapshot`: ok:true, fingerprint **`ea2310b854f11eb4`**.  
Read-only season inspect: `backend/scripts/inspectSeasonRewardPayoutReadiness.ts`.

### Verdict

**PHASE_7_STEP_8_NO_SAFE_PAYOUT_CANARY_CANDIDATE**

Payout **NOT** executed. Flags unchanged. W34 unchanged.

---

## PHASE 7 STEP 9 — REWARD-ENABLED SEASON DESIGNATION

**Date:** 2026-09-10  
**Mode:** Implementation + local verification only  
**Deploy:** **NO**  
**Payout:** **NO**  
**Production flags:** remain OFF

### Blocker from Step 8

`initializeClosingMeta` always wrote `rewardsEnabled: false` with no production-authoritative path to designate a future season. Historical closed seasons must not be retrofitted.

### Designation source of truth

`backend/src/seasonRewardPolicy.ts`

- Env allowlist: **`SEASON_REWARD_ENABLED_SEASONS`** (comma-separated ISO week keys)
- Empty / unset ⇒ **fail-closed** (no season designated)
- `resolveSeasonRewardPolicy(seasonKey)` → `{ rewardsEnabled, rewardCatalogVersion, reason }`
- `freezeSeasonRewardPolicyFields(policy)` → create-once meta fields
- `validateSeasonRewardDesignation(seasonKey)` — lightweight preflight (no I/O)

Explicit allowlist only — **not** “enable every season” when global reward backend is ON.

### Global flag vs per-season policy

| Layer | Meaning |
|---|---|
| `SEASON_REWARDS_ENABLED` | Global ops capability (materialize / get / claim allowed) |
| Meta `rewardsEnabled` + `rewardCatalogVersion` | Per-season frozen policy from designation at close init |

Both required for materialize/get/claim. Designation resolve is **independent** of the global flag (season can freeze reward-enabled while payout backend stays OFF).

### Close-time freeze

`initializeClosingMeta` now freezes:

- `rewardsEnabled` from policy
- `rewardCatalogVersion` = `1` when enabled, else `null`

Existing closing/closed meta is returned as-is — **never overwritten** on resume. Config changes after close start cannot alter that season.

### Catalog version

Designated seasons freeze `SEASON_REWARD_CATALOG_VERSION` (1). Unsupported catalog ⇒ fail-closed at resolve and at materialize (`unsupported-catalog-version`). No silent substitution.

### Historical protection

W34 (and any closed `rewardsEnabled=false` meta) remains authoritative even if later listed in `SEASON_REWARD_ENABLED_SEASONS`. No retrofit.

### Scheduler

`finalizeWeeklySeasonClose` still calls `finalizeSeason` only. Policy freezes via the same resolver at first meta create. **No automatic materialization.**

### Materialization

Remains manual Admin script. Requires global flag + closed + frozen `rewardsEnabled=true` + supported catalog. ParticipantCount &lt; 10 ⇒ no cash entitlement docs (existing skip behavior).

### Operator inspection

`backend/scripts/inspectSeasonRewardPolicy.ts --seasonKey=…` (read-only): configured designation, resolved policy, existing meta, whether config would be ignored.

### Future rollout sequence (repository-backed)

1. Choose a **future** seasonKey  
2. Set backend `SEASON_REWARD_ENABLED_SEASONS` to include that key  
3. Inspect designation read-only  
4. Season closes / snapshot initializes → freeze rewardsEnabled + catalog  
5. Verify participantCount ≥ 10  
6. Keep client reward UI OFF  
7. Temporarily enable `SEASON_REWARDS_ENABLED`  
8. Manual materialize  
9. One controlled claim canary + idempotency/cash verify  
10. Enable client UI only after success  
11. Do **not** use W34; do **not** fake participants; do **not** lower minimum 10

### Flags at end of Step 9

- `SEASON_REWARDS_ENABLED=false`
- `SEASON_CLOSE_SNAPSHOT_ENABLED=false`
- `EXPO_PUBLIC_ENABLE_SEASON_REWARDS=false`
- `EXPO_PUBLIC_ENABLE_SEASON_CLOSE_SNAPSHOT=false`
- `SEASON_REWARD_ENABLED_SEASONS` unset/empty in production (fail-closed)

### Verdict

**PHASE_7_STEP_9_REWARD_DESIGNATION_VERIFIED**

Future seasons can be safely designated and frozen at close without permitting historical retrofit. No production deploy / mutation / payout in this step.

---

## PHASE 7 STEP 10 — REWARD DESIGNATION PRODUCTION DEPLOY

**Date:** 2026-09-10  
**Project:** `logisticore-53ab4`  
**Mode:** Narrow Functions deploy + fail-closed production verification  
**Payout:** **NO**  
**Season designated:** **NONE** (`SEASON_REWARD_ENABLED_SEASONS` empty/unset)

### Deploy dependency audit

| Function | Depends on `finalizeSeason` / `initializeClosingMeta` → `resolveSeasonRewardPolicy` | Deployed? |
|---|---|---|
| `finalizeWeeklySeasonClose` | Yes (scheduler) | **Yes** |
| `ensureSeasonFinalizedCallable` | Yes (`ensureSeasonFinalized` → finalize) | **Yes** |
| `getSeasonResult` | Yes (`getSeasonResultForUid` may ensure/finalize when snapshot ON) | **Yes** |
| `getSeasonRewardEntitlement` | Imports `seasonClose` helpers only; does **not** freeze policy | **No** (unchanged fail-closed) |
| `claimSeasonReward` | Same | **No** |
| Firestore rules | Unchanged in Step 9 | **No** |

### Pre-deploy gate

PASS: designation regression (28), policy unit (11), close foundation/readiness, reward policy/claim/ui, history finals, leaderboard, account deletion, root/backend `tsc`, `git diff --check`.

Local/prod-intended:

- `SEASON_REWARDS_ENABLED=false`
- `SEASON_CLOSE_SNAPSHOT_ENABLED=false`
- `SEASON_REWARD_ENABLED_SEASONS` absent (empty allowlist)
- Client `EXPO_PUBLIC_ENABLE_SEASON_REWARDS=false`
- Client `EXPO_PUBLIC_ENABLE_SEASON_CLOSE_SNAPSHOT=false`

### Deploy scope / result

```text
firebase deploy --only \
  functions:finalizeWeeklySeasonClose,\
  functions:ensureSeasonFinalizedCallable,\
  functions:getSeasonResult \
  --project logisticore-53ab4
```

Log: `Loaded environment variables from .env.logisticore-53ab4`  
All three: **Successful update** (us-central1, nodejs20). No bare deploy. No rules redeploy. No client build.

### Runtime env verification (Cloud Run)

| Service | `SEASON_REWARDS_ENABLED` | `SEASON_CLOSE_SNAPSHOT_ENABLED` | `SEASON_REWARD_ENABLED_SEASONS` |
|---|---|---|---|
| finalizeweeklyseasonclose | false | false | **unset** |
| ensureseasonfinalizedcallable | false | false | **unset** |
| getseasonresult | false | false | **unset** |
| getseasonrewardentitlement (not redeployed) | false | false | unset |
| claimseasonreward (not redeployed) | false | false | unset |

### Empty allowlist / policy inspection (read-only)

`inspectSeasonRewardPolicy.ts`:

| seasonKey | configuredDesignation | rewardsEnabled | catalog | meta |
|---|---|---|---|---|
| 2026-W37 | false | false | null | none |
| 2026-W38 | false | false | null | none |
| 2026-W34 | false | false | null | **closed**, rewardsEnabled=false, catalog null; configWouldBeIgnored=true |

### W34 integrity

- status=closed, rewardsEnabled=false, catalog null
- results=3, entitlements=0, claims=0
- fingerprint **`ea2310b854f11eb4`** (`verifySeasonCloseSnapshot` ok:true)

### Historical retrofit protection

Unit/regression: existing closed meta returned create-once; config change cannot overwrite. W34 live meta proves configWouldBeIgnored. **Did not** add W34 to allowlist.

### Scheduler safety

`SEASON_CLOSE_SNAPSHOT_ENABLED=false` ⇒ `finalizeWeeklySeasonClose` no-ops (`feature-disabled`). Cadence remains `10 0 * * *` UTC. No new season meta initialized by this deploy.

### Reward ops safety

Global reward flag OFF. Materialize/get/claim remain blocked. Get/claim not redeployed (Step 7 fail-closed retained). No claim live retest required.

### Future designation operator procedure (DO NOT execute now)

1. Choose a **future** ISO week (never W34; never closed seasons).  
2. Set `SEASON_REWARD_ENABLED_SEASONS=<seasonKey>` in `backend/.env.logisticore-53ab4` (still keep `SEASON_REWARDS_ENABLED=false` if delaying payout).  
3. Redeploy affected season-close Functions so env propagates:  
   `finalizeWeeklySeasonClose`, `ensureSeasonFinalizedCallable`, `getSeasonResult`.  
4. Verify: `npx tsx backend/scripts/inspectSeasonRewardPolicy.ts --seasonKey=<key>` → configuredDesignation=true, resolved rewardsEnabled=true, catalog=1.  
5. Wait for natural close / snapshot init (snapshot flag only when intentionally opening close window).  
6. Confirm frozen meta matches designation; config changes after freeze ignored.  
7. Later: Step 8B materialize/claim canary under controlled global reward flag.

### Production mutations

None beyond Function code/env revision updates above. No season designation. No entitlements/claims/cash. W34 untouched.

### Post-deploy tests

PASS: designation (28), policy unit (11), close foundation (39), reward claim (44), history finals (47), account deletion (30), leaderboard (20), root/backend `tsc`, `git diff --check`.

### Verdict

**PHASE_7_STEP_10_REWARD_DESIGNATION_DEPLOY_VERIFIED**

### Next step

Wait for intentional future-season designation + natural ≥10 participants before payout canary. Keep allowlist empty until then.

---

## PHASE 7 FINAL AUDIT (2026-09-11)

**Canonical final audit:** [`V1_1_PHASE_7_FINAL_AUDIT.md`](./V1_1_PHASE_7_FINAL_AUDIT.md)

**Verdict:** `PHASE_7_FINAL_AUDIT_VERIFIED`

Live recheck: W34 fingerprint `ea2310b854f11eb4` unchanged; flags OFF; allowlist empty; payout `WAITING_FOR_NATURAL_QUALIFYING_SEASON`. No production mutations in the final audit step.

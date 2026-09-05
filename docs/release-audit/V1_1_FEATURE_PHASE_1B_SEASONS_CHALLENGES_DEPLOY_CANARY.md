# LogistiCore V1.1 Feature Phase 1B — Seasons / Challenges Deploy + Canary

Date: 2026-09-01
Firebase project: `logisticore-53ab4`
Functions region: `us-central1`

## Executive result

The three Phase 1 callables and the Firestore rules were successfully deployed to
production. Production function inventory and backend health are green. The linked
account mutation canary could not be completed from this workstation because no
disposable linked credential is available: Firebase CLI ADC cannot call
`iam.serviceAccounts.signBlob`, and Email/Password account creation is disabled in
production. No existing player account was used and no real player data was mutated.

Final status: **BLOCKED**

This status blocks enabling the internal feature flags. It does not mean the deployed
functions are unhealthy; it means the required authenticated claim/reconciliation
canary remains unproven in production.

## 1. Predeploy safety

| Check | Result |
|---|---|
| `npm --prefix backend run build` | PASS |
| `npm run backend:verify` | PASS — 69 backend/emulator tests, 0 failures |
| `npx tsc --noEmit` | PASS |
| `npm run validate:store-production` | PASS |
| `git diff --check` | PASS |

Deploy-scope audit:

- `backend/src/index.ts` contains only the three challenge callable exports and their
  rate-limit entries relative to HEAD.
- `firestore.rules` contains only the trusted-write rules for `challengeClaims` and
  `seasonProgress` relative to HEAD.
- No unrelated function name was included in the deploy selector.
- The working tree contains other pre-existing client/refactor changes. They were not
  part of the target function or rules deployment.

## 2. Functions deploy

Command:

```powershell
$env:FUNCTIONS_DISCOVERY_TIMEOUT = "60"
firebase deploy --only functions:getCurrentSeason,functions:getChallengeProgress,functions:claimChallengeReward --project logisticore-53ab4
```

Result: `Deploy complete!`

| Function | State | Generation | Region | Runtime | Memory |
|---|---|---:|---|---|---:|
| `getCurrentSeason` | active | v2 | us-central1 | nodejs20 | 256 MB |
| `getChallengeProgress` | active | v2 | us-central1 | nodejs20 | 256 MB |
| `claimChallengeReward` | active | v2 | us-central1 | nodejs20 | 256 MB |

No unrelated function was deployed by this command.

Deployment warnings:

- Node.js 20 is deprecated as of 2026-04-30 and scheduled for decommission on
  2026-10-30. Runtime migration is required before that date.
- The installed `firebase-functions` version is reported as outdated. Upgrade should
  be handled in a separate compatibility-tested maintenance phase.

## 3. Firestore rules deploy

Command:

```powershell
firebase deploy --only firestore:rules --project logisticore-53ab4
```

Result:

- rules compiled successfully
- `firestore.rules` released to `cloud.firestore`
- indexes were not deployed
- current query design did not report a composite-index requirement

Rule coverage:

| Path | Owner read | Client write | Trusted Admin/function write |
|---|---:|---:|---:|
| `users/{uid}/challengeClaims/*` | allowed | denied | allowed |
| `users/{uid}/seasonProgress/*` | allowed | denied | allowed |

Evidence:

- emulator authenticated-owner write denial tests passed for both paths
- unauthenticated production REST PATCH probes returned HTTP 403 for both paths
- authenticated-owner production write denial remains part of the blocked linked-account canary

## 4. Production health

`firebase functions:list --project logisticore-53ab4` confirmed the three functions
as v2, callable, `us-central1`, `nodejs20`, 256 MB.

`npm run production:backend-check`:

```text
deployedFunctionCount: 20
missing: []
wrongRegion: []
stale: false
marketplaceFunctionsActive: true
cleanupWorkersActive: true
missingIndexGroups: []
```

Global economy health at verification time:

```text
epoch: 993496
configVersion: 1
ageMinutes: 20
fuelPrice: 1.71
expectedHistoryRecords: 56
actualHistoryRecords: 56
problems: []
```

## 5. Callable reachability probe

Unauthenticated production callable probes reached all three deployed endpoints and
returned the expected structured authorization result:

| Callable | Result |
|---|---|
| `getCurrentSeason` | `{ ok: false, reason: "auth-required" }` |
| `getChallengeProgress` | `{ ok: false, reason: "auth-required" }` |
| `claimChallengeReward` | `{ ok: false, reason: "auth-required" }` |

This proves routing, region, callable envelope handling, and fail-closed unauthenticated
behavior. It does not prove authenticated progress or reward settlement.

## 6. Linked production canary

A dedicated, cleanup-safe canary runner was added:

`backend/scripts/productionSeasonsChallengesCanary.ts`

The runner is designed to:

- create disposable non-anonymous Firebase Auth identities
- seed only tagged canary marketplace history/server state
- call only the three new callables
- verify daily and weekly progress
- verify first claim, same-key replay, second-key rejection, stale/future period,
  invalid/disabled challenge behavior
- reconcile marketplace cash, server-state cash, claim receipt and season points
- verify malicious fields and direct Firestore writes are rejected
- delete all known canary documents and Auth users in `finally`

Attempt 1 — custom-token identity:

```text
CANARY_SIGN_BLOB_FAILED: Permission 'iam.serviceAccounts.signBlob' denied
```

Attempt 2 — disposable Email/Password identity fallback:

```text
AUTH_PASSWORD_TEST_ACCOUNT_CREATE_FAILED: OPERATION_NOT_ALLOWED
```

The second result confirms Email/Password is disabled in production, as expected for
the current provider policy. Because both failures happened before an identity was
returned or any canary Firestore seed ran, there was no partial canary state to clean.

### Canary result matrix

| Check | Result |
|---|---|
| active season key / UTC ISO boundaries | BLOCKED — no linked token |
| daily and weekly challenge progress | BLOCKED — no linked token |
| marketplace-history progress correctness | BLOCKED — no linked token |
| disabled delivery challenge not claimable | emulator PASS; production canary blocked |
| first reward claim | BLOCKED |
| same-key replay | emulator PASS; production canary blocked |
| second-key `already-claimed` | emulator PASS; production canary blocked |
| stale/future period rejection | emulator PASS; production canary blocked |
| invalid challenge rejection | emulator PASS; production canary blocked |
| marketplace/server cash reconciliation | emulator PASS; production canary blocked |
| season points reconciliation | emulator PASS; production canary blocked |

## 7. Security checks

| Security invariant | Emulator | Production |
|---|---:|---:|
| arbitrary progress amount rejected | PASS | blocked by missing linked token |
| arbitrary reward amount rejected | PASS | blocked by missing linked token |
| arbitrary UID rejected | PASS | blocked by missing linked token |
| another user's claim rejected | PASS | blocked by missing second linked token |
| direct `challengeClaims` write denied | PASS | unauthenticated 403; owner-token canary blocked |
| direct `seasonProgress` write denied | PASS | unauthenticated 403; owner-token canary blocked |

The callable request contract accepts no client progress, reward, or UID field. Progress
continues to be derived from server-authored marketplace history.

## 8. Log review

Function logs show:

- successful creation and ACTIVE state for all three functions
- successful deployment rollout startup probes
- the unauthenticated probes with `auth: MISSING`, returning structured `auth-required`
- no index errors
- no transaction conflicts
- no region mismatch
- no challenge idempotency anomalies (no authenticated claim was executed)

The log command also reported that the Firebase CLI credential should be reauthenticated.
The command still returned the relevant function logs, but `firebase login --reauth` is
required before the next production canary session.

No raw UID, email, token, save payload, or challenge payload was logged by the new
functions during these checks.

## 9. Feature flags

Verified values in `.env.example`, `.env.internal`, and `.env.production`:

```text
EXPO_PUBLIC_ENABLE_SEASONS=false
EXPO_PUBLIC_ENABLE_CHALLENGES=false
```

The backend is live while the UI remains hidden. No flag was enabled or deployed.

## 10. Required unblock action

Before enabling the internal flag, perform one of these controlled options:

1. Grant the deploy/test principal temporary
   `roles/iam.serviceAccountTokenCreator` on
   `363783837598-compute@developer.gserviceaccount.com`, reauthenticate Firebase CLI,
   run the canary, then remove the temporary grant; or
2. provide a disposable Google/Apple-linked production test account token through a
   secure local channel and run the same canary without persisting credentials.

Then run:

```powershell
firebase login --reauth
npx tsx backend/scripts/productionSeasonsChallengesCanary.ts --confirm-production
```

Only after the full claim and reconciliation matrix passes should the internal seasons
and challenges flags be considered safe to enable.

## 11. Remaining risks

- Required authenticated production mutation/reconciliation canary is incomplete.
- Authenticated-owner production rule denial is not yet directly observed.
- Node.js 20 runtime must be upgraded before 2026-10-30.
- `firebase-functions` dependency upgrade needs a separate regression-tested rollout.

## Final status

BLOCKED

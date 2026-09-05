# LogistiCore V1.1 Feature Phase 1B.1 — Authenticated Production Canary

Date: 2026-09-01
Project: `logisticore-53ab4`
Region: `us-central1`

## Executive result

The authenticated production canary completed successfully against the deployed
seasons/challenges callables. Reward settlement, idempotency, period validation,
challenge validation, direct-write denial, canonical cash reconciliation, and season
point reconciliation were verified using disposable non-anonymous custom-token
identities. All canary Firestore documents and Auth users were removed. The temporary
IAM binding was removed and independently verified absent.

Production/internal feature flags remain disabled. The backend is safe for an internal
flag enablement phase.

## 1. Authentication and project precheck

| Item | Result |
|---|---|
| Firebase reauthentication | PASS |
| GCP authentication | PASS |
| Active principal | `ethemsincarbusiness@gmail.com` |
| Active project | `logisticore-53ab4` |
| Tokens/credentials logged | No |

Email/Password remained disabled and was not enabled or modified.

## 2. Temporary IAM grant

The minimum role was scoped directly to the target service account.

| Field | Value |
|---|---|
| Principal | `user:ethemsincarbusiness@gmail.com` |
| Role | `roles/iam.serviceAccountTokenCreator` |
| Resource | `363783837598-compute@developer.gserviceaccount.com` |
| First recorded grant time | `2026-09-01T20:45:24.4073720Z` |
| Cleanup-instrumentation rerun grant time | `2026-09-01T20:49:46.7060949Z` |
| Project-wide Owner/Editor granted | No |

The role was not granted at project scope and no unrelated IAM binding was modified.

## 3. Custom-token signing

An in-memory `iam.serviceAccounts.signBlob` probe succeeded after normal IAM
propagation. No generated token, signed blob, or credential was printed or persisted.

Result: **PASS**

The production canary then created two disposable, non-anonymous custom-token Auth
identities:

- challenge account
- cross-user/attacker isolation account

Only SHA-256 UID hashes were emitted by the canary and function logs.

## 4. Active season

`getCurrentSeason` returned:

| Field | Result |
|---|---|
| Season key | `2026-W36` |
| Daily period key | `2026-09-01` |
| Status/boundaries | active and matched canonical UTC ISO calculation |
| `startsAt` | matched `getSeasonDefinition(nowMs)` |
| `endsAt` | matched `getSeasonDefinition(nowMs)` |

Result: **PASS**

## 5. Challenge progress

`getChallengeProgress` returned four enabled challenges.

Seed data was server-authored under the disposable account's marketplace history and
the callable derived the following canonical progress:

| Challenge | Current | Target/completion expectation | Result |
|---|---:|---|---|
| daily marketplace purchase | 1 | complete | PASS |
| daily marketplace sale | 1 | complete | PASS |
| weekly marketplace purchases | 1 | partial | PASS |
| weekly marketplace sales | 2 | complete | PASS |

`daily_delivery_foundation_deferred` was not exposed as an enabled challenge and was
not claimable.

Result: **PASS**

## 6. Reward claim and reconciliation

Claimed challenge: `daily_marketplace_purchase`

| Check | Result |
|---|---|
| First claim | success |
| Marketplace canonical cash before | 100,000 |
| Marketplace canonical cash after | 100,500 |
| Cash increase | exactly 500, once |
| Server-state cash mirror | 100,500 |
| Season key | `2026-W36` |
| Season points before | 0 |
| Season points after | 10 |
| Claim document | created with correct owner/challenge/period |

Marketplace canonical cash and server-state cash agreed after the transaction. Season
points increased exactly once under the active season document. No client-local state
was treated as authoritative.

Result: **PASS**

## 7. Idempotency and double claim

| Scenario | Result |
|---|---|
| Same transaction/idempotency key replay | returned the same successful result |
| Replay cash mutation | no second increase |
| Replay season point mutation | no second increase |
| Different transaction/idempotency key after claim | `already-claimed` |

Function logs contain two successful result entries for the first request and its
same-key replay, followed by `already-claimed` for the second key. Firestore
reconciliation proves the replay did not duplicate cash or season points.

Result: **PASS**

## 8. Period and challenge security

| Test | Production result |
|---|---|
| stale daily period | `period-closed` |
| future weekly period | `period-closed` |
| unknown challenge ID | `invalid-challenge-id` |
| disabled delivery challenge | `challenge-disabled` |
| arbitrary `progress` field | `invalid-request` |
| arbitrary `reward` field | `invalid-request` |
| arbitrary `uid` field | `invalid-request` |
| second identity claiming first identity's completion | rejected (`server-state-not-initialized`) |

The callable accepted no client-authored progress, reward, or target UID authority.

Result: **PASS**

## 9. Firestore rules production canary

Authenticated direct writes were attempted with the disposable user's Firebase ID
token.

| Path | Result |
|---|---|
| own `users/{uid}/challengeClaims/*` | HTTP 403 denied |
| own `users/{uid}/seasonProgress/*` | HTTP 403 denied |
| second identity writing first user's claim path | HTTP 403 denied |

Trusted Admin/function transaction writes continued to succeed.

Result: **PASS**

## 10. Canary cleanup

The canary runner was hardened during this phase to:

- include `quota_project_id` in its temporary ADC file
- use the known custom-token UID instead of requiring a deprecated/missing `localId`
  response field
- fail rather than swallow Auth deletion errors
- verify exact Auth and Firestore cleanup after `finally`

A read-only cleanup audit found two disposable Auth users left by the first harness
version while all Firestore canary documents were already absent. Only UIDs beginning
with `challenge-canary-` were deleted. The final audit returned:

```text
authUsers: 0
userRoots: 0
marketplaceStates: 0
serverStates: 0
challengeClaims: 0
seasonProgress: 0
marketplaceHistory: 0
orphanCount: 0
```

No real player document or Auth account matched the canary prefix or was changed.

Result: **PASS — orphan count 0**

## 11. Temporary IAM removal proof

The temporary service-account-level binding was removed immediately after each canary
attempt. Final policy verification at `2026-09-01T20:53:17.8033529Z` returned:

```text
bindingPresent: false
```

The target service account currently has no
`roles/iam.serviceAccountTokenCreator` binding for
`user:ethemsincarbusiness@gmail.com`.

Result: **PASS**

## 12. Function log review

Reviewed production logs for:

- `getCurrentSeason`
- `getChallengeProgress`
- `claimChallengeReward`

Observed:

- authenticated callable verification: `auth: VALID`
- first claim success
- same-key replay success
- second-key `already-claimed`
- stale/future `period-closed`
- invalid and disabled challenge rejection
- cross-user claim rejection

Not observed:

- transaction exceptions
- Firestore index errors
- permission anomalies
- duplicate cash/point mutation
- unexpected retries
- region mismatch
- raw UID, email, token, credential, save payload, or full marketplace history

Result: **PASS**

## 13. Post-canary validation

| Command | Result |
|---|---|
| `npm run production:backend-check` | PASS |
| `npm run backend:verify` | PASS — 69 tests, 0 failures |
| `git diff --check` | PASS |

Production health:

```text
deployedFunctionCount: 20
missing: []
wrongRegion: []
stale: false
marketplaceFunctionsActive: true
cleanupWorkersActive: true
missingIndexGroups: []
```

Global economy remained healthy with current/history parity and no reported problem.

## 14. Feature flags

Verified after canary:

```text
EXPO_PUBLIC_ENABLE_SEASONS=false
EXPO_PUBLIC_ENABLE_CHALLENGES=false
```

No production or internal flag was enabled in this phase.

## 15. Internal enablement decision

The backend, rules, authenticated progress projection, reward settlement, idempotency,
security rejection paths, cleanup, and post-canary health are verified.

**Internal flags are safe to enable in the next controlled phase.** Production flags
must remain disabled until the internal UI/reconciliation rollout is tested.

## Final status

V1_1_FEATURE_PHASE_1B_CANARY_VERIFIED

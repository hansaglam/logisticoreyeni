# Apple Revocation Broken Shell Recovery Report

**Date:** 2026-08-29  
**Project:** `logisticore-53ab4`  
**Function:** `revokeAppleSignInTokens` (`us-central1`)  
**Final status:** `APPLE_REVOCATION_DEPLOY_VERIFIED`

---

## Executive summary

The broken `UNKNOWN` function shell was deleted and `revokeAppleSignInTokens` was redeployed successfully. The function is now **ACTIVE** with memory **256**, all four Apple secrets bound at version 1, a healthy Cloud Run backing service, and passing production health and regression checks.

No source code, secrets, or IAM changes were made.

---

## 1. Pre-delete snapshot

### `firebase functions:list`

| Field | Value |
|-------|-------|
| Function | `revokeAppleSignInTokens` |
| Version | v2 |
| Region | `us-central1` |
| Memory | `---` |
| Runtime | `nodejs20` |
| Total functions | 17 |

### Apple secrets (metadata only)

| Secret | Version | State |
|--------|---------|-------|
| `APPLE_SIGNIN_TEAM_ID` | 1 | ENABLED |
| `APPLE_SIGNIN_CLIENT_ID` | 1 | ENABLED |
| `APPLE_SIGNIN_KEY_ID` | 1 | ENABLED |
| `APPLE_SIGNIN_PRIVATE_KEY` | 1 | ENABLED |

---

## 2. Deletion result

**Command:**

```powershell
firebase functions:delete revokeAppleSignInTokens --project logisticore-53ab4 --force
```

**Result:** `Successful delete operation.`

Only the Cloud Function resource was deleted. Apple secrets, other functions, Firestore, marketplace, leaderboard, and user data were not modified.

---

## 3. Clean removal proof

### `firebase functions:list`

`revokeAppleSignInTokens` **absent** — function count dropped to **16**.

### Cloud Functions API

```
GET .../functions/revokeAppleSignInTokens → 404 NOT_FOUND
Resource was not found
```

Broken shell confirmed removed before redeploy proceeded.

---

## 4. Local build check

| Command | Result |
|---------|--------|
| `npm --prefix backend run build` | PASS |
| `npm run backend:verify` | PASS (64/64 emulator tests) |
| `git diff --check` | PASS |

---

## 5. Redeploy result

**Command:**

```powershell
$env:FUNCTIONS_DISCOVERY_TIMEOUT = "60"
firebase deploy --only functions:revokeAppleSignInTokens --project logisticore-53ab4
```

**Result:**

```
+  functions[revokeAppleSignInTokens(us-central1)] Successful create operation.
+  Deploy complete!
```

| Metric | Value |
|--------|-------|
| Operation | `creating` (fresh create, not update) |
| Elapsed | ~130s |
| Secret accessor grants | All four confirmed |
| Other functions deployed | None |

Deploy output saved to `deploy-revoke-apple-recovery-output.txt`.

---

## 6. Active function verification

### `firebase functions:list`

| Field | Value |
|-------|-------|
| Function | `revokeAppleSignInTokens` |
| Version | v2 |
| Region | `us-central1` |
| Memory | **256** |
| Runtime | `nodejs20` |
| Total functions | 17 |

### Cloud Functions API

| Field | Value |
|-------|-------|
| state | **ACTIVE** |
| availableMemory | `256Mi` |
| runtime | `nodejs20` |
| uri | `https://revokeapplesignintokens-6wgqtaidla-uc.a.run.app` |

### Cloud Run backing service

| Field | Value |
|-------|-------|
| service | `revokeapplesignintokens` |
| latestReadyRevision | `revokeapplesignintokens-00001-tox` |
| RoutesReady | `CONDITION_SUCCEEDED` |
| ConfigurationsReady | `CONDITION_SUCCEEDED` |

---

## 7. Secret binding status (metadata only)

All four secrets bound to `revokeAppleSignInTokens` at version 1:

| Key | Secret | Version |
|-----|--------|---------|
| `APPLE_SIGNIN_TEAM_ID` | `APPLE_SIGNIN_TEAM_ID` | 1 |
| `APPLE_SIGNIN_CLIENT_ID` | `APPLE_SIGNIN_CLIENT_ID` | 1 |
| `APPLE_SIGNIN_KEY_ID` | `APPLE_SIGNIN_KEY_ID` | 1 |
| `APPLE_SIGNIN_PRIVATE_KEY` | `APPLE_SIGNIN_PRIVATE_KEY` | 1 |

Secret values were not read or printed.

---

## 8. Production health

**Command:** `npm run production:backend-check`

| Check | Result |
|-------|--------|
| `deployedFunctionCount` | 17 |
| `missing` | `[]` |
| `wrongRegion` | `[]` |
| `stale` | `false` |
| `marketplaceFunctionsActive` | `true` |
| `cleanupWorkersActive` | `true` |
| Global economy epoch | 993309 (fresh) |

---

## 9. Safe regression results

| Test | Result |
|------|--------|
| `scripts/apple-auth-audit-test.ts` | 46/46 PASS |
| `scripts/app-store-privacy-account-regression-test.ts` | 23/23 PASS |
| `scripts/account-signout-deletion-regression-test.ts` | 37/37 PASS |

No destructive production account deletion test was run.

---

## 10. Remaining blockers

**None.** Apple Sign-In token revocation callable is production-ready.

### Recommended follow-up (optional, not blocking)

- End-to-end Apple account deletion test on a real Apple-linked test account in TestFlight/internal build.
- App Store resubmission with privacy/account deletion fixes.

---

## Related reports

| Report | Status |
|--------|--------|
| `APPLE_REVOCATION_CLOUD_BUILD_ROOT_CAUSE.md` | `ROOT_CAUSE_IDENTIFIED` |
| `APPLE_REVOCATION_DEPLOY_RECOVERY_REPORT.md` | Prior attempt `BLOCKED` |

---

**Final status: `APPLE_REVOCATION_DEPLOY_VERIFIED`**

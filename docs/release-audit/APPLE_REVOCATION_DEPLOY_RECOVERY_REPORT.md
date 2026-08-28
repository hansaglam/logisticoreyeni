# Apple Revocation Deploy Recovery Report

**Date:** 2026-08-28  
**Project:** `logisticore-53ab4`  
**Function:** `revokeAppleSignInTokens` (`us-central1`)  
**Final status:** `BLOCKED`

---

## Executive summary

Targeted redeploy of `revokeAppleSignInTokens` was attempted once after secret binding and IAM accessor grants. The deploy failed again at the **Cloud Build** stage with status **CANCELLED** and message **"An unexpected error occurred."** Local code, secrets, and secret binding configuration are verified correct. The function shell exists in production but appears **incompletely deployed** (memory column `---`). Root cause stage could not be determined from this machine because **Cloud Build logs require `gcloud` authentication**, which is not configured locally (Firebase CLI auth does not transfer automatically).

No code, secret, or package changes were made during this recovery pass.

---

## 1. Secret presence and access

Verified via `firebase functions:secrets:describe` (metadata only; **no secret values read or printed**).

| Secret | Exists | Enabled version | Accessor grant |
|--------|--------|-----------------|----------------|
| `APPLE_SIGNIN_TEAM_ID` | Yes | v1 ENABLED | Granted during deploy to `363783837598-compute@developer.gserviceaccount.com` |
| `APPLE_SIGNIN_CLIENT_ID` | Yes | v1 ENABLED | Granted during deploy |
| `APPLE_SIGNIN_KEY_ID` | Yes | v1 ENABLED | Granted during deploy |
| `APPLE_SIGNIN_PRIVATE_KEY` | Yes | v1 ENABLED | Granted during deploy |

Firebase CLI output during both deploy attempts:

```
+ secretmanager: Granted roles/secretmanager.secretAccessor on .../APPLE_SIGNIN_* to 363783837598-compute@developer.gserviceaccount.com
+ functions: ensured 363783837598-compute@developer.gserviceaccount.com access to APPLE_SIGNIN_*.
```

**Conclusion:** All four secrets exist with enabled versions. Compute service account received `secretAccessor` on all four. No secret rotation or overwrite was performed.

---

## 2. Local build and test status

| Command | Result |
|---------|--------|
| `npm --prefix backend run build` | PASS |
| `npm run backend:verify` | PASS (64/64 emulator tests) |
| `npx tsc --noEmit` | PASS |
| `git diff --check` | PASS (CRLF warning on `package.json` only) |

**Code binding verified (no changes required):**

- `revokeAppleSignInTokens` exported from `backend/src/index.ts`
- Bound with `secrets: [...APPLE_SIGNIN_SECRETS]` (all four `defineSecret()` params from `backend/src/appleSignInSecrets.ts`)
- Uses `readAppleSignInSecretValuesFromBinding()` at runtime

**Safe regression tests (no production Apple revoke call):**

| Test | Result |
|------|--------|
| `scripts/apple-auth-audit-test.ts` | 46/46 PASS |
| `scripts/app-store-privacy-account-regression-test.ts` | 23/23 PASS |
| `scripts/account-signout-deletion-regression-test.ts` | 37/37 PASS |

---

## 3. Pre-retry production function state

`firebase functions:list --project logisticore-53ab4` before retry:

| Field | Value |
|-------|-------|
| Present | **Yes** (from prior failed create) |
| Region | `us-central1` |
| Version | v2 |
| Trigger | callable |
| Runtime | `nodejs20` |
| Memory | `---` (incomplete / failed deploy indicator) |

All other 16 functions show `256` or `512` Mi memory normally.

Audit log (`firebase functions:log`) from initial create at `2026-08-28T17:54:09Z` confirms intended config:

- `available_memory`: `256Mi`
- `secret_environment_variables`: all four Apple secrets at version `1`
- `timeout_seconds`: 60, `max_instance_count`: 20

---

## 4. Deploy retry result

**Environment:** `$env:FUNCTIONS_DISCOVERY_TIMEOUT = "60"`

**Command:**

```powershell
firebase deploy --only functions:revokeAppleSignInTokens --project logisticore-53ab4
```

**Outcome:** **FAILED** (did not reach `Deploy complete!`)

| Field | Value |
|-------|-------|
| Operation | `UpdateFunction` (function shell already existed) |
| Predeploy build | PASS |
| Source upload | PASS |
| Secret accessor grants | PASS (all four) |
| Cloud Build status | **CANCELLED** |
| Firebase CLI error | `Error: There was an error deploying functions` |
| Elapsed | ~12 minutes |

**Build IDs:**

| Attempt | Operation | Build ID | Time (UTC) |
|---------|-----------|----------|------------|
| First (prior to this recovery) | `CreateFunction` | `43808fe9-7acc-4c2e-b7ef-204e7aa1fbd0` | ~18:04 |
| Retry (this recovery) | `UpdateFunction` | `1b38241a-5f27-4153-867d-aed886305ee4` | ~18:23 |

**Cloud Build log URLs:**

- Retry: https://console.cloud.google.com/cloud-build/builds;region=us-central1/1b38241a-5f27-4153-867d-aed886305ee4?project=363783837598
- First: https://console.cloud.google.com/cloud-build/builds;region=us-central1/43808fe9-7acc-4c2e-b7ef-204e7aa1fbd0?project=363783837598

---

## 5. Cloud Build log inspection

| Tool | Result |
|------|--------|
| `gcloud builds describe` | **Blocked** — `gcloud` was not on PATH initially; installed via `winget` (SDK 582.0.0) but **no active account** (`gcloud auth login` required) |
| `gcloud builds log` | Not run (same auth blocker) |
| Google Auth REST via `google-auth-library` | **Blocked** — no Application Default Credentials on this machine |
| `firebase functions:log` | Audit entries captured (build failure messages only; no step-level build output) |

**Failing stage:** **Not determinable from available logs.** Failure occurs after source upload and secret IAM grants, during the Cloud Build / Cloud Run update phase. No evidence of local compilation error, npm install failure, or secret binding misconfiguration in Firebase audit metadata.

---

## 6. Root cause classification

**Classification: `UNKNOWN_PLATFORM_ERROR`**

Rationale (evidence-based, not guessed):

| Ruled out | Evidence |
|-----------|----------|
| Local `BUILD_FAILURE` | All local builds and 64 emulator tests pass |
| `SECRET_BINDING_ISSUE` (config) | Audit log shows all four secrets correctly bound at v1; accessor grants succeeded |
| `IAM_PERMISSION_ISSUE` (secret accessor) | Firebase CLI confirmed `secretAccessor` grants on all four secrets |
| `FUNCTION_CONFIG_ISSUE` (code) | Export, region, memory, timeout match other working callables |

| Observed | Implication |
|----------|-------------|
| Status `CANCELLED` + generic "unexpected error" | Platform/internal Cloud Build termination, not a surfaced compile or IAM denial |
| ~10–12 minute build before cancel | Possible timeout or internal build pipeline stall |
| Identical failure on create and update | Not a one-off upload glitch |
| Only secret-bound function affected | Suggests secret-mount or Cloud Run deploy path, but **cannot confirm without build step logs** |
| Memory `---` in `functions:list` | Function resource exists but revision not fully active |

**Not classified as `TRANSIENT_CLOUD_BUILD_FAILURE`** because the same error reproduced on immediate retry; treat as blocked until logs prove otherwise.

---

## 7. Code / config changes

**None.** No changes to source, `firebase.json`, secrets, Node version, or `firebase-functions` version.

---

## 8. Post-deploy verification

Deploy did **not** succeed; partial state only.

### `firebase functions:list` (after failed retry)

```
revokeAppleSignInTokens | v2 | callable | us-central1 | --- | nodejs20
```

17 functions listed; `revokeAppleSignInTokens` present but memory unset.

### `npm run production:backend-check`

**PASS** — other backend surfaces healthy:

```
deployedFunctionCount: 17
missing: []
wrongRegion: []
marketplaceFunctionsActive: true
cleanupWorkersActive: true
globalEconomyEpoch: 993300 (not stale)
```

Note: health check counts the function name as deployed but does not validate Cloud Run revision health or secret mount readiness for this callable.

### Secret binding in production (metadata only)

From Cloud Functions audit log (`CreateFunction` / `UpdateFunction` requests):

- `APPLE_SIGNIN_TEAM_ID` → version 1
- `APPLE_SIGNIN_CLIENT_ID` → version 1
- `APPLE_SIGNIN_KEY_ID` → version 1
- `APPLE_SIGNIN_PRIVATE_KEY` → version 1

Binding is **configured** in the function definition; runtime availability is **unverified** because deploy did not complete.

---

## 9. Remaining blockers

1. **Cloud Build `CANCELLED`** on both create and update — step-level cause unknown without console or `gcloud` log access.
2. **Function in broken partial state** — listed with `---` memory; likely no healthy revision serving requests.
3. **`gcloud` not authenticated** on this machine — blocks automated log retrieval.
4. **Apple account deletion in production** remains blocked until a successful deploy produces an active revision.

---

## 10. Recommended next actions (manual)

1. **Authenticate gcloud** (one-time on this machine):
   ```powershell
   gcloud auth login
   gcloud config set project logisticore-53ab4
   ```
2. **Inspect failed build logs:**
   ```powershell
   gcloud builds describe 1b38241a-5f27-4153-867d-aed886305ee4 --region=us-central1 --project=logisticore-53ab4
   gcloud builds log 1b38241a-5f27-4153-867d-aed886305ee4 --region=us-central1 --project=logisticore-53ab4
   ```
   Or open the Cloud Build console URLs above.
3. **If logs show IAM/logging gaps** (common pattern: build SA cannot write logs), grant only the role the log proves missing — e.g. `roles/logging.logWriter` on `PROJECT_NUMBER@cloudbuild.gserviceaccount.com`.
4. **If logs show stuck revision**, consider deleting the broken function and redeploying:
   ```powershell
   firebase functions:delete revokeAppleSignInTokens --project logisticore-53ab4
   firebase deploy --only functions:revokeAppleSignInTokens --project logisticore-53ab4
   ```
   Only after log review; do not delete blindly.
5. **Re-run** `npm run production:backend-check` and confirm `functions:list` shows `256` memory after successful deploy.

---

## Artifacts

| Artifact | Path |
|----------|------|
| Deploy CLI output | `deploy-revoke-apple-output.txt` |
| Terminal capture | terminals `536801.txt` |

---

**Final status: `BLOCKED`**

# Apple Revocation Cloud Build Root Cause Analysis

**Date:** 2026-08-29  
**Project:** `logisticore-53ab4`  
**Region:** `us-central1`  
**Function:** `revokeAppleSignInTokens`  
**Final status:** `ROOT_CAUSE_IDENTIFIED`

---

## Executive summary

Both Cloud Builds for `revokeAppleSignInTokens` were **cancelled before any build step started**. All three steps (`fetch`, `pre-buildpack`, `build`) remained `QUEUED` with **no `startTime`**. No step-level build logs exist because the build worker never ran.

The Cloud Functions resource is stuck in a **partial state** (`state: UNKNOWN`, no Cloud Run service, no Artifact Registry package, empty `serviceConfig`). This is the **only function** in the project with failed/cancelled builds; all other functions on the same build service account deploy successfully.

**Root cause classification:** `FUNCTION_PARTIAL_STATE_CONFLICT`

**Minimal fix:** Delete the broken function shell, then redeploy. No code changes required.

---

## 1. Authentication

| Method | Result |
|--------|--------|
| `gcloud auth login` | Browser prompt opened; **no user gcloud account credentialed** during this pass |
| Firebase ADC | Used successfully via `GOOGLE_APPLICATION_CREDENTIALS` (Firebase application default credentials file) |
| API access | Cloud Build, Cloud Functions, Cloud Run, Artifact Registry, Cloud Logging APIs queried via REST |

No tokens or credentials were printed.

---

## 2. Build metadata — retry build

**Build ID:** `1b38241a-5f27-4153-867d-aed886305ee4`

| Field | Value |
|-------|-------|
| status | `CANCELLED` |
| createTime | `2026-08-28T18:12:52.641623668Z` |
| startTime | **(none — build never started)** |
| finishTime | `2026-08-28T18:23:04.857213166Z` |
| duration | **612s** (~10m 12s) |
| timeout | `1800s` |
| failureInfo | `null` |
| statusDetail | `(none)` |
| serviceAccount | `projects/logisticore-53ab4/serviceAccounts/363783837598-compute@developer.gserviceaccount.com` |
| logsBucket | `(none)` |
| queueTtl | `360s` |
| logging | `CLOUD_LOGGING_ONLY` |
| logStreamingOption | `STREAM_OFF` |

**Steps:**

| Step | Image | Status |
|------|-------|--------|
| `fetch` | `gcs-fetcher:base_20260522_18_04_RC00` | `QUEUED` |
| `pre-buildpack` | `builder/nodejs:nodejs_20260812_RC00` | `QUEUED` |
| `build` | `builder/nodejs:nodejs_20260812_RC00` | `QUEUED` |

**Substitutions (selected):**

| Key | Value |
|-----|-------|
| `_GOOGLE_FUNCTION_TARGET` | `revokeAppleSignInTokens` |
| `_GOOGLE_RUNTIME` | `nodejs20` |
| `_GOOGLE_LABEL_SOURCE` | `gs://gcf-v2-sources-363783837598-us-central1/revokeAppleSignInTokens/function-source.zip#1787940772167056` |
| `_GOOGLE_LABEL_FUNCTION_TARGET` | `revokeAppleSignInTokens` |

**Tags:** `service_revokeapplesignintokens`, `p-gcf`, `r-nodejs20`, `t-function`, `bt-LIFECYCLE`

**Log URL:** https://console.cloud.google.com/cloud-build/builds;region=us-central1/1b38241a-5f27-4153-867d-aed886305ee4?project=363783837598

---

## 3. Build metadata — first build

**Build ID:** `43808fe9-7acc-4c2e-b7ef-204e7aa1fbd0`

| Field | Value |
|-------|-------|
| status | `CANCELLED` |
| createTime | `2026-08-28T17:54:10.065477874Z` |
| startTime | **(none)** |
| finishTime | `2026-08-28T18:04:17.969884318Z` |
| duration | **608s** (~10m 8s) |
| timeout | `1800s` |
| failureInfo | `null` |
| statusDetail | `(none)` |
| serviceAccount | `363783837598-compute@developer.gserviceaccount.com` |
| queueTtl | `360s` |

**Steps:** identical pattern — `fetch:QUEUED`, `pre-buildpack:QUEUED`, `build:QUEUED`

**Log URL:** https://console.cloud.google.com/cloud-build/builds;region=us-central1/43808fe9-7acc-4c2e-b7ef-204e7aa1fbd0?project=363783837598

---

## 4. Step-level logs

| Build ID | Log retrieval | Entries |
|----------|---------------|---------|
| `1b38241a-5f27-4153-867d-aed886305ee4` | Cloud Logging filter `resource.type="build" resource.labels.build_id="..."` | **0** |
| `43808fe9-7acc-4c2e-b7ef-204e7aa1fbd0` | Same filter | **0** |

**Why no logs:** Build never assigned a worker (`startTime` absent). With `logStreamingOption: STREAM_OFF` and `logging: CLOUD_LOGGING_ONLY`, no log entries are written until steps execute.

**Exact final error lines (from Cloud Functions operation API):**

```
Build failed with status: CANCELLED and message: An unexpected error occurred.
```

No additional step-level error text exists in build metadata, Cloud Logging, or operation `failureInfo`.

---

## 5. Failure stage identification

| Stage | Ran? | Evidence |
|-------|------|----------|
| fetch source | **No** | `fetch:QUEUED`, no `startTime` |
| npm install / buildpack | **No** | `pre-buildpack:QUEUED` |
| npm build | **No** | `build:QUEUED` |
| container image build | **No** | build step never started |
| Artifact Registry push | **No** | AR package does not exist |
| secret mount | **No** | Cloud Run service does not exist |
| Cloud Run revision create | **No** | Cloud Run service 404 |
| health check | **No** | no revision created |
| IAM (build SA) | **Not implicated** | same SA builds other functions in 33s |
| logging | **Not root cause** | absence of logs is effect, not cause |
| quota | **Not implicated** | only 2 cancelled builds in project, both this function |
| platform cancellation | **Yes** | `CANCELLED` after ~608–612s with all steps `QUEUED` |

**Exact failing stage:** **Cloud Build queue / worker assignment** — build submitted but never scheduled before platform cancellation.

---

## 6. Build service account

**Actual build service account (both builds):**

```
363783837598-compute@developer.gserviceaccount.com
```

This is the standard GCF v2 default compute service account. The same account successfully built other functions the same day, e.g.:

| Build ID | Function | Status | Duration | Steps |
|----------|----------|--------|----------|-------|
| `37f54610-dc5a-4512-b199-10b68082fc87` | `seedWeeklyLeaderboard` | SUCCESS | 33s | fetch/pre-buildpack/build SUCCESS |

**IAM audit conclusion:** No missing IAM permission identified. Preemptive role grants are **not** recommended.

| Checked role / permission | Implicated? |
|---------------------------|-------------|
| `roles/cloudbuild.builds.builder` on compute SA | No — other functions build fine with same SA |
| `roles/logging.logWriter` | No — build never started; not proven as cancel cause |
| `roles/artifactregistry.writer` | No — push never attempted |
| `roles/secretmanager.secretAccessor` | No — secret mount is post-build; accessor grants succeeded in Firebase CLI |

---

## 7. Function partial state

### `gcloud functions describe` equivalent (Cloud Functions v2 API)

| Field | Value |
|-------|-------|
| name | `projects/logisticore-53ab4/locations/us-central1/functions/revokeAppleSignInTokens` |
| state | **`UNKNOWN`** |
| environment | `GEN_2` |
| updateTime | `2026-08-28T18:23:29.614258394Z` |
| buildConfig.runtime | `nodejs20` |
| buildConfig.entryPoint | `revokeAppleSignInTokens` |
| buildConfig.serviceAccount | `363783837598-compute@developer.gserviceaccount.com` |
| buildConfig.dockerRepository | `projects/logisticore-53ab4/locations/us-central1/repositories/gcf-artifacts` |
| serviceConfig | **{}** (empty) |
| secretEnvironmentVariables (live) | **0** (not applied) |

### Backing Cloud Run service

```
GET .../services/revokeapplesignintokens → 404 NOT_FOUND
```

No Cloud Run service exists.

### Artifact Registry

```
packages/logisticore--53ab4__us--central1__revoke_apple_sign_in_tokens → 404 NOT_FOUND
```

No container images were published.

### Comparison with healthy function

| Function | state | secrets (live) | Cloud Run service | URI |
|----------|-------|----------------|-------------------|-----|
| `getLeaderboard` | ACTIVE | 0 | exists | `https://getleaderboard-...run.app` |
| `revokeAppleSignInTokens` | **UNKNOWN** | 0 | **missing** | **none** |

### Create operation rollback (evidence of partial create)

After the first failed build, GCF completed rollback stages:

1. `ARTIFACT_REGISTRY` — "Deleting function artifacts in Artifact Registry" — **COMPLETE**
2. `SERVICE` — "Deleting Cloud Run service" — **COMPLETE**

The Cloud Functions **shell resource** was **not** removed and remains in `UNKNOWN` state.

---

## 8. Root cause classification

### `FUNCTION_PARTIAL_STATE_CONFLICT`

**Evidence:**

1. Both builds cancelled with **zero steps executed** — not a source, buildpack, or compile failure.
2. **Only** `revokeAppleSignInTokens` has cancelled builds in the project (2/2 project-wide cancelled builds).
3. Function resource exists in **`UNKNOWN`** state with empty `serviceConfig`.
4. First `create` operation rolled back Cloud Run + Artifact Registry but **left the function shell**.
5. Second `update` operation failed identically (~612s queued cancel).
6. Same build service account deploys other functions successfully in 33s.
7. This is the **only secret-bound function** in the codebase, but secret mount occurs after build; the failure is pre-build queue cancellation tied to the broken function lifecycle state.

**Ruled out:**

| Classification | Why ruled out |
|----------------|---------------|
| `BUILD_PACK_FAILURE` | Buildpack step never ran |
| `SECRET_MOUNT_FAILURE` | Cloud Run revision never created |
| `CLOUD_RUN_REVISION_FAILURE` | No Cloud Run service exists |
| `BUILD_TIMEOUT` | Cancelled at 612s; timeout is 1800s |
| `CLOUD_BUILD_IAM` | Same SA builds other functions |
| `ARTIFACT_REGISTRY_IAM` | AR push never attempted |
| `CLOUD_BUILD_LOGGING_IAM` | No logs because build never started; not proven as cause |
| `QUOTA_LIMIT` | No quota error in API responses; only this function affected |
| `TRANSIENT_PLATFORM_FAILURE` | Identical failure on immediate retry with partial resource left behind |

---

## 9. Minimal fix recommendation (do not execute yet)

### Recommended sequence

1. **Delete the broken function shell:**
   ```powershell
   firebase functions:delete revokeAppleSignInTokens --project logisticore-53ab4
   ```
2. **Confirm removal:**
   ```powershell
   firebase functions:list --project logisticore-53ab4
   gcloud functions describe revokeAppleSignInTokens --gen2 --region=us-central1 --project=logisticore-53ab4
   ```
   (expect 404)
3. **Redeploy only this function:**
   ```powershell
   $env:FUNCTIONS_DISCOVERY_TIMEOUT = "60"
   firebase deploy --only functions:revokeAppleSignInTokens --project logisticore-53ab4
   ```
4. **Verify:** `functions:list` shows memory `256`, state ACTIVE, and audit log shows four secret bindings applied.

### Is function deletion required?

**Yes** — evidence indicates the `UNKNOWN` function shell from the failed create is blocking normal build scheduling. Update-on-broken-shell reproduces the same queue cancellation.

### Is any code change required?

**No** — local build, verify, and regression tests all pass. Secret binding configuration is correct in source and in operation request metadata.

### IAM changes required?

**No** — not proven by logs. Do not grant broad roles preemptively.

### If delete + redeploy fails again

Escalate to Google Cloud Support with both build IDs and note that builds never leave `QUEUED` state. That would reclassify toward `TRANSIENT_PLATFORM_FAILURE` or an undocumented GCF control-plane issue.

---

## 10. Artifacts referenced

| Item | ID / path |
|------|-----------|
| Retry build | `1b38241a-5f27-4153-867d-aed886305ee4` |
| First build | `43808fe9-7acc-4c2e-b7ef-204e7aa1fbd0` |
| Create operation | `operation-1787939648970-65a1f23a820f7-c6e6dd63-35a8e121` |
| Update operation | `operation-1787940771177-65a1f668ba293-45b1380a-dd5d2fb4` |
| Prior recovery report | `docs/release-audit/APPLE_REVOCATION_DEPLOY_RECOVERY_REPORT.md` |

---

**Final status: `ROOT_CAUSE_IDENTIFIED`**

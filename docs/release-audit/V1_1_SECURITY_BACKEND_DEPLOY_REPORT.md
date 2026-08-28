# V1.1 Security Backend Production Deploy Report

**Timestamp:** 2026-08-28T03:26:00+03:00  
**Final status:** `V1_1_SECURITY_BACKEND_DEPLOY_VERIFIED`

---

## Summary

| Gate | Result |
|------|--------|
| Pre-deploy build + tests | **PASS** |
| Security emulator gate | **PASS** |
| Functions deploy | **PASS** — `Deploy complete!` |
| Production backend health | **PASS** |
| Production security smoke | **SKIPPED** (IAM `signBlob` denied locally) |
| Firestore rules deploy | **Not required** (unchanged) |
| App binary | **NOT PRODUCED** |

Deployed leaderboard authority + marketplace cloud-save trust fixes to `logisticore-53ab4` / `us-central1`.

---

## Project / region

| Field | Value |
|-------|--------|
| **Project** | `logisticore-53ab4` |
| **Region** | `us-central1` |
| **Runtime** | Node.js 20 (2nd Gen) |

---

## 1. Pre-deploy checks

| Command | Result |
|---------|--------|
| `git status` | Dirty working tree (22 modified source files, uncommitted security fixes) |
| `git diff --check` | **PASS** |
| `npm --prefix backend run build` | **PASS** |
| `npm --prefix backend test` (emulator, 64 tests) | **PASS** (64/64) |
| `npx tsc --noEmit` | **PASS** |
| `security-malicious-save-trust-test.ts` | **PASS** (`MITIGATED`, `canonicalMarketplaceCash: 20000`, `forgedLeaderboardScoreIgnored: true`) |
| `leaderboard-server-state-sync-regression-test.ts` | **PASS** |

### Security matrix confirmed (emulator)

| Area | Status |
|------|--------|
| Leaderboard malicious cloud-save matrix | **PASS** (#17–#23) |
| Marketplace forged cash/fleet | **PASS** (security script + emulator) |
| Marketplace P0 purchase/tombstone | **PASS** (#52–#56, unit test) |

### Known unrelated (not gated for this deploy)

| Issue | Status |
|-------|--------|
| `backend:verify` → `cloud-save-conflict-test.ts` | **FAIL** (`body-missing` vs `cloud-save-corrupted`) — pre-existing, not modified |
| `npm run verify` → `time-progression-audit-test` | Not run — pre-existing offline threshold failures |

---

## 2. Functions deploy

**Command:**

```powershell
$env:FUNCTIONS_DISCOVERY_TIMEOUT="60"
firebase deploy --only functions --project logisticore-53ab4
```

**Evidence:** `+  Deploy complete!`

### Security-relevant functions (implementation → deployed name)

| Implementation concern | Deployed callable / worker | Deploy result |
|------------------------|---------------------------|---------------|
| Leaderboard submit | `submitLeaderboardScore` | **Updated** |
| Leaderboard season seed | `seedWeeklyLeaderboard` | **Updated** |
| Marketplace bootstrap (`ensureVehicleMarketplaceStateTransaction`) | Bundled in `getMyVehicleListings` + `createVehicleListing` bootstrap path (no separate export) | **Updated** (via parent functions) |
| Fleet reconcile | `reconcileAuthoritativeFleet` | **Updated** |
| Listing create | `createVehicleListing` | **Updated** |
| Listing purchase | `purchaseVehicleListing` | **Updated** |
| Legacy migration | `migrateLegacyServerState` | **Updated** |

### All functions deployed (16/16 successful)

| Function | Result |
|----------|--------|
| `submitLeaderboardScore` | Updated |
| `getLeaderboard` | Updated |
| `seedWeeklyLeaderboard` | Updated |
| `reconcileAuthoritativeFleet` | Updated |
| `migrateLegacyServerState` | Updated |
| `createVehicleListing` | Updated |
| `cancelVehicleListing` | Updated |
| `purchaseVehicleListing` | Updated |
| `getVehicleMarketplaceListings` | Updated |
| `getMyVehicleListings` | Updated |
| `prepareVehicleMarketplaceAccountDeletion` | Updated |
| `setUsername` | Updated |
| `checkUsernameAvailability` | Updated |
| `getUsernameProfile` | Updated |
| `generateGlobalEconomy` | Updated |
| `expireVehicleMarketplace` | Updated |

| Category | Count |
|----------|-------|
| **Updated** | 16 |
| **Failed** | 0 |
| **Unchanged (skipped)** | 0 |

---

## 3. Production health

**Command:** `npm run production:backend-check`

```json
{
  "projectId": "logisticore-53ab4",
  "missing": [],
  "wrongRegion": [],
  "stale": false,
  "marketplaceFunctionsActive": true,
  "cleanupWorkersActive": true,
  "missingIndexGroups": []
}
```

Global economy epoch active, 56/56 history records, no problems reported.

---

## 4. Security production check

**Script:** `npm run marketplace:smoke:production -- --confirm-production`

**Result:** **BLOCKED locally**

```
CANARY_SIGN_BLOB_FAILED: Permission 'iam.serviceAccounts.signBlob' denied
```

The smoke script uses disposable canary users with cleanup, but local IAM prevents custom-token signing. **No production user data was forged or altered.**

**Production security gate for this deploy:** Pre-deploy emulator suite + `security-malicious-save-trust-test.ts` (64 emulator tests + MITIGATED status). Manual production smoke pending IAM remediation or CI runner with `signBlob` access.

---

## 5. Firestore rules

| Check | Result |
|-------|--------|
| `git diff firestore.rules` | **Empty** — no changes |
| Rules deploy | **Not performed** |

---

## 6. Post-deploy source state

Deploy did not modify tracked source files. Working tree remains the same uncommitted security-fix diff as pre-deploy (`git diff --stat` unchanged in scope).

`backend/lib/` is gitignored; predeploy hook rebuilt it during deploy only.

---

## 7. Fix status in production

| Fix | Status |
|-----|--------|
| **LEADERBOARD_AUTHORITY_FIXED** | **LIVE** — `submitLeaderboardScore`, `seedWeeklyLeaderboard` deployed |
| **MARKETPLACE_CLOUD_SAVE_TRUST_FIXED** | **LIVE** — bootstrap/reconcile/migration paths in deployed marketplace + `getMyVehicleListings` |
| **Marketplace P0 compatibility** | **Preserved** — purchase/tombstone/idempotency paths redeployed unchanged in transaction semantics |

---

## 8. Warnings (recorded, not fixed)

| Warning | Notes |
|---------|-------|
| Node.js 20 deprecation | Decommission 2026-10-30 — upgrade deferred |
| Outdated `firebase-functions` | Upgrade deferred |
| Firebase CLI emulator/port warnings | Observed during pre-deploy only |
| `authProviderConfig: not-readable-with-firebase-cli` | Health check informational |

---

## 9. Binary status

**NOT PRODUCED** — server-side deploy only; no AAB/APK/IPA build in this pass.

---

## Final status

`V1_1_SECURITY_BACKEND_DEPLOY_VERIFIED`

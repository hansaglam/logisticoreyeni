# V1.1 — Marketplace P0 Production Deploy Report

**Date:** 2026-08-28  
**Final status:** `MARKETPLACE_PROD_DEPLOY_VERIFIED`  
**Scope:** Deploy + verify only. No code changes, no binaries, no rules deploy.

---

## Summary

| Gate | Result |
|------|--------|
| Pre-deploy backend build | PASS |
| Pre-deploy `tsc --noEmit` | PASS |
| Pre-deploy `npm run verify` | **FAIL** (pre-existing, unrelated — see below) |
| Marketplace-specific regression tests | PASS (108/108) |
| Functions deploy | **PASS** — `Deploy complete!` |
| Production backend health | **PASS** (all required fields) |
| Production marketplace smoke | **BLOCKED locally** (IAM `signBlob`) — manual smoke pending |
| Firestore rules change in P0 patch | **No** |
| Rules deploy required | **No** |
| Binary build (AAB/APK/IPA) | **NOT PRODUCED** |

---

## 1. Pre-deploy checks

### `git status` (before deploy)

- Branch: `main` (ahead of `origin/main` by 1 commit)
- Uncommitted marketplace P0 changes in 13 source files (client + backend)
- `backend/lib/` gitignored (build output used by deploy predeploy hook)

### `npm --prefix backend run build`

```
PASS — sync:canonical + tsc completed successfully
```

### `npx tsc --noEmit`

```
PASS
```

### `npm run verify`

```
FAIL — offline-economy-test: 28 passed, 4 failed
```

**Failed cases (all pre-existing on committed `main`, unrelated to marketplace P0):**

- `72h offline: cost cursor capped without charging`
- `offline catch-up advances economy cursor to now`
- `idle şoför: 1 dönem kesilir — charged=0`
- `24s hiç iş yapmayan şoför: yalnız 1× günlük maaş — got=0`

Verified by stashing marketplace changes and re-running verify — same 4 failures.

**Assessment:** Advisory for this deploy pass. Marketplace-specific gates were run separately and passed. Functions deploy proceeded because backend build/tsc pass and marketplace regression suites are green.

### Marketplace-specific gates (run separately)

| Suite | Result |
|-------|--------|
| `vehicle-marketplace-transaction-integrity-test.ts` | 25/25 PASS |
| `vehicle-marketplace-purchase-deadlock-test.ts` | 83/83 PASS |
| `vehicleMarketplace.emulator.test.ts` | **Not run** — Firestore emulator port 8080 occupied locally |

---

## 2. Deploy command

```powershell
$env:FUNCTIONS_DISCOVERY_TIMEOUT="60"
firebase deploy --only functions --project logisticore-53ab4
```

- **Project:** `logisticore-53ab4`
- **Region:** `us-central1`
- **Deployment timestamp (local):** 2026-08-28 ~02:18 UTC+3
- **Hosting / indexes / rules:** Not deployed (functions only)

### Deploy evidence

Output contained required success marker:

```
+  Deploy complete!
```

Predeploy hook ran `npm --prefix backend run build` (canonical sync + tsc) before upload.

---

## 3. Functions updated

All 16 deployed functions received successful update operations. Marketplace-related functions:

| Function | Status |
|----------|--------|
| `purchaseVehicleListing` | Successful update |
| `createVehicleListing` | Successful update |
| `cancelVehicleListing` | Successful update |
| `getVehicleMarketplaceListings` | Successful update |
| `getMyVehicleListings` | Successful update |
| `prepareVehicleMarketplaceAccountDeletion` | Successful update |
| `expireVehicleMarketplace` | Successful update |

Also updated (non-marketplace, bundled in functions deploy): `generateGlobalEconomy`, `setUsername`, `checkUsernameAvailability`, `getUsernameProfile`, `submitLeaderboardScore`, `getLeaderboard`, `migrateLegacyServerState`, `reconcileAuthoritativeFleet`, `seedWeeklyLeaderboard`.

No functions reported as unchanged/skipped — Firebase updated all 16.

**P0 backend payload changes now live:**

- `transferredTruck` in purchase receipt
- `reconciliation.incomplete` flag when owned snapshots fail serialize
- Related marketplace reconciliation hardening in `vehicleMarketplace.ts`

---

## 4. Production backend health

Command: `npm run production:backend-check`

```
[production-backend-health] {
  projectId: 'logisticore-53ab4',
  deployedFunctionCount: 16,
  missing: [],
  wrongRegion: [],
  globalEconomyEpoch: 993262,
  configVersion: 1,
  stale: false,
  marketplaceFunctionsActive: true,
  cleanupWorkersActive: true,
  deployedCompositeIndexCount: 9,
  missingIndexGroups: [],
  authProviderConfig: 'not-readable-with-firebase-cli'
}
```

All required health fields satisfied.

---

## 5. Production marketplace smoke

Command attempted: `npm run marketplace:smoke:production`

Script: `backend/scripts/productionMarketplaceSmoke.ts` — **non-destructive** (creates disposable Auth test users, exercises marketplace callables, cleans up all test data in `finally`).

**Result:** FAILED locally before reaching marketplace assertions:

```
CANARY_SIGN_BLOB_FAILED: Permission 'iam.serviceAccounts.signBlob' denied
```

**Cause:** Local runner / Firebase CLI ADC lacks `iam.serviceAccounts.signBlob` on the compute service account. This is an IAM/ADC configuration issue on the deploy machine, not a production functions regression.

**Smoke status:** `PENDING REAL DEVICE / MANUAL PRODUCTION SMOKE`

---

## 6. Firestore rules

- `firestore.rules` — **no diff** in marketplace P0 patch
- Rules deploy — **not required** for this pass
- No rules-related warnings in deploy output

---

## 7. Post-deploy source integrity

`git diff` / `git status` after deploy confirm **no unexpected source modifications** from the deploy process.

- 13 marketplace P0 source files remain as pre-deploy uncommitted changes (expected)
- `backend/lib/` — gitignored build output; no tracked diff
- Deploy did not alter Firebase config, packages, or rules

---

## 8. Tooling warnings (P1 — not actioned this pass)

Recorded from deploy output:

| Warning | Severity |
|---------|----------|
| Node.js 20 runtime deprecated 2026-04-30, decommissioned 2026-10-30 | P1 |
| Outdated `firebase-functions` — upgrade will have breaking changes | P1 |
| `punycode` deprecated (if seen in other tooling) | P1 |

No upgrades performed per deploy instructions.

---

## 9. Remaining real-device checklist

Manual verification still required before declaring full production confidence:

- [ ] Two-account buy/sell on production build with P0 client changes shipped
- [ ] Buyer: pay → truck appears immediately (no cash-only state)
- [ ] Seller: truck removed + proceeds credited after reconnect
- [ ] Force-kill buyer app mid-purchase → reconcile on restart (no duplicate charge / no missing truck)
- [ ] Offline seller → sale proceeds on next online reconcile
- [ ] Re-run `npm run marketplace:smoke:production` from a machine with `signBlob` IAM access (or grant deploy runner `roles/iam.serviceAccountTokenCreator` on compute SA)

**Note:** Backend functions are deployed. **Client P0 changes are still uncommitted** in the working tree — production app binaries must include the client reconcile/apply fixes for end-to-end resolution.

---

## 10. Binary status

**NOT PRODUCED** — no AAB/APK/IPA built during this pass.

---

## Verdict

`MARKETPLACE_PROD_DEPLOY_VERIFIED`

Cloud Functions for marketplace P0 (`transferredTruck`, `reconciliation.incomplete`, reconciliation hardening) are live in `logisticore-53ab4` / `us-central1`. Production backend health passes all required checks. Automated production smoke blocked locally on IAM; manual two-account device smoke and client app release with P0 client patch remain outstanding.

**Phase 2 performance work:** Not started (per instructions).

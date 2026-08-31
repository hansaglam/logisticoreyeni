# Account Deletion Cross-Platform E2E Fix

**Date:** 2026-09-01  
**Priority:** P0 / App Store rejection blocker  
**Final status:** `BLOCKED` (pending real production device E2E)

---

## Production root cause (confirmed from logs)

Production `prepareVehicleMarketplaceAccountDeletion` failures on **2026-08-29** and **2026-08-31**:

```
FAILED_PRECONDITION: The query requires a COLLECTION_GROUP_ASC index
for collection entries and field uid.
```

Thrown by `deleteLeaderboardEntriesForUid()` using:

```typescript
firestore.collectionGroup('entries').where('uid', '==', uid)
```

`firestore.indexes.json` has no collection-group index on `entries.uid`. Marketplace cleanup had already been fixed; **leaderboard cleanup was the current blocker**.

---

## Architecture — before

| Step | Where | Notes |
|------|-------|-------|
| Apple revoke (client) | `revokeAppleSignInIfNeeded()` | Separate callable; non-blocking |
| Marketplace + username + recursive delete + leaderboard | `prepareVehicleMarketplaceAccountDeletion` | Leaderboard step failed on missing index |
| Redundant client Firestore batch delete | `deleteUserCloudData()` | Duplicated server work; permission-fragile |
| Firebase Auth delete | `deleteCurrentFirebaseUser()` (client) | `auth/requires-recent-login` risk for Google/Apple |

## Architecture — after

| Stage | Diagnostic name | Where |
|-------|-----------------|-------|
| 1 Marketplace | `ACCOUNT_DELETE_STAGE_MARKETPLACE` | `backend/src/accountDeletion.ts` |
| 2 Username | `ACCOUNT_DELETE_STAGE_USERNAME` | same |
| 3 Leaderboard | `ACCOUNT_DELETE_STAGE_LEADERBOARD` | `deleteLeaderboardEntriesForUid` — **direct season doc paths** |
| 4 Recursive user data | `ACCOUNT_DELETE_STAGE_RECURSIVE_DATA` | Admin `recursiveDelete(users/{uid})` — skipped if absent |
| 5 Apple revoke (optional) | `ACCOUNT_DELETE_STAGE_APPLE_REVOKE` | Server, when `authorizationCode` provided |
| 6 Firebase Auth | `ACCOUNT_DELETE_STAGE_FIREBASE_AUTH` | **`admin.auth().deleteUser(uid)`** — idempotent |
| 7 Local reset | `ACCOUNT_DELETE_STAGE_LOCAL_RESET` | Client `accountDeletion.ts` |
| 8 Guest bootstrap | `ACCOUNT_DELETE_STAGE_COMPLETED` | `initAnonymousAuth()` |

**Firebase Auth deletion:** moved to **server-side Admin SDK** (final destructive step after all cleanup). Client calls `signOutAfterServerAccountDeletion()` on success; guest accounts still use client `deleteUser()` fallback.

**Client orchestration:** single path in `src/utils/accountDeletion.ts` — shared iOS/Android; Apple-only hook is authorization-code capture.

---

## Files changed

| File | Change |
|------|--------|
| `backend/src/accountDeletion.ts` | **NEW** — staged, idempotent deletion orchestration + Admin auth delete |
| `backend/src/leaderboard.ts` | Fix `deleteLeaderboardEntriesForUid` — no collection-group query |
| `backend/src/index.ts` | Callable delegates to `deleteLinkedAccount`; accepts optional `authorizationCode` |
| `src/utils/accountDeletion.ts` | Server auth delete path; Apple code → callable; generic UX message |
| `src/utils/accountLifecycleLog.ts` | Production-safe stage diagnostics |
| `src/services/cloudSaveService.ts` | Callable-only cloud delete (no client batch) |
| `src/services/vehicleMarketplaceService.ts` | Richer deletion callable result |
| `src/services/authService.ts` | `signOutAfterServerAccountDeletion()` |
| `src/hooks/useAccountCenter.ts` | Generic failure copy |
| `scripts/account-deletion-cross-platform-regression-test.ts` | **NEW** — 16-case matrix |
| `scripts/account-signout-deletion-regression-test.ts` | Updated assertions |
| `scripts/app-store-privacy-account-regression-test.ts` | Apple revoke path update |
| `scripts/cloud-save-production-audit-test.ts` | Leaderboard/index assertions |
| `backend/test/leaderboard.emulator.test.ts` | Idempotent leaderboard cleanup test |

---

## Provider / platform matrix

| Account | iOS | Android |
|---------|-----|---------|
| Guest | Client auth delete + local reset | Same |
| Google | Server callable + Admin auth delete | Same |
| Apple | Server callable + optional Apple revoke + Admin auth delete | N/A (no Apple Sign-In) |

User-facing error (all failure paths except reauth/cancelled):

> Hesap silinemedi. Lütfen tekrar deneyin.

Internal diagnostics log stage, `diagnosticId`, provider, platform, error code — never tokens/keys.

---

## Validation results

| Check | Result |
|-------|--------|
| `npm --prefix backend run build` | PASS |
| `npx tsc --noEmit` | PASS |
| `account-signout-deletion-regression-test.ts` | PASS (41) |
| `account-deletion-cross-platform-regression-test.ts` | PASS (30) |
| `app-store-privacy-account-regression-test.ts` | PASS (18) |
| `apple-auth-audit-test.ts` | PASS (46) |
| Firebase emulator tests (incl. leaderboard idempotent delete) | PASS |
| `cloud-save-production-audit-test.ts` | PASS |
| `npm run validate:store-production` | PASS |
| `npm run production:backend-check` | PASS |
| `git diff --check` | PASS |

---

## Production deploy

**Function changed:** `prepareVehicleMarketplaceAccountDeletion` only (bundles `accountDeletion.ts`).

```powershell
$env:FUNCTIONS_DISCOVERY_TIMEOUT = "60"
firebase deploy --only functions:prepareVehicleMarketplaceAccountDeletion
npm run production:backend-check
```

**No Firestore index deploy required** — collection-group index avoided by design.

---

## Real production E2E (required — NOT YET DONE)

| Test | Status |
|------|--------|
| A. iOS Google linked account | **PENDING** — manual device |
| B. iOS Apple linked account | **PENDING** — manual device |
| C. Android Google linked account | **PENDING** — manual device |

Each must verify: deletion completes, Firebase Auth user removed, Guest Mode after delete + relaunch, re-sign-in is clean, no stale marketplace/profile/cloud data.

---

## Platform results

| Platform / provider | Automated | Real production E2E |
|--------------------|-----------|---------------------|
| iOS Google | Architecture + regression PASS | **PENDING** |
| iOS Apple | Architecture + regression PASS | **PENDING** |
| Android Google | Architecture + regression PASS | **PENDING** |
| Guest (both) | Regression PASS | **PENDING** |

---

## App Store readiness

- Root cause identified and fixed in code (leaderboard index + server-side auth delete).
- Deploy required before device retest.
- **Cannot declare `ACCOUNT_DELETION_CROSS_PLATFORM_E2E_VERIFIED`** until at least one iOS linked account (Google or Apple) and one Android Google account succeed in production.

**Status: `BLOCKED`** — deploy complete; awaiting real device E2E confirmation.

### Deploy result (2026-09-01)

| Function | Region | Result |
|----------|--------|--------|
| `prepareVehicleMarketplaceAccountDeletion` | us-central1 | **Successful update** (~147s) |

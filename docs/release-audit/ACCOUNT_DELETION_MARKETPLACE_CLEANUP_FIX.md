# Account Deletion — Marketplace Cleanup Fix

**Date:** 2026-08-29  
**Status:** `BLOCKED` (backend deploy + production E2E pending)

## Root cause

Production account deletion failed at the client step that calls `prepareVehicleMarketplaceAccountDeletion`. The client surfaced this as `marketplace-account-cleanup-failed`.

The most likely backend failure was in `prepareMarketplaceAccountDeletion` (`backend/src/vehicleMarketplace.ts`):

- Seller listing cleanup used  
  `where('sellerUid', '==', uid).orderBy(FieldPath.documentId())`
- `firestore.indexes.json` had **no** composite index for `sellerUid + __name__` on `vehicleMarketplaceListings`
- In production this throws `FAILED_PRECONDITION` (missing index), causing the callable to fail and the client to return `marketplace-account-cleanup-failed`

Secondary risk (same callable, later step):

- `deleteLeaderboardEntriesForUid` used `collectionGroup('entries').where('uid', '==', uid)` with **no** collection-group index on `entries.uid`
- This ran **after** `recursiveDelete(users/{uid})`, so a failure there could leave Auth active after user data was already removed

Firebase production logs were not available from this environment (`firebase` CLI not installed; no log API access).

## Affected files / functions

| Area | File | Change |
|------|------|--------|
| Marketplace cleanup | `backend/src/vehicleMarketplace.ts` | Removed composite-index query; equality-only seller listing loop; idempotent marketplace state delete |
| Leaderboard cleanup | `backend/src/leaderboard.ts` | Replaced collection-group query with direct per-season doc deletes (156 weeks) |
| Callable orchestration | `backend/src/index.ts` | Leaderboard cleanup before `recursiveDelete`; structured error logging |
| Client orchestration | `src/services/cloudSaveService.ts` | Linked vs guest paths; structured cleanup result |
| Client callable wrapper | `src/services/vehicleMarketplaceService.ts` | Returns `{ ok, reason }` instead of bare boolean |
| UX | `src/utils/accountDeletion.ts` | User message: `Hesap silinemedi. Lütfen tekrar deneyin.` |
| Tests | `backend/test/vehicleMarketplace.emulator.test.ts` | No-activity, state-only, idempotent cases |
| Tests | `scripts/account-signout-deletion-regression-test.ts` | Marketplace cleanup + UX assertions |
| Tests | `scripts/app-store-privacy-account-regression-test.ts` | New privacy/account deletion static regression |

**Deploy target:** `prepareVehicleMarketplaceAccountDeletion` only (`us-central1`).

## Code change summary

1. **Seller listings:** paginate with `where('sellerUid','==',uid).limit(200)` only. Anonymized listings drop out of the query automatically.
2. **Leaderboard:** delete `leaderboards/{seasonKey}/entries/{uid}` for recent season keys — no collection-group index required.
3. **Ordering:** marketplace → username release → leaderboard → `recursiveDelete(users/{uid})`.
4. **Client:** linked accounts use trusted callable; guest accounts skip callable and use client batch delete.
5. **UX:** technical `marketplace-account-cleanup-failed` kept in logs only; UI shows Turkish friendly message.

## Validation results

| Check | Result |
|-------|--------|
| `npx tsx scripts/account-signout-deletion-regression-test.ts` | ✅ PASS (40/40) |
| `npx tsx scripts/app-store-privacy-account-regression-test.ts` | ✅ PASS (7/7) |
| `npx tsc --noEmit` (app) | ✅ PASS |
| `npm --prefix backend run build` | ✅ PASS (after `backend/npm install`) |
| `npm run backend:verify` | ⚠️ Not run (depends on backend build + emulators) |
| `git diff --check` | Not run in this session |
| Emulator tests (new deletion cases) | ⚠️ Not run (emulators not started) |

## Deployment

**Not deployed from this session.**

Required command after local backend deps install:

```bash
cd backend && npm install && npm run build
firebase deploy --only functions:prepareVehicleMarketplaceAccountDeletion
npm run production:backend-check
```

## Production E2E test

**Not performed.** Use a disposable Apple-linked test account after deploy:

1. Initiate full account deletion in Account Center
2. Confirm marketplace cleanup succeeds (no `marketplace-account-cleanup-failed`)
3. Verify Firestore user tree removed
4. Verify Firebase Auth user deleted
5. App returns to Guest Mode
6. Deleted account cannot resume prior cloud state

## Remaining blockers

1. Install backend dependencies and run `npm --prefix backend run build`
2. Run emulator suite for new account-deletion cases
3. Deploy `prepareVehicleMarketplaceAccountDeletion`
4. Run `npm run production:backend-check`
5. Execute real production deletion on dedicated test account

## Final status

`BLOCKED` — fix implemented and static regressions pass; backend deploy and production E2E verification still required.

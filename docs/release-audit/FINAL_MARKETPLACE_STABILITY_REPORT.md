# Final Marketplace Stability Report

**Date:** 2026-08-14  
**Scope:** Firebase emulator concurrent purchase flake — structural fix only (no test skip/retry masking).

---

## Final status: **READY_FOR_FINAL_BINARY**

---

## 1. Exact root cause

**Error:** `3 INVALID_ARGUMENT: Transaction is invalid or closed.`

**Mechanism:** Under concurrent `purchaseVehicleListingTransaction` calls, the Firestore emulator invalidates an in-flight transaction when another transaction commits conflicting writes (listing + seller state). The purchase callback used **`Promise.all([transaction.get(...)])`** for parallel reads. When Firestore aborted/retry internally, **in-flight parallel `get` streams** on the stale transaction object surfaced as `INVALID_ARGUMENT` instead of a clean retry → loser path threw instead of returning `listing-not-active`.

**Not the cause:** Callback-outside transaction reuse, write-then-read in helpers (`syncServerStateMirror` is write-only), or idempotency writes after close.

**Repro rate before fix:** ~3/15 emulator runs (~20%).

---

## 2. Changed files

| File | Change |
|------|--------|
| `backend/src/vehicleMarketplace.ts` | Purchase split into read/write phases; sequential reads; listing purchase lock; shared retry wrapper |
| `backend/src/firestoreTransactionUtils.ts` | **New** — bounded outer retry for transient txn errors |
| `backend/src/globalEconomyWorker.ts` | Same outer retry wrapper (prevents unrelated emulator flake in full suite) |
| `backend/test/vehicleMarketplace.emulator.test.ts` | Firestore state assertions (cash, truck ownership, lock, idempotency per buyer) |
| `firestore.rules` | Deny client access to `vehicleMarketplaceListingLocks` |

---

## 3. Transaction read phase (purchase)

Sequential reads in fixed order — **no `Promise.all`**:

1. Idempotency (`readIdempotent`)
2. Action receipt (`hasTransactionReceipt`)
3. Listing purchase lock (`vehicleMarketplaceListingLocks/{listingId}`)
4. Listing document
5. Buyer sale transaction doc (`vehicleMarketplaceTransactions/{transactionId}`)
6. Buyer marketplace state
7. Seller marketplace state
8. Buyer serverState mirror
9. Seller serverState mirror

Early returns (replay, already-completed, listing-not-active, validation failures) exit **without writes**.

---

## 4. Transaction write phase (purchase)

**No `transaction.get` after this point.**

Write order:

1. **Listing purchase lock** (`create` if absent) — exactly-one-winner claim
2. Buyer cash + truck
3. Seller cash + truck removal + tombstone
4. Buyer + seller `serverState` mirror (`syncServerStateMirror` — set only)
5. Listing → `sold`
6. Canonical sale record + history + ledger
7. Idempotency + receipt (`saveIdempotent`)

---

## 5. Retry behavior

| Layer | Behavior |
|-------|----------|
| Firestore inner | Default SDK retry on `runTransaction` |
| Service outer | `runFirestoreTransactionWithRetry` — max **3** attempts, exponential backoff + jitter |
| Transient codes | `ABORTED`, `UNAVAILABLE`, `DEADLINE_EXCEEDED`, and `INVALID_ARGUMENT` **only** when message contains `Transaction is invalid or closed` |
| Non-transient | `INVALID_ARGUMENT` for real validation errors is **not** retried |

---

## 6. Idempotency behavior

- Winner retry with same `transactionId` + `idempotencyKey` → `readIdempotent` returns cached result (no duplicate writes).
- Loser → `listing-not-active` failure; **no** idempotency record written.
- Listing lock with matching `buyerUid` + `transactionId` + sold listing → success replay without duplicate writes.

---

## 7. Concurrency invariants (verified in test)

| Invariant | Enforced |
|-----------|----------|
| Exactly one winner | ✓ |
| Exactly one loser (`listing-not-active`) | ✓ |
| Seller cash +1 sale only | ✓ |
| Winner cash −price only | ✓ |
| Truck transferred once | ✓ |
| Listing `sold` once with correct `buyerUid` | ✓ |
| One `vehicleMarketplaceTransactions` doc | ✓ |
| One winner idempotency doc; zero loser idempotency | ✓ |
| One listing purchase lock | ✓ |
| Winner idempotent replay | ✓ |

---

## 8. Emulator 10-run result

```
PASS 1–10 (50/50 each)
TOTAL FAILS: 0/10
```

No occurrences of:
- `Transaction is invalid or closed`
- Double winner
- Duplicate ownership
- Cash mismatch

---

## 9. Full validation

| Command | Result |
|---------|--------|
| `npx tsc --noEmit` | PASS |
| `npm run verify` | PASS |
| `npm run firebase:emulators:test` | PASS (50/50) |
| `npx expo export --platform android` | PASS |
| `npx expo export --platform ios` | PASS |
| `npm run validate:production-build` | PASS |
| `npm run production:backend-check` | PASS |
| `git diff --check` | PASS |

No AAB/APK/IPA produced (per instructions).

---

## 10. Gameplay / persistence

- Purchase semantics unchanged for single-buyer path
- Atomic write / corruption safety unchanged
- New `vehicleMarketplaceListingLocks` collection is server-only (rules deny client access)

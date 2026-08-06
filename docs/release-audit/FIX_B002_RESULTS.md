# FIX B-002 Results — Account Switch Isolation

**Date:** 2026-08-06  
**Blocker:** B-002 — Cross-account local save bleed on Google account switch  
**Status:** MITIGATED (client-ready; new build recommended after deploy)

---

## 1. Old Race Condition

| Step | Old behavior | Risk |
|------|----------------|------|
| 1 | Sync A → cloud (OK) | — |
| 2 | `signInWithCredential(B)` before validation completes | Auth on B |
| 3 | Cloud read fails OR user taps Vazgeç | **No rollback** |
| 4 | Local save has **no `ownerUid`** | Cannot detect mismatch |
| 5 | `syncLocalSaveToCloud` uses `getCurrentUserId()` | **A's save → B's cloud path** |

PoC invariant: Firebase UID B + local gameplay A → cross-account overwrite.

---

## 2. New State Machine

**Runtime stages** (`accountSwitchService.ts` + journal persistence):

`idle` → `preparing` → `selecting-provider` → `auth-switched-pending-validation` → `loading-target-cloud` → `awaiting-user-choice` → `committing` → `completed`

Failure paths: `rolling-back` → `idle` OR `recovery-required`

**Journal:** `@logisticore/account-switch/journal-v1` (AsyncStorage)

Fields: `stage`, `oldUid`, `targetUid`, `localOwnerUid`, `oldProviderIds`, `provider`, `startedAt`, `commitCompleted`, `rollbackRequired`

In-memory snapshot (not persisted): game state, local payload, Google rollback credential (session-only).

---

## 3. Local `ownerUid` Migration

**`SaveGamePayload.ownerUid`** added in `saveGame.ts`.

| Rule | Implementation |
|------|----------------|
| Linked user save matches auth UID | Set on `saveGameState` / `serializeGameState` |
| Legacy saves without owner | Migrated on load when auth UID available |
| `authUid !== localOwnerUid` | `assertLocalSaveOwnerMatchesAuth` blocks cloud write |
| Switch in progress | `isCloudSyncBlockedByAccountSwitch()` blocks all sync |

Applied at: manual sync, app_start sync, account switch commit, autosave path (via shared `syncLocalSaveToCloud`).

---

## 4. Commit Flow (Google A → B)

1. Flush current save + sync to A's cloud (`syncBeforeAccountTransition`)
2. `prepareAccountSwitch` — snapshot + capture Google rollback credential
3. Provider picker (Google forced interactive)
4. Sign in target account B
5. Load B's cloud metadata
6. User choice: link local / new game / cloud conflict / **Vazgeç**
7. **`commitAccountSwitch`** — bind `ownerUid` to B, then cloud write
8. Clear journal, re-enable sync

**Commit rule:** Local `ownerUid` is **not** updated to B until explicit user approval + `commitAccountSwitch`.

---

## 5. Rollback Paths

| Trigger | Action |
|---------|--------|
| Picker cancel (before auth) | `abortAccountSwitchBeforeAuth` — journal cleared, auth unchanged |
| Cloud network/permission/corrupt error | `rollbackAccountSwitch` — restore local + re-sign-in A via captured credential |
| New-account dialog Vazgeç | `rollbackAccountSwitch('user-cancelled')` |
| Conflict dialog Vazgeç | `cancelPendingGoogleLinkConflict` → rollback |
| Commit failure | Rollback + user alert |
| Auth restore impossible | `recovery-required` — sync locked, local preserved |

**Recovery-required:** User sees CTA to re-sign into old account; no automatic cross-UID writes.

---

## 6. App Kill Recovery

`initCloudSaveSync` calls `resolveInterruptedAccountSwitchOnStartup()`:

- Pending incomplete journal → auto rollback attempt
- If rollback fails → `recovery-required`, sync blocked
- Normal `app_start` sync does **not** run until resolved

---

## 7. Provider-Aware Behavior

| Provider | Switch path |
|----------|-------------|
| Google A → B | Full state machine + rollback credential capture |
| Apple link/conflict | Existing `switchToLinkedProviderAccount` + journal finalize on success |
| Anonymous → provider | Unchanged link flow; ownerUid stamped on save |

Apple A → Apple B: No false Google picker; Apple uses native auth path only.

---

## 8. Files Changed

| File | Change |
|------|--------|
| `src/services/accountSwitchService.ts` | **New** — state machine, snapshot, rollback, commit |
| `src/storage/accountSwitchJournal.ts` | **New** — persisted journal |
| `src/services/googleAuthService.ts` | `captureGoogleRollbackCredential()` |
| `src/storage/saveGame.ts` | `ownerUid` on payload + legacy migration |
| `src/storage/cloudSaveSync.ts` | Switch lock + owner guard + startup recovery |
| `src/services/authService.ts` | Rollback-safe `beginGoogleAccountSwitchSelection` |
| `src/components/AccountSection.tsx` | Vazgeç rollback, commit flow, no premature state clear |
| `scripts/account-switch-isolation-security-test.ts` | PoC inverted → MITIGATED |

---

## 9. Test Results

| Check | Result |
|-------|--------|
| `npm run typecheck` | PASS |
| `npm run verify` | PASS |
| `npx tsx scripts/account-switch-isolation-security-test.ts` | **MITIGATED** |
| `npx expo config --type public` | PASS |
| `npx expo export --platform android` | PASS |
| `npx expo export --platform ios` | PASS |
| `git diff --check` | PASS (line-ending warnings only) |

---

## 10. Remaining Risks

1. **Google rollback credential expiry** — If rollback token expires before user cancels, falls back to `recovery-required`
2. **Apple A→B full switch** — Still limited by Apple/Firebase; recovery path applies
3. **Recovery UI** — Minimal alert today; dedicated recovery screen optional follow-up
4. **In-flight double tap** — Guarded by `inFlight` flag; UI should keep buttons disabled (existing loading states)

---

## 11. Build Requirement

| Platform | Required? | Reason |
|----------|-----------|--------|
| **Android AAB/APK** | **Yes** | Client-side account switch + ownerUid + journal |
| **iOS IPA/Archive** | **Yes** | Same client changes |

Backend deploy **not required** for B-002 (client-only fix).

---

## 12. Acceptance Criteria

| Criterion | Status |
|-----------|--------|
| A save never silently writes to B | ✅ |
| Cancel/failure rolls back or recovery-required | ✅ |
| Local save carries ownerUid | ✅ |
| Sync blocked on owner mismatch | ✅ |
| Sync blocked during incomplete switch | ✅ |
| App kill recovery via journal | ✅ |
| Explicit commit before target UID bind | ✅ |

# Account Cloud-Save Conflict — Results

**Date:** 2026-08-13  
**Scope:** Guest → existing Google/Apple account “Bulut Kaydı” / “Bu Cihazdaki Kayıt”  
**Builds:** AAB / APK / IPA / Xcode Archive **not produced**

---

## Exact flow (before)

```
AccountCenter handleLink
→ linkAnonymousAccountWithGoogle/Apple
→ credential-already-in-use
→ showAccountConflictDialog
→ “Bulut Kaydı” onPress
→ handleSwitchToProviderAccount
→ pendingAccountConflict?.provider !== provider   // STALE CLOSURE
→ showAlert("Kayıt kullanılamıyor", "Seçilen kayıt artık kullanılamıyor.")
```

Dialog `onPress` captured `handleSwitchToProviderAccount` from the render **before** `setPendingAccountConflict` flushed. `pendingAccountConflict` was still `null` → `missing-conflict`.

“Sometimes nothing happens”: “Bu Cihazdaki Kayıt” for guest-link (not account-switch) only cleared React state and dismissed the modal. No sign-in, no bind, no upload.

---

## Root causes

| Symptom | Exact cause |
|---------|-------------|
| “Kayıt kullanılamıyor” / “Seçilen kayıt artık kullanılamıyor.” | `missing-conflict` from stale `pendingAccountConflict` React state in `useAccountCenter.ts` |
| Cloud button no-op | Same stale check returning before `switchToLinkedProviderAccount` |
| Local button no-op | Guest-link path had no handler unless `fromAccountSwitch` |
| Possible cloud overwrite | `syncLocalSaveToCloud` did not honor account-conflict pending flag |

---

## New resolver

**Session (module, not React):** `src/services/accountSaveConflictSession.ts`

- `conflictId`, credential, provider, status, request token
- Open dialog → `beginAccountSaveConflictSession` (synchronous)
- Press → `ensureAccountSaveConflictSession` from **credential argument**, not React state
- Request token so a stale promise cannot overwrite a newer resolve

**Cloud choice** (`switchToLinkedProviderAccount(..., { choice: 'cloud' })`):

1. Sign in with pending credential  
2. Fresh `loadGameFromCloudDetailed` (metadata + body)  
3. Owner: missing ownerUid on `users/{uid}` allowed; other UID rejected  
4. Atomic restore + marketplace reconcile  
5. Invalidate save-recovery probe  
6. Release conflict lock → `initCloudSaveSync`

**Local choice** (`choice: 'local'`):

1. Sign in with pending credential  
2. Rebind current local save to linked UID  
3. Explicit cloud upload (`bypassAccountConflictLock`)  
4. Read-back verify  
5. Does **not** restore existing cloud first  

Account-switch “Bu Cihazdaki Kayıt” still uses `commitAccountSwitch` (already signed in).

---

## Errors

| Code | User copy | Retry |
|------|-----------|-------|
| `cloud-save-fetch-failed` | Bulut kaydı şu anda yüklenemedi. Tekrar dene. | yes — modal stays |
| `cloud-save-not-found` | Bu hesapta kullanılabilir bir bulut kaydı bulunamadı. | no |
| `owner-mismatch` | Bu bulut kaydı seçili hesaba ait değil. | no |
| `missing-conflict` | Seçilen kayıt artık kullanılamıyor. | only if credential truly missing |

“Kayıt kullanılamıyor” alert **removed** from the cloud CTA path.

Dev log: `[account-conflict-resolve]` — no UID/email.

---

## Sync lock

While conflict session is active / resolving:

- automatic `syncLocalSaveToCloud` blocked  
- leaderboard submit from sync blocked  

Explicit local-choice upload uses `bypassAccountConflictLock`.

---

## Tests

| Check | Result |
|-------|--------|
| `npm run typecheck` | **PASS** |
| `npm run verify` | **PASS** (incl. new `account-cloud-conflict-regression-test`) |
| `cloud-save-conflict-test` | **PASS** |
| `account-switch-flow-test` | **PASS** |
| `npx expo export --platform android` | **PASS** |
| `npx expo export --platform ios` | **PASS** |
| AAB/APK/IPA/Archive | **Not produced** |

---

## Real device remaining

**Android Google**

1. Guest save → existing Google with cloud → conflict modal  
2. Bulut Kaydı → loading → Google progress on Dashboard  
3. Account Center: Google bağlı, bulut güvende  
4. Restart → same save  
5. Repeat with Bu Cihazdaki Kayıt → local progress kept after restart  

**iOS Apple** — same canonical resolver (`choice` shared).

---

## Files

- `src/hooks/useAccountCenter.ts`  
- `src/services/authService.ts`  
- `src/services/accountSaveConflictSession.ts` (new)  
- `src/utils/cloudSaveConflict.ts`  
- `src/storage/cloudSaveSync.ts`  
- `src/services/accountSwitchService.ts`  
- `scripts/account-cloud-conflict-regression-test.ts` (new)  

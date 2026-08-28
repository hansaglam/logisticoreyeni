# V1.1 — Apple Auth Audit Failure Audit

**Date:** 2026-08-28  
**Scope:** Read-only audit of `scripts/apple-auth-audit-test.ts` (4 UI wiring failures)  
**Final status:** `TEST_STALE`

---

## Executive summary

All four failures come from **source-text scans of the wrong file**. `apple-auth-audit-test.ts` lines 93–100 read `src/components/AccountSection.tsx`, but commit **`6d68ed5`** (2026-08-06) refactored `AccountSection` into a compact “open Account Center” card (~1,775 lines of auth UI removed). Apple/Google sign-in wiring now lives in:

- `src/hooks/useAccountCenter.ts` — guards, handlers, cancel/error UX
- `src/components/accountCenter/AccountConnectionTab.tsx` — guest auth buttons
- `src/screens/AccountCenterScreen.tsx` — prop bridge

**Apple Sign-In is not broken.** Service-layer assertions in the same script (41/45) pass. Sibling `apple-auth-release-regression-test.ts` already targets `useAccountCenter` + `AccountConnectionTab` and passes.

---

## Failure reproduction

```bash
npx tsx scripts/apple-auth-audit-test.ts
```

```
  ✗ Apple button only on iOS when available
  ✗ cancel is not shown as error modal
  ✗ double-tap guard via isLinking
  ✗ uses shared AuthProviderButton

Result: 41 passed, 4 failed
```

All service/config checks pass (nonce, `appleAuthService`, `authService`, entitlements, `app.config.js`, Firebase init, conflict detector).

---

## UI → auth trace (current production path)

```
MoreScreen / Dashboard
  → AccountSection (compact card, opens Account Center)
    → AccountCenterScreen (account tab)
      → AccountConnectionTab
           showApple ? ActionButton "Apple ile Devam Et"
           onPress → onLinkApple
      → useAccountCenter.handleLink('apple')
           guards: isLinking | isResolvingConflict | linkTapLock
           → linkAnonymousAccountWithApple()  [authService.ts]
              Platform.OS !== 'ios' → apple-not-supported
              → ensureFirebaseAuthReady()
              → linkWithAppleAccount()  [appleAuthService.ts, lazy import]
                 loadAppleAuthentication() — iOS only, require() in try/catch
                 → signInWithAppleAccount() flow
                    generateSecureNonceAsync → sha256 → signInAsync
                    identityToken → OAuthProvider('apple.com') + rawNonce
           → completeExistingProviderAccountLogin / save outcome (accountCloudLogin)
```

Guest flow: unchanged in behavior — guest opens Account Center → **Hesap** tab → Google/Apple buttons when `isGuest`.

---

## Per-assertion analysis

### 1. Apple button only on iOS when available

| Field | Detail |
|-------|--------|
| **Test** | `accountSrc.includes("Platform.OS === 'ios' && appleAvailable")` on `AccountSection.tsx` |
| **Expected pattern** | iOS + availability guard co-located with button render |
| **Actual in `AccountSection.tsx`** | No `Platform`, no `appleAvailable`, no Apple button |
| **Actual canonical location** | `useAccountCenter.ts`: `const showApple = Platform.OS === 'ios' && appleAvailable` (line ~1398); availability probe via `isAppleSignInAvailable()` in `useEffect` (lines ~317–333) |
| **UI render** | `AccountConnectionTab`: `{showApple ? <ActionButton label="Apple ile Devam Et" … /> : null}` |
| **Runtime behavior** | **Works** — Apple CTA hidden on Android; on iOS only when `isAvailableAsync()` true |
| **Wiring missing?** | **No** — moved to hook + tab |
| **Test brittle?** | **Yes** — scans deprecated surface |

### 2. Cancel is not shown as error modal

| Field | Detail |
|-------|--------|
| **Test** | `accountSrc.includes("error === 'cancelled'")` on `AccountSection.tsx` |
| **Expected pattern** | Silent return on user cancel |
| **Actual in `AccountSection.tsx`** | Absent |
| **Actual canonical location** | `useAccountCenter.handleLink`: `if (result.error === 'cancelled') { return; }` (~716–718) |
| | `showAppleLinkFailure`: `if (isAppleAuthCancelFailure(failure) \|\| fallbackError === 'cancelled') return;` (~657–658) |
| **Service layer** | `linkAnonymousAccountWithApple` sets `errorKind: 'cancelled'` when `appleResult.error === 'cancelled'` |
| **Runtime behavior** | **Works** — cancel does not open error dialog |
| **Wiring missing?** | **No** |
| **Test brittle?** | **Yes** |

### 3. Double-tap guard via `isLinking`

| Field | Detail |
|-------|--------|
| **Test** | `accountSrc.includes('isLinking')` on `AccountSection.tsx` |
| **Expected pattern** | In-flight link guard |
| **Actual in `AccountSection.tsx`** | Absent |
| **Actual canonical location** | `useAccountCenter`: `isLinking` state; `handleLink` checks `isLinking \|\| isResolvingConflict \|\| linkTapLock.current`; `setIsLinking(provider)` in try/finally |
| | `AccountConnectionTab`: `disabled={Boolean(isLinking)}` on both Google and Apple buttons |
| **Sibling coverage** | `apple-auth-release-regression-test.ts` asserts both hook + tab |
| **Runtime behavior** | **Works** |
| **Wiring missing?** | **No** |
| **Test brittle?** | **Yes** |

### 4. Uses shared `AuthProviderButton`

| Field | Detail |
|-------|--------|
| **Test** | `accountSrc.includes('AuthProviderButton')` on `AccountSection.tsx` |
| **Expected pattern** | Shared styled provider button component |
| **Actual in `AccountSection.tsx`** | Absent |
| **Actual UI component** | `ActionButton` in `AccountConnectionTab` (not `AuthProviderButton`) |
| **`AuthProviderButton` usage** | Defined in `src/components/ui/AuthProviderButton.tsx`, exported from `ui/index.ts`, **not imported by any screen or hook** |
| **Runtime behavior** | **Works** — `ActionButton` provides label, `onPress`, `disabled`, variant |
| **Wiring missing?** | **No** — different presentational primitive, same handler chain |
| **Test brittle?** | **Yes** — asserts unused component name; not a functional requirement |

---

## Verification checklist

| Check | Status | Evidence |
|-------|--------|----------|
| Apple button only on iOS | ✓ | `showApple = Platform.OS === 'ios' && appleAvailable`; tab conditional render |
| No Android crash/import | ✓ | `loadAppleAuthentication()` returns null when `Platform.OS !== 'ios'`; lazy `require()` in try/catch; no top-level expo-apple-authentication import |
| Button press → handler | ✓ | `onLinkApple={() => void vm.handleLink('apple')}` |
| Cancel path handled | ✓ | `cancelled` early return + `isAppleAuthCancelFailure` |
| Google + Apple coexist | ✓ | Both buttons in `authButtons`; shared `isLinking` disable |
| Guest flow unaffected | ✓ | Buttons shown when `isGuest`; `AccountSection` routes to Account Center |
| iOS entitlements / plugin | ✓ | Audit passes entitlements + `usesAppleSignIn` + `expo-apple-authentication` |
| Firebase / nonce / token | ✓ | 37 non-UI assertions pass in same script |
| Updated regression sibling | ✓ | `apple-auth-release-regression-test.ts` uses `useAccountCenter` + `AccountConnectionTab` |

---

## What the test was protecting

The four UI assertions were added when **`AccountSection.tsx` was the monolithic account + auth surface** (pre-`6d68ed5`). They guarded:

1. Platform-gated Apple CTA visibility  
2. User-cancel silence  
3. Double-tap / concurrent link prevention  
4. Consistent provider button styling via `AuthProviderButton`

**Behavioral invariants still hold** — only the **file locations and button component** changed. Literal Turkish copy in `AccountConnectionTab` (`Apple ile Devam Et`) is covered by `apple-auth-release-regression-test.ts`.

---

## Classification matrix

| Option | Verdict | Rationale |
|--------|---------|-----------|
| **TEST_STALE** | **YES** | Audit scans refactored-away `AccountSection`; sibling tests already updated |
| APPLE_AUTH_UI_REGRESSION | **No** | Full guest auth UI in Account Center account tab |
| AUTH_WIRING_BUG | **No** | Handler → service → Firebase chain intact |
| NO_ISSUE | **No** | Script legitimately fails until retargeted |

`AuthProviderButton` being unused is a **dead export**, not an auth regression. Adopting it again would be cosmetic; `ActionButton` is the live pattern.

---

## Recommended fix (report only — not applied)

When code changes are allowed:

1. Retarget UI assertions from `AccountSection.tsx` to `useAccountCenter.ts` + `AccountConnectionTab.tsx` (mirror `apple-auth-release-regression-test.ts`).
2. Replace `AuthProviderButton` check with `ActionButton` + `Apple ile Devam Et` + `onLinkApple` / `handleLink('apple')`.
3. Optionally remove or repurpose unused `AuthProviderButton` in a separate cleanup PR (not required for auth correctness).

Do **not** change `isCorruptCloudReason`, cancel semantics, or `appleAuthService` guards — not indicated by this audit.

---

## Related test status

| Script | UI target | Result |
|--------|-----------|--------|
| `apple-auth-audit-test.ts` | `AccountSection.tsx` (stale) | **4 UI failures** |
| `apple-auth-release-regression-test.ts` | `useAccountCenter` + `AccountConnectionTab` | **Pass** |
| `account-cloud-conflict-regression-test.ts` | `useAccountCenter` | **Pass** |
| `account-center-ui-regression-test.ts` | Account Center screen bundle | **Pass** (no Apple-specific string asserts) |

---

## Final status

**`TEST_STALE`**

Apple Sign-In service, platform guards, credential handling, and Account Center UI wiring are present and consistent. The audit script failed because it still inspects the pre-refactor `AccountSection` shell instead of the current auth surfaces.

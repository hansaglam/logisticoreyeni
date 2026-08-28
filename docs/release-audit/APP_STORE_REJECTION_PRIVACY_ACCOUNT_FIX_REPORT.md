# App Store Rejection — Privacy (5.1.2(i)) + Account Deletion (5.1.1(v))

**Date:** 2026-08-28  
**Status:** `APP_STORE_REJECTION_FIX_READY`

---

## Summary

Apple rejected LogistiCore for:

1. **Guideline 5.1.2(i)** — UMP consent dialog referenced tracking/personalized advertising, but **App Tracking Transparency (ATT)** was not requested before tracking-dependent SDK behavior.
2. **Guideline 5.1.1(v)** — Account deletion existed but was **hidden** under a collapsed “Tehlikeli İşlemler” section in Preferences.

This pass implements production-compliant ATT ordering, non-personalized ad fallback, prominent account deletion UX, guest deletion fix, and Sign in with Apple token revocation (server callable).

---

## PART A — ATT / Consent Audit (pre-fix)

| Question | Finding |
|----------|---------|
| ATT implemented? | Yes, but **deferred to first rewarded ad** — too late |
| `NSUserTrackingUsageDescription`? | **Yes** — `app.config.js` (`expo-tracking-transparency` + AdMob plugin) |
| SDK init before ATT? | **Yes — root cause** — `gatherAdsConsentIfNeeded()` → `initializeAdProvider()` before ATT |
| UMP shows Apple consent dialog? | **Yes** — Google UMP via `AdsConsent.gatherConsent()` |
| After “Do not consent”? | Ads blocked via `canRequestAdsAfterConsent()`; game continues |
| IDFA before ATT? | **Likely** — Mobile Ads could initialize before ATT |
| Personalized ads wired? | **No** — ATT mapping was diagnostic only |
| Firebase Analytics? | **Disabled** (`IS_ANALYTICS_ENABLED: false`) |
| App Privacy “tracking”? | Likely **No** while ads used identifiers — metadata must be updated (see Part D) |

---

## PART B — ATT Fix

- ATT resolves **once at ads bootstrap** via `resolveAttBeforeAdsInitialization()` in `src/services/attService.ts`.
- **No re-prompt** on rewarded ad show (`requestAttIfNeededForRewardedAd` is idempotent).
- Denied/restricted → `requestNonPersonalizedAdsOnly: true` on rewarded ad requests.
- Gameplay is **not blocked** when ATT is denied.

---

## PART C — Canonical SDK Initialization Order

**iOS** (`src/services/adsPrivacyBootstrap.ts` → `App.tsx` after `bootPhase === 'ready'`):

```
ATT (notDetermined → single system prompt)
  → applyAdTrackingConfiguration() (personalized vs NPA)
  → Google UMP gatherAdsConsentIfNeeded()
  → Mobile Ads initialize()
  → preload rewarded placements
```

**Android:** ATT steps are no-ops; UMP → SDK init unchanged.

---

## PART D — App Privacy Metadata Recommendations (App Store Connect)

Match **post-fix runtime** on iOS:

| Field | Recommendation |
|-------|----------------|
| **Data Used to Track You** | **YES** (when user grants ATT + UMP allows personalized ads) |
| Device ID | Collected, used for advertising, may be used for tracking when ATT authorized |
| Advertising Data | Collected for third-party advertising (AdMob) |
| Product Interaction | Optional — if declared today, keep consistent with AdMob/UMP forms |
| Linked to identity | **No** for ad data (no account-linked ad profiling in-app) |
| Purposes | **Advertising** (primary); **App Functionality** for account/cloud features |

**Notes for reviewer:**

- If ATT denied: app uses **non-personalized ads** only; tracking should not occur.
- Firebase Analytics is **not enabled** in the client.
- UMP handles GDPR/EEA consent; ATT handles Apple tracking permission — separate responsibilities.

---

## PART E–F — Account Deletion UX

**Reviewer path:**

```
More → Hesap → Hesap Merkezi → Hesap tab → Hesap ve Gizlilik → Hesabı Sil
```

- Destructive red **Hesabı Sil** button (always visible on Account tab; not collapsed).
- Two-step confirmation with explicit scope:
  - LogistiCore account
  - Cloud save
  - Username/profile
  - Leaderboard entries
  - Marketplace account state (listings safely removed)
- Guest: **Misafir Kaydını Sil** — local data only.

Removed hidden delete from Preferences “Tehlikeli İşlemler” accordion.

---

## PART G — Backend Deletion Architecture

Existing server-authoritative flow retained and documented:

1. Client: `deleteAccountAndCloudData()` (`src/utils/accountDeletion.ts`)
2. Apple revoke (if provider = Apple): `revokeAppleSignInIfNeeded()` → `revokeAppleSignInTokens` callable
3. Callable `prepareVehicleMarketplaceAccountDeletion`:
   - Marketplace listing cleanup (`prepareMarketplaceAccountDeletion`)
   - Username release
   - `recursiveDelete(users/{uid})` (saves, meta, subcollections)
   - Leaderboard entry removal
4. Client batch deletes any remaining allowed user docs
5. Firebase Auth `deleteUser()`
6. Local reset + new anonymous session

**Guest accounts:** skip cloud/marketplace callable (anonymous rejected by backend); local clear + auth delete only.

**Idempotency:** Reauth retry uses `skipCloudDelete: true` after successful cloud cleanup.

---

## PART H — Sign in with Apple Revocation

- `src/services/appleAuthService.ts` captures `authorizationCode` on sign-in.
- `revokeAppleSignInTokens` Cloud Function (`backend/src/appleTokenRevocation.ts`) calls Apple `https://appleid.apple.com/auth/revoke`.
- Requires server env (Firebase Functions config/secrets):
  - `APPLE_SIGNIN_TEAM_ID`
  - `APPLE_SIGNIN_CLIENT_ID` (Services ID or bundle ID per Apple setup)
  - `APPLE_SIGNIN_KEY_ID`
  - `APPLE_SIGNIN_PRIVATE_KEY` (`.p8` contents, `\n` escaped if needed)

If not configured, callable returns `not-configured`; deletion still proceeds (cloud + auth cleanup).

---

## PART I — Reauthentication

- `requires-recent-login` → dialog **Doğrula ve Sil** → `reauthenticateCurrentUser()` (Google or Apple).
- Retry with `skipCloudDelete: true` so backend data is not double-deleted.
- Apple reauth refreshes authorization code for revocation on retry path.

---

## PART J — Tests

| Script | Coverage |
|--------|----------|
| `scripts/app-store-privacy-account-regression-test.ts` | ATT mapping, NPA options, bootstrap order, deletion UX wiring |
| `scripts/ad-privacy-regression-test.ts` | UMP/rewarded privacy (existing) |
| `scripts/account-signout-deletion-regression-test.ts` | Deletion flow, Apple revoke, guest skip |
| `scripts/account-center-ui-regression-test.ts` | Delete on Account tab |

---

## Files Changed

| Area | Files |
|------|-------|
| ATT / ads | `src/services/attService.ts`, `src/services/adsPrivacyBootstrap.ts`, `src/services/adProvider.ts`, `App.tsx` |
| Account UX | `AccountConnectionTab.tsx`, `AccountPreferencesTab.tsx`, `AccountCenterScreen.tsx`, `useAccountCenter.ts` |
| Deletion | `src/utils/accountDeletion.ts`, `src/services/appleAuthService.ts`, `src/services/appleSignInRevocationService.ts` |
| Backend | `backend/src/appleClientSecret.ts`, `backend/src/appleTokenRevocation.ts`, `backend/src/index.ts` |
| Tests / validators | `scripts/app-store-privacy-account-regression-test.ts`, `scripts/account-*-regression-test.ts`, `scripts/cold-start-performance-test.ts`, `scripts/validate-store-production-config.ts`, `package.json` |

---

## Deploy / Release Checklist

| Item | Required? |
|------|-----------|
| **New iOS binary** | **YES** — ATT order + deletion UX |
| **Cloud Functions deploy** | **YES** — `revokeAppleSignInTokens` (+ configure Apple env vars) |
| **Firestore rules deploy** | **No** — no rule changes |
| **App Store Connect privacy labels** | **YES** — update per Part D |

---

## App Review Test Steps

### ATT / Ads

1. Fresh install on iOS (or reset advertising identifier + delete app).
2. Launch game → complete tutorial/boot to main screen.
3. **ATT system dialog** should appear after UI is ready, **before** any rewarded ad.
4. Deny ATT → game playable; rewarded ads may still work with non-personalized path if UMP allows.
5. UMP form may appear separately (EEA/test geography) — distinct from ATT.
6. Grant ATT → personalized ad path eligible.

### Account Deletion

1. **More → Hesap → Hesap Merkezi → Hesap**.
2. Scroll to **Hesap ve Gizlilik** → tap **Hesabı Sil**.
3. Confirm twice → account removed, new guest session.
4. Linked Google/Apple: verify cloud save cannot be restored after deletion.

---

## Final Status

**`APP_STORE_REJECTION_FIX_READY`**

Pending your manual steps: configure Apple revocation secrets, deploy Cloud Functions, update App Privacy labels, archive new iOS build, submit to App Review.

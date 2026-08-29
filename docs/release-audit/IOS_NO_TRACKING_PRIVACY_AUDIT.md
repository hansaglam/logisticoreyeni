# iOS No-Tracking Privacy Audit

**Date:** 2026-08-29  
**Scope:** Remove ATT / IDFA; keep rewarded ads with non-personalized iOS requests + UMP for GDPR/EEA  
**Final status:** `IOS_TRACKING_REMOVED_VERIFIED`

---

## Executive summary

LogistiCore iOS no longer requests App Tracking Transparency, does not access IDFA, and always requests **non-personalized** rewarded ads on iOS. Google UMP remains for legally required GDPR/EEA consent. Rewarded ads, Android behavior, and SKAdNetwork (via AdMob SDK) are preserved.

**App Store privacy recommendation:** **Does the app track users? → NO**

---

## 1. What tracking existed before

| Path | Previous behavior |
|------|-------------------|
| `expo-tracking-transparency` | Lazy-loaded; `requestTrackingPermissionsAsync()` at ads bootstrap |
| `src/services/attService.ts` | ATT resolution before UMP / Mobile Ads init |
| `src/services/attPolicy.ts` | `authorized` → personalized ads; `denied` → NPA |
| `src/services/adsPrivacyBootstrap.ts` | ATT → tracking config → UMP → SDK init |
| `src/services/adProvider.ts` | ATT-gated `buildRewardedAdRequestOptions()`; ATT re-check before rewarded show |
| `app.config.js` | `expo-tracking-transparency` plugin + AdMob `userTrackingUsageDescription` |
| `ios/LogistiCore/Info.plist` | `NSUserTrackingUsageDescription` |
| `package.json` | `expo-tracking-transparency@~6.0.8` |

Personalized ad path was possible when user granted ATT. That path is removed.

---

## 2. ATT / IDFA paths removed

| Item | Action |
|------|--------|
| `src/services/attService.ts` | **Deleted** |
| `src/services/attPolicy.ts` | **Deleted** |
| `expo-tracking-transparency` dependency | **Removed** from `package.json` / lockfile |
| `expo-tracking-transparency` plugin | **Removed** from `app.config.js` |
| AdMob `userTrackingUsageDescription` | **Removed** from `app.config.js` |
| `NSUserTrackingUsageDescription` | **Removed** from `ios/LogistiCore/Info.plist` |
| `resolveAttBeforeAdsInitialization()` | **Removed** from bootstrap |
| `applyAdTrackingConfiguration()` | **Removed** |
| `requestAttIfNeededForRewardedAd()` | **Removed** from rewarded show path |

No remaining references to `AppTrackingTransparency`, `ATTrackingManager`, `requestTrackingAuthorization`, or `advertisingIdentifier` in app source.

---

## 3. UMP — remains and why

**UMP stays** via `src/services/adsConsentService.ts` (`gatherAdsConsentIfNeeded()`).

| Reason | Detail |
|--------|--------|
| Legal requirement | GDPR/EEA consent for ads via Google User Messaging Platform |
| Not ATT substitute | UMP is **not** used as an IDFA/ATT explainer |
| Bootstrap order | UMP → Mobile Ads SDK init → rewarded preload |

**New ads bootstrap** (`src/services/adsPrivacyBootstrap.ts`):

```
UMP consent → Mobile Ads SDK init → rewarded preload
```

Android unchanged (no ATT steps).

---

## 4. Rewarded ads after removal

| Platform | Ad request behavior |
|----------|---------------------|
| **iOS** | Always `requestNonPersonalizedAdsOnly: true` via `buildRewardedAdRequestOptions()` |
| **Android** | Default AdMob request options (unchanged) |

Rewarded ad flow preserved:

- UMP consent gate (`canRequestAdsAfterConsent`)
- Preload + show via `RewardedAd.createForAdRequest(unitId, buildRewardedAdRequestOptions())`
- Earned reward only on `EARNED_REWARD` event
- Stub mode in `__DEV__` unchanged

---

## 5. SKAdNetwork status

**Preserved** — not modified.

SKAdNetwork identifiers are injected by the `react-native-google-mobile-ads` Xcode build script (`ios/LogistiCore.xcodeproj/project.pbxproj`). SKAdNetwork attribution does not require ATT/IDFA and remains compatible with a no-tracking posture.

---

## 6. App Store privacy recommendation

Based on post-change runtime configuration:

| Question | Answer |
|----------|--------|
| **Does the app track users?** | **NO** |
| IDFA access | **None** — no ATT prompt, no tracking transparency API |
| Cross-app tracking | **None** — iOS ads always non-personalized |
| Data broker sharing | **None introduced** |
| Personalized ads on iOS | **Disabled** |

### Suggested App Privacy labels (update in App Store Connect)

| Category | Recommendation |
|----------|----------------|
| **Data Used to Track You** | **None** |
| **Advertising Data** | May still be collected by AdMob for ad delivery/measurement — declare under **Data Collected** if required, but **not for tracking** |
| **Device ID** | Do **not** declare as used for tracking; no IDFA path |

UMP may still collect consent choices in EEA; that is consent management, not Apple-defined cross-app tracking.

---

## 7. Validation results

| Command / test | Result |
|----------------|--------|
| `npx tsc --noEmit` | PASS |
| `npm run validate:store-production` | PASS |
| `npm run backend:verify` | PASS (64/64) |
| `git diff --check` | PASS |
| `scripts/app-store-privacy-account-regression-test.ts` | 18/18 PASS |
| `scripts/ad-privacy-regression-test.ts` | 44/44 PASS |
| `scripts/store-production-config-security-test.ts` | PASS (`iosNoTrackingAds: true`) |
| `scripts/apple-auth-audit-test.ts` | 46/46 PASS |
| `scripts/account-signout-deletion-regression-test.ts` | 37/37 PASS |

---

## 8. Remaining tracking risk

| Risk | Level | Notes |
|------|-------|-------|
| AdMob SDK internal behavior | Low | iOS requests explicitly NPA; no IDFA API in app |
| UMP consent form wording | Low | Review AdMob console form; ensure no IDFA/tracking language |
| Android ad personalization | N/A | Unchanged; Android has no ATT |
| Re-introduction via dependency upgrade | Low | Pin review on AdMob/Expo plugin updates |

**No blockers.** Rebuild iOS binary required for App Store submission (Info.plist + native dependency change).

---

## 9. Files changed

| File | Change |
|------|--------|
| `src/services/adsPrivacyBootstrap.ts` | UMP-only bootstrap |
| `src/services/adProvider.ts` | iOS always NPA; ATT removed |
| `src/services/attService.ts` | Deleted |
| `src/services/attPolicy.ts` | Deleted |
| `app.config.js` | Removed tracking plugin + usage strings |
| `ios/LogistiCore/Info.plist` | Removed `NSUserTrackingUsageDescription` |
| `package.json` / `package-lock.json` | Removed `expo-tracking-transparency` |
| `scripts/app-store-privacy-account-regression-test.ts` | Updated for no-tracking policy |
| `scripts/validate-store-production-config.ts` | Updated checks |
| `scripts/store-production-config-security-test.ts` | Updated checks |
| `scripts/branding-ios-config-policy-test.ts` | Asserts tracking plugin absent |

---

**Final status: `IOS_TRACKING_REMOVED_VERIFIED`**

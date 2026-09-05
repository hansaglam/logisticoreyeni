# Apple 5.1.2(i) — iOS UMP Removal

Date: 2026-09-05

## Executive result

The Apple rejection path was reproduced from source and removed. iOS no longer requests Google UMP consent information, loads or displays a UMP consent form, or exposes the UMP privacy-options action. Optional rewarded ads remain non-personalized. Android retains its existing UMP behavior.

This change requires a new signed iOS archive with a new build number. The rejected binary must not be resubmitted.

## Root cause

The canonical startup path was:

`usePostStartupLifecycle` → `initializeAdsPrivacyStack` → `gatherAdsConsentIfNeeded` → `AdsConsent.gatherConsent`

That path ran on iOS as well as Android. `react-native-google-mobile-ads` can automatically load and display the Google UMP form from `AdsConsent.gatherConsent`, which is the consent screen shown in Apple's rejection screenshot.

A second reachable iOS path existed in Account Center:

`AccountCenterScreen` → `openAccountPrivacyOptions` → `AdsConsent.requestInfoUpdate` → `AdsConsent.showPrivacyOptionsForm`

## Behavior before and after

| Platform | Before | After |
| --- | --- | --- |
| iOS startup | UMP gather → Mobile Ads init → rewarded preload | iOS NPA state → Mobile Ads init → rewarded preload |
| iOS privacy settings | Could expose UMP privacy-options UI | UMP row is not rendered; service also returns `not-required` before native access |
| iOS rewarded requests | Non-personalized | Still always `requestNonPersonalizedAdsOnly: true` |
| iOS failure mode | Consent state could block or show UMP | Fails closed to non-personalized ads; no consent UI |
| Android | UMP gather and privacy-options behavior | Unchanged |

## Platform policy boundary

`shouldUseGoogleUmpOnPlatform(platform)` is the canonical policy boundary and returns true only for Android. iOS uses an explicit `IOS_NPA_ONLY` consent snapshot. The native `AdsConsent` module accessor returns `null` on iOS, providing a service-level guard in addition to each public flow's early return.

## UMP call-site audit

| Call site | Location | iOS reachability | Android behavior |
| --- | --- | --- | --- |
| `AdsConsent.getConsentInfo` | `src/services/adsConsentService.ts` | Blocked by iOS early return and Android-only module accessor | Preserved |
| `AdsConsent.reset` | `src/services/adsConsentService.ts` | Blocked; debug reset restores iOS NPA state | Preserved for internal Android builds |
| `AdsConsent.gatherConsent` | `src/services/adsConsentService.ts` | Blocked before module access | Preserved |
| `AdsConsent.requestInfoUpdate` | `src/services/adsConsentService.ts` | Blocked by `openAccountPrivacyOptions` early return | Preserved |
| `AdsConsent.showPrivacyOptionsForm` | `src/services/adsConsentService.ts` | Blocked by service guard and hidden UI | Preserved |

`GoogleUserMessagingPlatform` remains a transitive CocoaPods dependency of Google Mobile Ads. It is not directly removable while retaining that SDK. Its presence in `Podfile.lock` is not a runtime invocation; all application-owned iOS UMP entry points are now unreachable.

## Privacy-options UI

Account Center passes `adsPrivacyOptionsSupported={Platform.OS === 'android'}`. On iOS neither the UMP action nor the static UMP/cookie status row is rendered. `shouldShowAccountPrivacyOptions` also returns false for iOS even if stale state says `REQUIRED`.

## ATT / IDFA audit

- `expo-tracking-transparency` is absent from `package.json` and Expo plugins.
- `NSUserTrackingUsageDescription` is absent from `app.config.js`, the source `Info.plist`, and generated Expo introspection output.
- Stale `ExpoTrackingTransparency` entries were removed from `ios/Podfile.lock`.
- No app-owned ATT request or `ASIdentifierManager`/IDFA access was found.
- `ios/LogistiCore/PrivacyInfo.xcprivacy` declares `NSPrivacyTracking` as false.
- The generated RNGoogleMobileAds Xcode script contains generic optional support for a tracking usage description, but the project supplies no such setting, so it injects no ATT usage description.

## Ad personalization audit

`buildRewardedAdRequestOptions` continues to return `{ requestNonPersonalizedAdsOnly: true }` on iOS. Both rewarded preload and show paths use this canonical request configuration. iOS never enables personalized requests based on a UMP state.

## User-visible copy audit

- In-app UMP/privacy-option copy is Android-gated.
- General gameplay uses of “takip/tracking” refer to deliveries, vehicles, prices, or statistics—not cross-app tracking.
- Legal pages now state that UMP is Android-only and that iOS uses non-personalized ads without ATT or UMP consent forms.
- The stale Support-page statement that iOS ATT might affect availability was corrected.

## Files changed for this fix

Runtime and native:

- `src/services/adsConsentPolicy.ts`
- `src/services/adsConsentService.ts`
- `src/services/adsPrivacyBootstrap.ts`
- `src/services/adProvider.ts` (documentation only; NPA behavior retained)
- `src/domain/adPrivacyState.ts`
- `src/screens/AccountCenterScreen.tsx`
- `src/components/accountCenter/AccountPreferencesTab.tsx`
- `src/hooks/usePostStartupLifecycle.ts` (documentation only)
- `ios/Podfile.lock`

Regression and production validation:

- `scripts/ios-ump-removal-regression-test.ts`
- `scripts/ad-privacy-regression-test.ts`
- `scripts/app-store-privacy-account-regression-test.ts`
- `scripts/store-production-config-security-test.ts`
- `scripts/validate-store-production-config.ts`

Public legal site (nested repository):

- `logisticore-legal/index.html`
- `logisticore-legal/privacy-policy/index.html`
- `logisticore-legal/privacy-choices/index.html`
- `logisticore-legal/support/index.html`

This report is also new. Other dirty-worktree files belong to earlier work and were not modified for this fix.

## Validation results

| Validation | Result |
| --- | --- |
| `npx tsc --noEmit` | PASS |
| `npm run validate:store-production` | PASS |
| `npm run backend:verify` | PASS, including emulator 69/69 |
| `npx tsx scripts/ios-ump-removal-regression-test.ts` | PASS |
| `npx tsx scripts/ad-privacy-regression-test.ts` | PASS, 45/45 |
| `npx tsx scripts/app-store-privacy-account-regression-test.ts` | PASS, 21/21 |
| `npx tsx scripts/store-production-config-security-test.ts` | PASS |
| `npx tsx scripts/ads-config-test.ts` | PASS |
| `npx tsx scripts/account-center-ui-regression-test.ts` | PASS, 74/74 |
| `npx tsx scripts/account-signout-deletion-regression-test.ts` | PASS, 41/41 |
| `npx tsx scripts/seasons-challenges-foundation-test.ts` | PASS, 26/26 |
| `npx tsx scripts/seasons-challenges-ui-regression-test.ts` | PASS, 32/32 |
| `npx tsx scripts/vehicle-marketplace-regression-test.ts` | PASS, 20 cases |
| `npx tsx scripts/vehicle-marketplace-ui-test.ts` | PASS |
| `npx tsx scripts/validate-production-build-config.ts` | PASS |
| `npx tsx scripts/apple-auth-release-regression-test.ts` | PASS, 70/70 |
| `npx tsx scripts/app-lifecycle-extraction-regression-test.ts` | PASS |
| `npx tsx scripts/legal-pages-validation-test.ts` | PASS, 218/218 |
| `git diff --check` (main and legal repositories) | PASS; line-ending warnings only |
| Expo introspection | PASS: bundle `com.ethemsincar.logisticore`, no `NSUserTrackingUsageDescription`, no tracking-transparency plugin |

## Fresh archive requirement

Windows cannot produce or inspect the final signed iOS archive. On macOS, after pulling these changes:

1. Install exact dependencies with `npm ci`.
2. Regenerate/install pods with `npx pod-install` (or `cd ios && pod install`).
3. Increment the iOS build number above the rejected build.
4. Create a fresh Release Archive in Xcode using `com.ethemsincar.logisticore`.
5. Run the existing built-app preflight against the archive output:

   `IOS_ARCHIVE_APP_PATH="/absolute/path/to/LogistiCore.app" npx tsx scripts/verify-ios-apple-auth-config.ts`

6. Inspect the built `Info.plist` and confirm `NSUserTrackingUsageDescription` is absent, then perform a clean-device launch/rewarded-ad test and verify that no Google UMP form appears.

The public legal-site changes must also be published from its nested repository before or alongside the App Store resubmission.

No backend or Firestore deployment is required for this fix.

APPLE_5_1_2_IOS_UMP_REMOVAL_VERIFIED

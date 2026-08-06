# FIX Branding & iOS Production Compliance Results

**Date:** 2026-08-06  
**Scope:** Production branding assets, Android/iOS source config, ATS, entitlements, version alignment  
**Status:** MITIGATED (source-config verified; final signed artifacts pending separate build step)

AAB / APK / IPA / Xcode Archive **not produced** in this task.

---

## Executive Summary

| Area | Before | After |
|------|--------|-------|
| App icon | Expo grid placeholder / Android robot template | LogistiCore gold emblem on `#020712` |
| Splash | White `#FFFFFF` + grid placeholder | Navy `#020712` + centered emblem |
| `app.json` icon/splash | Missing | Configured + native Android res regenerated |
| iOS ATS | `NSAllowsArbitraryLoads: true` | **`false`** (no domain exceptions required) |
| Save `appVersion` metadata | Hardcoded `1.0.0` | **`1.0.10`** via `src/config/appVersion.ts` |
| Product UI | — | **Unchanged** (no redesign) |

---

# SOURCE-CONFIG VERIFIED

## 1. Branding Asset Audit (Pre-Fix Findings)

| Location | Finding |
|----------|---------|
| `app.json` | No `icon`, `splash`, or `adaptiveIcon` |
| `assets/` | No app icon/splash sources (only in-game/dashboard art) |
| `android/.../mipmap-*/ic_launcher.webp` | **Android robot + teal grid** (Expo default) |
| `android/.../drawable-*/splashscreen_logo.png` | **Grid/circle placeholder** |
| `android/.../values/colors.xml` | `splashscreen_background=#FFFFFF` |
| `android/.../values/styles.xml` | `statusBarColor=#ffffff` |
| iOS (introspect) | No custom icon path; default splash storyboard |

**Removed:** All placeholder launcher/splash PNG/WebP under `android/app/src/main/res/` replaced by generated LogistiCore assets.

---

## 2. App Icon

| Asset | Path | Spec |
|-------|------|------|
| Master iOS / Expo icon | `assets/branding/icon.png` | **1024×1024**, opaque `#020712` background |
| Adaptive foreground | `assets/branding/adaptive-icon-foreground.png` | Same emblem, 66% safe zone |
| Android mipmaps | `android/app/src/main/res/mipmap-*/ic_launcher*.webp` | Regenerated from master |
| Adaptive XML | `mipmap-anydpi-v26/ic_launcher.xml` | `@color/iconBackground` + `@mipmap/ic_launcher_foreground` |

**Source art:** `assets/dashboard/company-emblem-gold.png` (LogistiCore shield + building emblem)  
**Generator:** `npx tsx scripts/generate-branding-assets.ts`  
**Monochrome icon:** Not added (Android 13 themed icon optional; not required for initial Play compliance — add if store review requests)

---

## 3. Splash Screen

| Setting | Value |
|---------|-------|
| Background | `#020712` (premium dark navy — matches in-app chrome) |
| Center image | `assets/branding/splash-icon.png` |
| Resize | `contain` (no stretch) |
| Plugin | `expo-splash-screen` — `imageWidth: 280` |
| Android native | `drawable-*/splashscreen_logo.png` regenerated |
| Android theme | `Theme.App.SplashScreen` → `#020712` background |

No subtitle / version text on splash.

---

## 4. iOS App Transport Security (ATS)

| Setting | Value |
|---------|-------|
| `NSAllowsArbitraryLoads` | **`false`** (`app.json` + `app.config.js`) |
| Domain exceptions | **None** (no `http://` endpoints in app source; Firebase/AdMob/Google HTTPS only) |

**Introspect confirmation:** `NSAllowsArbitraryLoads: false`

---

## 5. iOS Entitlements & Capabilities (Source)

| Capability | Source config | Notes |
|------------|---------------|-------|
| Sign in with Apple | `usesAppleSignIn: true` + `expo-apple-authentication` plugin | Entitlement `com.apple.developer.applesignin` in introspect |
| Bundle ID | `com.ethemsincar.logisticore` | Matches Android package |
| Google Sign-In URL scheme | `com.googleusercontent.apps.363783837598-tvbeuhmirctkrpdam51lsqm5uj8nac3l` | From `@react-native-google-signin/google-signin` plugin |
| Push notifications | `expo-notifications` + `UIBackgroundModes: [remote-notification]` | Used for market alerts feature path |
| AdMob | `react-native-google-mobile-ads` plugin with production App IDs | Native manifest metadata |
| ATT | `expo-tracking-transparency` + `NSUserTrackingUsageDescription` | Deferred to rewarded-ad flow (B-003) |
| Unused entitlements | None added beyond above | — |

**Introspect note:** `aps-environment: development` in local introspect (expected until production provisioning profile / archive).

---

## 6. Version Config

| Field | Value | Location |
|-------|-------|----------|
| Marketing version | **1.0.10** | `app.json` `expo.version` |
| Android `versionCode` | **11** | `app.json` / `android/app/build.gradle` |
| iOS `CFBundleVersion` | **1** (default) | Introspect — **not bumped in this task** |
| Save metadata `appVersion` | **1.0.10** | `src/config/appVersion.ts` → `saveGame.ts`, cloud save, quarantine |
| Save schema `saveVersion` | **3** | `SAVE_GAME_VERSION` (unchanged) |

### Before final store build — increment guidance

| Platform | Action |
|----------|--------|
| Android | Increment `versionCode` in `app.json` (currently **11**) only when uploading a **new** Play build |
| iOS | Set `expo.ios.buildNumber` (or `CFBundleVersion`) to next integer — currently **1**, misaligned with Android **11**; align policy before TestFlight |
| Marketing version | Bump `expo.version` (e.g. `1.0.11`) only for user-visible release notes |

---

## 7. ATT / AdMob / Privacy (Source)

| Item | Status |
|------|--------|
| `NSUserTrackingUsageDescription` | Set (AdMob plugin + ATT plugin Turkish copy) |
| ATT runtime | Deferred to first rewarded ad (`attService.ts`) — B-003 |
| UMP consent | `gatherAdsConsentIfNeeded()` before ad SDK init — B-003 |
| AdMob App IDs | Production IDs in `app.config.js` plugin + `adMobConstants.ts` |
| Store production test ads | Blocked by `.env.production` + `validate:store-production` — B-003 |

### App Store Privacy Nutrition Labels (declarative checklist)

Collect / declare as applicable at submission time:

- **Identifiers:** Device ID (ads), User ID (Firebase Auth anonymous/linked)
- **Usage data:** Advertising data (AdMob rewarded ads)
- **Diagnostics:** Crash/performance if Firebase/Crashlytics added later (currently minimal)
- **Tracking:** ATT prompt may apply for personalized ads; UMP for EEA consent

### Play Data Safety alignment

- Ads declared (AdMob rewarded)
- Account info (Google/Apple optional link)
- Data encrypted in transit (HTTPS)
- No arbitrary cleartext (ATS off)

---

## 8. iOS Safe Area (Source Review — No UI Redesign)

| Area | Implementation | Action |
|------|----------------|--------|
| Tab bar bottom inset | `GameTabBar` → `SafeAreaView` + `useTabBarLayout` | Verified — no change |
| App root insets | `AppSafeAreaProvider` + `react-native-safe-area-context` | Verified |
| Modals / sheets | Existing `SafeAreaView` / bottom sheets | No validated overflow fixed (none found in audit) |
| Orientation | `portrait` only | Unchanged |
| Status bar | Dark UI; Android native `#020712` | Updated native `styles.xml` only |
| Dynamic Island / home indicator | Tab bar uses `bottomInset` | Verified at source |

---

## 9. Changed Files

| File | Change |
|------|--------|
| `assets/branding/*` | Production icon + splash sources |
| `app.json` | Icon, splash, adaptive icon, ATS, splash plugin |
| `app.config.js` | iOS ATS fail-closed merge |
| `android/.../res/**` | Launcher, splash, colors, adaptive XML, status bar |
| `src/config/appVersion.ts` | Single semver source |
| `src/storage/saveGame.ts` | Use `APP_VERSION` |
| `src/storage/saveRecoveryQuarantine.ts` | Aligned app version |
| `src/services/cloudSaveService.ts` | Aligned fallback version |
| `scripts/generate-branding-assets.ts` | Asset generator |
| `scripts/branding-ios-config-policy-test.ts` | CI policy test |
| `package.json` | `expo-splash-screen`, `sharp` devDep |

---

## 10. Verification Commands

```text
npm run typecheck                              → PASS
npm run verify                                 → PASS
npx tsx scripts/branding-ios-config-policy-test.ts → PASS
npx expo config --type public                  → icon/splash/adaptive configured
npx expo config --type introspect              → NSAllowsArbitraryLoads=false
npx expo export --platform android             → PASS
npx expo export --platform ios                 → PASS
git diff --check                               → PASS
```

---

# FINAL ARTIFACT VERIFICATION REQUIRED

These items **cannot** be fully validated from source config alone. Confirm on the **next** signed release build:

- [ ] **AAB** launcher icon on device (adaptive + legacy) — no robot/grid
- [ ] **AAB** cold-start splash — navy + centered emblem, no white flash
- [ ] **Merged release manifest** — AdMob App ID, no debug permissions (B-004)
- [ ] **Signed iOS archive** entitlements — Apple Sign-In, push (`aps-environment: production`)
- [ ] **Provisioning profile** matches `com.ethemsincar.logisticore`
- [ ] **IPA / TestFlight** URL scheme — Google Sign-In redirect works
- [ ] **App Store Connect** 1024×1024 icon upload matches `assets/branding/icon.png`
- [ ] **Production APNs** — replace development push entitlement in distribution profile
- [ ] **TestFlight device** — auth (Google/Apple), ATT on rewarded ad, UMP in EEA test geography
- [ ] **Play / App Store** privacy forms match AdMob + Firebase data practices

---

## Acceptance Criteria

| Criterion | Status |
|-----------|--------|
| Placeholder icons/splash removed from source | ✅ |
| Production branding configured (Expo + Android native) | ✅ |
| ATS arbitrary loads disabled | ✅ |
| Entitlements source correct (Apple, Google scheme, push path) | ✅ |
| Version metadata aligned to 1.0.10 | ✅ |
| No in-game UI redesign | ✅ |
| No AAB/APK/IPA/Archive in this task | ✅ |

# FIX B-003 Results — Internal vs Store Production Build Profiles

**Date:** 2026-08-06  
**Blocker:** B-003 — Store build shipped test ads + internal diagnostics; UMP/ATT not proven  
**Status:** MITIGATED (profile split + fail-closed validator + consent/ATT wiring verified in CI; real-device ad/consent checks remain)

---

## 1. Build Profile Snapshots

Profiles load **`.env` (shared secrets) → `.env.{profile}` (overrides only)** via `app.config.js` and `scripts/build-env.ts`. No chained fragile overwrite beyond explicit profile override.

### Internal (`.env.internal`)

| Flag | Value |
|------|-------|
| `LOGISTICORE_BUILD_PROFILE` | `internal` |
| `EXPO_PUBLIC_ADS_ENABLED` | `true` |
| `EXPO_PUBLIC_ADS_USE_TEST_IDS` | `true` |
| `EXPO_PUBLIC_BACKEND_DIAGNOSTICS_ENABLED` | `true` |
| `EXPO_PUBLIC_USE_FIREBASE_EMULATOR` | `false` |
| `EXPO_PUBLIC_MOCK_GLOBAL_ECONOMY` | `false` |

**Expo public config (`LOGISTICORE_BUILD_PROFILE=internal`):**

- `extra.buildProfile`: `internal`
- `extra.ads.useTestIds`: `true`
- `extra.features.backendDiagnosticsEnabled`: `true`

### Production (`.env.production`)

| Flag | Value |
|------|-------|
| `LOGISTICORE_BUILD_PROFILE` | `production` |
| `EXPO_PUBLIC_ADS_ENABLED` | `true` |
| `EXPO_PUBLIC_ADS_USE_TEST_IDS` | `false` |
| `EXPO_PUBLIC_BACKEND_DIAGNOSTICS_ENABLED` | `false` |
| `EXPO_PUBLIC_USE_FIREBASE_EMULATOR` | `false` |
| `EXPO_PUBLIC_MOCK_GLOBAL_ECONOMY` | `false` |

**Expo public config (`LOGISTICORE_BUILD_PROFILE=production`):**

- `extra.buildProfile`: `production`
- `extra.ads.useTestIds`: `false`
- `extra.features.backendDiagnosticsEnabled`: `false`

**Store release command pattern:**

```bash
LOGISTICORE_BUILD_PROFILE=production npm run validate:store-production
LOGISTICORE_BUILD_PROFILE=production npm run android:bundle:release   # when ready — not run in this task
```

---

## 2. Test ID Status

| Check | Internal | Production |
|-------|----------|------------|
| `EXPO_PUBLIC_ADS_USE_TEST_IDS` | `true` | **`false`** |
| `shouldUseTestAdUnitIds()` runtime | allowed | **blocked** (`isStoreProductionProfile()` fail-closed) |
| Rewarded unit at runtime | `TestIds.REWARDED` | production unit IDs from `adMobConstants.ts` |
| Google sample App ID (`3940256099942544`) | N/A | **validator rejects** |
| Fail-closed if production + test IDs | — | **`validate:store-production` FAIL** |

**Production AdMob IDs (native plugin + JS):**

| Platform | App ID | Rewarded unit |
|----------|--------|---------------|
| Android | `ca-app-pub-8214453687597896~5560651696` | `…/1840898530` |
| iOS | `ca-app-pub-8214453687597896~4247570027` | `…/4313204541` |

---

## 3. Diagnostics Status

| Layer | Production behavior |
|-------|---------------------|
| `EXPO_PUBLIC_BACKEND_DIAGNOSTICS_ENABLED` | `false` |
| `isBackendDiagnosticsEnabled()` | **always `false`** when `isStoreProductionProfile()` |
| `BackendDiagnosticsGate` | returns `null` — panel never mounts |
| Debug simulation route (`MoreScreen`) | **`__DEV__` guarded** — unreachable in release |
| Validator | production + diagnostics `true` → **FAIL** |

Internal builds retain diagnostics panel in Account section via gate when profile + flag allow.

---

## 4. UMP Consent Flow

**Implementation:** `src/services/adsConsentService.ts` (SDK) + `src/services/adsConsentPolicy.ts` (headless decision logic)

| Step | Behavior |
|------|----------|
| Boot (`App.tsx`) | `gatherAdsConsentIfNeeded()` before `initializeAdProvider()` |
| Consent update | `AdsConsent.gatherConsent()` |
| Form | Shown when SDK status requires it |
| Ad load gate | `canRequestAdsAfterConsent()` must be `true` before SDK init / rewarded load |
| Error | Logged; ads blocked; **game continues** |
| Consent reset | `resetAdsConsentForDebug()` — **internal profile only** |
| EEA test geography | `EXPO_PUBLIC_ADS_CONSENT_DEBUG_EEA=true` — **internal only** (`isAdsConsentDebugGeographyEnabled()`) |

**CI coverage:** `scripts/store-production-config-security-test.ts` — required / obtained / error snapshot paths.

---

## 5. ATT (iOS App Tracking Transparency)

**Package:** `expo-tracking-transparency@~6.0.8` (Expo SDK 54)

**Implementation:** `src/services/attService.ts` + `src/services/attPolicy.ts`

| Rule | Behavior |
|------|----------|
| Prompt timing | **Deferred** — first rewarded ad tap (`showRewardedAd`), not app launch |
| Denied / restricted | Game continues; **non-personalized** ad path reported via `getAttAdsPersonalizationMode()` |
| Authorized | **personalized** mode reported |
| Not determined (pre-prompt) | `unknown` — ads not blocked solely for ATT |
| Plugin copy | `app.config.js` — user-facing explanation before system dialog |

**Privacy / AdMob note:** AdMob rewarded ads do not require ATT for basic delivery; ATT affects IDFA availability for cross-app tracking / personalization. UMP handles GDPR/EEA consent separately. App Store privacy label should declare **Advertising Data** / **Device ID** used for advertising; tracking declaration aligns with ATT prompt (optional, user-controlled).

---

## 6. Ads Runtime Safeguards

Verified in `src/services/adProvider.ts`:

- Reward granted **only** on `RewardedAdEventType.EARNED_REWARD`
- Duplicate reward guard (`rewardGrantedForImpression`)
- Listener cleanup on finish
- No-fill / network / timeout → `failed` with categorized logging
- UMP consent gate on init + availability
- ATT deferred before native rewarded show

---

## 7. Fail-Closed Store Validator

**Script:** `scripts/validate-store-production-config.ts`  
**npm:** `npm run validate:store-production`  
**Policy:** `src/config/storeProductionPolicy.ts`

**Fails when (production profile):**

- `EXPO_PUBLIC_ADS_USE_TEST_IDS=true`
- `EXPO_PUBLIC_BACKEND_DIAGNOSTICS_ENABLED=true`
- localhost / emulator env values
- missing or sample AdMob App / unit IDs
- `EXPO_PUBLIC_ADS_MODE=test|stub`
- `EXPO_PUBLIC_ADS_CONSENT_DEBUG_EEA=true`
- `EXPO_PUBLIC_USE_FIREBASE_EMULATOR=true`
- `EXPO_PUBLIC_MOCK_GLOBAL_ECONOMY=true`
- `EXPO_PUBLIC_DEBUG_CLOUD_SAVE_CONFLICT=1`

Also checks source: debug route guard, diagnostics gate, UMP gate, deferred ATT.

---

## 8. Changed / Added Files

| File | Purpose |
|------|---------|
| `.env.internal` / `.env.production` | Profile flag overrides |
| `scripts/build-env.ts` | Headless profile env loader |
| `scripts/validate-store-production-config.ts` | Store CI validator |
| `scripts/store-production-config-security-test.ts` | B-003 security tests |
| `src/config/buildProfile.ts` | Profile resolution (fail-closed) |
| `src/config/storeProductionPolicy.ts` | Shared validation policy |
| `src/config/adMobConstants.ts` | Headless-safe AdMob IDs |
| `src/services/adsConsentService.ts` | UMP integration |
| `src/services/adsConsentPolicy.ts` | Consent decision (testable) |
| `src/services/attService.ts` | Deferred ATT |
| `src/services/attPolicy.ts` | ATT personalization mapping (testable) |
| `src/components/BackendDiagnosticsGate.tsx` | Production-safe diagnostics boundary |
| `app.config.js` | Profile env + ATT plugin |
| `App.tsx` | Consent before ad init |
| `src/services/adProvider.ts` | Consent + ATT + reward guards |
| `src/config/adMob.ts` | Block test IDs on store production |
| `src/services/backendDiagnostics.ts` | Fail-closed enabled check |
| `package.json` | `validate:store-production`; `expo-tracking-transparency` |

**Not produced in this task:** AAB, APK, IPA, Xcode Archive.

---

## 9. Verification Results

```text
npm run typecheck                              → PASS
npm run verify                                 → PASS
npm run validate:store-production              → PASS (0 failed)
npx tsx scripts/store-production-config-security-test.ts → MITIGATED
npx expo config --type public (internal)       → useTestIds=true, diagnostics=true
npx expo config --type public (production)     → useTestIds=false, diagnostics=false
npx expo config --type introspect (production) → PASS
npx expo export --platform android (production)  → PASS → dist/
npx expo export --platform ios (production)      → PASS → dist/
git diff --check                               → PASS (no conflict markers)
```

---

## 10. Remaining Real-Device Tests

Before store submission with live ads:

- [ ] **UMP EEA device:** consent form appears when required; ads load only after accept
- [ ] **UMP non-EEA device:** no unnecessary form; ads load when policy allows
- [ ] **UMP error/offline:** game boot OK; rewarded button shows failure state, no crash
- [ ] **ATT iOS:** prompt on first rewarded tap only; deny → non-personalized ads still attempt load
- [ ] **ATT authorized:** personalized path logged in internal build diagnostics
- [ ] **Production AAB/IPA:** confirm no “Test Ad” label, no diagnostics panel in Account
- [ ] **AdMob console:** production units receiving requests (no test App ID in merged manifest)

---

## 11. Final Android / iOS Build Requirements

1. Set `LOGISTICORE_BUILD_PROFILE=production` for EAS / local release builds.
2. Run `npm run validate:store-production` and `npm run validate:production-build` before bundling.
3. Do **not** set `EXPO_PUBLIC_ADS_USE_TEST_IDS=true` in production profile or release CI secrets.
4. Android: existing production App ID in manifest via `react-native-google-mobile-ads` plugin.
5. iOS: ATT usage string in `expo-tracking-transparency` plugin; UMP via Google Mobile Ads SDK 15.x.
6. Play / App Store: update privacy nutrition labels for advertising + optional tracking (ATT).

---

## 12. Acceptance Criteria

| Criterion | Status |
|-----------|--------|
| Production `ADS_USE_TEST_IDS=false` | ✅ |
| Production diagnostics `false` / unreachable | ✅ |
| Fail-closed validation | ✅ |
| Consent flow production-safe (non-blocking errors) | ✅ (CI + code; device proof pending) |
| ATT deferred, non-blocking | ✅ (CI + code; device proof pending) |

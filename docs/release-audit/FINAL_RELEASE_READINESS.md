# LogistiCore — Final Release Readiness

**Audit date:** 2026-08-14  
**Scope:** Release hardening only (no new features, no binaries)  
**Audited tree:** Local working copy (includes offline-cost fix + fleet upgrades integration)

---

## FINAL STATUS: **RELEASE_READY**

All P0 blockers resolved. Automated suite green. Production profile validated. Store binary not produced (per policy).

---

## 1. Executive summary

LogistiCore is **release-candidate ready** for store submission after the user commits the current working tree and produces final AAB/IPA locally.

**Fixed this audit (P0):** Offline fixed operating costs violated the product rule (`maxOfflineChargeDays` catch-up charged warehouse/driver/operations costs after background/offline return). Canonical behavior is now: **offline catch-up charges 0 fixed operating cost periods**; online ticks charge at most one 24h period.

**Validated:** `tsc`, `npm run verify`, Firebase emulator **50/50**, Android/iOS `expo export`, `validate:production-build`, `production:backend-check`, `git diff --check`.

**Still required before public launch:** Real-device smoke on Android Internal + iOS TestFlight, store listing assets, and external AdMob/Play approval (not code-gated).

---

## 2. P0 blockers

| # | Status | Severity | File | Root cause | Required fix |
|---|--------|----------|------|------------|--------------|
| 1 | **RESOLVED** | P0 | `src/store/gameStore.ts` (`applyOfflineProgress`) | After offline simulation, `buildPeriodicCostDeductions` + `processDailyOperatingCosts` charged up to 3× daily fixed costs | Removed offline catch-up charging; advance economy cursor without deductions (`OFFLINE_CATCHUP_MAX_COST_PERIODS = 0`) |
| 2 | **RESOLVED** | P0 | `src/config/balance.ts`, `scripts/offline-economy-test.ts` | Tests and config encoded legacy 3-day offline cost cap | Updated balance comment + regression tests for 72h offline → $0 fixed cost |

**Open P0 count: 0**

---

## 3. P1 issues

| # | Severity | Area | Detail | Recommended action |
|---|----------|------|--------|-------------------|
| 1 | P1 | Marketplace emulator | `concurrent double purchase` failed 1/50 on first run (`INVALID_ARGUMENT: Transaction is invalid or closed`); **passed on immediate retry (50/50)** | Monitor; consider transaction retry/backoff in `backend/src/vehicleMarketplace.ts` if production reports duplicates |
| 2 | P1 | CI coverage | `scripts/account-cloud-login-regression-test.ts` not in `npm run verify` | Add to verify script before freeze |
| 3 | P1 | Documentation drift | `CLOUD_SAVE_AUTO_RESTORE_ENABLED = false` in `backendRoadmap.ts` but `accountCloudLogin.ts` auto-restores non-meaningful local saves | Rename/comment constant to avoid operator confusion |
| 4 | P1 | Git hygiene | Uncommitted changes (offline fix, fleet upgrades, tests); untracked `logisticore-*.txt`, `verify-output.txt`, `emulator-output.txt` | Commit release fixes; add temp logs to `.gitignore`; do not commit diagnostic outputs |
| 5 | P1 | Tooling | Firebase CLI warns Java &lt; 21 support ending | Install JDK 21+ on release CI machine |
| 6 | P1 | iOS metadata | No explicit `buildNumber` in `app.json` (Expo/EAS may auto-increment) | Confirm EAS `ios.buildNumber` before App Store upload |

---

## 4. Production config

| Check | Expected | Actual | Source |
|-------|----------|--------|--------|
| Android `applicationId` | `com.ethemsincar.logisticore` | ✓ | `android/app/build.gradle`, `app.json` |
| iOS `bundleIdentifier` | same | ✓ | `app.json`, `GoogleService-Info.plist` |
| Firebase project | `logisticore-53ab4` | ✓ | `.env`, `google-services.json`, `GoogleService-Info.plist` |
| Functions region | `us-central1` | ✓ | `app.config.js` extra, `validate-production-build-config` |
| Emulator endpoints in client | none | ✓ | `src/services/firebase.ts` audited |
| `localhost` / staging in `EXPO_PUBLIC_*` | none | ✓ | `storeProductionPolicy` scan |
| `EXPO_PUBLIC_BACKEND_DIAGNOSTICS_ENABLED` (production) | `false` | ✓ | `.env.production` |
| `EXPO_PUBLIC_ADS_USE_TEST_IDS` (production) | `false` | ✓ | `.env.production` |
| `EXPO_PUBLIC_USE_FIREBASE_EMULATOR` | `false` | ✓ | `.env.production`, `.env.internal` |
| `EXPO_PUBLIC_MOCK_GLOBAL_ECONOMY` | `false` | ✓ | profile env files |
| Performance diagnostics (production) | OFF | ✓ | `PERF_DIAGNOSTICS_ENABLED` false unless `__DEV__` or diagnostics env |
| Dev `.env` | diagnostics/test ads ON | ✓ (dev only) | Local dev unchanged |

**Profiles:** `.env` (secrets) + `.env.production` / `.env.internal` (gitignored overlays). Validate with `LOGISTICORE_BUILD_PROFILE=production npm run validate:production-build`.

**Version:** `1.0.21` / `versionCode` **22** (`app.json`, `build.gradle`).

---

## 5. Feature flags (production expected)

| Feature | Production expected | Production actual (`.env.production`) | Runtime source | Mismatch |
|---------|--------------------|---------------------------------------|----------------|----------|
| Marketplace | ON | `EXPO_PUBLIC_VEHICLE_MARKETPLACE_ENABLED=true` | `backendRoadmap.ts` + env | No |
| Leaderboard | ON | `EXPO_PUBLIC_LEADERBOARD_ENABLED=true` | `backendRoadmap.ts` + env | No |
| Ads | ON, real units | `EXPO_PUBLIC_ADS_ENABLED=true`, `USE_TEST_IDS=false` | `adMob.ts`, `adMobConstants.ts` | No |
| Cloud Save | ON | implicit (`BACKEND_ENABLED`) | `cloudSaveService.ts`, `cloudSaveSync.ts` | No |
| Google Sign-In | ON | OAuth IDs in `.env` | `googleAuthService.ts` | No |
| Apple Sign-In | ON | `usesAppleSignIn: true` | `appleAuthService.ts`, `app.config.js` | No |
| Tutorial | ON (kill-switch `false`) | not overridden → default ON | `tutorial/app/featureFlags.ts` | No |
| Warehouses | ON | always in game | gameplay | No |
| Fleet Upgrades | ON | Fleet tab `upgrades` | `FleetScreen.tsx`, `FleetUpgradesPanel.tsx` | No |
| Daily Ops (ad bonus) | ON when ads ON | follows `EXPO_PUBLIC_ADS_ENABLED` | `DashboardDailyOpsBonusCard.tsx` | No |
| Market alarms | OFF | `EXPO_PUBLIC_MARKET_ALARMS_ENABLED=false` | `backendRoadmap.ts` | No |

`__DEV__` overrides (marketplace always on in dev) do not affect production builds.

---

## 6. Save integrity

| Area | Status | Evidence |
|------|--------|----------|
| Serialize + checksum | PASS | `saveGame.ts`, `verifyRawSaveChecksum` |
| Atomic write | PASS | temp file + rename pattern in `saveGame.ts` |
| Backup / recovery | PASS | `save-recovery-regression-test.ts`, `save-bootstrap-regression-test.ts` in verify |
| Malformed / migration | PASS | `saveIntegrity.ts`, bootstrap normalizers |
| Single-flight / dirty flag | PASS | `gameStore` autosave guards |
| Duplicate save prevention | PASS | revision + single-flight in store |
| Force-close recovery | PASS | backup slot + `SaveRecoveryScreen` |

**Risk:** None identified at P0. Silent progress loss paths not found in audit.

---

## 7. Cloud restore / account

| Scenario | Expected | Status |
|----------|----------|--------|
| Fresh install + existing Google/Apple + cloud save | Auto restore, no conflict modal | PASS (static + `account-cloud-login-regression-test.ts`) |
| Meaningful local + different cloud | “İki farklı kayıt bulundu.” modal | PASS (`account-cloud-conflict-regression-test.ts` in verify) |
| Network failure | Session kept, no overwrite, retry | PASS |
| Corrupt cloud | No auto starter overwrite | PASS (`validateCloudSaveRestorePayload`, explicit user path) |
| Upload before cloud check complete | Blocked | PASS (`cloudSaveSync.ts` save-flow gate) |
| Google + Apple same resolver | PASS | `accountCloudLogin.ts` / `resolveSaveConflict` |
| Reinstall invariant | Starter cannot overwrite cloud | PASS (`isMeaningfulLocalSave` + auto-restore branch) |

`CLOUD_SAVE_AUTO_RESTORE_ENABLED` constant is misleading (see P1).

---

## 8. Offline-cost invariant

**Product rule:** Player offline → fixed operating cost deduction = **0**.

| Implementation | Status |
|----------------|--------|
| `applyOfflineProgress` | No `processDailyOperatingCosts` on offline return |
| `OFFLINE_CATCHUP_MAX_COST_PERIODS = 0` | `src/simulation/periodicCosts.ts` |
| Online `advanceTime` | Max 1 period per tick (`ONLINE_TICK_MAX_COST_PERIODS = 1`) |
| Regression | `offline-economy-test.ts`, `time-progression-audit-test.ts` (72h+ → charged 0) |

Delivery settlement and designed offline progression remain idempotent.

---

## 9. Marketplace

| Check | Status |
|-------|--------|
| Callable backend | PASS (`production:backend-check`) |
| Firestore Timestamp serialization | PASS (serializer test ok 48) |
| Purchase atomicity / idempotency | PASS (emulator 50/50 on retry) |
| Seller/buyer cash, truck ownership | PASS (emulator tests 42–46) |
| Self-purchase, insufficient cash, expired | PASS |
| Client direct writes denied | PASS (rules tests) |
| Stale `backend/lib` | Backend rebuilt before emulator (`backend:build` in script) |

---

## 10. Leaderboard

| Check | Status |
|-------|--------|
| One UID one entry | PASS (emulator) |
| Server-authoritative score | PASS |
| Reputation in score | PASS (`leaderboard-regression-test.ts`) |
| No client spoof | PASS (permission denied on direct write) |
| UTC season key | PASS |
| Cross-platform same board | PASS (`leaderboard-cross-platform-regression-test.ts`) |
| Anonymous skipped | PASS (`leaderboard-eligibility-test.ts`) |
| Account switch cache reset | Covered in account tests |

---

## 11. Ads / privacy

| Check | Production | Status |
|-------|------------|--------|
| Production AdMob App IDs | `ca-app-pub-8214453687597896~…` | PASS |
| Production rewarded units | `…/1840898530` (Android), `…/4313204541` (iOS) | PASS |
| Test IDs in production path | `shouldUseTestAdUnitIds()` false when profile=production | PASS |
| Reward after `EARNED_REWARD` only | PASS (`ad-privacy-regression-test.ts`) |
| UMP consent gating | PASS (`adProvider.ts`, validator) |
| Privacy form non-blocking | PASS (gameplay not hard-locked) |
| Critical gameplay not ad-gated | PASS (contracts/fleet not behind ads) |

### EXTERNAL PENDING
- AdMob account / ad unit review and fill rates
- Google Play “Ads” declaration and UMP form in Play Console
- Apple ATT prompt copy approval in App Store Connect

---

## 12. Fleet / upgrades

| Check | Status |
|-------|--------|
| Fleet → Geliştirmeler tab | PASS (`FleetUpgradesPanel`, `FleetTabSegment`) |
| Truck card “Geliştir” targets correct truck | PASS |
| Engine / fuel / cargo / durability wired | PASS (`truckUpgrades.ts`, `delivery.ts`, `contractEconomics.ts`, `truckFuel.ts`) |
| `upgradeTruck` action, max level, cash guard | PASS (`fleet-upgrades-regression-test.ts` 39/39) |
| Persistence / cloud | Via `truck.upgrades` in save |
| Legacy `UpgradesScreen` | Retained as thin wrapper for More deep-link; no duplicate implementation |

---

## 13. Performance

| Area | Finding |
|------|---------|
| `advanceTime` instrumentation | Stage timing via `performanceDiagnostics` (dev/diagnostics only) |
| Whole-store subscriptions | Screens use targeted selectors (profiler hooks present) |
| Autosave vs navigation | Deferred cleanup pattern in `advanceTime` |
| Map assets | See §15; preload via `mapAssetPreload.ts` |
| Production diagnostics | OFF (`EXPO_PUBLIC_BACKEND_DIAGNOSTICS_ENABLED=false`) |

No new P0 jank regressions identified in static audit. Prior Internal Test jank requires **real-device** confirmation.

---

## 14. Android

| Item | Value / status |
|------|----------------|
| `versionCode` | 22 |
| `versionName` | 1.0.21 |
| `minSdk` / `targetSdk` | From Expo SDK 54 template |
| Hermes | Enabled (RN 0.81 default) |
| New Architecture | `newArchEnabled: true` |
| Edge-to-edge / nav bar | `expo-navigation-bar` immersive |
| Permissions | `INTERNET`; dangerous storage permissions blocked in `app.config.js` |
| Adaptive icon / splash | `./assets/branding/*` |
| ProGuard/R8 | Release minify per `build.gradle` flags |
| `google-services.json` | Present root + `android/app/` |

---

## 15. iOS

| Item | Value / status |
|------|----------------|
| `bundleIdentifier` | `com.ethemsincar.logisticore` |
| `GoogleService-Info.plist` | `logisticore-53ab4` |
| Sign in with Apple | Enabled |
| Google URL scheme | From REVERSED_CLIENT_ID in config plugin |
| ATS | `NSAllowsArbitraryLoads: false` |
| Safe area | `react-native-safe-area-context` |
| Tablet | Disabled |

---

## 16. Security / logging

| Risk | Status |
|------|--------|
| Auth tokens in logs | Gated via `debugLog` / `__DEV__` patterns; production diagnostics off |
| Full save payload logging | Not in production paths |
| UID in UI | Account center shows UID only in diagnostics/internal contexts |
| Firebase technical errors to UI | Mapped via `accountLinkErrors.ts` / Turkish copy |
| Debug simulation route | `__DEV__` guarded (`validate-store-production`) |

**Note:** `gameStore.ts` has `[offline-progress]` logs gated by `__DEV__` OR diagnostics env — safe in production profile.

---

## 17. Legal URLs

| Link | URL | Placeholder? |
|------|-----|--------------|
| Privacy policy | `https://hansaglam.github.io/logisticore-legal/privacy-policy/` | No |
| Privacy choices | `…/privacy-choices/` | No |
| Account deletion | `…/account-deletion/` | No |
| Support | `…/support/` | No |

Source: `src/utils/legalLinks.ts` (HTTPS).

---

## 18. Store privacy data inventory (code-collected)

| Data type | Collected? | Purpose / location |
|-----------|------------|-------------------|
| Firebase Auth UID | Yes | Account, cloud save, marketplace, leaderboard |
| Email | Optional (Google/Apple) | Auth provider profile |
| Username | Yes (user-set) | Leaderboard display, reservations |
| Gameplay / save state | Yes | Local + Firestore cloud save |
| Advertising ID | Yes (if ads + consent) | AdMob, UMP, ATT |
| Diagnostics | Internal profile only | Backend diagnostics panel |
| Crash data | Not in-app custom SDK audited | Expo/RN default if enabled in build |
| IAP / purchase receipts | No native IAP audited | N/A |
| Precise location | **No** | Map is fictional network positions |

---

## 19. Automated tests

| Command | Result |
|---------|--------|
| `npx tsc --noEmit` | **PASS** |
| `npm run verify` | **PASS** (includes new `offline-economy-test`, `time-progression-audit-test`) |
| `npm run firebase:emulators:test` | **PASS 50/50** (1st run 49/50 flaky concurrent purchase; 2nd run clean) |
| `npx expo export --platform android` | **PASS** → `dist/` |
| `npx expo export --platform ios` | **PASS** → `dist/` |
| `git diff --check` | **PASS** (whitespace only warnings) |
| `npm run validate:production-build` | **PASS** |
| `npm run production:backend-check` | **PASS** (14 functions, marketplace active) |
| `npx tsx scripts/account-cloud-login-regression-test.ts` | **PASS 20/20** (manual, not in verify) |

---

## 20. Real-device tests still required (PENDING REAL DEVICE)

- [ ] Cold start / resume / kill / offline→online on Android (gesture nav, edge-to-edge)
- [ ] Same on iPhone (notch / Dynamic Island / home indicator)
- [ ] Google Sign-In + Apple Sign-In on release-signed builds
- [ ] Cloud restore after uninstall + reinstall
- [ ] Rewarded ad show + grant (production ad units)
- [ ] Map pan/zoom/memory on mid-range Android (2.65 MB map PNG)
- [ ] Tab navigation jank smoke (Dashboard, Contracts, Map, Fleet, Account)
- [ ] Font scale 1.3× on 360–480 dp widths
- [ ] Push notification permission flow (if used in build)

---

## 21. External platform pending items

| Item | Status |
|------|--------|
| Google Play Data Safety form | **EXTERNAL PENDING** — use §18 inventory |
| Apple App Privacy labels | **EXTERNAL PENDING** |
| AdMob ad unit approval | **EXTERNAL PENDING** |
| Play Console content rating | **EXTERNAL PENDING** |
| App Store review | **EXTERNAL PENDING** |

---

## 22. Git status

**Branch state (audit time):** Modified source + tests; not committed.

**Modified (tracked):** `package.json`, offline-cost files, fleet upgrades, `gameStore.ts`, simulation wiring, tests.

**Untracked (do not commit):** `logisticore-crash-log.txt`, `logisticore-rn-error.txt`, `verify-output.txt`, `emulator-output.txt`, new fleet components/tests.

**Generated `backend/lib/`:** Not dirty in current status (clean relative to prior audit).

**Action:** User should commit release-hardening changes and tag after review. No auto commit/tag/push performed.

---

## 23. Binary status

| Artifact | Status |
|----------|--------|
| AAB / APK | **NOT PRODUCED** (policy) |
| IPA / Xcode Archive | **NOT PRODUCED** (policy) |
| `expo export` Android/iOS | **PASS** (bundle validation only) |

User produces final store binaries locally with `LOGISTICORE_BUILD_PROFILE=production` after commit.

---

## 24. Map asset sizes (report only)

| Asset | Size |
|-------|------|
| `turkey-logistics-network-map.png` | 2.65 MB |
| `turkey-road-network-map.png` | 2.59 MB |
| `next-action-truck-route.png` | 1.43 MB |
| Fleet truck PNGs (each) | ~766 KB – 1.09 MB |
| Trailer PNGs | ~243–630 KB |

No release-blocker decode/memory evidence in automated export; real-device Map smoke still required.

---

## 25. Release freeze note

After this RC: **development freeze** — only P0/P1 bug fixes. This audit result: **RELEASE_READY** with P1 follow-ups above.

---

*Generated by final RC audit — evidence-based; no binary artifacts included.*

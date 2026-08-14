# LogistiCore — Final Pre-Build Report

**Date:** 2026-08-14  
**Version target:** 1.0.21 / Android `versionCode` 22  
**Binary policy:** No AAB/APK/IPA produced in this pass

---

## FINAL PRE-BUILD STATUS: **BLOCKED**

**Blocker:** Firebase emulator marketplace concurrent-purchase test failed **1 of 5** consecutive runs (`INVALID_ARGUMENT: Transaction is invalid or closed`). Requirement was **5/5 PASS** before final binary.

---

## Validation matrix

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | **PASS** |
| `npm run verify` | **PASS** (includes `account-cloud-login-regression-test`) |
| `account-cloud-login` in verify chain | **YES** — `scripts/account-cloud-login-regression-test.ts` (20/20) |
| `npm run firebase:emulators:test` ×5 | **4/5 PASS** — see below |
| `npx expo export --platform android` | **PASS** |
| `npx expo export --platform ios` | **PASS** |
| `npm run validate:production-build` | **PASS** |
| `npm run production:backend-check` | **PASS** |
| `git diff --check` | **PASS** (line-ending warnings only) |
| Offline 72h fixed cost = 0 | **PASS** (`offline-economy-test.ts`) |
| Production diagnostics | **OFF** in `.env.production` (`EXPO_PUBLIC_BACKEND_DIAGNOSTICS_ENABLED=false`) |

### Emulator 5-run result

| Run | Result | Notes |
|-----|--------|-------|
| 1 | **FAIL** | `concurrent double purchase` — `3 INVALID_ARGUMENT: Transaction is invalid or closed.` |
| 2 | PASS 50/50 | |
| 3 | PASS 50/50 | |
| 4 | PASS 50/50 | |
| 5 | PASS 50/50 | |

**Required fix before READY_FOR_FINAL_BINARY:** Harden `purchaseVehicleListingTransaction` concurrent path or emulator test retry policy (backend `backend/src/vehicleMarketplace.ts`, test `backend/test/vehicleMarketplace.emulator.test.ts`).

---

## Changes this pass

### 1. Account cloud test in verify
- Added `npx tsx scripts/account-cloud-login-regression-test.ts` to `package.json` `verify` (after `account-switch-flow-test`).

### 2. Cloud save flag drift
- **Removed** obsolete `CLOUD_SAVE_AUTO_RESTORE_ENABLED` constant (unused at runtime; dead import in `DebugSimulationScreen`).
- **Added** comment in `backendRoadmap.ts`: auto-restore lives in `accountCloudLogin.runPostSignInSaveFlow` + `isMeaningfulLocalSave`.
- **No** cloud restore logic changed.

### 3. iOS buildNumber
- **MANUAL REQUIRED** — `app.json` / `app.config.js` have no `expo.ios.buildNumber`; no `eas.json`; no App Store Connect history in repo.
- **Verified in repo:** Android `versionCode` **22** @ `1.0.21` (`app.json`, `android/app/build.gradle`).
- **Action:** Set `expo.ios.buildNumber` to next unused integer in App Store Connect before TestFlight upload (do not assume `22` without ASC confirmation).

### 4. `.gitignore` hygiene
Added (diagnostic only):
- `verify-output.txt`
- `emulator-output.txt`
- `logisticore-*.txt`

Source/test files are **not** ignored.

### 5. Performance optimizations (static audit)
Present in source tree (not device-verified):

| Optimization | File(s) |
|--------------|---------|
| Contract schedule fast path | `contracts.ts` (`canSkipContractScheduleTick`), `gameStore.ts` |
| Save single stringify + checksum shallow path | `saveGame.ts`, `saveIntegrity.ts` |
| Lifecycle save flush | `gameStore.ts` (`flushLifecycleSave`), `App.tsx` |
| Offline cost = 0 on catch-up | `periodicCosts.ts`, `gameStore.ts` |

**Performance status:** **PENDING PERFORMANCE REAL DEVICE** — baseline 53–59 ms `advanceTime` not re-measured on Android in this session.

---

## Git status — file classification

### A) MUST COMMIT (release source + tests + audit docs)

**Modified:**
- `.gitignore`
- `App.tsx`
- `package.json`
- `scripts/contract-generation-reliability-test.ts`
- `scripts/core-game-production-readiness-test.ts`
- `scripts/offline-economy-test.ts`
- `scripts/performance-regression-test.ts`
- `scripts/time-progression-audit-test.ts`
- `scripts/warehouse-system-test.ts`
- `src/config/backendRoadmap.ts`
- `src/config/balance.ts`
- `src/screens/DebugSimulationScreen.tsx`
- `src/screens/FleetScreen.tsx`
- `src/screens/UpgradesScreen.tsx`
- `src/simulation/contractEconomics.ts`
- `src/simulation/contracts.ts`
- `src/simulation/delivery.ts`
- `src/simulation/periodicCosts.ts`
- `src/simulation/truckUpgrades.ts`
- `src/storage/saveGame.ts`
- `src/store/gameStore.ts`
- `src/tutorial/app/definitions.ts`
- `src/utils/saveIntegrity.ts`
- `src/utils/truckFuel.ts`

**Untracked (must add):**
- `src/components/fleet/FleetTabSegment.tsx`
- `src/components/fleet/FleetUpgradesPanel.tsx`
- `scripts/fleet-upgrades-regression-test.ts`
- `scripts/save-checksum-regression-test.ts`
- `docs/release-audit/FINAL_RELEASE_READINESS.md`
- `docs/release-audit/PERFORMANCE_OPTIMIZATION_REPORT.md`
- `docs/release-audit/FINAL_PRE_BUILD_REPORT.md` (this file)

### B) MUST NOT COMMIT / diagnostic

Now gitignored (local only):
- `verify-output.txt`
- `emulator-output.txt`
- `logisticore-crash-log.txt`
- `logisticore-rn-error.txt`

### C) GENERATED / already ignored

- `dist/` (expo export)
- `backend/lib/`
- `node_modules/`
- `.env`, `.env.production`, `.env.internal`
- `android/app/build/`

---

## Remaining REAL DEVICE items

- [ ] Android perf re-profile (`contract-schedule`, `[perf-save]`) after optimizations
- [ ] iOS `buildNumber` set from App Store Connect history
- [ ] TestFlight / Internal Test smoke (auth, cloud restore, ads)
- [ ] Final signed AAB/IPA build (user-owned step)

---

## Path to READY_FOR_FINAL_BINARY

1. Fix or stabilize marketplace concurrent purchase emulator test (**5/5**).
2. Commit all **MUST COMMIT** files (single release commit recommended).
3. Set iOS `buildNumber` after ASC check.
4. Optional: Android perf confirmation on diagnostic Internal build.

No binaries were produced in this pass.

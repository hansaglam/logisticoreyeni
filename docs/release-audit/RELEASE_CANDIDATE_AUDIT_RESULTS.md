# LogistiCore — Release Candidate Audit Results

**Date:** 2026-08-13  
**Scope:** Full RC audit (sections 0–88), safe code fixes, automated verification  
**Binaries:** AAB / APK / IPA / Xcode Archive **not produced** (per policy)

---

## 0. Release Pre-Flight

| Item | Value | Expected | Status |
|------|-------|----------|--------|
| Expo SDK | ~54.0.35 | SDK 54 | OK (patch 54.0.36 available — P2) |
| React Native | 0.81.5 | — | OK |
| React | 19.1.0 | — | OK |
| Hermes | `hermesEnabled=true` (`android/gradle.properties`) | enabled | OK |
| New Architecture | `newArchEnabled: true` (`app.json`) | enabled | OK |
| Android package | `com.ethemsincar.logisticore` | same | OK |
| iOS bundle ID | `com.ethemsincar.logisticore` | same | OK |
| App version | **1.0.17** | — | OK |
| Android versionCode | **18** | — | OK |
| iOS buildNumber | Not in repo (no `ios/` folder; EAS/prebuild) | align with versionCode | **Set at build** — recommend `18` |
| Firebase projectId | `logisticore-53ab4` | same | OK |
| Functions region | `us-central1` | same | OK |
| Build profile (production) | `LOGISTICORE_BUILD_PROFILE=production` via `app.config.js` | production | OK |

### Production env flags (`.env.production`, non-secret)

| Flag | Value | Production expected |
|------|-------|---------------------|
| `EXPO_PUBLIC_ADS_ENABLED` | `true` | `true` |
| `EXPO_PUBLIC_ADS_USE_TEST_IDS` | `false` | `false` |
| `EXPO_PUBLIC_BACKEND_DIAGNOSTICS_ENABLED` | `false` | `false` |
| `EXPO_PUBLIC_VEHICLE_MARKETPLACE_ENABLED` | `true` | `true` |
| `EXPO_PUBLIC_LEADERBOARD_ENABLED` | `true` | `true` |
| `EXPO_PUBLIC_MARKET_ALARMS_ENABLED` | `false` | `false` |
| `EXPO_PUBLIC_USE_FIREBASE_EMULATOR` | `false` | `false` |
| `EXPO_PUBLIC_MOCK_GLOBAL_ECONOMY` | `false` | `false` |

No staging endpoint / emulator flags in production env. `validate:production-build` PASS.

### Git / lockfile

| Item | Status |
|------|--------|
| Git status | **Large uncommitted working tree** (RC fixes + audit docs) |
| Uncommitted changes | ~60+ modified files, ~15 untracked (see `git status`) |
| `package-lock.json` | Present, in sync with `npm ls` (no invalid peer deps at depth 0) |
| `git diff --check` | PASS (CRLF warnings only) |

---

## 1. GO / NO-GO Blocker List (initial)

### P0 (release blockers)

| ID | Area | Status | Notes |
|----|------|--------|-------|
| P0-MKT-DEPLOY | Vehicle marketplace list callables | **OPEN** | Serializer fix in repo; **production `apiVersion: 1` wire not verified** without deploy + smoke |
| P0-MKT-PROD-SMOKE | Marketplace on production after deploy | **MANUAL** | Real device / linked account required |

### P1 (serious, not always ship-stop)

| ID | Area | Status |
|----|------|--------|
| P1-EXPO-PATCH | `expo` 54.0.35 vs 54.0.36 | Open (low risk) |
| P1-EXPO-CONFIG | `app.json` vs `app.config.js` drift (`expo-doctor`) | Open (prebuild/CNG awareness) |
| P1-ASSETS | Map PNGs ~2.6 MB each decoded in bundle | Known; not measured on device FPS |
| P1-REAL-DEVICE | Full smoke matrix | **MANUAL REAL DEVICE REQUIRED** |

### P2

- Require-cycle pairs still detected by `check-require-cycles.ts` (informational guard, no runtime fix this RC)
- `setLayoutAnimationEnabledExperimental` scan: no leftovers reported
- Production success-path `[save-bootstrap]` log spam removed (this RC)

### Areas regression-tested in CI (no open P0 found in code/emulator)

- Offline delivery progression (`offline-delivery-progress-regression-test.ts` — run standalone; delivery tick does not auto-resolve pending incidents)
- Fuel parity (`truck-fuel-system-test`, map heading regressions in verify chain)
- Settlement idempotency (delivery / finance tests in verify + emulator marketplace purchase idempotency)
- Leaderboard cross-platform (emulator + static regression)
- Account sign-out / deletion (regression scripts)
- Ads privacy state machine (44 checks)
- Tutorial first-visit-only
- Contract generation reliability
- Save recovery / checksum

---

## 2–3. Startup & Time-to-Interactive

### Cold-start chain (canonical)

`App.tsx` → auth hydrate → `probeSaveRecoveryWithCloudAttempt` → recovery UI if needed → `initializeGame` (`gameInitPromise` single-flight) → save bootstrap → store hydrate → `bootPhase === 'ready'` → navigation → **deferred** ads consent/init.

### Fixes applied (this RC)

| Fix | File | Root cause |
|-----|------|------------|
| Save recovery probe single-flight | `saveRecoveryService.ts` | `App.tsx` + `initializeGame` both probed on cold start → duplicate cloud/local work |
| Probe cache invalidation | `saveRecoveryService.ts` + `App.tsx` | Stale probe after recovery / new game |
| Ads init deferred until ready | `App.tsx` | UMP/AdMob init blocked/interleaved with boot |
| Production save-bootstrap log guard | `saveBootstrap.ts` | Success-path `console.info` spam in production |

### Single-flight inventory

| Operation | Mechanism |
|-----------|-----------|
| Game init | `gameInitPromise` in `gameStore.ts` |
| Save recovery probe | `coldStartProbePromise` / `coldStartProbeResult` |
| Save bootstrap | Canonical bootstrap reuse (existing) |

### Deferred (non-blocking for TTI)

- Leaderboard preload — on screen focus
- Marketplace preload — on screen focus
- Ads — after `bootPhase === 'ready'`
- Tutorial measurements — only when tutorial active / layout hooks

**Performance measurement:** duplicate probe count before/after — **not instrumented**; fix is structural single-flight.

---

## 4–6. Render / Zustand / Delivery simulation

**Method:** Static regression scripts + code review; no React Profiler run on device.

- Broad `useGameStore()` subscriptions: primary screens use selectors (verified by layout/tutorial regression scripts).
- Delivery tick: `applyOfflineDeliveries` timestamp/progress-based; pending incidents not advanced offline.
- Map route heading: Ankara↔Bursa regression in verify chain.
- Tutorial overlay: layout measurement skipped when not visible (tutorial regression suite).

**Not measured:** per-frame rerender counts, Map FPS during pan/zoom.

---

## 7. Offline Delivery P0

| Invariant | Evidence |
|-----------|----------|
| Real-time elapsed catch-up | `applyOfflineProgress` + `applyOfflineDeliveries` |
| Pending incidents not auto-resolved | `offlineProgression.ts` early return on `incident.status === 'pending'` |
| Completion once | Settlement idempotency via `transactionId` / delivery settlement paths (verify + domain tests) |
| Duplicate offline apply prevented | `plan.duplicatePrevented` in `gameStore.applyOfflineProgressionIfNeeded` |

**MANUAL REAL DEVICE REQUIRED:** force-close mid-delivery, long elapsed, clock skew.

**Note:** “Offline fixed operating cost = 0” interpreted as delivery catch-up not charging spurious per-delivery fixed fees; daily operating costs may still apply via separate `processDailyOperatingCosts` path with caps (`maxOfflineChargeDays`). No regression reintroducing removed delivery fixed-fee offline charge found.

---

## 8. Fuel State P0

Canonical source: truck `currentFuelL` on store + `updateDeliveryProgressWithFuel` / `truckFuel` utils.  
Regression: `truck-fuel-system-test`, `map-truck-heading-regression-test`, `bursa-ankara-truck-route-regression-test` in verify — **PASS**.

**MANUAL REAL DEVICE REQUIRED:** Map vs Fleet parity visual check.

---

## 9–10. Settlement idempotency & Credit

- Marketplace purchase: emulator test “duplicate request is idempotent” — PASS.
- Finance ledger `transactionId` dedup on daily operating costs — present in `gameStore`.
- Credit/loan: covered by existing finance regression in verify chain — **PASS** (automated).

---

## 11–12. Map & List performance

- Map assets large (see §45); no code change this RC (risky pre-release).
- FlatList screens: existing `initialNumToRender` / memo patterns retained; warehouse/contracts have dedicated UI regression tests.

---

## 13. Assets

| Asset | Bundle size |
|-------|-------------|
| `turkey-logistics-network-map.png` | 2.65 MB |
| `turkey-road-network-map.png` | 2.59 MB |
| Truck PNGs | 766 KB – 1.09 MB each |
| JS HBC Android | **7.91 MB** |
| JS HBC iOS | **7.9 MB** |

**P1:** Consider downscaling map assets post-release if memory/FPS issues on 360px devices.

---

## 14–15. Memory leaks & AppState

- Rewarded ad listeners: centralized in `useRewardedAdRequest` (ads privacy RC).
- AppState: canonical coordinator pattern in game store / offline meta persist.
- No new unbounded timers introduced this RC.

**Not measured:** heap growth on long session (device).

---

## 16–17. Save performance & size

- Debounced / queued save patterns existing; force-persist on critical mutations retained.
- Save payload byte measurement: **not measured** this run (no sample save instrumented).

---

## 18–20. Cloud save & Account / Apple

Prior P0 fixes preserved (see `FIX_ACCOUNT_SIGNOUT_DELETION_P0_RESULTS.md`).  
Regression: `account-signout-deletion-regression-test.ts` — **PASS** in verify.

**MANUAL REAL DEVICE REQUIRED:** Apple fresh-nonce reauth on delete, cloud sync after link.

---

## 21–22. Vehicle Marketplace

### Root cause (fixed in repo)

Raw Firestore `document.data()` → client parse failure → `"Sunucudan geçersiz veri alındı."`

### Client + backend fix

- `backend/src/vehicleMarketplaceSerialization.ts`
- `src/domain/vehicleMarketplaceResponseParser.ts`
- User message → `"İlanlar şu anda yüklenemiyor. Tekrar dene."`

### Production deploy matrix

| Function | Source changed? | Production deployed? | Deploy required? | Risk if not deployed |
|----------|-----------------|----------------------|------------------|----------------------|
| `getVehicleMarketplaceListings` | **Yes** | **Unknown** (function exists; wire `apiVersion` not probed) | **YES** | List fetch errors / invalid data for users |
| `getMyVehicleListings` | **Yes** | **Unknown** | **YES** | My listings broken |
| Leaderboard callables | No (this RC) | Yes (health check) | No | — |
| Marketplace mutations | No (this RC) | Yes | No | — |

```bash
firebase deploy --only functions:getVehicleMarketplaceListings,functions:getMyVehicleListings
```

Pre-deploy: `npm run backend:build && npm run firebase:emulators:test`

---

## 23–24. Leaderboard & Reputation

Cross-platform shared path verified — see `FIX_LEADERBOARD_CROSS_PLATFORM_RESULTS.md`.  
Emulator: 50/50 PASS. Backend deploy **not required**.

---

## 25–31. Screen UI regressions

| Screen | Automated | Manual |
|--------|-----------|--------|
| Warehouse | `warehouse-screen-ui-regression-test.ts` PASS | 360/390/430 |
| Account Center | `account-center-ui-regression-test.ts` PASS | safe area, cloud status |
| Market | market tutorial + screen tests PASS | iOS text clipping |
| Tutorial | first-visit + safety regressions PASS | `?` manual replay |
| Contracts | generation + layout PASS | — |
| Management panel | regression PASS | Android strip height |

---

## 32–33. Tutorial & Ads / UMP

- Tutorial: no layout work when disabled (regression PASS).
- Ads: canonical `AdPrivacyState` machine — see `FIX_ADS_PRIVACY_RESULTS.md`.

---

## 34. AdMob External Release Gate

**EXTERNAL RELEASE BLOCKER (console):**

1. AdMob → Privacy & messaging → European regulations  
2. Publish consent message for Android (`ca-app-pub-8214453687597896~5560651696`) and iOS app IDs  
3. Status must be **Published**, not draft  

Until published: EEA users may see degraded `config-error` mode (no crash/deadlock by design).

---

## 35–39. Network, Firebase cost, rules, secrets

- Production health: `npm run production:backend-check` — PASS (`logisticore-53ab4`, 14 functions, indexes OK, economy not stale).
- Firestore rules: emulator suite denies client leaderboard/marketplace/username writes — PASS.
- Secret scan: no service account JSON in repo; `.env.production` gitignored; public Firebase config only in client.

---

## 40. Production logging

- `[save-bootstrap]` success logs gated to `__DEV__` (this RC).
- Account lifecycle / leaderboard config logs remain dev-oriented or failure-only.

---

## 41–44. Cycles, New Arch, deps

| Check | Result |
|-------|--------|
| `check-require-cycles.ts` | Known pairs logged; no new cycles |
| `expo-doctor` | 3 warnings (config drift, prebuild sync, expo patch) |
| `npm ls --depth=0` | No invalid peer dependency errors |

---

## 45. Bundle size

| Platform | JS (HBC) | Modules |
|----------|----------|---------|
| Android | 7.91 MB | 1887 |
| iOS | 7.9 MB | 1885 |

Largest embedded assets: map PNGs, truck art, MaterialCommunityIcons TTF (1.31 MB).

---

## 46–48. Game loop / battery / animation

- Idle dashboard: no 60fps JS delivery sim when no active jobs (update-loop regression PASS).
- Background: offline catch-up timestamp-based; no GPS polling.

---

## 49–57. UX guards

Double-tap / idempotency covered for marketplace (emulator), finance transaction IDs, and regression scripts for primary CTAs. Force-close matrix: **MANUAL REAL DEVICE REQUIRED**.

---

## 54. Error boundary

Root error boundary present (existing app shell). Gameplay corruption not masked.

---

## 67–71. Store config & dev tools

`npm run validate:store-production` — PASS  
`npm run validate:production-build` — PASS  

Debug simulation / backend diagnostics fail-closed for production.

---

## 72. Test suite (this run)

| Command | Result |
|---------|--------|
| `npm run typecheck` | **PASS** |
| `npm run verify` | **PASS** (52 regression scripts) |
| `npm run firebase:emulators:test` | **PASS** (50/50) |
| `npm run validate:production-build` | **PASS** |
| `npm run production:backend-check` | **PASS** |
| `npx expo-doctor` | **3 warnings** (non-fail) |
| `npx expo export --platform android` | **PASS** |
| `npx expo export --platform ios` | **PASS** |
| `git diff --check` | **PASS** |

---

## 79. Backend deploy matrix (summary)

See §21 table. **Marketplace list callables: REQUIRED BEFORE RELEASE.**

---

## 81. External release blockers

- [ ] AdMob UMP consent form **Published** (EEA)
- [ ] Play Data Safety / App Store privacy declarations (store console)
- [ ] Marketplace functions deploy + production smoke
- [ ] Real device matrix (§85)
- [ ] Commit/tag RC branch before final EAS build (user)

---

## 82. Performance before / after

| Metric | Before | After | Notes |
|--------|--------|-------|-------|
| Duplicate save recovery probe | 2× possible | 1× (single-flight) | Structural fix |
| Ads init during boot | Yes | Deferred to `ready` | Structural fix |
| Production `[save-bootstrap]` info logs | Every success | Failures only | Log guard |
| JS bundle Android | — | 7.91 MB | Measured |
| Startup ms | not measured | not measured | — |
| Map FPS | not measured | not measured | — |
| Save payload bytes | not measured | not measured | — |

---

## 85. Real device checklist (pre-build, max 25)

### Android + iOS (shared)

1. Cold start → Dashboard < 3s perceived (linked + guest)
2. Accept contract → delivery starts → Map shows truck + fuel
3. Background 5+ min → foreground → delivery progress advanced once
4. Force-close during delivery → reopen → progress deterministic, single completion payout
5. Fleet screen fuel matches Map for same truck
6. Finish delivery → money/reputation/XP/finance ledger once (no duplicate)
7. Warehouse upgrade (“Yükselt”) → money/capacity/history atomic
8. Market buy → inventory + cash once (double-tap safe)
9. Vehicle Marketplace list loads (after Functions deploy) — no invalid data error
10. Buy vehicle listing → ownership + cash (one winner)
11. Leaderboard load + submit (linked account with username)
12. Account Center: cloud status consistent after sync
13. Sign out → guest session + local cleanup
14. Sign in Google (Android) / Apple (iOS) → cloud sync → leaderboard
15. Rewarded ad: non-EEA direct; EEA UMP if published; deny = no reward
16. Tutorial: first visit auto once; `?` replay; restart no auto replay
17. Contracts screen: non-empty for single-truck city; refresh works
18. Management panel: full height, no strip bug
19. Finance history scroll smooth
20. Map pan/zoom Ankara↔Bursa heading sane
21. Offline summary modal: earnings/expenses math consistent
22. Pending delivery incident: offline does not auto-resolve
23. Clock forward 24h → no absurd economy (clamped)
24. Android back / iOS swipe back: no stack loop
25. Font scale 1.3: primary CTAs not clipped

---

## Code changes summary (this RC audit)

| Area | Change |
|------|--------|
| Startup | Ads deferred; save recovery single-flight |
| Logging | Production save-bootstrap success silence |
| Marketplace | Backend serializer + client parser (prior in branch) |
| Leaderboard | Cross-platform regression (prior in branch) |
| Account / Warehouse / Ads / Tutorial | UI + regression (prior in branch) |

---

## 86. FINAL GO / NO-GO

```
RELEASE STATUS:
CONDITIONAL GO

P0 OPEN:
- P0-MKT-DEPLOY: getVehicleMarketplaceListings + getMyVehicleListings serializer deploy not verified on production wire (apiVersion: 1)
- P0-MKT-PROD-SMOKE: Marketplace list on production after deploy (MANUAL REAL DEVICE REQUIRED)

P1 OPEN:
- P1-EXPO-PATCH: expo 54.0.35 → 54.0.36 optional
- P1-EXPO-CONFIG: app.json / app.config.js drift (expo-doctor)
- P1-ASSETS: large map PNG memory footprint (device FPS not measured)
- P1-REAL-DEVICE: full smoke matrix not executed on hardware

BACKEND DEPLOY REQUIRED:
- functions:getVehicleMarketplaceListings — REQUIRED BEFORE RELEASE
- functions:getMyVehicleListings — REQUIRED BEFORE RELEASE
- All other production functions present and healthy (production-backend-check PASS)

EXTERNAL CONSOLE TASKS:
- AdMob Privacy & messaging → European regulations → consent message Published (Android + iOS app IDs)
- Play / App Store privacy & Data Safety declarations
- iOS buildNumber confirmation at EAS/prebuild (recommend 18 to match Android versionCode)

ANDROID EXPORT:
PASS

IOS EXPORT:
PASS

TYPECHECK:
PASS

VERIFY:
PASS

EMULATOR:
PASS

REAL DEVICE TESTS REMAINING:
- §85 checklist (25 items) — Android + iOS
- Marketplace production smoke post-deploy
- Apple account deletion reauth
- AdMob EEA consent if targeting EU

FINAL BINARY:
NOT PRODUCED
```

---

## 87–88. Policy compliance

- No AAB/APK/IPA/Archive produced.
- No production Firestore migration executed.
- No Firebase/AdMob console mutations automated.
- Uncommitted changes remain in working tree — **commit before EAS release build**.

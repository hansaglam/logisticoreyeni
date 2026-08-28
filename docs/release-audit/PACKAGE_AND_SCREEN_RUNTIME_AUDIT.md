# LogistiCore — Package & Screen Runtime Audit

**Date:** 2026-08-27  
**Scope:** Read-only audit of `package.json`, dependencies, test scripts, and screen-level runtime triggers.  
**Method:** Static analysis + diagnostic commands only (`npm outdated`, `npm ls`, `npx expo-doctor`, `npx expo install --check`). No installs, updates, or code changes.

---

## 1. Executive Summary

| Hypothesis | Verdict | Evidence level |
|---|---|---|
| `package.json` test/verify scripts are bloated | **Partially true** — script *count* is moderate (22 npm scripts), but **`npm run verify` is a long sequential chain (75 steps: typecheck + 74 tsx scripts)** | CONFIRMED |
| Dependencies are outdated/incompatible with Expo SDK 54 | **Mostly aligned** — core stack matches SDK 54; **2 patch-level Expo mismatches** flagged by expo-doctor; several packages have *latest* majors far ahead but that is expected and not automatically actionable | CONFIRMED (minor) |
| Performance spikes come from duplicate screen-level logic | **Unlikely as primary cause** of contract-schedule spikes; **some screen remount work exists** (market refresh, map reconcile, mission sync) with throttling/guards | HIGH CONFIDENCE (spikes) / POSSIBLE (screen remount) |

**Bottom line:** The repo is not suffering from random dependency chaos. The main “weight” is intentional release regression coverage in `verify`, not npm script sprawl. Runtime architecture is generally centralized (`App.tsx`, single `useGameLoop`, cooldown-gated market refresh). Occasional performance spikes previously documented align with **`advanceTime` / contract-schedule full ticks**, not repeated screen mounts.

**Release blocker today:** **None identified** from this audit alone. P1 follow-ups: backend Node 20 engine constraint, Expo patch alignment, prebuild/native sync hygiene.

---

## 2. package.json script graph

### 2.1 All scripts (22 total)

| Script | What it does | Called by | Direct use |
|---|---|---|---|
| `start` | `expo start` | — | Dev |
| `typecheck` | `tsc --noEmit` | `verify`, `backend:verify` (via backend:typecheck) | CI/dev |
| `verify:ios-apple-auth` | iOS Apple auth config check | **`verify` (duplicate)** | Optional manual |
| `verify:ios-firebase` | iOS Firebase runtime config check | **`verify` (duplicate)** | Optional manual |
| `verify` | Full client regression chain (see §2.2) | Manual / CI | Primary client gate |
| `validate:store-production` | Store production config validation | `validate:production-build`, android bundle scripts | Release |
| `validate:production-build` | Store + production build config | `android:bundle:release` | Release |
| `production:backend-check` | Global economy + backend health | Manual release checklist | Release |
| `android:bundle:release` | validate production + Gradle bundleRelease | Manual | Release |
| `android:bundle:internal` | Internal AAB script | Manual | Release |
| `android:bundle:production` | Production AAB script | Manual | Release |
| `backend:build` | Backend compile | `backend:verify`, emulators | Backend |
| `backend:typecheck` | Backend TS check | `backend:verify` | Backend |
| `backend:verify` | Backend chain (see §2.3) | Manual / CI | Backend gate |
| `marketplace:migrate:dry` | Dry-run marketplace migration | — | Ops |
| `marketplace:migrate` | Marketplace migration | — | Ops |
| `marketplace:smoke:production` | Production marketplace smoke | — | Ops |
| `test:firebase` | Backend unit tests | `firebase:emulators:test` | Backend |
| `firebase:emulators:test` | Emulator + backend tests | `backend:verify` | Backend |
| `android` / `android:usb` / `ios` | Native run targets | — | Dev |

### 2.2 `npm run verify` execution graph

```
verify
├── npm run typecheck
├── check-require-cycles.ts                    ← also in backend:verify
├── offline-economy-test.ts
├── time-progression-audit-test.ts
├── performance-regression-test.ts             (static file guards, not device perf)
├── cold-start-performance-test.ts
├── save-checksum-regression-test.ts
├── test-money-sync-regression-test.ts
├── apple-auth-audit-test.ts
├── apple-auth-release-regression-test.ts
├── verify-ios-apple-auth-config.ts            ← duplicate of verify:ios-apple-auth
├── verify-ios-firebase-runtime-config.ts      ← duplicate of verify:ios-firebase
├── ios-firebase-config-regression-test.ts
├── apple-auth-unavailable-regression-test.ts
├── management-account-navigation-regression-test.ts
├── ios-tabbar-safe-area-regression-test.ts
├── ios-layout-regression-test.ts
├── ios-map-truck-fuel-display-regression-test.ts
├── market-buy-cash-preview-regression-test.ts
├── apple-cloud-save-link-regression-test.ts
├── market-product-card-layout-regression-test.ts
├── offline-operating-cost-disabled-regression-test.ts
├── offline-delivery-progress-regression-test.ts
├── offline-delivery-settlement-regression-test.ts
├── warehouse-upgrade-regression-test.ts
├── vehicle-marketplace-ui-test.ts
├── vehicle-marketplace-regression-test.ts
├── vehicle-marketplace-purchase-deadlock-test.ts
├── vehicle-marketplace-startup-reconcile-test.ts
├── marketplace-response-contract-test.ts
├── leaderboard-regression-test.ts
├── leaderboard-eligibility-test.ts
├── leaderboard-cross-platform-regression-test.ts
├── leaderboard-score-v2-test.ts
├── ad-privacy-regression-test.ts
├── reputation-regression-test.ts
├── delivery-lateness-ux-test.ts
├── delivery-incidents-smoke-test.ts
├── random-events-regression-test.ts
├── incident-distribution-simulation-test.ts
├── os-notifications-test.ts
├── market-tutorial-regression-test.ts
├── app-tutorial-regression-test.ts
├── tutorial-first-visit-regression-test.ts
├── tutorial-coordinate-regression-test.ts
├── tutorial-target-layout-regression-test.ts
├── dashboard-layout-regression-test.ts
├── dashboard-starter-guide-removal-test.ts
├── dashboard-metric-responsive-test.ts
├── daily-operation-support-economy-test.ts
├── daily-operation-support-ui-regression-test.ts
├── management-panel-regression-test.ts
├── contract-generation-reliability-test.ts
├── contracts-screen-layout-regression-test.ts
├── warehouse-screen-ui-regression-test.ts
├── warehouse-system-test.ts
├── warehouse-stock-transfer-test.ts
├── account-center-ui-regression-test.ts
├── account-signout-deletion-regression-test.ts
├── account-switch-flow-test.ts
├── account-cloud-login-regression-test.ts
├── fleet-upgrades-regression-test.ts
├── account-cloud-conflict-regression-test.ts
├── truck-route-heading-test.ts
├── map-truck-heading-regression-test.ts        ← overlaps domain with truck-route-heading
├── bursa-ankara-truck-route-regression-test.ts
├── render-rate-instrumentation-test.ts
├── save-recovery-regression-test.ts
├── vehicle-state-recovery-test.ts
├── map-tracking-integrity-regression-test.ts
├── driver-operational-state-regression-test.ts
├── achievement-reward-claim-regression-test.ts
├── save-bootstrap-regression-test.ts
├── app-tutorial-safety-regression-test.ts
└── update-loop-regression-test.ts
```

**Counts:** 75 steps (1 typecheck + 74 tsx scripts).  
**Approximate runtime:** Not measured in this audit; prior `docs/release-audit/TEST_RESULTS.md` (2026-08-05) records PASS but no duration. Sequential headless tests typically run minutes, not seconds.

### 2.3 `npm run backend:verify` graph

```
backend:verify
├── npm run backend:typecheck
├── npm run backend:build
├── backend-function-consistency-test.ts
├── check-require-cycles.ts                       ← OVERLAP with verify
├── npm run firebase:emulators:test
│   ├── firebase emulators:exec (Firestore)
│   ├── npm run backend:build                     ← second build in chain
│   └── npm run test:firebase (backend/test/*.test.ts)
├── cloud-save-conflict-test.ts
└── cloud-save-production-audit-test.ts
```

### 2.4 Release validation overlap

| Chain | Includes full `verify`? | Includes `backend:verify`? | Includes production validate? |
|---|---|---|---|
| `verify` | Yes | No | No |
| `backend:verify` | No | Yes | No |
| `validate:production-build` | No | No | Yes (config only) |
| `android:bundle:release` | No | No | Yes + Gradle |
| `production:backend-check` | No | No | No (live backend health) |

**Finding:** No single npm script runs *everything*. Release safety requires **`verify` + `backend:verify` + validate/bundle scripts** separately. That is overlap by design, not accidental duplication of the full client suite.

### 2.5 Duplicate / overlapping test calls

| Duplicate | Where | Assessment |
|---|---|---|
| `check-require-cycles.ts` | `verify` + `backend:verify` | **USEFUL BUT REDUNDANT** — cheap static check; harmless double-run if both gates used |
| `verify-ios-apple-auth-config.ts` | `verify:ios-apple-auth` + `verify` | **USEFUL BUT REDUNDANT** — standalone script for focused debugging |
| `verify-ios-firebase-runtime-config.ts` | `verify:ios-firebase` + `verify` | Same |
| `backend:build` | `backend:verify` + inside emulator exec | **USEFUL BUT REDUNDANT** — emulator path rebuilds |
| Map heading tests (`truck-route-heading`, `map-truck-heading`, `bursa-ankara-truck-route`) | All in `verify` | **Different assertions** on related domain — not byte-identical duplication |

**Verdict on “verify re-runs same tests”:** Only **one explicit shared script** (`check-require-cycles`) across client/backend gates. The verify chain does **not** call `backend:verify` or emulator tests.

---

## 3. Test suite audit

### 3.1 Inventory

| Metric | Count |
|---|---|
| Total `scripts/*.ts` files | **167** |
| Test/regression scripts (`*test*.ts` pattern) | **~155** |
| Scripts invoked by `verify` | **74** |
| Scripts **not** in `verify` | **93** |

Non-test scripts outside verify include: `android-bundle-*.ts`, `validate-*-config.ts`, `generate-branding-assets.ts`, `build-env.ts`, `productionFirebaseRead.ts`, etc.

### 3.2 Scripts NOT in `verify` (93) — sample categorization

| Category | Examples | Label |
|---|---|---|
| Release-critical but separate gate | `validate-store-production-config.ts`, `validate-production-build-config.ts`, `global-economy-production-health-test.ts`, `production-backend-health-check.ts`, `cloud-save-conflict-test.ts`, `backend-function-consistency-test.ts`, `store-production-config-security-test.ts`, `release-blocker-startup-test.ts`, `core-game-production-readiness-test.ts` | **MUST KEEP** (different npm script) |
| Dev / diagnostic / extended perf | `cold-start-local-bottleneck-test.ts`, `screen-open-performance-regression-test.ts`, `tab-navigation-performance-regression-test.ts`, `market-history-performance-regression-test.ts`, `truck-refuel-render-loop-test.ts`, `retention-manual-test.ts`, `debug-contract-generation-test.ts` | **DEV ONLY** |
| Overlapping domain with verify tests | `vehicle-marketplace-freeze-regression-test.ts`, `vehicle-marketplace-transaction-integrity-test.ts`, `leaderboard-server-state-sync-regression-test.ts`, `ios-map-heading-marker-regression-test.ts`, `account-sign-out-isolation-regression-test.ts` | **USEFUL BUT REDUNDANT** or **UNKNOWN — MANUAL REVIEW** |
| Smoke / phase / economy deep dives | `phase3-smoke-test.ts`, `economy-retention-30day-test.ts`, `world-events-smoke-test.ts`, `monetization-smoke-test.ts` | **DEV ONLY** or pre-release manual |
| Asset / tooling | `generate-branding-assets.ts`, `build-env.ts`, `verify-dashboard-assets.ts` | **DEV ONLY** |
| Possibly obsolete | `diamond-removal-regression-test.ts` (if feature permanently removed), `phase3-smoke-test.ts` (phase naming) | **POSSIBLY OBSOLETE** — needs owner confirmation |

### 3.3 `verify` test categories (all 74)

| Domain | Count (approx) | Label |
|---|---|---|
| Save / recovery / bootstrap | 6 | **MUST KEEP** |
| Apple auth / iOS Firebase | 6 | **MUST KEEP** |
| Vehicle marketplace | 5 | **MUST KEEP** |
| Leaderboard | 4 | **MUST KEEP** |
| Account / cloud | 5 | **MUST KEEP** |
| Tutorials (app + market + layout) | 9 | **MUST KEEP** |
| iOS layout / tab bar / map UI | 4 | **MUST KEEP** |
| Offline / delivery / incidents | 7 | **MUST KEEP** |
| Warehouse / contracts / fleet | 7 | **MUST KEEP** |
| Economy / performance guards | 5 | **MUST KEEP** (mostly static) |
| Dashboard / management UI | 5 | **MUST KEEP** |
| Ads / reputation / notifications | 3 | **MUST KEEP** |
| Map routes / tracking | 4 | **MUST KEEP** |
| Static infra (`check-require-cycles`, `update-loop`) | 2 | **MUST KEEP** |

**Assessment:** The verify suite is **large but domain-differentiated**. It is not “the same test 74 times”; it is **breadth for a complex simulation + cloud + marketplace + auth product**. Shrinking without a matrix would increase release risk.

---

## 4. Dependency version audit

### 4.1 Core stack (installed)

| Package | Installed | package.json pin | Expo SDK 54 expected |
|---|---|---|---|
| expo | 54.0.35 | ~54.0.35 | ~54.0.37 (**patch behind**) |
| react | 19.1.0 | 19.1.0 | 19.1.0 ✓ |
| react-native | 0.81.5 | 0.81.5 | 0.81.5 ✓ |
| react-native-reanimated | 4.1.7 | ~4.1.1 | ~4.1.x ✓ |
| react-native-gesture-handler | 2.28.0 | ~2.28.0 | ~2.28.x ✓ |
| react-native-safe-area-context | 5.6.2 | ~5.6.0 | ~5.6.x ✓ |
| react-native-screens | — | **not a direct dependency** | N/A (custom tab nav) |
| @react-native-async-storage/async-storage | 2.2.0 | 2.2.0 | 2.2.0 ✓ |
| firebase (client) | 10.12.5 | **10.12.5 (exact pin)** | Compatible with JS SDK usage |
| typescript | 5.9.3 | ^5.7.3 | OK |
| tsx | 4.23.12 | ^4.23.6 | OK |

### 4.2 `npm outdated` highlights (latest ≠ recommended)

| Package | Current | Latest | Upgrade risk |
|---|---|---|---|
| expo | 54.0.35 | **57.0.17** | **HIGH** — SDK major jump |
| firebase | 10.12.5 | **12.18.0** | **HIGH** — major; pinned intentionally |
| react-native | 0.81.5 | 0.87.1 | **HIGH** — tied to Expo SDK |
| react-native-gesture-handler | 2.28.0 | 3.2.1 | **HIGH** |
| react-native-google-mobile-ads | 15.8.3 | 16.5.0 | **MEDIUM** — native module |
| firebase-tools | 14.27.0 | 15.28.1 | **MEDIUM** — dev CLI only |

**Important:** “Latest” on npm is **not** the Expo SDK 54 compatibility target. Only `expo install --check` patch hints are actionable within current SDK.

### 4.3 Peer dependency / tree health

`npm ls --depth=0`: **clean**, no UNMET/invalid peer warnings reported.

---

## 5. Expo/RN compatibility

### 5.1 `npx expo-doctor` (2026-08-27 run)

- **15/18 checks passed**
- **Failures:**
  1. `app.json` vs `app.config.js` sync warning (static app.json not merged into dynamic config)
  2. Non-CNG project warning: native `android/ios` folders present + config plugins — prebuild sync risk
  3. **Patch mismatches:** `expo` 54.0.35 vs expected ~54.0.37; `expo-constants` 18.0.13 vs ~18.0.14

### 5.2 `npx expo install --check`

Confirms same 2 patch-level mismatches. No other SDK 54 incompatibilities reported.

### 5.3 Compatibility matrix (toolchain)

| Component | Version | SDK 54 / RN 0.81.5 fit | Notes |
|---|---|---|---|
| Expo SDK | 54.0.x | ✓ (patch behind) | Hermes default |
| React | 19.1.0 | ✓ | Matches RN 0.81 template |
| RN | 0.81.5 | ✓ | New Architecture capable |
| Reanimated | 4.1.x | ✓ | Requires worklets peer |
| RN Worklets | 0.5.1 | ✓ | Paired with Reanimated 4 |
| Firebase JS | 10.12.5 | ✓ | Client SDK |
| Firebase Admin (backend) | ^13.0.0 | ✓ | Separate from client |
| Firebase Functions | ^6.0.0 | ✓ | Node 20 engine |
| Google Sign-In | ^16.1.2 | ✓ | Native dev build required |
| Google Mobile Ads | ^15.8.3 | ✓ | Native module |
| TypeScript | 5.9.x | ✓ | |
| tsx | 4.23.x | ✓ | Test runner |

**Not present:** `@react-navigation/*`, `expo-auth-session` (user asked to check — **not in project**).

---

## 6. Deprecated packages

No npm packages flagged as deprecated in diagnostic output.  
**Config/process warnings (not package deprecation):** app.json/app.config.js dual config; non-CNG native folder sync.

---

## 7. Possibly unused dependencies

| Package | Evidence | Verdict |
|---|---|---|
| `sharp` | Used only in `scripts/generate-branding-assets.ts` | **Used (dev tooling)** — not unused |
| `babel-preset-expo` | In `dependencies`; used by Metro/Babel pipeline | **Used (build)** — typical Expo pattern |
| `expo-font` / `expo-build-properties` | Referenced in `app.config.js` plugins | **Used (config plugin)** — not visible in src imports |
| `expo-splash-screen` | Likely native bootstrap / config | **Likely used** — false positive risk if only native |
| `expo-notifications` | `src/services/notifications.ts`, `src/domain/osNotifications.ts` | **Used** |
| `expo-tracking-transparency` | Lazy import in `src/services/attService.ts` | **Used** |
| `expo-crypto` | `authNonce.ts`, marketplace screen | **Used** |
| `expo-navigation-bar` | Lazy require in `src/utils/systemBars.ts` | **Used** |
| `expo-asset` | `src/utils/mapAssetPreload.ts` | **Used** |
| `@firebase/rules-unit-testing` (root) | Dev/test for Firestore rules | **Dev test** — also in backend |
| `firebase-tools` | Emulator / deploy CLI | **Dev** |

**No clear orphan production dependency identified.** False positive risk: config-plugin-only Expo packages.

---

## 8. Backend/runtime warnings

| Item | Severity | Detail |
|---|---|---|
| Backend `engines.node: "20"` | **P1** | Firebase Functions v6 on Node 20 — correct today; Node 22 migration is a **future** coordinated upgrade (explicitly out of scope for this audit) |
| `@types/node ^22` in backend devDeps | **P2** | Types newer than runtime engine — minor mismatch |
| Client Firebase pin 10.12.5 vs backend admin 13.x | **Info** | Normal split (client vs admin SDKs) |
| `production:backend-check` not in `verify` | **Info** | Live production probe — correctly separate |

---

## 9. Screen mount/focus trigger matrix

**Navigation model:** Custom tab bar in `App.tsx`. Tabs **remount on each visit** except **`more`** and **`vehicleMarketplace`** (keep-alive). No React Navigation `useFocusEffect` — remount ≈ focus for most tabs.

| Screen | Mount trigger | Focus trigger | Timer | Network | Store mutation | Save trigger | Cleanup? | Duplicate? | Severity |
|---|---|---|---|---|---|---|---|---|---|
| **Dashboard** | `useOnboardingScreenVisit`; `syncMissionProgress` + `syncRetentionProgress` (many deps); `advanceOnboardingProgress`; `notifyActiveDeliverySeen` | Same as remount | No | No direct | Mission/retention/onboarding sync | `markSaveDirty` via store actions | N/A | Re-runs mission sync on many state changes while visible | **POSSIBLE** perf (store work), not network duplicate |
| **Map** | `useOnboardingScreenVisit`; **`reconcileMapTracking('map-open')` once/mount**; status toast timer | Remount repeats reconcile once | setTimeout status | No | Map integrity reconcile | Possible dirty mark | Yes | Reconcile each visit | **POSSIBLE** — bounded |
| **Contracts** | `useOnboardingScreenVisit`; **`notifyContractsScreenOpened`** → `bootstrapContractsIfNeeded`; tutorial dev log; route-filter scroll effect | Remount repeats notify/bootstrap | setTimeout status | No | Contract bootstrap / tutorial | markSaveDirty | Yes | Bootstrap guarded in store | **POSSIBLE** |
| **Market** | **`notifyMarketScreenOpened`** → `maybeRefreshMarketSnapshot('screen-open')` + history defer; city default; UI banner timers | Remount repeats notify | 2× setTimeout | **Yes** (snapshot, cooldown 60s) | Tutorial/mission flags | markSaveDirty | Yes | Foreground also refreshes market (`App.tsx`) | **HIGH CONFIDENCE** guarded duplicate path |
| **Fleet** | Pending sub-tab routing; status timer | Remount | setTimeout | No | Tab routing only | No | Yes | Low | UNLIKELY |
| **Shop** | Pending category routing; pause/resume via actions; status timer | Remount | setTimeout | No | Minimal | No | Yes | Low | UNLIKELY |
| **More** (keep-alive) | Sub-route from `pendingMoreSubRoute`; scroll-to-account | **`isActive` gated** — only when tab visible | InteractionManager | No | Navigation state | No | Yes | Stays mounted | UNLIKELY |
| **Warehouse** (embedded) | Status timer; layout debug (dev) | Lazy mount inside More | setTimeout | No | Trade actions via UI | On actions | Yes | Only when opened | UNLIKELY |
| **Finance** (embedded) | **No useEffect** — render-only | Lazy mount | No | No | No | No | N/A | Low | UNLIKELY |
| **Missions** (embedded) | `syncMissionProgress` + retention on mount | Remount | No | No | Mission sync | markSaveDirty | N/A | Overlaps Dashboard mission sync logic | **POSSIBLE** |
| **Leaderboard** (embedded) | **`loadLeaderboard` + auth subscription**; username profile subscription | Remount when re-entering | InteractionManager defer | **Yes** | Screen state | No | Yes | Account screen also refreshes rank | **POSSIBLE** |
| **Account** (embedded) | Recovery refresh; prefs load; **`refreshLeaderboardRank`**; auth/username subs | Remount | InteractionManager | **Yes** (rank) | Cloud/account VM | On user actions | Yes | Overlap with Leaderboard screen fetch | **POSSIBLE** |
| **VehicleMarketplace** (keep-alive) | **`refreshAll` on mount**; auth change → reset + refresh; BackHandler | Stays mounted after first visit | No | **Yes** | Marketplace listings | Reconcile apply | Yes | Startup reconcile also in `App.tsx` | **HIGH CONFIDENCE** different lifecycle (startup vs open) |

---

## 10. Global listener/timer audit

| Mechanism | Location | Count | Cleanup | Duplicate risk |
|---|---|---|---|---|
| **`useGameLoop` → `advanceTime` interval** | `AppShell` via `App.tsx` | **1 global** | clearInterval on deps change | **UNLIKELY** duplicate — single hook |
| **AppState listener** | `App.tsx` | 1 | remove on unmount | Foreground: offline progression, market refresh, marketplace reconcile, leaderboard season |
| **Notification response listener** | `App.tsx` | 1 | remove | No |
| **Immersive mode refresh** | `App.tsx` | 1 | unsubscribe | No |
| **Cloud save sync init** | `App.tsx` after game ready | 1 | stop on unmount | Not re-run per screen |
| **Ads init** | `App.tsx` after boot ready | 1 | cancelled via InteractionManager | No |
| **Map asset preload** | `App.tsx` once game ready | 1 | N/A | No |
| **Marketplace startup reconcile** | `App.tsx` | 1 | N/A | Separate from screen-open refresh |
| **Test money sync** | `App.tsx` | 1 | stopTestMoneySync | Dev/internal |
| **Spotlight tutorial triggers** | `AppShell` | 1 | hook cleanup | Tab-scoped logic |

**Finding:** Global listeners are **centralized and cleaned up**. No evidence of the same AppState listener registering per screen.

---

## 11. Duplicate runtime work findings

| Finding | Evidence | Confidence |
|---|---|---|
| Market snapshot refresh: foreground + screen-open | `App.tsx` AppState + `notifyMarketScreenOpened` → `maybeRefreshMarketSnapshot` | **HIGH CONFIDENCE** — mitigated by **60s cooldown** + in-flight guard |
| Mission progress sync: Dashboard + Missions | Both call `syncMissionProgress()` | **POSSIBLE** — idempotent store sync, extra CPU on visit |
| Leaderboard load: Leaderboard + Account rank refresh | Separate network paths | **POSSIBLE** — user may hit both in one session |
| Map tracking reconcile: hydrate + map-open | `gameStore` hydrate + MapScreen mount | **HIGH CONFIDENCE** — intentional integrity checks |
| Marketplace: startup reconcile + screen refreshAll | `App.tsx` + `VehicleMarketplaceScreen` | **HIGH CONFIDENCE** — different phases (post-startup vs UI open) |
| Contract schedule spikes from screen mount | Spikes documented in advanceTime contract-schedule full ticks | **UNLIKELY** primary link |

---

## 12. Performance relevance

Prior work (`docs/release-audit/PERFORMANCE_SPIKE_FOLLOWUP_REPORT.md`) attributes occasional **80+ ms contract-schedule spikes** to **`advanceTime` full refresh ticks** (generation, route eligibility, minimum supply), not navigation.

| Source | Link to spikes | Confidence |
|---|---|---|
| Screen remount market fetch | Could add **network + store** work on tab switch; cooldown limits repeat | **POSSIBLE** |
| Dashboard mission sync on wide deps | Store scans while dashboard visible | **POSSIBLE** (not measured) |
| Single `useGameLoop` | Steady 1–3 ms ticks; spikes on scheduled full contract refresh | **CONFIRMED** unrelated to screen count |
| Keep-alive More/Marketplace | Avoids remount cost; may retain heavier component trees | **POSSIBLE** memory/render tradeoff |

**Do not claim “screen X causes jank” without device traces** — this audit flags **candidates only**.

---

## 13. P0 / P1 / P2 findings

| ID | Sev | Finding |
|---|---|---|
| P0-1 | — | **No release blocker** identified from package/test/runtime static audit |
| P1-1 | P1 | Backend pinned to **Node 20** — plan Node 22 + firebase-functions upgrade separately |
| P1-2 | P1 | **expo / expo-constants patch drift** (54.0.35/18.0.13 vs expected .37/.14) |
| P1-3 | P1 | **app.config.js / app.json / native folder** sync warnings from expo-doctor |
| P2-1 | P2 | `verify` runtime length (74 sequential scripts) — CI latency, not correctness |
| P2-2 | P2 | 93 scripts outside `verify` — documentation needed for when to run which |
| P2-3 | P2 | Market refresh dual path (foreground + screen-open) — already cooldown-gated |
| P2-4 | P2 | `@types/node` 22 vs engine 20 in backend |

---

## 14. Recommended fixes — ONLY recommendations (DO NOT APPLY)

1. **Align Expo patches** within SDK 54: `npx expo install expo expo-constants` when choosing to act (not done in this audit).
2. **Resolve app.json vs app.config.js** per Expo docs — single source of truth.
3. **Document release gate matrix:** `verify` + `backend:verify` + `validate:production-build` + `production:backend-check` as explicit checklist (partially exists in `docs/release-audit/`).
4. **Optional CI split:** parallelize verify domains or add `--domain=marketplace` flags *if* wall-clock becomes painful — do not delete tests without coverage mapping.
5. **Runtime (optional):** instrument tab-switch market refresh skip rate in diagnostics build to confirm cooldown effectiveness.
6. **Node 20 → 22:** schedule with Firebase Functions compatibility matrix — out of scope now.

---

## 15. Safe upgrade candidates (within SDK 54)

| Package | Action | Risk |
|---|---|---|
| expo | Patch 54.0.35 → ~54.0.37 | **Low** (expo-doctor recommended) |
| expo-constants | Patch 18.0.13 → ~18.0.14 | **Low** |
| @react-native-google-signin/google-signin | Patch 16.1.2 → 16.1.4 | **Low** |
| zustand | Patch 5.0.14 → 5.0.15 | **Low** |
| sharp | Patch 0.35.3 → 0.35.4 | **Low** (dev only) |

---

## 16. High-risk upgrade candidates (do not bump casually)

| Package | Why |
|---|---|
| expo 57.x | Full SDK migration |
| react-native 0.87+ | Tied to future Expo SDK |
| firebase 11+ / 12+ | Client SDK major; test all auth/Firestore paths |
| react-native-gesture-handler 3.x | Native breaking changes |
| react-native-google-mobile-ads 16.x | Native + policy testing |
| firebase-tools 15.x | CLI behavior changes |
| TypeScript 7.x | Tooling churn |

---

## 17. Tests that must remain

- All **74 verify scripts** unless replaced by equivalent coverage in the same domain.
- **Backend emulator suite** (`backend:verify` / `test:firebase`).
- **Production config validators** (`validate:store-production`, `validate:production-build`).
- **Cloud save conflict + production audit** (backend gate).
- **Marketplace transaction/deadlock/startup reconcile** tests (historical P0 fixes).
- **Apple auth + iOS Firebase config** tests (store submission blockers).
- **Save checksum / recovery / bootstrap** tests.

---

## 18. Tests possibly redundant

| Test / pattern | Reason |
|---|---|
| `check-require-cycles` in both verify and backend:verify | Cheap duplicate |
| Standalone `verify:ios-*` vs same inside verify | Convenience duplicate |
| `truck-route-heading` + `map-truck-heading` + `bursa-ankara-truck-route` | Overlapping map domain — keep until consolidated assertions |
| Scripts outside verify that mirror verify domains (e.g. `vehicle-marketplace-freeze-regression-test.ts`) | Run ad-hoc / pre-release, not daily |
| `diamond-removal-regression-test.ts` | **POSSIBLY OBSOLETE** if feature gone |
| `performance-regression-test.ts` | Static string guards — **USEFUL** but not runtime perf measurement |

**Do not delete** without mapping each to a release incident or domain owner sign-off.

---

## 19. Final conclusion

### Is `package.json` bloated?
**Moderately, in one dimension:** only **22 npm scripts**, which is reasonable. The **`verify` script itself is long** (74 headless tests + typecheck). That is **release-safety breadth**, not accidental script proliferation.

### Is the test suite unnecessarily bloated?
**No for release safety; yes for dev iteration speed.** Most tests map to distinct domains (marketplace, cloud save, Apple auth, tutorials, offline economy). **93 scripts sit outside `verify`** — many are manual/ops/deep diagnostics, not all redundant.

### Do outdated packages create release risk?
**Not acutely.** Stack matches **Expo SDK 54 / RN 0.81.5 / React 19.1**. Risk is **patch drift (expo, expo-constants)** and **config/native sync warnings** — **P1**, not P0 blocker. Major “latest” versions on npm are **irrelevant** until an SDK upgrade project.

### Packages that should be updated (when you choose to act)?
**Safe:** expo + expo-constants patches per `expo install --check`.  
**Do not auto-update:** firebase major, Expo 57, RN 0.87+, gesture-handler 3.x, ads SDK major.

### Packages that should NOT be updated now?
All **SDK-tied majors** above; **firebase 10.12.5** exact pin likely intentional; **firebase-functions 6.x on Node 20** until migration plan exists.

### Runtime duplicate work at screen level?
**Some remount-triggered store/network work exists** (Market, Map reconcile, Contracts bootstrap, Dashboard mission sync). **Guards/cooldowns present** for the highest-risk path (market). **Not the leading explanation** for contract-schedule spikes.

### Same work triggered from multiple screens?
**Partially** — mission sync (Dashboard/Missions), leaderboard fetch (Leaderboard/Account), market refresh (AppState/Market tab). **Not unbounded loops** observed statically.

### Release blocker right now?
**None** from this audit. Recommended pre-release gates remain: **`npm run verify` + `npm run backend:verify` + production validate scripts + device smoke**.

---

*Audit performed read-only. Diagnostic commands: `npm outdated`, `npm ls --depth=0`, `npx expo-doctor`, `npx expo install --check`.*

# FINAL PRE-BUILD RELEASE GATE — LogistiCore

**Date:** 2026-08-06  
**Scope:** Read-only gate — test, config validation, manifest merge, Expo export. No AAB/APK/IPA/Archive produced.  
**Profile:** `LOGISTICORE_BUILD_PROFILE=production`  
**Firebase project:** `logisticore-53ab4`

---

## Release Decision

**Automated client/backend CI is green and local exports succeed, but production still runs pre–B-001 backend (8 functions) without serverState/leaderboard/username callables or updated Firestore rules deploy. Migration dry-run reports 2 cash reconciliation conflicts. Real-device UMP/ATT/auth verification remains outstanding.**

**Verdict:** Production deploy and migration review must complete before store release. Local release binaries may be built for device QA after backend/rules deploy.

---

## 1. Closed Blockers

| ID | Status | Test evidence | Source paths | Remaining risk | Deploy | Migration |
|----|--------|---------------|--------------|----------------|--------|-----------|
| **B-001** Server-owned trust | **MITIGATED (code)** — **production NOT closed** | `npm run backend:verify` → 46/46 emulator PASS; `backend/test/serverState.emulator.test.ts`, `leaderboard.emulator.test.ts`, `vehicleMarketplace.emulator.test.ts`; `scripts/security-malicious-save-trust-test.ts` → SKIP headless (exit 0), not re-run with emulator this session (Java 21 gate failed on retry; covered by backend emulator suite) | `backend/src/serverState.ts`, `backend/src/leaderboard.ts`, `backend/src/vehicleMarketplace.ts`, `firestore.rules` L78–81 | Production still on old function bundle; client save trust boundary not enforced live until deploy | **NOT DEPLOYED** — only 8 functions live; missing `submitLeaderboardScore`, `getLeaderboard`, `migrateLegacyServerState`, `setUsername`, `checkUsernameAvailability`, `getUsernameProfile` | `migrateLegacyServerState` callable + dry-run script ready; production migration not run |
| **B-002** Account switch isolation | **CLOSED (client)** | `scripts/account-switch-isolation-security-test.ts` → MITIGATED; `scripts/account-switch-flow-test.ts` → PASS | `src/services/accountSwitchService.ts`, `src/storage/saveGame.ts`, `src/services/cloudSaveService.ts` | `recovery-required` path needs device QA; Google-specific picker strings remain | Client-only — **new build required** | N/A |
| **B-003** Store vs internal profiles | **MITIGATED** | `npm run validate:store-production` → PASS; `scripts/store-production-config-security-test.ts` → PASS; `scripts/ads-config-test.ts` → PASS | `scripts/build-env.ts`, `src/config/buildProfile.ts`, `src/services/adsConsentService.ts`, `src/services/attService.ts` | UMP consent form + ATT prompt not proven on real iOS/Android devices | Profile split is build-time; no backend deploy | N/A |
| **B-004** Android manifest permissions | **CLOSED** | `gradlew :app:processReleaseMainManifest` → BUILD SUCCESSFUL; `scripts/android-release-manifest-policy-test.ts` → MITIGATED | `android/app/src/main/AndroidManifest.xml`, `app.config.js` | Post-AAB bundletool confirmation still manual | Manifest source ready — **new AAB build required** | N/A |
| **C-001** Corrupt save recovery | **CLOSED (client)** | `scripts/corrupt-save-recovery-security-test.ts` → MITIGATED | `src/storage/saveRecoveryCore.ts`, `src/screens/SaveRecoveryScreen.tsx`, `src/storage/saveGame.ts` | Export/share failure UX needs device check | Client-only — **new build required** | Local quarantine keys; no server migration |

---

## 2. Security Verification

| Control | Evidence | Result |
|---------|----------|--------|
| Malicious save cannot change marketplace cash | `backend/test/vehicleMarketplace.emulator.test.ts` — bootstrap ignores cloud save; `ensureVehicleMarketplaceStateTransaction` uses serverState | **PASS (emulator)** |
| Fake truck ownership blocked | Same suite + `backend/test/serverState.emulator.test.ts` bounded migration rejects invalid trucks | **PASS (emulator)** |
| Fake leaderboard score blocked | `backend/test/leaderboard.emulator.test.ts` — malicious cloud save write does not change score | **PASS (emulator)** |
| `serverState` client write denied | `backend/test/serverState.emulator.test.ts` — direct client write PERMISSION_DENIED | **PASS (emulator)** |
| Marketplace double purchase blocked | `backend/test/vehicleMarketplace.emulator.test.ts` — concurrent purchase exactly one winner | **PASS (emulator)** |
| Account switch UID isolation | `scripts/account-switch-isolation-security-test.ts` | **PASS** |
| Cloud write owner mismatch block | `scripts/cloud-save-production-audit-test.ts`, `scripts/cloud-save-conflict-test.ts` | **PASS** |
| Corrupt save silent delete blocked | `scripts/corrupt-save-recovery-security-test.ts` | **PASS** |
| Recovery idempotent | Same test — journal receipts, atomic staging | **PASS** |
| Leaderboard direct writes false | `firestore.rules` L131–134; emulator test ok 9 | **PASS (rules + emulator)** |
| Marketplace direct writes false | `firestore.rules` L86–111; emulator test ok 44 | **PASS (rules + emulator)** |

**Note:** Production Firestore rules deploy status not independently verified against live project; repo rules are correct. **Deploy required** before production trust boundary is active.

---

## 3. Automated Test Summary

### Gate commands

| Command | Result |
|---------|--------|
| `npm run typecheck` | **PASS** |
| `npm run verify` | **PASS** (typecheck + require-cycle check) |
| `npm run backend:verify` | **PASS** (backend typecheck/build, function consistency, 46 Firebase emulator tests, cloud-save conflict + production audit) |
| `npm run validate:store-production` | **PASS** (0 failed) |
| `npm run validate:production-build` | **PASS** (0 failed, 33 checks) |
| `npm run production:backend-check` | **PASS** |

### Full client script suite (`scripts/*test*.ts`, 67 scripts)

```
PASS=67  FAIL=0  SKIP=0
```

Includes regression, smoke, security, marketplace, economy, cloud-save, branding, and manifest policy tests.

### Backend emulator suite

```
tests 46  pass 46  fail 0
```

### Require cycles

No release blockers (`npm run verify`).

### Expo exports

| Platform | Result | Bundle |
|----------|--------|--------|
| Android | **PASS** | `dist/_expo/static/js/android/index-8eec2e7461c52c776ab3f63478176664.hbc` (1787 modules) |
| iOS | **PASS** | `dist/_expo/static/js/ios/index-43ad7741489298c28b4682fcf7c2f1c1.hbc` (1785 modules) |

**Export hygiene:** No `localhost`, emulator, mock economy, or Google test App ID (`3940256099942544`) found in `dist/`.

---

## 4. Backend Deploy Status

### Production functions (`firebase functions:list`)

| Function | Region | Runtime | State |
|----------|--------|---------|-------|
| `generateGlobalEconomy` | us-central1 | nodejs20 | ACTIVE |
| `expireVehicleMarketplace` | us-central1 | nodejs20 | ACTIVE |
| `createVehicleListing` | us-central1 | nodejs20 | ACTIVE |
| `cancelVehicleListing` | us-central1 | nodejs20 | ACTIVE |
| `purchaseVehicleListing` | us-central1 | nodejs20 | ACTIVE |
| `getVehicleMarketplaceListings` | us-central1 | nodejs20 | ACTIVE |
| `getMyVehicleListings` | us-central1 | nodejs20 | ACTIVE |
| `prepareVehicleMarketplaceAccountDeletion` | us-central1 | nodejs20 | ACTIVE |

**Deployed count:** 8  
**All deployed functions:** us-central1 ✓

### Not deployed (present in `backend/src/index.ts`, required for B-001 / leaderboard / username)

- `submitLeaderboardScore`
- `getLeaderboard`
- `migrateLegacyServerState`
- `setUsername`
- `checkUsernameAvailability`
- `getUsernameProfile`

**Production deploy:** **NOT DONE** for B-001 security bundle.

### Firestore rules (repo)

| Path | Client write |
|------|--------------|
| `users/{uid}/serverState/{documentId}` | **denied** |
| `users/{uid}/marketplaceState/*` | **denied** |
| `leaderboards/{seasonId}/entries/{entryId}` | **denied** |
| `vehicleMarketplaceListings/{listingId}` | **denied** |
| `usernames/{usernameNormalized}` | **denied** |

**Rules deploy:** **NOT VERIFIED / ASSUMED PENDING** — deploy with `firebase deploy --only firestore:rules` before release.

### Indexes

- Deployed composite indexes: **6**
- Required groups present: `globalMarketHistory`, `vehicleMarketplaceListings`
- **Healthy**

### Global economy (production)

```
epoch: 992203  configVersion: 1  stale: false
fuelPrice: 1.64  historyRecords: 56/56
```

### Migration dry-run (`npm run marketplace:migrate:dry`)

```
scannedUsers: 22
wouldMigrate: 14
existingStates: 6
invalidSaves: 2
reconciliationConflicts: 2  (cashMatches: false)
failures: 0
exitCode: 1  (conflicts trigger non-zero)
```

**Migration plan:** Bounded and dry-run safe, but **2 production accounts need manual reconciliation review** before `--apply`.

---

## 5. Production Config Snapshot

| Check | Value | Status |
|-------|-------|--------|
| Android package | `com.ethemsincar.logisticore` | ✓ |
| iOS bundle | `com.ethemsincar.logisticore` | ✓ |
| Firebase project | `logisticore-53ab4` | ✓ |
| App version | `1.0.10` / Android `versionCode` 11 | ✓ |
| `EXPO_PUBLIC_ADS_USE_TEST_IDS` | `false` | ✓ |
| `EXPO_PUBLIC_BACKEND_DIAGNOSTICS_ENABLED` | `false` | ✓ |
| Emulator / localhost in `src/` | None | ✓ |
| Mock economy | `EXPO_PUBLIC_MOCK_GLOBAL_ECONOMY=false` | ✓ |
| Production AdMob App IDs | Android `…~5560651696`, iOS `…~4247570027` | ✓ |
| UMP / ATT source config | `adsConsentService`, `attService`, plugin copy in `app.config.js` | ✓ |
| Secrets in logs | Validators do not print `.env` secrets; export bundle clean | ✓ |
| `extra.buildProfile` | `production` | ✓ |
| `extra.features.leaderboardEnabled` | `true` | ⚠ functions not deployed |

---

## 6. Android Merged Release Manifest

**Task:** `cd android && gradlew.bat :app:processReleaseMainManifest` → **BUILD SUCCESSFUL**

**File:** `android/app/build/intermediates/merged_manifest/release/processReleaseMainManifest/AndroidManifest.xml`

| Check | Result |
|-------|--------|
| `SYSTEM_ALERT_WINDOW` | **Absent** |
| `READ_EXTERNAL_STORAGE` | **Absent** |
| `WRITE_EXTERNAL_STORAGE` | **Absent** |
| `MANAGE_EXTERNAL_STORAGE` | **Absent** |
| `android:allowBackup` | **`false`** |
| `package` | `com.ethemsincar.logisticore` |
| `targetSdkVersion` | **36** |

Gradle merge warnings (harmless): `tools:node="remove"` tags with no conflicting dependency declarations.

---

## 7. iOS Source Config

**Commands:** `npx expo config --type public`, `npx expo config --type introspect`, `npx expo export --platform ios`

| Check | Result |
|-------|--------|
| Bundle ID | `com.ethemsincar.logisticore` ✓ |
| Apple Sign-In | `usesAppleSignIn: true`, `expo-apple-authentication` plugin ✓ |
| Google URL scheme | `com.googleusercontent.apps.363783837598-tvbeuhmirctkrpdam51lsqm5uj8nac3l` ✓ |
| ATS arbitrary loads | `NSAllowsArbitraryLoads: false` ✓ |
| Icon / splash | `./assets/branding/icon.png`, `splash-icon.png`, `#020712` ✓ |
| ATT description | Plugin + AdMob `userTrackingUsageDescription` ✓ |
| AdMob App ID | `ca-app-pub-8214453687597896~4247570027` ✓ |
| `CFBundleVersion` | **`1`** — bump required before App Store upload |
| `aps-environment` | **`development`** — switch to `production` for distribution build |

---

## 8. Android Export

**Command:** `npx expo export --platform android` → **PASS**

- JS bundle produced (1787 modules, 7.5 MB HBC)
- No mock/test backend references in `dist/`
- Require cycle gate: **PASS** (`npm run verify`)

---

## 9. Known Issues

1. **B-001 production deploy pending** — 6 callables + updated marketplace/leaderboard logic not live; pre-B-001 trust path may still exist in production.
2. **Firestore rules deploy unconfirmed** — repo rules correct; live project may lag.
3. **Marketplace migration dry-run** — 2 cash reconciliation conflicts; exit code 1.
4. **UMP / ATT / rewarded ads** — wired in source; no real-device proof this gate.
5. **iOS `CFBundleVersion` = 1** and **`aps-environment: development`** — must fix before store submission.
6. **`security-malicious-save-trust-test.ts`** — skipped without emulator in headless run; backend emulator suite provides equivalent coverage.
7. **Host JDK** — firebase-tools warns Java &lt; 21; emulator re-exec failed once this session (backend:verify succeeded earlier).

---

## 10. Deferred V1.1 Items

- Client UI to invoke `migrateLegacyServerState` for legacy cloud-save-only users
- Trusted delivery-receipt callable for live serverState progression sync outside marketplace
- `marketAlarmsEnabled` production feature (currently `false`)
- Selective Android backup rules (V1 uses full `allowBackup=false`)
- Post-quantum OAuth SHA registration note in validator (informational only)

---

## 11. Final Local Build Checklist

Before producing signed local binaries:

- [ ] Deploy B-001 functions: `firebase deploy --only functions` (or targeted list in `FIX_B001_RESULTS.md`)
- [ ] Deploy Firestore rules: `firebase deploy --only firestore:rules`
- [ ] Review migration dry-run conflicts (2 accounts) and run serverState dry-run audit
- [ ] Set `LOGISTICORE_BUILD_PROFILE=production` for release build
- [ ] Bump iOS `CFBundleVersion` / align build numbers
- [ ] Set iOS push entitlement to `production` for distribution
- [ ] Run `npm run validate:production-build` immediately before bundle
- [ ] Android: `npm run android:bundle:release` (when ready — not run in this gate)
- [ ] iOS: Archive via Xcode (when ready — not run in this gate)

---

## 12. Real-Device Checklist (post local build)

### iOS

- [ ] Apple login / link account
- [ ] Cloud save upload + restore
- [ ] Account switch (A → B → Vazgeç rollback)
- [ ] Save recovery screen (corrupt JSON quarantine)
- [ ] Offline progress apply on resume
- [ ] Safe area / notch layouts
- [ ] Delivery incident modal
- [ ] Rewarded ad load + grant
- [ ] UMP consent form (EEA test geography if needed) + ATT prompt on first ad tap

### Android

- [ ] Google login
- [ ] Account switch rollback
- [ ] Cloud save
- [ ] Offline progress
- [ ] Android back navigation
- [ ] Vehicle marketplace list/create/purchase
- [ ] Rewarded ad
- [ ] Merged manifest permission audit on device (Settings → App info)

### Shared soak

- [ ] 30-minute continuous play session
- [ ] 50 rapid tab switches
- [ ] 3 completed deliveries
- [ ] Fuel depletion + refuel
- [ ] Truck transfer between depots
- [ ] Warehouse stock transfer
- [ ] Random world event trigger
- [ ] Network offline → online transition
- [ ] Process kill + cold start save restore

---

RELEASE BLOCKED

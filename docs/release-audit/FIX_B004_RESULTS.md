# FIX B-004 Results — Android Release Manifest Store Policy

**Date:** 2026-08-06  
**Blocker:** B-004 — Restricted overlay + legacy storage permissions in release manifest; implicit backup policy  
**Status:** MITIGATED (source + merged release manifest verified; new AAB build recommended)

---

## 1. Permission Sources (Pre-Fix)

| Permission | Source | Notes |
|------------|--------|-------|
| `SYSTEM_ALERT_WINDOW` | `android/app/src/main/AndroidManifest.xml` (line 5) | Expo/RN dev overlay legacy — **no in-app overlay feature** |
| `SYSTEM_ALERT_WINDOW` | `android/app/src/debug/AndroidManifest.xml` | Debug-only (acceptable for dev builds) |
| `READ_EXTERNAL_STORAGE` | `android/app/src/main/AndroidManifest.xml` | Legacy storage — app uses AsyncStorage / FileProvider |
| `WRITE_EXTERNAL_STORAGE` | `android/app/src/main/AndroidManifest.xml` | Legacy storage |
| `MANAGE_EXTERNAL_STORAGE` | Not declared in project sources | Guarded via `tools:node="remove"` for dependency merge safety |

**Not found in:** `android/app/src/release/AndroidManifest.xml` (file does not exist — release uses `main`).

**Dependency manifests (release merge):** No additional declarations of the four forbidden permissions after removal + merge (verified on `processReleaseMainManifest` output). AdMob / expo-notifications add notification/ad permissions only.

**Expo plugin output:** `app.config.js` now lists `android.blockedPermissions` for future `expo prebuild` runs.

---

## 2. Removed Permissions

From **`android/app/src/main/AndroidManifest.xml`:**

- Removed direct declarations of `SYSTEM_ALERT_WINDOW`, `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`
- Added explicit merge strippers:

```xml
<uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW" tools:node="remove"/>
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" tools:node="remove"/>
<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" tools:node="remove"/>
<uses-permission android:name="android.permission.MANAGE_EXTERNAL_STORAGE" tools:node="remove"/>
```

**Debug build:** `android/app/src/debug/AndroidManifest.xml` retains `SYSTEM_ALERT_WINDOW` for RN dev tooling — **not merged into release**.

**Android 13+ media permissions:** Not added (no photo picker / media library feature requiring them).

---

## 3. Backup Policy

**Decision:** `android:allowBackup="false"` (UID-safe V1)

**Rationale:**

- Cloud save is authoritative for linked accounts (`ownerUid` isolation, B-002)
- Local AsyncStorage includes gameplay + recovery quarantine (C-001)
- Android Auto Backup could restore stale/cross-profile local state and conflict with account switch / recovery flows

**Not used:** `dataExtractionRules` / `fullBackupContent` selective backup — full disable is safer given documented cross-account data-mixing risk.

---

## 4. Merged Release Manifest Verification

**Task run (no AAB/APK):**

```text
cd android
gradlew.bat :app:processReleaseMainManifest
gradlew.bat :app:processReleaseManifestForPackage  (after clean)
```

**File inspected:**

`android/app/build/intermediates/merged_manifest/release/processReleaseMainManifest/AndroidManifest.xml`

| Check | Result |
|-------|--------|
| `SYSTEM_ALERT_WINDOW` | **Absent** |
| `READ_EXTERNAL_STORAGE` | **Absent** |
| `WRITE_EXTERNAL_STORAGE` | **Absent** |
| `MANAGE_EXTERNAL_STORAGE` | **Absent** |
| `allowBackup` | **`false`** |
| `package` | `com.ethemsincar.logisticore` |
| `targetSdkVersion` | **36** |
| `minSdkVersion` | 24 |

**Packaged manifest** (`processReleaseManifestForPackage`) also clean after `:app:clean`.

---

## 5. Changed Files

| File | Change |
|------|--------|
| `android/app/src/main/AndroidManifest.xml` | Remove legacy/restricted permissions; `allowBackup="false"`; merge strippers |
| `app.config.js` | `android.blockedPermissions` for prebuild parity |
| `scripts/android-release-manifest-policy-test.ts` | New policy test (source + merged + packaged) |
| `docs/release-audit/FIX_B004_RESULTS.md` | This report |

**Unchanged (intentional):** `android/app/src/debug/AndroidManifest.xml` — debug overlay permission.

---

## 6. Test Results

```text
npm run typecheck          → pass
npm run verify             → pass
npx tsx scripts/android-release-manifest-policy-test.ts → status: MITIGATED
```

---

## 7. Final AAB — Post-Build Checklist

After producing the next release AAB (not done in this task), confirm on the **Play Console / bundletool** merged manifest:

- [ ] No `SYSTEM_ALERT_WINDOW`
- [ ] No `READ_EXTERNAL_STORAGE` / `WRITE_EXTERNAL_STORAGE`
- [ ] No `MANAGE_EXTERNAL_STORAGE`
- [ ] `android:allowBackup="false"`
- [ ] Package `com.ethemsincar.logisticore`
- [ ] `targetSdkVersion` ≥ 34 (current build: 36)

---

## Acceptance Criteria

| Criterion | Status |
|-----------|--------|
| Restricted overlay permission absent from release | ✅ |
| Legacy storage permissions absent from release | ✅ |
| Backup policy explicit | ✅ `allowBackup=false` |
| Source + merged release manifest clean | ✅ |

**Build note:** New **Android AAB** required to ship manifest changes to Play Store.

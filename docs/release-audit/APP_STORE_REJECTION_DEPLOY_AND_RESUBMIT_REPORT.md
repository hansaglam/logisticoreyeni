# App Store Rejection — Production Deploy & Resubmission Prep

**Date:** 2026-08-28  
**Prior fix status:** `APP_STORE_REJECTION_FIX_READY` (client code)  
**Final status:** **`BLOCKED`**

---

## Executive Summary

Client-side rejection fixes (ATT order, visible account deletion, Apple revocation client path) are implemented and validated locally. **Production deploy and resubmission are blocked** because:

1. **All four Apple Sign-In revocation server secrets are missing** from local env and repo config.
2. **`revokeAppleSignInTokens` is not deployed** to production (16 functions live; new callable absent).
3. **A new iOS binary is still required** (not built in this pass).

Backend code builds and passes `backend:verify`. Production backend health is green for **currently deployed** functions.

---

## 1. Apple Env Preflight

Checked: shell environment, `.env`, `.env.production`, `.env.internal`, `.env.example` (presence only; private key contents not read or logged).

| Secret | Status |
|--------|--------|
| `APPLE_SIGNIN_TEAM_ID` | **missing** |
| `APPLE_SIGNIN_CLIENT_ID` | **missing** |
| `APPLE_SIGNIN_KEY_ID` | **missing** |
| `APPLE_SIGNIN_PRIVATE_KEY` | **missing** |

**Action:** Configure these as Firebase Functions runtime environment variables (or Secret Manager bindings) on project `logisticore-53ab4` before deploying `revokeAppleSignInTokens`.

**Deploy gate:** **STOPPED** — per policy, functions deploy was not executed.

---

## 2. Backend Validation

| Command | Result | Notes |
|---------|--------|-------|
| `npm --prefix backend run build` | **PASS** | Includes `revokeAppleSignInTokens` in compiled output |
| `npm --prefix backend test` (standalone) | **FAIL** | Firestore emulator not running (`ECONNREFUSED :8080`) — expected without `firebase emulators:exec` |
| `npm run backend:verify` | **PASS** | 64/64 emulator tests; cloud-save conflict + production audit PASS |
| `npx tsc --noEmit` | **PASS** | |
| `git diff --check` | **PASS** | CRLF warning on `package.json` only |

### Targeted path verification (code + emulator tests)

| Area | Status |
|------|--------|
| `revokeAppleSignInTokens` callable | **Present in source**; auth-gated; rate-limited; **not in production deploy** |
| `prepareVehicleMarketplaceAccountDeletion` | **PASS** — marketplace cleanup + `recursiveDelete(users/{uid})` + leaderboard removal |
| Guest deletion path | **Client skips cloud callable** for anonymous/guest; local + auth delete |
| Apple-linked deletion | **Client calls** `revokeAppleSignInIfNeeded()` before cloud delete; **server needs secrets + deploy** |
| Marketplace cleanup compatibility | **PASS** — emulator test “account deletion cancels active listing…” |
| Leaderboard cleanup | **PASS** — emulator test “account deletion clears leaderboard entries” |

---

## 3. Functions Deploy

**Status:** **NOT DEPLOYED** (blocked by §1)

Planned command (after secrets configured):

```powershell
$env:FUNCTIONS_DISCOVERY_TIMEOUT="60"
firebase deploy --only functions --project logisticore-53ab4
```

### Expected deploy delta (post-unblock)

| Function | Current production | After deploy |
|----------|-------------------|--------------|
| `revokeAppleSignInTokens` | **Absent** | **New** |
| `prepareVehicleMarketplaceAccountDeletion` | Active | Updated if code changed |
| Other account/marketplace callables | Active | Unchanged unless in diff |

**Recorded production function count (pre-deploy):** 16  
**`revokeAppleSignInTokens` deploy status:** **SKIPPED — BLOCKED**

---

## 4. Production Health

```text
npm run production:backend-check
```

| Check | Result |
|-------|--------|
| `missing` | `[]` |
| `wrongRegion` | `[]` |
| `stale` | `false` |
| `marketplaceFunctionsActive` | `true` |
| `cleanupWorkersActive` | `true` |
| `missingIndexGroups` | `[]` |

Global economy epoch fresh (~19 min at check time).

---

## 5. iOS Build Preflight

| Item | Status |
|------|--------|
| `NSUserTrackingUsageDescription` | **Present** — `ios/LogistiCore/Info.plist` + `app.config.js` (`expo-tracking-transparency` + AdMob plugin) |
| `expo-tracking-transparency` | **In `package.json` + `app.config.js` plugins** |
| `expo-apple-authentication` | **In `package.json` + `app.config.js` plugins** |
| `usesAppleSignIn` | **true** in `app.config.js` |
| AdMob / UMP | **Configured** — production iOS app ID in plist (`GADApplicationIdentifier`); UMP via `react-native-google-mobile-ads` |
| Production test ads disabled | **PASS** — `.env.production`: `EXPO_PUBLIC_ADS_USE_TEST_IDS=false`, `EXPO_PUBLIC_ADS_ENABLED=true` |
| `LOGISTICORE_BUILD_PROFILE` | `production` in `.env.production` |

### Version / build readiness

| Source | Marketing version | Build number |
|--------|-------------------|--------------|
| `app.json` | **1.0.32** | iOS: **not set** (Android `versionCode`: 33) |
| `ios/LogistiCore/Info.plist` (checked in) | **1.0.0** (likely stale vs Expo config) | **1** (likely stale) |

**App Store Connect current build state:** unknown from this repo.

**Required for resubmission binary:**

- **Marketing version (`CFBundleShortVersionString`):** use **1.0.32** from `app.json` unless App Store Connect requires a higher version for this rejection resubmit.
- **iOS build number (`CFBundleVersion`):** **must be incremented above the last build uploaded to App Store Connect** (not known here). After `expo prebuild` / archive, confirm the generated plist matches `app.json` before upload.

**Binary built in this pass:** **No** (audit only).

**New binary required for App Review:** **Yes**

---

## 6. App Store Connect Privacy Recommendations

Based on **post-fix runtime behavior** (AdMob rewarded ads, UMP, ATT-gated personalization, Firebase Auth, cloud save, no in-app Firebase Analytics/Crashlytics).

### Tracking umbrella

| Question | Recommendation |
|----------|----------------|
| **Does your app track users?** | **Yes** — when user grants ATT and UMP allows personalized ads, AdMob may use IDFA for cross-app advertising/tracking. When ATT denied/restricted, app requests **non-personalized ads only**. |

### Data types

| Data type | Collected? | Linked to user? | Used for tracking? | Purpose(s) |
|-----------|------------|-----------------|--------------------|------------|
| **Device ID** (IDFA when ATT authorized) | Yes | No* | **Yes** (when ATT authorized + personalized ad path) | Third-party advertising |
| **Advertising Data** | Yes | No* | **Yes** (when ATT authorized + personalized ad path) | Third-party advertising |
| **Product Interaction** (ad impressions/clicks via AdMob) | Yes | No* | **Yes** (when ATT authorized + personalized ad path) | Third-party advertising |
| **User ID** (Firebase Auth UID) | Yes | **Yes** | No | App functionality (cloud save, account, leaderboard, marketplace) |
| **Email Address** | Yes (if user signs in with Google/Apple and provider shares email) | **Yes** | No | App functionality (account) |
| **Gameplay Content** (save/progression synced to cloud) | Yes | **Yes** | No | App functionality |
| **Other User Content** (username/profile) | Yes | **Yes** | No | App functionality |
| **Crash Data** | **No** | — | No | Not collected (no Crashlytics/Sentry in app) |
| **Diagnostics** | **No** dedicated SDK | — | No | Production backend diagnostics disabled (`EXPO_PUBLIC_BACKEND_DIAGNOSTICS_ENABLED=false`) |

\*AdMob/UMP data is tied to device/advertising identifiers, not the LogistiCore account profile, unless your AdMob/UMP configuration links them (default AdMob behavior: treat as not linked to identity for App Privacy “Linked to You”).

### UMP / ATT nuance for reviewer alignment

- **UMP** = GDPR/EEA consent for ads (personalized advertising, measurement, etc.).
- **ATT** = Apple permission before tracking on iOS; requested **before** ad SDK init after main UI is ready.
- Denied ATT → non-personalized ad requests; game remains playable.

---

## 7. Review Notes Draft (English — paste into App Store Connect)

```
REJECTION FIXES — Guidelines 5.1.2(i) and 5.1.1(v)

1) App Tracking Transparency (Guideline 5.1.2(i))

LogistiCore now requests the iOS App Tracking Transparency permission before any tracking-dependent advertising SDK initialization.

Flow:
- Launch the app and reach the main game UI (boot completes).
- Shortly after the first screen is interactive, the system ATT dialog appears (if status is Not Determined).
- If the user denies or restricts tracking, the app continues normally and ad requests use non-personalized / non-tracking settings.
- Google UMP (consent) is separate from ATT and may appear for EEA users when required by AdMob.

Where to see ATT:
- Fresh install (or reset advertising permission for LogistiCore in Settings > Privacy & Security > Tracking).
- Open app → wait for main UI → ATT system prompt.

2) Account deletion (Guideline 5.1.1(v))

Account deletion is available in-app without hidden gestures:

More → Account → Account Center → Account tab → Account & Privacy → Delete Account

Steps:
- Tap "Delete Account" (red/destructive button).
- Confirm on the first dialog, then confirm again on the final destructive confirmation.
- Linked accounts: cloud save, username/profile, leaderboard entry, and marketplace account data are removed server-side; Firebase Auth user is deleted after cleanup.
- Sign in with Apple: when applicable, Apple tokens are revoked server-side during deletion (requires linked Apple account).

Test account: [provide App Review test account if needed]
```

---

## 8. App Review Reply Draft (English)

```
Hello App Review Team,

Thank you for your feedback. We have addressed both rejection items in a new build:

1. Guideline 5.1.2(i) — We now request App Tracking Transparency before initializing tracking-dependent advertising SDKs. Users who deny or restrict tracking still can play the game; ad requests fall back to non-personalized / non-tracking mode.

2. Guideline 5.1.1(v) — Account deletion is now easy to find in Account Center under Account & Privacy → Delete Account, with clear two-step confirmation. Full account and cloud data deletion is supported in-app, including Sign in with Apple token revocation when applicable.

Please see the Review Notes for exact navigation steps. We have attached screen recordings demonstrating the ATT prompt and the account deletion flow.

Thank you,
LogistiCore Team
```

---

## 9. Screen Recording Checklist

### Recording A — Account deletion (linked account recommended)

1. Use a **physical iPhone** (production or TestFlight build with rejection fixes).
2. Sign in with Apple or Google (create/link account).
3. Optional: create username / verify cloud save synced.
4. Navigate: **More → Account → Account Center → Account tab**.
5. Scroll to **Account & Privacy**.
6. Tap **Delete Account** (red button).
7. Show **first** confirmation dialog → tap continue.
8. Show **second** destructive confirmation → confirm.
9. Show success message and new guest session.
10. Optional: attempt cloud restore / sign-in with deleted account to show data is gone.

### Recording B — ATT

1. **Reset ATT state:** delete app, or Settings → Privacy & Security → Tracking → LogistiCore → Off/reset; use fresh install if possible.
2. Launch app; wait for main UI (do not rush past boot).
3. Capture **system ATT dialog** (appears after UI ready, before using rewarded ads).
4. Choose **Allow** or **Ask App Not to Track**.
5. Show game remains playable (navigate dashboard).
6. Optional: if EEA UMP form appears, show it is separate from ATT.

**Tip:** Record in portrait, show status bar, no personal data on screen.

---

## 10. Remaining Manual Steps (App Store Connect / Infra)

1. **Configure Apple Sign-In secrets** on Cloud Functions (`APPLE_SIGNIN_*`).
2. **Deploy functions:** `firebase deploy --only functions --project logisticore-53ab4`
3. **Verify** `revokeAppleSignInTokens` appears in `firebase functions:list`.
4. **Bump iOS build number** above last App Store Connect upload; align `app.json` / native plist via Expo prebuild.
5. **Archive iOS production build** (`LOGISTICORE_BUILD_PROFILE=production`, `validate:store-production` first).
6. **Update App Privacy** labels per §6 (especially **Data Used to Track You = Yes** with Device ID / Advertising Data when ATT+personalized ads path applies).
7. **Upload binary** to App Store Connect.
8. **Paste Review Notes** (§7) and **attach screen recordings** (§9).
9. **Submit for review** manually (not automated).

---

## Final Status

| Gate | Status |
|------|--------|
| Apple env secrets | **BLOCKED** (all missing) |
| Functions deploy | **SKIPPED** |
| Production health (current) | **PASS** |
| Client validation | **PASS** |
| New iOS binary | **Required — not produced** |

## **`BLOCKED`**

Unblock path: configure Apple secrets → deploy functions → produce and upload new iOS binary → update privacy labels → submit with Review Notes and recordings.

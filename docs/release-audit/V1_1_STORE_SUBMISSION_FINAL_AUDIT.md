# LogistiCore V1.1 — Store Submission Final Audit

**Date:** 2026-09-11  
**Scope:** Audit only — no code, flag, deploy, or console form submission  
**Project:** LogistiCore (`logisticore-53ab4`) only  
**Verdict:** `V1_1_STORE_SUBMISSION_AUDIT_COMPLETE`

---

## Executive summary

Store **forms** can be filled from repository truth for ads, tracking, account deletion, login, IAP, location, and financial features.  

**Do not use stale docs** that still mention ATT / iOS UMP / “track Yes” (`APP_STORE_REJECTION_*` historical drafts). Current truth: **no ATT**, **iOS NPA-only ads**, **Android UMP retained**, `NSPrivacyTracking=false`.

**P0 for dual-store product readiness (not a privacy-form field):** Android mandatory tutorial physical QA remains pending (`V1_1_REMAINING_WORK_AUDIT.md`).

**External operator work:** Fill App Privacy + Data Safety + ads + content rating in consoles; produce signed binaries; draft reviewer notes.

---

## 1. Login / account access

| Platform | Guest | Google | Apple |
|---|---|---|---|
| iOS | Yes (anonymous Firebase) | Yes | Yes |
| Android | Yes | Yes | **No** (code gates Apple to iOS) |

**Works without login (guest):** core logistics gameplay (contracts, fleet, map, warehouses, local market trade, local save), mandatory tutorial, rewarded ads (after onboarding gate).

**Requires linked (non-anonymous) account:** leaderboard, vehicle marketplace, seasons/challenges (when flags ON — **prod flags OFF**), season reward claim (prod OFF).

**Reviewer:** Guest is enough for main game. For marketplace/leaderboard: use Google (any Google account) or Apple (iOS). **No demo credentials in repo.**

---

## 2. Account deletion

| Check | Truth |
|---|---|
| In-app entry | Account Center → Hesap ve Gizlilik → Hesabı Sil / Misafir Kaydını Sil |
| Confirmations | Two-step dialogs (`useAccountCenter`) |
| Linked path | Callable `prepareVehicleMarketplaceAccountDeletion` → marketplace, username, leaderboard, season results, reward entitlements/claims, recursive `users/{uid}`, Apple revoke, Firebase Auth delete |
| Guest path | Local wipe; **skips** cloud callable |
| External URL | `https://hansaglam.github.io/logisticore-legal/account-deletion/` |

**Apple:** In-app deletion for account holders — **READY** (meets in-app deletion expectation per prior App Store fix docs).  
**Google:** In-app deletion + public URL present — **READY** for Play account-deletion disclosure.  
**EXTERNAL_POLICY_CONFIRMATION_NEEDED:** Whether Play still requires the web URL to remain live and match in-app language (URL exists; do not invent extras).

---

## 3. Ads

| Fact | Truth |
|---|---|
| SDK | `react-native-google-mobile-ads` (AdMob) |
| Formats | **Rewarded only** (no banner/interstitial in app source) |
| Audience | Guest + signed-in (after `onboarding.completed` for monetization CTAs) |
| iOS | Always `requestNonPersonalizedAdsOnly: true`; **no UMP UI** |
| Android | UMP gather + privacy options when required |
| Test IDs | DEV/internal; **forbidden** in store production (`storeProductionPolicy`) |
| Prod IDs | Declared in `adMobConstants` / Android manifest `GADApplicationIdentifier` |

**Store declaration:** **Contains ads = YES** (Apple ads-related privacy + Google “Does your app contain ads?” → **YES**).

---

## 4. Tracking / ATT

| Check | Truth |
|---|---|
| ATT prompt | **Absent** |
| `NSUserTrackingUsageDescription` | **Absent** |
| `NSPrivacyTracking` | **false** (`PrivacyInfo.xcprivacy`) |
| IDFA / tracking APIs in app | **Absent** |

**Apple App Privacy — Tracking: NO**

Justification: no ATT; Privacy Manifest tracking false; iOS ads forced NPA; regressions assert no tracking usage string (`ios-ump-removal-regression-test`, `IOS_NO_TRACKING_PRIVACY_AUDIT`, `APPLE_5_1_2_IOS_UMP_REMOVAL`).

---

## 5. Apple App Privacy — submission matrix (repo-based)

| Category | Collected? | Linked to user? | Used for tracking? | Purpose (repo) |
|---|---|---|---|---|
| Email Address | **Yes** (optional) | Yes (Auth provider) | No | App Functionality (Google/Apple sign-in) |
| User ID | **Yes** (Firebase UID) | Yes | No | App Functionality (save, marketplace, leaderboard) |
| Device ID | **Likely via AdMob SDK** | Possibly | **No** (tracking) | Third-Party Advertising / App Functionality — **EXTERNAL_POLICY_CONFIRMATION_NEEDED** for exact Apple labels with NPA AdMob |
| Gameplay Content | **Yes** (save state, scores, username) | Yes | No | App Functionality |
| Product Interaction | **No dedicated analytics SDK active** | — | — | V11 analytics provider is **fail-closed / no-op** in store (`EXPO_PUBLIC_ENABLE_V11_ANALYTICS=false`, no provider). Do **not** declare Product Interaction unless AdMob requires interaction disclosure — **EXTERNAL_POLICY_CONFIRMATION_NEEDED** |
| Crash Data | **No in-app Crashlytics** | — | — | Not app-initialized. Expo/OS defaults only if any — do not overclaim |
| Coarse Location | **No app GPS** | — | — | Map uses fictional network positions. AdMob may infer coarse location server-side — **EXTERNAL_POLICY_CONFIRMATION_NEEDED** for AdMob-only coarse location disclosure |
| Precise Location | **No** | — | — | No `expo-location` / location permissions |
| Name / Phone / Photos / Contacts / Payment / Browsing / Search / Sensitive | **No** (not collected by app) | — | — | — |
| Advertising Data | **Yes** (AdMob rewarded) | May be linked via ads stack | **No** (tracking=NO; iOS NPA) | Third-Party Advertising |

`PrivacyInfo.xcprivacy` has empty `NSPrivacyCollectedDataTypes` but still declares required reason APIs (UserDefaults, file timestamp, etc.). **App Privacy labels in Connect remain operator-filled** from this matrix — do not assume empty manifest means “collects nothing.”

---

## 6. Google Play Data Safety — submission matrix

| Data type | Collected | Shared | Stored | Required/Optional | Purpose | Encrypted in transit | Deletion |
|---|---|---|---|---|---|---|---|
| Email | Yes (Google/Apple) | With Google/Apple Auth | Yes (Auth/profile) | Optional (guest OK) | Account | Yes (HTTPS/Firebase) | Account delete |
| User ID | Yes | Firebase/backend | Yes | Required for cloud features; guest has anonymous UID | Account / App functionality | Yes | Account delete |
| Device or other IDs | Yes via AdMob (esp. Android advertising ID) | Shared with Google Ads | SDK-managed | Optional (ads optional) | Advertising | Yes | Limited (ads SDKs); account delete clears app account data |
| Gameplay activity / content | Yes (saves, scores, username) | Firebase (Firestore/Functions) | Yes | Required for cloud features | App functionality | Yes | Account delete + guest local wipe |
| App interactions | Only if AdMob measures ad interaction | Google Ads | SDK | Optional | Advertising | Yes | SDK |
| Crash logs | No Crashlytics in app | — | — | — | — | — | — |
| Approximate location | Not by app APIs | Possibly AdMob | SDK | Optional | Advertising | Yes | SDK |
| Precise location | No | No | — | — | — | — | — |

**COLLECTED** vs **SHARED WITH SERVICE PROVIDER:**  
- Firebase Auth/Firestore/Functions = service providers for app functionality.  
- AdMob = advertising service provider / third party for ads.  
Do **not** claim “not shared” for AdMob identifiers.

---

## 7. Location

- No device GPS / `expo-location` / location permissions in source manifests.  
- Map: fictional logistics network positions (not player GPS).  
- Do **not** declare precise location.  
- Coarse location only if AdMob disclosure requires it (policy confirm).

---

## 8. Device ID / analytics / crash

| Service | Active in production store profile? |
|---|---|
| Firebase Auth / Firestore / Functions | **Yes** |
| Firebase Analytics SDK init | **No** |
| Crashlytics | **No** |
| V11 analytics | **Disabled** (no provider; flag false in store) |
| AdMob | **Yes** (rewarded) |

---

## 9. User-generated content

| Element | Present? |
|---|---|
| Usernames | **Yes** (leaderboard display; validated format) |
| Marketplace free-text / chat / bios / photos | **No** |
| Listing content | Truck selection + **numeric price** only |

**UGC = YES (limited)** — usernames visible to others on leaderboard.  
Not a social network / chat app. Rating/questionnaire: disclose user interaction / UGC as applicable — **EXTERNAL_POLICY_CONFIRMATION_NEEDED** for exact Apple/Google UGC form wording.

---

## 10. Vehicle marketplace / IAP / financial

| Claim | Truth |
|---|---|
| Virtual game vehicles only | Yes |
| Real money / crypto / cash-out | **No** |
| IAP / subscriptions | **No** (no IAP packages) |
| Login required | Yes (linked account) |
| Gambling / chance purchase | **No** |

**Play Financial features: NO** — in-game virtual economy ≠ financial services.  
**EXTERNAL_POLICY_CONFIRMATION_NEEDED** only if Play form text is ambiguous about “virtual currencies.”

---

## 11. Age rating / contests / children

**Gameplay content (repo):** logistics management simulation; no sexual content, drugs, horror, or real-money gambling found; marketplace is virtual; season cash rewards **disabled** in production.

**Contests / leaderboard:** Competitive weekly leaderboard with usernames. Production has **no** enabled cash prize contest (rewards flags OFF). Recommend answering as **competitive ranking / leaderboard**, **not** gambling or chance contest. Exact Apple “Contests” radio — **EXTERNAL_POLICY_CONFIRMATION_NEEDED**.

**Children / Kids category:** Not designed for children; no parental controls / age gate in app. Target audience: **teen/adult general**. Not Kids Category.

**Apple age rating:** Prior operator note **13+**; current content is mild but UGC/leaderboard may drive questionnaire to 12+/13+. **Do not change rating in this audit** — complete Apple questionnaire from current answers; confirm vs prior 13+.

**Google content rating:** Complete IARC questionnaire from same truth (simulation, mild UGC, ads, no violence). Console **EXTERNAL PENDING**.

---

## 12. Permissions

| Permission | Platform | Why | Store text? | Unused dangerous? |
|---|---|---|---|---|
| Internet / network | Both | Firebase, ads, auth | Standard | No |
| VIBRATE | Android | Feedback | Usually none | Low risk |
| Remote notification background | iOS (`UIBackgroundModes`) | Notifications module present | If push used | Confirm whether push is user-facing in store build — **P1 verify** |
| Tracking | iOS | — | — | **Not present** (good) |
| Location / camera / mic / photos | — | — | — | **Not declared** (good) |
| SYSTEM_ALERT_WINDOW / external storage | Android | — | — | **Explicitly stripped** |
| AD_ID | Android | May merge from AdMob | Ads disclosure | **P1:** confirm merged manifest after production bundle |

No unused dangerous permissions found in source manifests.

---

## 13. SDK inventory (production-relevant)

| SDK | Active? | Declaration impact |
|---|---|---|
| Firebase JS (Auth/Firestore/Functions client) | Yes | Account, User ID, gameplay data |
| Firebase Admin (backend) | Yes | Server authority |
| Google Sign-In | Yes | Email / account |
| Apple Sign-In (iOS) | Yes | Email / account |
| Google Mobile Ads | Yes | Ads, identifiers, advertising data |
| expo-notifications | Present | Push capability — verify usage in store build |
| Expo core modules | Yes | Runtime |
| Firebase Analytics / Crashlytics RN | **No** | Do not declare as active analytics/crash SDKs |
| IAP / location / tracking-transparency | **Absent** | — |

---

## 14. Privacy / terms links

| Link | URL | Status |
|---|---|---|
| Privacy policy | https://hansaglam.github.io/logisticore-legal/privacy-policy/ | **READY** (in-app) |
| Privacy choices | …/privacy-choices/ | **READY** |
| Account deletion | …/account-deletion/ | **READY** |
| Support | …/support/ | **READY** |
| Dedicated Terms of Service | **NOT_FOUND** | In-app “Yasal Belgeler” opens **privacy policy** |

**Privacy policy: READY**  
**Terms: MISSING as separate URL** — P1 if store listing requires distinct Terms (**EXTERNAL_POLICY_CONFIRMATION_NEEDED**).

---

## 15. Listing consistency

Do **not** advertise in store listing:
- Season cash rewards / payouts (prod OFF)
- Seasons/challenges as live features if production flags remain false
- IAP / real-money trading
- Multiplayer beyond leaderboard/marketplace asocial listings
- Tracking / personalized ads on iOS

Safe claims: logistics simulation, guest play, optional Google/Apple link, leaderboard & vehicle marketplace for linked accounts, rewarded ads, offline-capable local play (with documented limits).

---

## 16. APPLE APP STORE CONNECT — answer sheet

**App Privacy**
- Email Address: Collected (optional), linked to user, not used for tracking; App Functionality  
- User ID: Collected, linked, not tracking; App Functionality  
- Device ID: Disclose if required for AdMob — not used for tracking; Advertising — confirm labels  
- Gameplay Content: Collected, linked, not tracking; App Functionality  
- Product Interaction: Generally **do not declare** first-party analytics (disabled); confirm AdMob-only needs  
- Crash Data: **Do not declare** custom Crashlytics (absent)  
- Coarse Location: **No app collection**; confirm AdMob-only policy  
- Tracking: **NO**

**Age Rating (content guidance)**
- Parental Controls: No  
- Age Assurance: No  
- UGC: Limited (usernames) — confirm form  
- Unrestricted Web: No (no arbitrary browser)  
- Profanity / Horror / Drugs / Sexual / Medical: No evidence  
- Violence: No graphic violence in sim  
- Gambling / Simulated Gambling: No  
- Contests: Leaderboard competitive ranking; no prod cash prizes — confirm form  

**Account**
- Login: Guest + Google + Apple (iOS)  
- Guest: Yes  
- Delete Account: In-app + web URL  
- Reviewer access: Guest for core; Google/Apple for marketplace/leaderboard  

**Ads**
- Contains ads: **YES** (rewarded)  
- ATT: **Not used**  
- Consent: iOS NPA-only; Android UMP  

---

## 17. GOOGLE PLAY CONSOLE — answer sheet

**Data Safety**
- Collect: email (optional), user IDs, gameplay/save data, username, ad-related identifiers via AdMob  
- Share: Firebase providers; Google Ads/AdMob  
- Encryption in transit: Yes  
- Deletion: In-app account deletion + web URL  

**Ads:** Contains ads = **YES**

**App Access:** **Yes, partially restricted** — guest plays core; marketplace/leaderboard (and gated V1.1 features) need Google Sign-In. Provide instructions in Play App Access form.

**Content Rating:** Complete IARC from simulation + ads + limited UGC; console pending.

**Target Audience:** Not child-directed; general / teen+ consistent with ads + account features.

**Financial Features:** **NO**

**Account Deletion:** In-app **YES**; external URL **YES** (`…/account-deletion/`)

---

## 18. Reviewer notes (recommended draft)

**App Review / Play review**

1. Launch as Guest — full core logistics loop available.  
2. Optional: Google Sign-In (or Apple on iOS) to access Leaderboard and Vehicle Marketplace. Any personal Google/Apple test account is fine; **no special demo password in repo**.  
3. Account deletion: Yönetim/More → Hesap → Hesap Merkezi → Hesap ve Gizlilik → Hesabı Sil (two confirms). Guest: Misafir Kaydını Sil.  
4. Ads: optional rewarded placements after onboarding; iOS non-personalized; Android may show consent (UMP).  
5. Seasons/challenges/season rewards are **disabled** in production store builds — do not expect those UIs.  
6. Privacy: https://hansaglam.github.io/logisticore-legal/privacy-policy/  

---

## 19. Blocker classification

| Item | Class |
|---|---|
| Fill Apple App Privacy + Play Data Safety from this matrix | **P0** (submission process) |
| Declare Contains ads = YES | **P0** if omitted |
| Tracking = NO (do not declare ATT) | **READY** / **P0** if wrongly set YES |
| Account deletion in-app + URL | **READY** |
| IAP / financial features NO | **READY** |
| Android mandatory tutorial QA | **P0 product** (dual-store quality; not a privacy field) |
| Confirm AdMob Device ID / advertising ID labels | **P1** + EXTERNAL_POLICY |
| Confirm Contests / UGC questionnaire answers | **P1** + EXTERNAL_POLICY |
| Dedicated Terms URL if required | **P1** + EXTERNAL_POLICY |
| Production AD_ID merge / push notification actual use | **P1** |
| Signed binaries + reviewer notes | **P1** |
| Sync stale FINAL_RELEASE §18 ATT wording | **P2** (this audit supersedes) |
| Season rewards enablement | **Not for this submission** |

---

## 20. What not to do

- Re-enable ATT / iOS UMP for submission  
- Claim no ads  
- Claim tracking Yes  
- Advertise seasons/rewards as live  
- Mark financial features Yes because of virtual cash  
- Invent MatchAI/other-project data practices  
- Invent a Terms URL that does not exist  

---

## 21. Status vs remaining-work audit

| Gate | Status |
|---|---|
| Store disclosure truth | **COMPLETE** (this doc) |
| Console form fill | Operator EXTERNAL |
| Android tutorial QA | Still pending |
| Phase 7 payout | Not required for V1.1 store enablement |

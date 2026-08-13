# Ads Privacy / Rewarded Ads Fix — Results

**Date:** 2026-08-13  
**Scope:** UMP consent gate, rewarded CTA UX, publisher misconfiguration handling  
**Builds:** AAB/APK/IPA/Xcode Archive **not produced** (per task scope)

---

## 1. Old privacy blocker chain (root cause)

```
Rewarded CTA press
  → useAdPrivacyAction.runPrivacyAction()
  → completeAdPrivacyAction()
  → showAdsPrivacyOptionsForm()   // ALWAYS first
  → (often fails / wrong form)
  → "Gizlilik tercihleri açılamadı" shown to user
  → ad never shown, reward never granted
```

**Findings:**

| Issue | Detail |
|-------|--------|
| Privacy form on every ad click | `completeAdPrivacyAction()` always opened privacy **options**, not UMP consent |
| `privacyOptionsRequirementStatus` ignored | Never read before showing form |
| `canRequestAds === true` bypass missing | Ready users still routed to privacy settings |
| Config error → user deadlock | Publisher misconfiguration surfaced as technical privacy error |
| Rewarded vs Account same helper | Both used `runPrivacyAction()` |
| Error latch | Config failures could re-trigger form loops |

**Device error (publisher misconfiguration):**

```
Failed to read publisher's account configuration;
no form(s) configured for the input app ID.

Android App ID: ca-app-pub-8214453687597896~5560651696
```

---

## 2. New canonical privacy state machine

`AdPrivacyState` in `src/domain/adPrivacyState.ts`:

| State | Meaning |
|-------|---------|
| `loading` | Consent info update in progress |
| `not-required` | Consent not required; ads may be requested |
| `required` | UMP consent form should be shown |
| `ready` | `canRequestAds === true` |
| `blocked` | Consent required but user has not granted ad request |
| `config-error` | Publisher/config problem; ads safely disabled, game continues |

`config-error` ≠ `blocked` — config errors are latched for the session (no retry loop).

---

## 3. New rewarded flow

```
Rewarded CTA press
  → ensureAdsAllowedForReward() / handleRewardedAdRequest()
  → if canRequestAds → allowed (no privacy settings screen)
  → if consent REQUIRED → gatherConsent() (UMP form)
  → if config-error → "Reklam şu anda kullanılamıyor. Daha sonra tekrar dene."
  → applyAdReward() → showRewardedAd() → reward ONLY on EARNED_REWARD callback
```

**Account Center (separate):**

```
Gizlilik Tercihlerini Yönet
  → openAccountPrivacyOptions()
  → only if privacyOptionsRequirementStatus === REQUIRED
  → else "Ek reklam gizlilik tercihi gerekmiyor."
```

---

## 4. Key file changes

| File | Change |
|------|--------|
| `src/services/adsConsentService.ts` | Rewritten: `handleRewardedAdRequest`, `openAccountPrivacyOptions`, config latch, masked dev logs |
| `src/services/adsConsentPolicy.ts` | Error classification, `privacyOptionsRequirementStatus`, `maskAdMobAppId` |
| `src/domain/adPrivacyState.ts` | Canonical states + user messages |
| `src/domain/rewardedAdAvailability.ts` | Removed `privacy-action-required`; consent flows through ad CTA |
| `src/hooks/useRewardedAdRequest.ts` | New hook for rewarded surfaces |
| `AdRewardButton`, `DashboardDailyOpsBonusCard`, `DeliveryBoostPanel` | Use `ensureAdsAllowedForReward`, not privacy settings |
| `AccountPreferencesTab` | Conditional privacy options row |
| `scripts/ad-privacy-regression-test.ts` | 44 assertions |

---

## 5. Behavior by scenario

| Scenario | Behavior |
|----------|----------|
| **notRequired / non-EEA** | Direct ad preload/show; no privacy modal |
| **canRequestAds true** | Direct ad; privacy screen not reopened |
| **consent required** | UMP form on CTA press; then ad if allowed |
| **user denies consent** | No ad, no reward |
| **config-error** | User message only; no form loop; no technical error |
| **network error** | Retry on next CTA press |

---

## 6. AdMob Console — external task (manual)

Code handles missing console config gracefully. **Publisher must still:**

1. AdMob → **Privacy & messaging** → **European regulations**
2. Select Android app (`ca-app-pub-8214453687597896~5560651696`)
3. Create & **publish** consent message (vendors/settings)
4. Repeat for iOS app if separate AdMob app ID exists
5. Verify message status = Published (not draft)

Until published, EEA users may see `config-error` degraded mode — app must not crash or deadlock.

---

## 7. Verification results

| Check | Result |
|-------|--------|
| `npm run typecheck` | PASS |
| `npm run verify` | PASS (incl. ad-privacy-regression 44/44) |
| `npx expo export --platform android` | PASS |
| `npx expo export --platform ios` | PASS |
| `git diff --check` | PASS |
| AAB/APK/IPA/Xcode Archive | **Not produced** |

---

## 8. Real device acceptance (manual)

### Android / iOS

| Test | Expected |
|------|----------|
| A — Consent not required | Rewarded CTA → ad directly, no privacy screen |
| B — EEA debug geography | UMP consent form → ad follows `canRequestAds` |
| C — Config error (until AdMob publish) | No crash, no infinite modal, unavailable copy only |

---

## 9. Acceptance criteria

- [x] Consent-not-required users watch ads directly
- [x] `canRequestAds true` does not reopen privacy screen
- [x] Consent-required users not bypassed
- [x] Privacy options only when UMP `REQUIRED`
- [x] Publisher misconfiguration no UI deadlock
- [x] Technical "gizlilik tercihleri açılamadı" removed from rewarded flows
- [x] Reward only on SDK earned callback
- [x] Android + iOS share same business logic (`adsConsentService` + policy)
- [x] Game/save/auth unaffected by ads privacy errors

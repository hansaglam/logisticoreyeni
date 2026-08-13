# Dashboard Starter Guide Removal — Results

**Date:** 2026-08-13  
**Scope:** Remove legacy “BAŞLANGIÇ REHBERİ” Dashboard card + duplicate screen hints  
**Builds:** AAB / APK / IPA / Xcode Archive **not produced**

---

## 1. Exact source

| Layer | File | Role |
|-------|------|------|
| **Dashboard card UI** | `src/components/dashboard/DashboardNextActionCard.tsx` | **Deleted** — rendered “BAŞLANGIÇ REHBERİ · N/5”, step title, CTA |
| **Dashboard mount** | `src/screens/DashboardScreen.tsx` | `showOnboardingCard && <DashboardNextActionCard …>` — **removed** |
| **Step config / labels** | `src/onboarding/onboardingConfig.ts` | 5 steps, `getOnboardingProgressLabel()` → `BAŞLANGIÇ REHBERİ · …` — **kept** (domain) |
| **Progress engine** | `src/onboarding/onboardingProgress.ts` | `syncOnboardingProgress`, `resolveOnboardingDashboardAction` — **kept** (gate logic) |
| **Screen hints** | `src/components/onboarding/OnboardingHintCard.tsx` | **Deleted** — Contracts / Map / Missions duplicate banners |
| **Artwork registry** | `src/assets/onboardingAssets.ts` | **Deleted** — only used by removed card (~3 MB PNGs dropped from bundle) |

Strings “İlk İşini Seç” / “İşlere Git” also appear in `dashboardHubLogic.ts` (`resolveNextAction`) but that helper is **not mounted** on Dashboard today.

---

## 2. State / visibility (old card)

Card shown when:

```ts
isOnboardingActive(onboarding) && resolveOnboardingDashboardAction(...) != null
```

`onboarding` save fields:

- `enabled`, `completed`, `currentStepId`, `completedStepIds`
- `visitedScreens`, `assignmentOpened`, `missionRewardClaimed`
- `dismissedHintIds` (legacy hints)

**Not a separate progression game** — step derived from real gameplay:

| Step ID | Advance trigger |
|---------|-----------------|
| `choose_first_contract` | Default new save |
| `assign_team` | `assignmentOpened` (contract modal) |
| `track_delivery` | Delivery started / active |
| `complete_first_delivery` | Map visited + delivery active |
| `claim_first_reward` | First contract completed |
| *(complete)* | Mission reward claimed / missions visit / contracts ≥ 1 |

---

## 3. Overlap with new tutorial system

| Old (V1) | New (`AppTutorialOverlay`) |
|----------|----------------------------|
| Dashboard 5-step card + CTAs | Dashboard 4-step spotlight (first visit only) |
| Contracts / Map hint cards | Contracts / Map screen tutorials |
| Auto on every session until complete | Auto **once** per screen; `?` manual replay |

**Overlap ~85%+** — same user journey (contract → assign → map → complete → missions).  
**Decision:** Remove V1 **UI only**; keep V1 **progression gate** in save.

---

## 4. Critical business logic preserved

`onboarding.completed` still gates (unchanged):

| Consumer | Behavior |
|----------|----------|
| `DashboardDailyOpsBonusCard` | Hidden until onboarding complete |
| `AdRewardButton` / `DeliveryBoostPanel` | Rewards blocked until complete |
| `useScreenAppTutorial` | `isOnboarding: !onboardingCompleted` during early game |

Background sync **retained**:

- `advanceOnboardingProgress()` in `gameStore` (delivery, mission claim, etc.)
- `useEffect` on `DashboardScreen` re-syncs on relevant deps
- `useOnboardingScreenVisit` on Dashboard / Contracts / Map / Missions (no UI)

---

## 5. Rewards

**Card gave no rewards.** Rewards live in **missions** (`STARTER_MISSION_IDS`) via `claimMissionReward` — unchanged.

Step 5 only **navigated** to Missions; payout is mission system.

---

## 6. Navigation

“İşlere Git” was `dispatchOnboardingNavigation → tab: contracts`.  
Duplicate of bottom **İşler** tab — safe to remove.

---

## 7. Save / migration

- `onboarding` field **still written** for progression gate
- No schema migration; legacy saves normalize via `normalizeOnboardingState`
- `resolveOnboardingDashboardAction` kept + `@deprecated` for `onboarding-smoke-test.ts`

---

## 8. Dashboard layout after removal

Order:

1. Resource bar + `?` tutorial help  
2. Company hero card  
3. Piyasa Olayları | Alınacak Ödüller (split row)  
4. Management module grid + daily ops bonus  

No placeholder for removed card; section flow uses existing `dashboardStyles.lowerSection` gap.

---

## 9. Tutorial source of truth

| Concern | Source |
|---------|--------|
| Visual first-visit guide | `AppTutorialOverlay` + `tutorialProgress` |
| Early-game monetization gate | `onboarding.completed` (background) |

---

## 10. Removed code

- `DashboardNextActionCard.tsx`
- `OnboardingHintCard.tsx`
- `onboardingAssets.ts`
- Dashboard card mount + hint hooks in Contracts / Map / Missions
- `useActiveOnboardingHint` from `useOnboardingScreenVisit.ts`
- Export of `DashboardNextActionCard` from `components/dashboard/index.ts`

**Added:** `scripts/dashboard-starter-guide-removal-test.ts` (in `npm run verify`)

---

## 11. Test results

| Check | Result |
|-------|--------|
| `npm run typecheck` | **PASS** |
| `dashboard-starter-guide-removal-test.ts` | **PASS** (19/19) |
| `onboarding-smoke-test.ts` | **PASS** (21/21) |
| `app-tutorial-regression-test.ts` | **PASS** (26/26) |
| `tutorial-first-visit-regression-test.ts` | **PASS** (43/43) |
| `npx expo export --platform android` | **PASS** (~7.9 MB HBC; onboarding step PNGs no longer in asset list) |
| `npx expo export --platform ios` | **PASS** (~7.89 MB HBC) |
| AAB / APK / IPA / Archive | **Not produced** |

---

## 12. Manual device checks

- [ ] Fresh save: Dashboard **no** “BAŞLANGIÇ REHBERİ” card  
- [ ] Dashboard tutorial auto once; second visit silent; `?` replays  
- [ ] Contracts / Map / Missions: no “REHBER” hint strip  
- [ ] First delivery → mission reward → daily ops ad card unlocks  
- [ ] Android + iOS layout: no dead gap between events row and module grid  

---

## Summary

| Item | Result |
|------|--------|
| Exact component | `DashboardNextActionCard` (+ `OnboardingHintCard` on other screens) |
| Old purpose | Visual 5-step funnel + navigation shortcuts |
| Duplicate with new tutorial | **Yes** — UI removed |
| Rewards | **None on card** — missions unchanged |
| Business gate | **Preserved** (`onboarding.completed`) |
| Dashboard | Cleaner, no starter card |
| Android / iOS | Same code path |

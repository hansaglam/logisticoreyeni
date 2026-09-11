# V1.1 Phase 6 — Getting Started / Help System

## PHASE 6 STEP 2 — CONTEXTUAL GUIDE FOUNDATION

**Date:** 2026-09-08  
**Status:** Foundation only (no visual cards, no Help screen, no AppTutorial removal)

### Persistence model

Additive save-scoped field on `StoreGameState` / `SaveGamePayload`:

```ts
contextualGuide: {
  version: number;
  status: 'eligible' | 'active' | 'dismissed' | 'completed';
  completedCardIds: ContextualGuideCardId[];
  dismissedCardIds: ContextualGuideCardId[];
}
```

- **Version:** `CONTEXTUAL_GUIDE_VERSION = 1`
- Lives in the existing game save blob (AsyncStorage + cloud full-save sync)
- **No** device-global AsyncStorage keys
- Independent from `onboarding.completed` (ads / legacy sequencing unchanged)

### Stable card IDs

| ID | Future meaning |
|----|----------------|
| `welcome` | Map / Home welcome |
| `choose_contract` | Contracts |
| `manage_fleet` | Fleet |
| `follow_route` | Route / delivery tracking |
| `need_help` | Point to Help & Guide |

Constants: `src/contextualGuide/contextualGuideState.ts` → `CONTEXTUAL_GUIDE_CARD_IDS`

### New / existing player inference

Missing `contextualGuide` **does not** mean new player.

Signals (`buildContextualGuideProgressSignals` / `hasExistingPlayerProgress`):

- `completedContracts >= 1`
- `activeDeliveryCount > 0`
- `missions.flags.deliveryStarted`
- `missions.flags.tradePurchased`
- `player.level > 1`
- `tutorial.isCompleted`
- `onboarding.completed`
- any `tutorialProgress` presentation / completion / skip / dismiss / manual replay

| Cohort | Resulting status | Auto-show later? |
|--------|------------------|------------------|
| True new player | `eligible` | Yes (Step 3+) |
| Existing, no field | `dismissed` | No |
| Has persisted guide | normalize & preserve | Per status |

**Why `dismissed` for existing players:** they never saw cards; `completed` would falsely imply finishing the guide. Manual Help replay uses `resetContextualGuideForReplay` → `active` with empty card lists.

### Old-save normalization

- `normalizeSavePayload` / `payloadToStoreState` call `resolveContextualGuideFromSave`
- Additive only; legacy tutorial / onboarding / spotlight / tutorialProgress / market flags untouched
- Serialize always writes `contextualGuide`

### Account / guest / cloud

- Guide state is part of each save → A→B→A restores per-account state
- Guest fresh save → `eligible`
- Linking/restoring a progressed cloud save without the field → `dismissed` (no fresh guide)

### Store API

| Action | Behavior |
|--------|----------|
| `markContextualGuideCardCompleted(cardId)` | Idempotent unique IDs; eligible→active; all cards→completed |
| `dismissContextualGuideCard(cardId)` | Idempotent |
| `completeContextualGuide()` | Whole-guide completed |
| `dismissContextualGuide()` | Whole-guide dismissed (skip auto) |
| `resetContextualGuideForReplay()` | Future Help replay → active, cleared lists |

### Ads gate confirmation

- **No changes** to `onboarding.completed`, `hasCompletedOnboarding`, `canGrantAdReward`, `applyAdReward`
- Completing/dismissing contextual guide **does not** unlock ads

### Files changed

- `src/types/game.ts`
- `src/contextualGuide/contextualGuideState.ts` (new)
- `src/storage/saveGame.ts`
- `src/store/gameStore.ts`
- `scripts/contextual-guide-foundation-regression-test.ts` (new)
- `docs/release-audit/V1_1_PHASE_6_GETTING_STARTED_HELP.md` (this file)

### Tests

`npx tsx scripts/contextual-guide-foundation-regression-test.ts`

Covers fresh/existing inference, preserve state, idempotent mutations, save normalize, account isolation, guest, cloud restore, ads gate unchanged.

### Known pending UI work (Step 3+)

- Wire contextual cards onto Dashboard / Contracts / Fleet / Map screens
- Fill Help & Guide section content
- Disable/remove AppTutorial / MarketTutorial / Spotlight after replacement exists

---

## PHASE 6 STEP 3 — UI FOUNDATION

**Date:** 2026-09-08  
**Status:** UI foundation only (cards not yet mounted on gameplay screens)

### Component architecture

| Piece | Path | Role |
|-------|------|------|
| `ContextualGuideCard` | `src/contextualGuide/components/ContextualGuideCard.tsx` | Presentational floating card (callbacks only) |
| Icon map | `src/contextualGuide/contextualGuideIcons.ts` | Optional per-card `GameIconName` mapping |
| Help sections meta | `src/contextualGuide/helpGuideSections.ts` | Data-driven section list for shell |
| `HelpGuideScreen` | `src/screens/HelpGuideScreen.tsx` | Help & Guide shell (placeholder copy) |

`ContextualGuideCard` does **not** read Zustand, mutate persistence, navigate, or start timers.

### Visual design decisions

- Light surface (`#F7F9FC`) over dark LogistiCore backgrounds
- Dark title / muted body / amber primary CTA (`colors.accentAmber`)
- Rounded `radius.card`, `shadows.medium`, close X with `MIN_TOUCH_TARGET`
- Optional step dots (active amber / inactive neutral)
- `bottomOffset` prop for tab-bar clearance
- No Modal / spotlight / blur takeover

### Help entry location

`MoreScreen` (Şirket) menu — permanent `ListRowCard`:

- Label: **Yardım & Rehber**
- Route: `help`

### Help shell route

- Local `MoreRoute = 'help'`
- `PendingMoreSubRoute` includes `'help'` for future deep-links
- Embedded screen with `onBack` → menu

### Persistence impact

**None.** Step 2 `contextualGuide` semantics / save normalization / ads gates unchanged.

### Legacy tutorial status

AppTutorial, MarketTutorial, SpotlightTutorial: **unchanged** (still active / flagged as before).

### Files changed

- `src/contextualGuide/components/ContextualGuideCard.tsx` *(new)*
- `src/contextualGuide/contextualGuideIcons.ts` *(new)*
- `src/contextualGuide/helpGuideSections.ts` *(new)*
- `src/screens/HelpGuideScreen.tsx` *(new)*
- `src/screens/MoreScreen.tsx`
- `src/navigation/managementNavigation.ts`
- `src/theme/icons.ts` (`help` icon)
- `scripts/contextual-guide-ui-foundation-regression-test.ts` *(new)*
- this doc

### Tests

`npx tsx scripts/contextual-guide-ui-foundation-regression-test.ts`

Plus Step 2 foundation, monetization, tutorial first-visit, `tsc --noEmit`, `git diff --check`.

### Device QA pending

Physical/device matrix (iPhone/Android sizes, wrapping, safe area, tab overlap, font scaling) **not claimed** in this step.

---

## PHASE 6 STEP 4 — HELP CONTENT + REPLAY

**Date:** 2026-09-08  
**Status:** Help content live; contextual cards still not mounted on gameplay screens

### Help sections (player-facing TR)

All 11 sections filled with repository-verified copy (accordion UI):

| ID | Title |
|----|-------|
| getting_started | Başlarken (+ replay CTA) |
| deliveries | Teslimatlar |
| vehicles_fleet | Araçlar ve Filo |
| fuel | Yakıt |
| warehouses | Depolar |
| marketplace | Piyasa & Araç Pazarı |
| reputation | İtibar |
| driver_xp | Şoför XP |
| seasons_challenges | Sezonlar ve Görevler |
| achievements_progress | Başarımlar ve İlerleme |
| account_cloud | Hesap ve Bulut Kayıt |

### Mechanics verification (summary)

- Deliveries: İşler → Ekibi Seç → startDelivery; fuel gate at start; success pays cash/XP/rep
- Fleet: Mağaza buy/lease/hire; upgrades Motor/Yakıt/Kargo/Dayanıklılık
- Fuel: INSUFFICIENT_FUEL blocks start; city + roadside refuel exist
- Warehouses: Piyasa trade storage; level/city unlocks
- Marketplace: Piyasa ≠ Araç Pazarı; linked account for vehicle market; no real-money trade
- Reputation: 0–100; prestige contracts need high reputation
- Driver XP: success-only; fail/cancel = no delivery XP
- Seasons/Challenges: linked account; marketplace metrics; **no final rank rewards**; delivery challenges deferred
- Achievements: informational only when enabled; **no cash**
- Account: guest local vs linked cloud protect

### Replay behavior

CTA: **Başlangıç Rehberini Tekrar Göster** (Getting Started section)

1. `resetContextualGuideForReplay()` → `contextualGuide` status `active`, card lists cleared  
2. Confirmation dialog  
3. Optional navigate: `onBack` + `navigationRequest: { tab: 'dashboard' }`

**Only** `contextualGuide` resets. Does **not** touch: `onboarding.completed`, ads gate, AppTutorial/`tutorialProgress`, MarketTutorial, Spotlight, achievements, Driver XP, seasons.

Card display still awaits Step 5 mounts.

### Persistence / ads / legacy

- Step 2 persistence semantics unchanged  
- `onboarding.completed` unchanged  
- Ads eligibility unchanged  
- AppTutorial / MarketTutorial / Spotlight unchanged  

### Files changed

- `src/contextualGuide/helpGuideSections.ts`
- `src/screens/HelpGuideScreen.tsx`
- `scripts/contextual-guide-help-content-regression-test.ts` *(new)*
- this doc

### Tests

`npx tsx scripts/contextual-guide-help-content-regression-test.ts`  
(+ foundation, UI foundation, monetization, tutorial, tsc, diff-check)

### Management navigation baseline

Pre-existing brittle failures in `management-account-navigation-regression-test.ts` expected to remain (Step 3 baseline: 38 pass / 3 fail). Step 4 does not touch MoreScreen/nav mapping beyond Help content screen.

### Device QA pending

Not claimed.

---

## PHASE 6 STEP 5 — GAMEPLAY SCREEN INTEGRATION

First step where contextual guide cards appear during real gameplay. Legacy AppTutorial / MarketTutorial remain; auto-start is temporarily suppressed while `contextualGuide.status` is `eligible` or `active`.

### Mounted screens

| Card ID | Screen | Host placement |
|---|---|---|
| `welcome` | `DashboardScreen` | Overlay sibling above tab bar |
| `choose_contract` | `ContractsScreen` | Overlay; blocked while assignment/quick sheets open |
| `manage_fleet` | `FleetScreen` | Overlay outside `AppScreen` |
| `follow_route` | `MapScreen` | Overlay; only when `runningDeliveries.length > 0` |
| `need_help` | `MoreScreen` (menu) | Sibling of scrolled `AppScreen` (not inside ScrollView) |

UX: compact floating `ContextualGuideCard`, no Modal, no spotlight, no screen lock, no forced tab change.

### Guide sequence semantics

Order: `welcome` → `choose_contract` → `manage_fleet` → `follow_route` → `need_help` → complete.

Helpers in `contextualGuideSequence.ts`:

- `getCurrentContextualGuideCardId`
- `getNextContextualGuideCardId`
- `canShowContextualGuideCard`
- `isContextualGuideAutoShowAllowed`

Auto-show only when status is `eligible` or `active`. Never when `dismissed` or `completed`.

Primary CTA marks the current card complete; does **not** navigate. Next card appears when the player naturally opens the matching screen.

### Dismissal behavior (product rule B)

**X dismisses the entire Getting Started flow** via `dismissContextualGuide()`.

- Stops all remaining automatic cards
- Help & Guide remains available
- Manual replay can restart the flow later

Do not use per-card X dismissal (would surprise players with later cards).

### `follow_route` activation condition

Shows on Map only when there is a meaningful active delivery:

`hasActiveDelivery={runningDeliveries.length > 0}`

Empty map / no delivery → card does not show. No fabricated delivery state.

### Legacy tutorial collision mitigation

Smallest temporary rule:

- While `contextualGuide.status` is `eligible` or `active`, treat as `isAnotherTutorialActive` in:
  - `useScreenAppTutorial.ts`
  - `useMarketTutorial.ts`

Effect: legacy auto-start does not overlap with contextual cards.

**Not changed:** legacy persistence, progress, manual Help replay of AppTutorial, Spotlight code, ads / `onboarding.completed`.

### Replay behavior

Help → `resetContextualGuideForReplay()` → guide becomes eligible/active again → welcome can show on Dashboard when player is there. No legacy tutorial reset. No forced tab navigation beyond existing Help back-to-dashboard action.

### Account / guest / cloud

Unchanged from Step 2: save-scoped `contextualGuide`, guest/existing normalization, cloud restore wins after normalize. No device-global onboarding flag.

### Files changed

- `src/contextualGuide/contextualGuideSequence.ts` *(new)*
- `src/contextualGuide/contextualGuideCopy.ts` *(new)*
- `src/contextualGuide/hooks/useContextualGuideHost.ts` *(new)*
- `src/contextualGuide/components/ContextualGuideHost.tsx` *(new)*
- `src/screens/DashboardScreen.tsx`
- `src/screens/ContractsScreen.tsx`
- `src/screens/FleetScreen.tsx`
- `src/screens/MapScreen.tsx`
- `src/screens/MoreScreen.tsx`
- `src/hooks/useScreenAppTutorial.ts`
- `src/hooks/useMarketTutorial.ts`
- `scripts/contextual-guide-gameplay-mount-regression-test.ts` *(new)*
- this doc

### Tests

`npx tsx scripts/contextual-guide-gameplay-mount-regression-test.ts`  
(+ foundation, UI foundation, help content, monetization, tutorial, management-nav baseline, tsc, diff-check)

### Management navigation baseline

Pre-existing: `management-account-navigation-regression-test.ts` **38 pass / 3 fail**. Step 5 touches MoreScreen menu wrapper only; do not increase failure count.

### Device QA pending

Not claimed. Checklist: iOS/Android fresh guest, welcome → dismiss, Contracts/Fleet/route/Help cards, replay, small/large phone, safe area, tab overlap, legacy collision, long TR text, font scaling, restart, linked account, cloud restore, A→B→A.

### Known risks

- Tab/CTA heights differ per screen — `extraBottomOffset` available if a screen needs more clearance
- Legacy tutorials still present for manual/help paths; only auto-start is blocked during contextual guide
- Map `follow_route` depends on `runningDeliveries` semantics staying meaningful

---

## PHASE 6 STEP 6 — LEGACY TUTORIAL RETIREMENT

Player-facing legacy tutorial UX removed from normal product flow. Compatibility persistence retained. ContextualGuide + Help & Guide are the supported onboarding/help model.

### Post-Step-5 legacy audit (summary)

| Surface | Class | Step 6 action |
|---|---|---|
| AppTutorial auto-start | A → retired | Default `autoStart: false` |
| MarketTutorial auto-start | A → retired | Explicit `autoStart: false` |
| AppTutorial / Market `?` replay | B → repurposed | Opens Help & Guide section |
| MapHelpMenu tutorial action | B → repurposed | Opens Help & Guide |
| AppTutorialOverlay / Targets | C (dormant mounts) | Kept mounted; never auto-show |
| Spotlight stack | C | Remains `ENABLE_SPOTLIGHT_TUTORIAL=false` |
| `tutorialProgress` / market flags / spotlight save / mission `tutorial` / `onboarding` | D+G | **Kept** |
| DEV onboarding reset on More | E | Kept (`__DEV__`) |
| Full Spotlight/AppTutorial file deletion | F (future) | **Not deleted** this step |

### Player-facing surfaces retired

- No automatic first-visit AppTutorial
- No automatic MarketTutorial
- No blocking tutorial Modal auto-show in normal play
- No `?` button that reopens legacy blocking tutorials

### Help buttons repurposed

| Entry | Opens |
|---|---|
| Dashboard / Map / Contracts / Fleet / Warehouses / Finance / Marketplace / Leaderboard / Account / Reputation `?` | Help & Guide (section mapped from tutorial id) |
| Market `?` | Help & Guide → `marketplace` |
| MapHelpMenu “Yardım & Rehber” | Help & Guide → `deliveries` |

Helper: `src/contextualGuide/openHelpGuide.ts`  
(`navigationRequest: more` + `pendingMoreSubRoute: 'help'` + ephemeral section pending)

### AppTutorial auto-start status

**Off permanently** via hook defaults (`useAppTutorial`, `useScreenAppTutorial`). Reputation sheet also `autoStart: false`.

### MarketTutorial auto-start status

**Off permanently** (`useMarketTutorial` `autoStart: false`). `openManual` from UI now opens Help.

### Spotlight status

Still hard-disabled (`ENABLE_SPOTLIGHT_TUTORIAL=false`). No giant deletion sweep.

### Persistence kept / removed

**Kept (no schema removal):**
- `tutorial` / `tutorialProgress`
- `marketTutorialCompleted` / `marketTutorialVersion`
- `spotlightTutorial`
- `onboarding` (including `onboarding.completed`)

**Removed:** none (prefer inert compatibility fields).

### onboarding.completed / ads

Unchanged. Not set by contextual guide complete/dismiss/replay.

### Help replay path (only supported onboarding replay)

Help & Guide → Başlarken → **Başlangıç Rehberini Tekrar Göster** → `resetContextualGuideForReplay()`

### Help deep-linking

Lightweight section targeting via `openHelpGuide(sectionId)` + `consumePendingHelpGuideSection()` on Help mount; More remounts Help with `helpSessionKey` when deep-linked.

### Files changed

- `src/contextualGuide/openHelpGuide.ts` *(new)*
- `src/hooks/useAppTutorial.ts`
- `src/hooks/useScreenAppTutorial.ts`
- `src/hooks/useMarketTutorial.ts`
- `src/tutorial/app/controller.ts`
- `src/tutorial/app/featureFlags.ts`
- `src/tutorial/app/definitions.ts` (help a11y labels)
- `src/screens/HelpGuideScreen.tsx`
- `src/screens/MoreScreen.tsx`
- `src/screens/MarketScreen.tsx`
- `src/components/dashboard/ReputationDetailSheet.tsx`
- `src/components/map/MapHelpMenu.tsx`
- `scripts/contextual-guide-legacy-retirement-regression-test.ts` *(new)*
- Adjusted assertions: `app-tutorial-safety`, `tutorial-first-visit`, `update-loop`
- this doc

### Tests

Step 6 retirement suite + prior Phase 6 suites + tutorial/monetization/management baselines + tsc + diff-check.

### Baseline failures

- management-nav: **38 pass / 3 fail** (unchanged expected)
- rewarded-ad visibility: **42 pass / 1 fail** (consent-not-ready UI message; unrelated)

### Device QA pending

Not claimed. Checklist: fresh guest, no old App/Market tutorials, contextual guide + dismiss + Help replay, `?` → Help sections, layout after retirement, no orphaned overlays, small/large devices, font scaling, safe areas, A→B→A, cloud restore, restart.

### Remaining technical-debt cleanup candidates

- Delete dormant AppTutorialOverlay/Target mounts once Help coverage confirmed on device
- Delete MarketTutorial overlay/step registries
- Delete Spotlight UI/store after save migration window
- Optionally flip `APP_TUTORIALS_ENABLED=false` as hard kill of overlay code path
- Dedicated finance Help section (currently maps to `getting_started`)

---

## PHASE 6 STEP 7 — FINAL AUDIT, REGRESSION, RELEASE READINESS

**Date:** 2026-09-08  
**Status:** `V1_1_PHASE_6_GETTING_STARTED_HELP_VERIFIED` (automated; device QA PENDING)

### 1. Phase scope

Replace blocking first-visit tutorials with optional, non-blocking Contextual Getting Started cards on real gameplay screens + permanent Help & Guide. Preserve ads/`onboarding.completed`, gameplay gates, and save compatibility.

### 2. Original legacy audit (Step 1 summary)

Five overlapping systems: mission `tutorial`, `onboarding`, Spotlight (already off), AppTutorial, MarketTutorial. Soft ads gate on `onboarding.completed`; real progression gates separate. Insertion points: Dashboard/Contracts/Fleet/Map/More.

### 3. Implemented architecture

- Save-scoped `contextualGuide` + pure sequence helpers
- Presentational `ContextualGuideCard` + per-screen `ContextualGuideHost`
- Help & Guide (11 sections) + `openHelpGuide` deep-link
- Manual replay: `resetContextualGuideForReplay()` only
- Legacy App/Market overlays dormant (`autoStart: false`); `?` → Help

### 4. contextualGuide persistence

Statuses: `eligible | active | dismissed | completed`. Additive on save/cloud. No device-global key. Missing field ≠ new player.

### 5. New / existing player logic

| Cohort | Logic | Result |
|---|---|---|
| True new | no progress signals | `eligible`; welcome may show |
| Existing (old save, no field) | progress signals | `dismissed`; silent |
| Replay | Help CTA | `active`, cards cleared; welcome can show |

### 6. Help & Guide

11 TR sections (Getting Started → Account & Cloud). No fake claims (season final rank, achievement cash, real-money marketplace, active deferred delivery challenges). Deep-link via `openHelpGuide(sectionId)`.

### 7. Gameplay mounts

| Card | Screen | Gate |
|---|---|---|
| welcome | Dashboard | status eligible/active + current |
| choose_contract | Contracts | sequence + sheet blockers |
| manage_fleet | Fleet | sequence + modal blockers |
| follow_route | Map | **active delivery required** |
| need_help | More menu | sequence |

Non-blocking floating cards; no Modal/spotlight/forced tabs. Physical layout clearance: device QA pending.

### 8. Replay behavior

Help → Başlarken → Başlangıç Rehberini Tekrar Göster → `resetContextualGuideForReplay()` only. Does not reset AppTutorial / Market / Spotlight / onboarding / ads.

### 9. Legacy retirement

- AppTutorial / MarketTutorial auto-start: **off**
- Spotlight: **disabled**
- `?` / MapHelpMenu: **Help only**
- Overlay code: **dormant mounts kept** (compat / tech debt)

### 10. Retained compatibility fields

| Field | Why kept |
|---|---|
| `tutorial` / `tutorial.isCompleted` | Missions + existing-player inference |
| `onboarding` / `onboarding.completed` | **Ads gate** + inference |
| `tutorialProgress` | Save compat + dormant hooks + inference |
| `marketTutorialCompleted` / `Version` | Save merge / compat |
| `spotlightTutorial` | Save compat until dedicated deletion |

### 11. Ads gate safety

Guide complete/dismiss/replay **do not** write `onboarding` or call `canGrantAdReward` / `applyAdReward`. Ads still require `hasCompletedOnboarding === true`. Verified by foundation + final verification suites.

### 12. Gameplay gate safety

Phase 6 did not alter fuel, vehicle/driver requirements, level/reputation/warehouse unlocks, contract availability, marketplace authority, economy, delivery payouts, or reputation rules. Regression: delivery capacity, fuel, warehouse, reputation, marketplace, leaderboard, seasons, achievements — green (see baselines).

### 13. Account / guest / cloud

Save-scoped guide; A→B→A isolation tested; guest fresh → eligible; progressed cloud without field → dismissed; account deletion untouched.

### 14. Performance / architecture

No Phase 6 polling/timers; no giant onboarding controller; no forced nav state machine; no App.tsx expansion for guide. `performance-regression-test`: PASSED.

**Performance hardening (follow-up):** see section below — status-only gate, boolean visibility selector, Map delivery-length boolean (no delivery prop), memoized card/host, soft shadow.

### 15. Files changed (Phase 6 overall)

Core new: `src/contextualGuide/**`, Help screen, mount hosts on Dashboard/Contracts/Fleet/Map/More, `openHelpGuide`, Step 2–7 scripts, this doc. Legacy: autoStart defaults + Help routing in tutorial hooks/controller. Save/store types additive for `contextualGuide`.

### 16. Automated tests (Step 7 run)

Phase 6: foundation 60, UI 59, Help 81, mounts 44, legacy retirement 42, **final verification 40** — all pass.  
Tutorial/safety/first-visit/app/market/update-loop — pass.  
Monetization smoke 44/0.  
Save bootstrap, account-cloud login/conflict — pass.  
Gameplay samples: delivery capacity, truck fuel, warehouse, reputation, marketplace, leaderboard, seasons, achievements, driver progression — pass.  
`tsc --noEmit`, `git diff --check`, performance-regression — pass.

### 17. Known baseline failures (unchanged / unrelated)

| Suite | Count | Note |
|---|---|---|
| `management-account-navigation-regression-test.ts` | **38 pass / 3 fail** | Pre-existing brittle More asserts |
| `rewarded-ad-visibility-regression-test.ts` | **42 pass / 1 fail** | `consent-not-ready UI message` |
| `roadside-fuel-test.ts` | **28 pass / 1 fail** | Copy drift (`out-of-fuel mesajı`); **not Phase 6** (fuelWarnings message ≠ test string) |

No Phase 6-caused P0/P1 failures identified.

### 18. Manual device QA matrix (PENDING)

**Android & iOS:** fresh guest; welcome; dismiss; replay; Contracts/Fleet/Map(active)/Need Help cards; Help deep links; no legacy blocking tutorials; linked account; A→B→A; cloud restore; restart; bg/fg; small/large; long TR; font scaling; tab clearance; no overlap/modal collision/safe-area issues.

**Not claimed completed.**

### 19. Remaining technical debt

- Remove dormant AppTutorial/MarketTutorial overlay mounts after device QA
- Spotlight stack deletion after migration window
- Optional `APP_TUTORIALS_ENABLED=false` hard kill
- Dedicated Finance Help section
- Unused per-card `dismissedCardIds` sequence reads

### 20. Final verification status

**VERIFIED** for automated release readiness of Phase 6 Getting Started / Help, with device QA explicitly **PENDING**.

Micro-cleanup in Step 7: removed unused `getPendingHelpGuideEpoch` helper only.

---

## CONTEXTUAL GUIDE PERFORMANCE HARDENING

**Date:** 2026-09-09  
**Status:** Source hardening complete — **real-device FPS not measured**

### Subscription audit (before → after)

| Area | Before | After |
|---|---|---|
| Host when dismissed/completed | Full `contextualGuide` + actions + `useTabBarLayout` | **Status primitive only**; Active unmounted |
| Host when eligible/active | Full guide object sub | Boolean `visible` selector (+ stable actions) |
| Map `follow_route` | `hasActiveDelivery={runningDeliveries.length > 0}` (parent prop) | No delivery prop; host uses `selectHasRunningDelivery` (boolean on preparing/on_route/paused only; progress updates that keep the same boolean do not re-render) |
| Fleet | No vehicles prop (OK) | Unchanged mount; inactive gate still applies |
| Card | Unmemoized + `shadows.medium` | `React.memo` + `shadows.soft` |
| Host | Unmemoized | `React.memo` gate component |

### Early-out behavior

`ContextualGuideHost` returns `null` unless status is `eligible` or `active`.  
Dismissed/completed players keep a single cheap status subscription per mounted screen host.

### Animation policy

No continuous animations added. No Lottie/video/GIF. One-shot animations not introduced in this pass.

### Persistence write policy

Writes only via explicit store actions (complete card / dismiss / replay). No save on mount/render.

### Listeners / timers

None in guide modules (no `setInterval` / tutorial `setTimeout` / Firestore listeners).

### Performance tests

`scripts/contextual-guide-performance-regression-test.ts`

### Real-device performance

**PENDING** — Android/iOS matrix documented in Phase 6 §18; not claimed here.

---

## LEGACY TUTORIAL PERMANENT REMOVAL

**Date:** 2026-09-10  
**Status:** **LEGACY FULLY REMOVED** from runtime source

### Old systems deleted

| System | Action |
|---|---|
| AppTutorial (overlays, targets, hooks, controller, definitions) | Deleted |
| MarketTutorial (overlay, targets, hook, steps/layout/registry) | Deleted |
| SpotlightTutorial (store, overlay, mask, tooltip, targets, triggers, flag) | Deleted |
| `src/tutorial/` directory | Deleted |
| `src/components/tutorial/` directory | Deleted |
| Legacy DEV spotlight reset on MoreScreen | Deleted |

### Persistence fields removed from store/save

No longer stored or serialized:

- `tutorialProgress`
- `marketTutorialCompleted`
- `marketTutorialVersion`
- `spotlightTutorial`

Old saves that still contain these keys:

- Load without crash
- Keys ignored for state hydration
- Read once via `hasLegacyTutorialActivityFromRawSave` for contextual-guide **existing player** cohort only
- Not written back on next save

### Existing-player detection

Signals (non-legacy):

- completed contracts ≥ 1
- active deliveries
- `missions.flags.deliveryStarted`
- `missions.flags.tradePurchased`
- player level > 1
- mission `tutorial.isCompleted`
- `onboarding.completed`
- plus one-shot raw-save legacy tutorial activity (never re-persisted)

Missing deleted fields never reclassifies an old player as new.

### `onboarding.completed` retained

Kept for rewarded-ads / monetization gating and progression. Not removed with legacy tutorial UI.

### Mission tutorial retained

`TutorialState` / `completeTutorialStep` / `src/config/tutorial.ts` / Missions “Sıradaki Hamle” remain — separate from deleted AppTutorial/Spotlight.

### New ContextualGuide / Help & Guide

Untouched behavior. Help buttons use `HelpGuideButton` + `openHelpGuide(section)`.

### Tests

- `scripts/legacy-tutorial-removal-regression-test.ts`
- Updated contextual-guide / layout / performance regressions for post-deletion invariants
- Deleted obsolete AppTutorial / MarketTutorial / Spotlight / first-visit / target-layout scripts

### Performance

Removed overlay mounts, target wrappers, tutorial layout subscriptions, and spotlight store/triggers.

### Remaining references

Runtime source: only `legacyTutorialSaveSignals.ts` (intentional raw-save read) + historical docs/README. Regression scripts use negative assertions only.

---

## MANDATORY FIRST-RUN GUIDED TUTORIAL REVISION

**Date:** 2026-09-10  
**Status:** Product behavior changed — ContextualGuide is now a **mandatory first-run guided tutorial** for true new players (not a lightweight non-blocking tip stream).

### Product behavior change

| Before | After |
|---|---|
| Non-blocking cards; user navigates freely; "Sonraki" only advances card id | Guided sequence; CTA **navigates** to the next required screen |
| Background UI fully interactive | Full-screen dim + interaction blocker; tab bar manual taps blocked |
| X dismisses entire flow | **Mandatory:** no X. **Manual Help replay:** X / Eğitimden Çık allowed |
| `follow_route` required active delivery | Educational Map step — **no delivery required**, none fabricated |

### New player behavior (`mandatory_first_run`)

1. After auth/save hydration, cloud conflict resolved, bootstrap complete, and `isGameReady` → AppShell mounts.
2. If `contextualGuide.status` is `eligible`/`active` and not a Help replay session → mandatory mode.
3. Welcome on Dashboard → Contracts → Fleet → Map → Management (More) → complete.
4. Player must finish all five steps; dismiss is disabled.
5. Progress uses existing `completedCardIds`; restart resumes the next incomplete card and navigates to its screen.

### Existing player behavior

- Saves already `dismissed` / `completed` (or normalized as existing-player skip) remain silent.
- No reinterpretation of old saves. Legacy-removal cohort safeguards intact.

### Runtime interaction lock

- Module: `contextualGuideSession.ts` (`mandatory_first_run` | `manual_replay` | `none`) — **runtime-only**, not a second persistence system.
- Host: semi-transparent dim (~0.22) + pointer-blocking layer under the card.
- App: `shouldBlockManualTabPressWhileGuideActive` + quick-access blocked while locked.
- Tutorial navigation sets a one-shot bypass so programmatic tab changes still work.
- Lock held across CTA → navigate → next card (status stays eligible/active until final complete).

### Navigation sequence (CTA only — no timers)

1. `welcome` → Contracts  
2. `choose_contract` → Fleet (no forced real contract accept)  
3. `manage_fleet` → Map  
4. `follow_route` → Management/More  
5. `need_help` → `completeContextualGuide()` → Dashboard  

### Manual replay distinction

- Help CTA still calls `resetContextualGuideForReplay()`.
- Starts `manual_replay` session with a snapshot of prior durable guide.
- Save serialization uses `getDurableContextualGuideForSave()` so mid-replay crashes do **not** permanently erase prior completion.
- Exit restores snapshot via `exitContextualGuideReplay()`.
- Completing replay clears session and persists completed guide.

### Restart / resume

- `useContextualGuideResumeNavigation` in AppShell once after ready.
- Uses `completedCardIds` → current card → `requestNavigationToCurrentGuideCard`.

### Performance

- Inactive (dismissed/completed): host still early-outs on status only.
- No Map truck/route subscriptions for guide.
- No timers/intervals/Lottie/animation loops for the tutorial.
- Replay session is a tiny module listener; near-zero when idle.

### No legacy tutorial restoration

Still zero runtime: AppTutorial, MarketTutorial, SpotlightTutorial, TutorialOverlay, SpotlightMask, TutorialTooltip, useAppTutorial, useMarketTutorial.

### Tests

- `scripts/mandatory-contextual-tutorial-regression-test.ts` (new)
- Updated: gameplay-mount + performance regressions for delivery-gate removal / guided nav

### Device QA

**PENDING** — physical iOS/Android matrix (new account, restart mid-flow, existing, manual replay exit) not claimed here.



# LogistiCore — Post-Launch Architecture + Performance Decomposition Audit

**Date:** 2026-08-27  
**Scope:** Read-only. Game is live. No code changes, no refactors, no package updates.  
**Goal:** Decide whether large central files should be decomposed before the next major update — with evidence that decomposition would (or would not) improve performance, render isolation, maintenance, regression risk, testability, and feature velocity.

**Working rule:** Large file ≠ bad. Prove benefit before recommending a split.

---

## Executive answers (required)

| # | Question | Answer |
|---|----------|--------|
| 1 | Is `gameStore.ts` currently too large? | **Yes for maintenance** (~11.5k LOC, ~149 actions, one flat `create()`). Domain logic is partly extracted; this file is the god-orchestrator. |
| 2 | Should it be split? | **Yes, eventually — but not as a big-bang Zustand rewrite before V1.1.** Prefer Phase A action extraction + Phase B thin slices. Keep one public store API initially. |
| 3 | Is `App.tsx` too responsible? | **Yes for runtime orchestration (class B).** Tab shell is fine; boot/AppState/ads/cloud/marketplace/notifications should become hooks. |
| 4 | Which 5 files most need decomposition? | 1) `gameStore.ts` 2) `MarketScreen.tsx` 3) `ContractsScreen.tsx` 4) `App.tsx` 5) `contracts.ts` *(maintainability / generation structure — not “split for LOC”)* |
| 5 | Which splits would actually help performance? | **Almost none of the file splits.** Perf wins: contract eligibility indices/caches; narrower Zustand selectors / time bucketing; avoid whole-`player` + raw `currentTime` on hot screens. |
| 6 | Which splits are maintenance-only? | Extracting `gameStore` actions into modules; splitting Market/Contracts UI into container/presentational; splitting `saveGame` stages; extracting App lifecycle hooks. |
| 7 | Are screens causing measured jank? | **Partially.** Steady `advanceTime` is ~1–3ms. Perceived jank more likely from **tick → wide re-renders** (player/currentTime) and **contract refresh spikes (~80ms+)**, not from screen LOC alone. |
| 8 | What is the actual current performance bottleneck? | **(A)** Contract full refresh / city×city×product eligibility (~80ms+). **(B)** Save integrity path (~73ms checksum + ~76ms atomic write ≈ ~255ms total). **(C)** Render fan-out on game ticks. |
| 9 | What should be refactored before V1.1? | Selector discipline + time bucketing; contract generation data structures; App lifecycle hooks; Market/Contracts presentational extraction; progression/notification module boundaries *before* new season/challenge features land in the store. |
| 10 | What should NOT be touched? | `saveIntegrity.ts`, atomic write protocol, `contractEconomics.ts`, `types/game.ts`, `balance.ts`, map road network data, upload keystore, live economy formulas, save format. |
| 11 | Is a large architectural refactor justified? | **No.** Live game. Prefer staged, test-backed extractions. A store slice rewrite that changes mutation semantics is unjustified. |
| 12 | Recommended exact order of work | See [§12 Recommended order](#12-recommended-exact-order-of-work). |

---

## 1. File size / responsibility audit

### 1.1 Target files

| File | LOC | ~Exports | Hooks | useEffects | Timers/listeners | Store actions / selectors | Unrelated responsibilities | Classification |
|------|----:|---------:|------:|-----------:|-----------------:|---------------------------:|---------------------------:|----------------|
| `App.tsx` | 735 | 0 (default) | ~30 | 8 (+2 layout) | ~9 | Consumers only | Boot, AppState, ads, cloud, marketplace, notifs, tabs, modals, perf | **SHOULD SPLIT** (hooks) |
| `src/store/gameStore.ts` | 11,477 | ~7 fn + 1 store | 1 (create) | 0 | ~6 (module timers) | ~149 actions; no selector factories | All domains + UI nav + ads + save + loop | **SHOULD SPLIT** → leans **HIGH-RISK MONOLITH** (wiring) |
| `src/simulation/contracts.ts` | 2,957 | ~45 | 0 | 0 | 0 | N/A | Schedule + eligibility + generation + supply | **LARGE BUT COHESIVE** *(structure/caches > file split)* |
| `src/simulation/delivery.ts` | 2,126 | ~72 | 0 | 0 | 0 | N/A | Progress/complete/fail; already has satellites | **LARGE BUT COHESIVE** |
| `src/storage/saveGame.ts` | 2,307 | ~32 | 0 | 0 | 0 | N/A | Serialize/load/migrate/orchestrate | **LARGE BUT COHESIVE** *(optional stage split)* |

### 1.2 Top 15 largest under `src/` (by LOC)

| Rank | Path | LOC | Classification |
|-----:|------|----:|----------------|
| 1 | `src/store/gameStore.ts` | 10,660+ | SHOULD SPLIT / HIGH-RISK MONOLITH (wiring) |
| 2 | `src/simulation/contracts.ts` | 2,679+ | LARGE BUT COHESIVE |
| 3 | `src/screens/MarketScreen.tsx` | 2,521+ | SHOULD SPLIT |
| 4 | `src/screens/DebugSimulationScreen.tsx` | 2,250+ | LARGE BUT COHESIVE (dev-only; do not block V1.1) |
| 5 | `src/storage/saveGame.ts` | 2,155+ | LARGE BUT COHESIVE |
| 6 | `src/screens/ContractsScreen.tsx` | 2,111+ | SHOULD SPLIT |
| 7 | `src/simulation/delivery.ts` | 1,917+ | LARGE BUT COHESIVE |
| 8 | `src/services/authService.ts` | 1,870+ | LARGE BUT COHESIVE |
| 9 | `src/types/game.ts` | 1,650+ | **DO NOT SPLIT** |
| 10 | `src/hooks/useAccountCenter.ts` | 1,375+ | LARGE BUT COHESIVE / borderline SHOULD SPLIT |
| 11 | `src/screens/FleetScreen.tsx` | 1,352+ | SHOULD SPLIT |
| 12 | `src/data/mapRoadNetwork.ts` | 1,234+ | **DO NOT SPLIT** (data) |
| 13 | `src/screens/FinanceScreen.tsx` | 1,164+ | LARGE BUT COHESIVE |
| 14 | `src/components/ContractAssignmentModal.tsx` | 1,147+ | LARGE BUT COHESIVE / optional split |
| 15 | `src/screens/VehicleMarketplaceScreen.tsx` | 1,055+ | SHOULD SPLIT (data hook + UI) |

---

## 2. gameStore audit

### 2.1 Shape

- Single Zustand `create<GameStore>((set, get) => ({ ... }))` — **no slice pattern**.
- Interface + action signatures ~L1838–2124; implementation ~L2130–11433.
- Heavy logic already lives in `src/simulation/`, `src/domain/`, `src/storage/`.
- Module-level mutables (~25) coordinate save/offline/market races **outside** React state.
- Related satellites: `spotlightTutorialStore.ts`, `osNotificationDispatch.ts`, `selectors/stableCollections.ts`.

### 2.2 Responsibility map

| Domain | In store? | Notes |
|--------|-----------|-------|
| Player / money / XP / level | Yes | Coupled via `player` object |
| Trucks / drivers / trailers | Yes | Fleet actions + delivery races |
| Contracts | Yes | Schedule inside `advanceTime` |
| Deliveries | Yes | Completions merge large simulation graphs |
| Warehouses | Yes | Quality + stock transfers in loop |
| Finance | Yes | Daily costs + ledger |
| Marketplace client | Yes | Reconcile mutates trucks + money |
| Onboarding / tutorial | Yes | Mostly isolated; some contract seeding |
| Missions / achievements / retention | Yes | Claim paths force save |
| Save / autosave | Yes | Dirty + deferred `time_tick` |
| Offline progression | Yes | Flags + `advanceTime` catch-up |
| Game loop | Yes | `advanceTime` orchestrator |
| Recovery | Yes | Init + vehicle recovery |
| UI / debug / navigation | Yes | Notifications, tabs, debug cash/time |

### 2.3 Coupling & `set()` behavior

**Independent-ish:** notifications, navigationRequest, many tutorial fields, pause/speed.

**Tightly coupled:** deliveries ↔ fleet ↔ contracts ↔ money ↔ finance ↔ XP/missions; `advanceTime` touches almost everything; offline catch-up; marketplace reconcile; `loadGame` whole-state hydrate; `mergeSimulationIntoStore` rewrites cities/contracts/deliveries/`player` fleet.

**Broad updates:** `set({ ...saved })` hydrate; `createInitialGameState()` resets; ~50 `player: { ... }` patches; functional race-safe updates on fuel/delivery.

### 2.4 Selectors

- No selector factories inside `gameStore.ts`.
- Good pattern exists: `src/store/selectors/stableCollections.ts` (stable empty arrays).
- Many screens still use `state.player` wholes and `?? []` inline (unstable when missing).

### 2.5 Verdict

**SHOULD SPLIT** (maintenance / feature velocity / regression surface).  
**Not** the primary runtime perf bottleneck by itself.

**Slice candidates (only if justified later):**

| Slice | Contents | Perf benefit | Risk |
|-------|----------|--------------|------|
| `uiNavSlice` | notifications, navigationRequest | LOW | Low |
| `tutorialOnboardingSlice` | tutorial/spotlight/onboarding | NONE–LOW | Low–med |
| `persistenceSlice` | init/load/save/autoSave/flush | NONE | **High** |
| `timeLoopSlice` | advanceTime, offline, speed | NONE if thin | **Very high** |
| `deliverySlice` / `fleetSlice` / `contractMarketSlice` / `warehouseSlice` / `financeProgressionSlice` | domain actions | NONE (same `set` fan-out unless selectors improve) | High |

**Preferred approach:** keep one store API; move action bodies to `src/store/actions/*.ts` first; extract UI/tutorial first; leave `advanceTime` as last thin orchestrator.

---

## 3. App.tsx audit

### 3.1 Responsibilities

| Area | Present |
|------|---------|
| Navigation / tab shell / keep-alive | Yes |
| Game loop (`useGameLoop`) | Yes |
| AppState lifecycle | Yes |
| Autosave flush on background | Yes |
| Cloud save init | Yes |
| Ads init | Yes |
| Notifications + deep links | Yes |
| Map preload | Yes |
| Marketplace reconcile | Yes |
| Leaderboard season on foreground | Yes |
| Tutorial orchestration | Yes |
| Performance diagnostics | Yes |
| Auth / recovery boot | Yes |
| Global modals (offline, delivery result, incident, recovery, toast) | Yes |

**Counts:** 8 `useEffect`, 2 `useLayoutEffect`, ~9 timer/listener-related sites; intervals live in `useGameLoop`.

### 3.2 Classification

**B — doing too much runtime work itself.**

Tab composition is a **reasonable composition root**. Boot + AppState + ads + cloud + marketplace + notifications + map preload + leaderboard should not all be inline root effects.

### 3.3 Recommended extractions (do not implement in this pass)

| Hook / service | Owns |
|----------------|------|
| `useAppBootstrap` | immersive, Google Sign-In, anonymous auth, recovery probe |
| `useAppLifecycle` | AppState, offline catch-up, background flush, foreground refreshes |
| `useNotificationDeepLinks` | handler + response → navigation |
| `useAdsBootstrap` | consent + provider after interactions |
| `usePostReadyServices` | map preload, marketplace reconcile, cloud sync |
| `useTabNavigationController` | navigationRequest, keep-alive, More routes |
| `usePerfTabTransition` | mount/layout marks |

**Performance benefit of App.tsx split:** **LOW / NONE** (organization).  
**Maintenance benefit:** **HIGH**.

---

## 4. Screen performance audit

| Screen | LOC | Effects | `useGameStore` | Mount network / mutations | Hot render risks | Split? |
|--------|----:|--------:|---------------:|---------------------------|------------------|--------|
| Dashboard | 427 | 3 | ~21 | Local syncs only | Whole `player` + `currentTime` → score | Optional |
| Contracts | 2,255 | 5 | ~20 | `notifyContractsScreenOpened` | Preview/sort/filter; per-card store | **Yes** |
| Map | 746 | 3 | ~11 | `reconcileMapTracking` | Recommendations + whole player | Borderline |
| Fleet | 1,429 | 2 | ~18 | Sub-tab pending | `?? []` + `currentTime` list | **Yes** |
| Market | 2,684 | 6 | ~30 | `notifyMarketScreenOpened` | Huge subscription surface | **Yes** |
| Warehouse | 567 | 1 | ~10 | Toast timer | VM on player+time | Optional |
| Finance | 1,239 | 0 | ~9 | None | Score on every tick | Presentational OK |
| Missions | 586 | 1 | ~10 | Mission sync | Sorts in memo | Optional |
| Leaderboard | 991 | 2 | ~5 | **Yes** fetch/submit | Score on player+time | Data hook + UI |
| Account | 383 | 4 | ~5 | **Yes** leaderboard/prefs | Floored time (better) | Optional |
| VehicleMarketplace | 1,110 | 4 | ~6 | **Yes** listings + reconcile | Filters in memo | **Yes** |
| More | 738 | 2 | ~5 | Router | Light | Keep as router |

**Container / selectors / presentational / hooks:** warranted for Market, Contracts, Fleet, VehicleMarketplace, Leaderboard. Dashboard/Account/More are fine as-is for V1.1.

---

## 5. Performance hotspot connection

| Measured | Meaning | Helped by file split? |
|----------|---------|----------------------|
| Steady `advanceTime` ~1–3ms | Skip path when no contract tick | **NONE** — already optimized |
| Contract refresh spike ~80ms+ | Full eligibility + generation | **NONE** for splits; **HIGH** for indices/caches |
| Save ~255ms (serialize ~8, checksum ~73, write ~76) | Integrity + atomic AsyncStorage | **NONE** for splits; do not weaken |

### Proposed splits → PERFORMANCE BENEFIT

| Proposal | Benefit | Why |
|----------|---------|-----|
| Zustand action file extraction | **NONE** | Same JS work, same `set` |
| Zustand multi-store / slices without selector changes | **LOW / NONE** | Fan-out unchanged unless subscriptions narrow |
| Narrow selectors + time bucketing + `useShallow` | **HIGH** | Cuts tick re-renders |
| Contract route Map / opportunity merge / indices | **HIGH** | Cuts 80ms+ spikes |
| Worker for contract gen | **LOW / NONE** | Small N; marshal cost |
| Split `saveGame.ts` modules | **NONE** | Maintenance only |
| Weaken checksum / atomic write | **NONE (unsafe)** | Forbidden |
| App lifecycle hooks | **NONE** | Maintainability |
| Market/Contracts UI split | **LOW–MEDIUM** | Helps if it forces narrower subscriptions |

**Do not blame LOC for the 80ms or 255ms numbers.**

---

## 6. Contract scheduler

### 6.1 Current design (evidence)

- `processContractGenerationSchedule` — daily / medium / small + minimum supply.
- `canSkipContractScheduleTick` — explains steady 1–3ms ticks.
- `generateContractsCore` — city × city × product scan.
- `findMarketOpportunities` — **second** full scan at generation start.
- `getRouteBetweenCities` uses `routes.find` (O(R)) despite `ROUTES_BY_ID` existing in `data/routes.ts`.
- Duplicate counting via full contract `.filter` per cell.
- `contractEconomics.ts` already separated (payment/cost only).
- No eligibility index, surplus/shortage product index, or dirty domain cache for contracts.

### 6.2 What helps more than file splitting

| Approach | Relative value |
|----------|----------------|
| Route `Map` / `ROUTES_BY_ID` in generation | **HIGH** |
| Available-contract index by origin×dest×product | **HIGH** |
| Merge opportunity scan with generation | **HIGH** |
| Stop rebuilding pending lists per candidate | **HIGH** |
| City-pair connectivity boolean cache | **MEDIUM–HIGH** |
| Incremental / dirty eligibility | **MEDIUM** |
| Worker / off-thread | **LOW / NONE** at current scale |
| Split `contracts.ts` into files only | **NONE** for perf |

---

## 7. Save pipeline

```
serializeGameState (~8ms)
  → sealSavePayloadIntegrity / checksum (~73ms)
  → atomicWriteSaveJson (~76ms; staging → read-back → backup → promote)
≈ ~255ms observed total
```

- Revision cache: `saveRevision.ts` / `bumpSaveContentRevision` avoids re-hash when clean.
- Integrity rules centralized in `saveIntegrity.ts`.

**Architecture separation for maintenance:** optional (serialize vs load/migrate vs atomic adapter vs orchestrator).  

**Must stay coupled:** dirty → invalidate → seal → exclude volatile meta → staging read-back → backup promote.  

**Do not weaken:** checksum, atomic write, backup, recovery.

**Perf benefit of save file split:** **NONE**.

---

## 8. Render / Zustand audit — top 10 risks

No `useShallow` usage found under `src/`. No live whole-store `useGameStore()` without selector (only commented example).

1. **Raw `currentTime` on hot screens** — Map, Fleet, Dashboard, Finance, Warehouse, Leaderboard, Missions re-render every tick.
2. **Whole `state.player` subscriptions** — any fuel/money/status change re-renders entire screen.
3. **`?? []` inside selectors** — new array when missing → equality fail (`FleetScreen`, sheets, management panel).
4. **`?? createDefault*` / `?? {}` outside selectors** — new object each render (`Dashboard`, `Missions`).
5. **`GameTabBar` eligibility signature** — maps all contracts/trucks/drivers/trailers into a large derived string.
6. **AppShell incident `.find` over deliveries** — runs in selector on updates.
7. **Per-card truck `.find` + live time** — N list subscriptions (`OwnedTruckCard`, delivery cards, refuel sheet).
8. **MarketScreen ~30 store bindings** — any economy/cities/routes/contracts change re-renders 2.6k-line screen.
9. **Contracts preview/sort pipeline** — rebuilds on quantized time + economy + fleet keys.
10. **Company score on every tick** — Dashboard/Finance/Leaderboard/Account deps include time + full player/ledger.

**Honorable:** keep-alive tabs keep More/Marketplace mounted and subscribed while hidden.

Stable empty collections in `stableCollections.ts` are the right pattern — **adoption is incomplete**.

---

## 9. Decomposition plan

### PHASE A — LOW RISK (pure extraction, no behavior change)

| Current | Extract to | Reason | Perf | Maintenance | Regression | Required tests |
|---------|------------|--------|------|-------------|------------|----------------|
| `App.tsx` effects | `useAppLifecycle`, `useAdsBootstrap`, `usePostReadyServices`, `useNotificationDeepLinks` | Composition root hygiene | NONE | HIGH | Low | Existing startup / cloud / ads smoke |
| `gameStore` UI/nav actions | `src/store/actions/uiNav.ts` | Shrink monolith | NONE | MED | Low | Navigation/toast wiring tests |
| Tutorial actions | `src/store/actions/tutorial.ts` | Isolation | NONE | MED | Low | Tutorial regression suite |
| MarketScreen sections | hooks + presentational components | Feature velocity | LOW | HIGH | Med | Market UI regression |
| ContractsScreen list/cards | container + cards | Same | LOW | HIGH | Med | Contracts layout / assignment tests |
| `saveGame.ts` stages | `serialize` / `load` / `atomic` modules (same exports) | Readability | NONE | MED | Med | Save checksum/recovery/bootstrap |

### PHASE B — MEDIUM RISK (store/domain separation)

| Current | Extract to | Reason | Perf | Maintenance | Regression | Required tests |
|---------|------------|--------|------|-------------|------------|----------------|
| Store action bodies | `actions/delivery`, `fleet`, `contracts`, `warehouse`, `finance` | Ownership | NONE | HIGH | High | Domain regression packs |
| Optional Zustand slices | `uiNavSlice`, `tutorialSlice` first | Subscription isolation *if* paired with selectors | LOW–MED | MED | Med | Screen mount + selector tests |
| Progression / seasons / challenges | **new modules before feature land** | Avoid stuffing V1.1 into god-store | NONE now | HIGH | Med | New feature tests |

### PHASE C — HIGH RISK (runtime / loop)

| Current | Change | Reason | Perf | Maintenance | Regression | Required tests |
|---------|--------|--------|------|-------------|------------|----------------|
| Contract generation loops | Indices, Maps, merge opportunity scan | Cut 80ms+ spikes | **HIGH** | MED | High | Contract gen + schedule + economy tests |
| Tick → UI | Bucketed time selectors, shallow player fields | Cut jank | **HIGH** | MED | Med | Cold-start + screen perf tests |
| Multi-store / worker loop | Separate stores or worker gen | Speculative | LOW–UNKNOWN | ? | **Very high** | Full P0 suite — **defer** |
| Save integrity shortcuts | Faster hash / skip atomic | Tempting | Unsafe | — | **Do not** | — |

---

## 10. What NOT to split

| Module | Why |
|--------|-----|
| `src/utils/saveIntegrity.ts` | Single source of checksum semantics |
| `src/storage/saveRevision.ts` | Dirty ↔ checksum cache coupling |
| Atomic write protocol inside save path | Integrity / recovery |
| `src/simulation/contractEconomics.ts` | Payment/cost single source of truth |
| `src/types/game.ts` | Shared domain surface |
| `src/config/balance.ts` | Cross-cutting knobs |
| `src/data/routes.ts` / `cities.ts` / `mapRoadNetwork.ts` | Data + invariants |
| Upload keystore / signing | Ops, not architecture |
| Live economy formulas / save format | Product risk |
| `DebugSimulationScreen.tsx` as a V1.1 blocker | Dev-only |

Avoid architecture-for-architecture’s-sake: **do not** split `delivery.ts` / `contracts.ts` purely because of LOC if generation algorithms and store wiring stay unchanged.

---

## 11. Next major update compatibility (V1.1+)

Planned: weekly seasons, leaderboard rewards, daily/weekly challenges, driver XP/levels, achievements, company progression, player statistics, notification inbox, push, analytics/funnel, market alarm worker.

| Upcoming feature | Current bottleneck file | Recommended boundary **before** implementing |
|------------------|-------------------------|-----------------------------------------------|
| Weekly seasons / LB rewards | `gameStore` + `LeaderboardScreen` + cloud services | `progression/` or `seasons/` module + thin store actions; do not grow leaderboard screen into season engine |
| Daily/weekly challenges | Missions + retention paths in store | `challenges/` domain + claim persistence (reuse achievement idempotency patterns) |
| Driver XP/levels | Fleet + delivery completion merge | `drivers/` progression helpers; avoid more logic in `completeDeliveryById` blob |
| Achievements expansion | Retention/mission claim in store | Keep claim idempotency in dedicated service; store only commits |
| Company progression / stats | Score calculators on screens | Shared `companyStats` selector module; bucketed time |
| Notification inbox / push | `App.tsx` + OS notification domain | `notifications/` lifecycle hook; inbox state separate from game tick |
| Analytics / funnel | App boot + screens | Side-effect service; never inside `advanceTime` |
| Market alarm worker | Market screen + store alerts | Background worker/service boundary; not more MarketScreen effects |

**Files that will hurt most if untouched:** `gameStore.ts`, `MarketScreen.tsx`, `ContractsScreen.tsx`, `App.tsx`, contract generation loops in `contracts.ts`.

---

## 12. Recommended exact order of work

1. **Freeze** save integrity, economy formulas, save format.  
2. **Render isolation (perf):** adopt `stableCollections` everywhere; stop `?? []` in selectors; bucket `currentTime`; prefer field-level player selectors / `useShallow`.  
3. **Contract generation (perf):** Maps/indices, merge opportunity scan, remove O(R) finds — *without* rewriting store.  
4. **App.tsx (maintenance):** extract lifecycle/bootstrap hooks.  
5. **Market + Contracts UI (velocity):** container / presentational / data hooks.  
6. **gameStore Phase A:** move UI + tutorial action bodies out; keep one `useGameStore`.  
7. **Define V1.1 module boundaries** (seasons, challenges, notifications, analytics) as empty or thin modules **before** feature PRs.  
8. **Defer** multi-store rewrite, workers, and checksum weakening.  
9. Only then consider Phase B slices if subscription isolation still insufficient.

---

## Final summary checklist

1. **`gameStore.ts` too large?** Yes (maintenance / orchestration).  
2. **Split?** Staged yes; not a pre-V1.1 big-bang.  
3. **`App.tsx` too responsible?** Yes for runtime work; shell OK.  
4. **Top 5 decomposition targets:** `gameStore.ts`, `MarketScreen.tsx`, `ContractsScreen.tsx`, `App.tsx`, `contracts.ts` (algorithm structure).  
5. **Splits that help performance:** selector/time discipline + contract indices — **not** LOC splits.  
6. **Maintenance-only splits:** App hooks, store action files, screen presentational splits, save stage modules.  
7. **Screens causing jank?** Tick fan-out + Market/Contracts width; not “file is big” alone.  
8. **Actual bottlenecks:** contract refresh ~80ms+; save checksum+write ~150ms of ~255ms; tick re-renders.  
9. **Before V1.1:** selectors + contract caches + App hooks + Market/Contracts structure + feature module boundaries.  
10. **Do not touch:** integrity, economics, types/balance/data tables, save format, signing.  
11. **Large architectural refactor justified?** **No.**  
12. **Order:** §12 above.

---

*Audit only. No code was modified in the product paths; this document is the deliverable.*

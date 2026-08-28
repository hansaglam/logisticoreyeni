# V1.1 Render / Zustand Performance Optimization Report

**Phase:** 2A — RENDER / ZUSTAND PERFORMANCE CLEANUP  
**Date:** 2026-08-28  
**Status:** `RENDER_ZUSTAND_OPTIMIZED`

---

## Goal

Reduce visible screen-transition stutter and tick-driven re-renders without changing gameplay behavior, save integrity, marketplace logic, economy formulas, or navigation architecture.

---

## Baseline (pre-change)

Diagnostics used: `useScreenRenderProfiler` (Dashboard, Market, Map, Contracts, Finance), `[perf-navigation]`, `[perf-render-storm]`, existing `render-rate-instrumentation-test.ts`. No new production log spam was added.

| Screen | Baseline render trigger | Notes |
|--------|-------------------------|-------|
| **Dashboard** | Every game tick (`state.currentTime`); whole `state.player`; unstable `?? []` / `createDefault*` for missions/retention/worldEvents | Company score + warehouse fill recomputed each tick |
| **Market** | Already day/6h anchors for trends/events; inline `?? []` on cities/products/routes/contracts/alerts | Broad but mostly static collections |
| **Contracts** | Quarter-hour time already; whole `player`; inline `?? []` | Preview memos keyed on full player |
| **Fleet** | Raw `currentTime` (required for lease visibility); inline `?? []` on trucks/deliveries/transfers | Partial field split already on money |
| **Map** | Raw `currentTime` + whole `player` | Delivery progress + truck positions need tick |
| **Finance** | Raw `currentTime` + whole `player` | Company score breakdown each tick |
| **Warehouse** | Raw `currentTime` + whole `player` | Inventory normalization |
| **Missions** | Raw `currentTime`; unstable missions/retention/receipt defaults | More tab, not keep-alive root |
| **Leaderboard** | Raw `currentTime` + whole `player` | Score breakdown only when screen ready |
| **VehicleMarketplace** | Whole `player`; mount fetch on keep-alive tab | Hidden tab still subscribed + fetched |

### Mount-effect findings (unchanged behavior)

| Screen | Effect | Classification |
|--------|--------|----------------|
| Dashboard | `syncMissionProgress` / `syncRetentionProgress` | Required when progress inputs change (guarded deps) |
| Dashboard | `advanceOnboardingProgress` | Required on relevant state changes |
| Contracts | `notifyContractsScreenOpened` | Required every mount |
| Map | `reconcileMapTracking('map-open')` | Once per session open (ref guard) |
| Market | `notifyMarketScreenOpened` | Required every mount |
| VehicleMarketplace | `refreshAll` on mount | **Gated** by `isActive` when tab hidden |
| More | Lazy sub-routes + `isActive` | Already respected |

---

## Files changed

### New modules

- `src/store/selectors/timeBuckets.ts` — shared game-hour bucket selectors
- `src/store/selectors/playerFields.ts` — field-level player selectors

### Extended

- `src/store/selectors/stableCollections.ts` — world events, market alerts, missions, retention, reward receipts
- `scripts/performance-regression-test.ts` — stable selector + bucket guards

### Screens

- `src/screens/DashboardScreen.tsx`
- `src/screens/MarketScreen.tsx`
- `src/screens/ContractsScreen.tsx`
- `src/screens/FleetScreen.tsx`
- `src/screens/MapScreen.tsx`
- `src/screens/FinanceScreen.tsx`
- `src/screens/WarehouseScreen.tsx`
- `src/screens/MissionsScreen.tsx`
- `src/screens/LeaderboardScreen.tsx`
- `src/screens/VehicleMarketplaceScreen.tsx`
- `App.tsx` — passes `isActive` to VehicleMarketplace keep-alive tab

---

## Selector changes

### Time buckets (`timeBuckets.ts`)

| Selector | Granularity | Game hours |
|----------|-------------|------------|
| `selectCurrentTimeQuarterHour` | 15 min | `floor(t*4)/4` |
| `selectCurrentTimeHour` | 1 hour | `floor(t)` |
| `selectCurrentTimeSixHour` | 6 hours | `floor(t/6)*6` |
| `selectCurrentTimeGameDayAnchor` | Day | `floor(t/24)*24` |

Simulation `currentTime` is **unchanged** — only UI subscription granularity.

### Stable collections

Replaced hot-path `?? []`, `?? {}`, and per-render `createDefault*()` with:

- `selectWorldEvents` → `EMPTY_WORLD_EVENTS`
- `selectMarketAlerts` → `EMPTY_MARKET_ALERTS`
- `selectMissions` → `DEFAULT_MISSIONS_STATE`
- `selectRetention` → lazy singleton default
- `selectRewardReceipts` → `EMPTY_REWARD_RECEIPTS`
- Existing: `selectCities`, `selectProducts`, `selectRoutes`, `selectContracts`, `selectActiveDeliveries`, `selectActiveTransfers`, `selectFinanceLedger`

### Player field selectors

`selectPlayerMoney`, `selectPlayerLevel`, `selectPlayerTrucks`, `selectPlayerDrivers`, `selectPlayerTrailers`, `selectPlayerWarehouses`, `selectPlayerReputation`, `selectPlayerHomeCityId`, `selectPlayerCompletedContracts`, `selectHasPlayer`, `selectPlayer` (narrow use for score helpers / modals).

---

## Before / after evidence

| Screen | Baseline trigger | Old subscription | New subscription | Expected reduction | Behavior risk |
|--------|------------------|------------------|------------------|--------------------|---------------|
| **Dashboard** | Every tick + whole player | `currentTime`, `player`, `?? []` defaults | Hour + day anchors; field selectors for money/trucks/warehouses; stable missions/retention/events; `selectPlayer` only for score/level helpers | High — no tick re-render for hero/world cards | Low — hour bucket for warehouse fill & score |
| **Market** | Day/6h already | Inline `?? []` | `selectCities/Products/Routes/Contracts/MarketAlerts` + shared bucket imports | Low–medium — fewer false-positive renders from new array refs | None |
| **Contracts** | Quarter-hour + whole player | `player`, `?? []` | Field selectors for fleet/preview keys; stable collections; shared quarter-hour | Medium — previews skip unrelated player fields | Low — quarter-hour unchanged |
| **Fleet** | Every tick (lease visibility) | Inline `?? []` | Stable collections + field selectors | Low on refs; tick unchanged | None |
| **Map** | Every tick (tracking) | Whole `player` | Field selectors; `selectPlayer` only for `getRecommendedMapAction` | Medium — unrelated player mutations | None — still raw tick |
| **Finance** | Every tick | `currentTime`, whole `player` | Hour bucket + `selectPlayer` for score only | Medium | Low — hour bucket for score |
| **Warehouse** | Every tick | Whole `player`, `?? []` | Quarter-hour + field selectors | Medium | Low — 15m inventory UI granularity |
| **Missions** | Every tick | Raw time + unstable defaults | Quarter-hour + stable selectors | Medium | Low |
| **Leaderboard** | Every tick | Raw time + whole player | Hour bucket + stable collections | Medium when breakdown visible | Low |
| **VehicleMarketplace** | Hidden tab fetch | Whole `player` arrays | Field selectors; mount gated by `isActive` | High when tab hidden | None |

### Tick consumers after pass

**Still render every tick (unavoidable / intentional):**

- **Fleet** — `getVisibleFleetTrucks` / lease expiry (`selectCurrentTime` raw)
- **Map** — delivery progress, truck map positions, ETA (`selectCurrentTime` raw)
- **Contracts** — active delivery cards (per-card quarter-hour bucket; list still updates on delivery state)

**No longer render every tick:**

- **Dashboard** — hour/day buckets
- **Finance** — hour bucket for company score
- **Warehouse** — quarter-hour bucket
- **Missions** — quarter-hour bucket
- **Leaderboard** — hour bucket for local score breakdown
- **Market** — was already bucketed; no raw tick subscription added

---

## Market screen

- Replaced inline `?? []` with stable selectors for cities, products, routes, contracts, market alerts.
- Reused shared `selectCurrentTimeGameDayAnchor` and `selectCurrentTimeSixHour` (same behavior as prior inline math).
- Callback-only store actions unchanged; no gameplay path changes.

## Contracts screen

- Preview/sort memos now depend on field selectors (`selectPlayerTrucks`, level, reputation, home city) instead of whole `player`.
- Active delivery card truck lookup uses `selectPlayerTrucks`.
- Stable `selectContracts`, `selectActiveDeliveries`, `selectWorldEvents`.
- Quarter-hour bucket centralized in `selectCurrentTimeQuarterHour`.

## Hidden-screen behavior

- **More** — already uses `isActive` for embedded Finance/Warehouse.
- **VehicleMarketplace** — now receives `isActive` from `App.tsx`; initial `refreshAll` and auth re-fetch effects skip when tab is not visible. Store subscriptions remain (money/trucks needed if user opens tab quickly) but network/mount work is gated.

---

## Tests

Extended `scripts/performance-regression-test.ts`:

- Stable empty fallback identity (`EMPTY_*` references)
- Time bucket math (quarter-hour, hour, six-hour, game-day)
- Dashboard hour bucket / no raw `currentTime` subscription
- Contracts quarter-hour + truck field selector
- Market stable selectors
- Vehicle marketplace `isActive` wiring

---

## Validation

| Command | Result |
|---------|--------|
| `npx tsc --noEmit` | **PASS** |
| `npm run verify` | Fails at `verify-ios-apple-auth-config.ts` — `IOS_ARCHIVE_APP_PATH` missing / no `LogistiCore.app` |
| `npm run backend:verify` | **PASS** (64/64 emulators, cloud-save tests) |
| `git diff --check` | **PASS** |
| `scripts/performance-regression-test.ts` | **PASS** |

**Classification:** `FUNCTIONAL_VERIFY_PASS` + `IOS_ARCHIVE_PREFLIGHT_PENDING` (not a code regression).

---

## Real-device checks still required

1. Tab switch frame time (Dashboard ↔ Market ↔ Contracts) on mid-tier Android + iOS
2. Map truck animation smoothness with active deliveries (tick consumer — should be unchanged)
3. Fleet lease-expiry row appearance timing (tick consumer)
4. Warehouse inventory/spoilage display after 15+ minutes game time
5. VehicleMarketplace: open from More tab after browsing other tabs — confirm listings load once when tab becomes active
6. Dashboard world-event card countdown — confirm day anchor is acceptable visually

---

## Final status

`RENDER_ZUSTAND_OPTIMIZED`

# LogistiCore V1.1 Phase 2D — Market / Contracts Presentational Extraction

## Status

`V1_1_PHASE_2D_VERIFIED`

Phase 2D is a presentation-only structural refactor. Gameplay, business rules,
store state, persistence, cloud schema, backend behavior, navigation, auth,
privacy, balance values and copy remain unchanged.

## Original responsibility map

### `ContractsScreen`

- **Container/domain ownership:** contract collections, active deliveries, world
  events, player/fleet selectors, contract preview generation, availability,
  filtering/sorting, market-opportunity matching and scheduler refresh.
- **Action ownership:** quick start, advanced assignment, fleet navigation,
  market filter clearing, manual/ad refresh and delivery boost.
- **Lifecycle ownership:** five effects, the status timeout, market-highlight
  timeout and tutorial/open-screen notifications.
- **Modal ownership:** quick action, assignment, roadside fuel and truck refuel.
- **Presentation originally embedded:** segmented tabs, market-filter summary,
  contracts summary and next-route hint, plus contract/delivery cards.

### `MarketScreen`

- **Container/domain ownership:** global market/client state, cache/fuel state,
  city/product/warehouse/contract selectors, opportunity detection, inventory,
  trade eligibility/profit and world-event price modifiers.
- **Action ownership:** refresh, buy, sell, alert creation/deletion, product
  detail, contract navigation and all trade callbacks.
- **Lifecycle ownership:** six effects, fetch/status timers, pending focus and
  tutorial/open-screen handling.
- **Modal ownership:** trade, price alert and product detail.
- **Presentation originally embedded:** world status, city summary, tabs, city
  chips, product cards and opportunity cards.

## Extracted boundaries

### Contracts

`src/features/contracts/components/ContractsOverview.tsx`

- `ContractsTabBar`
- `MarketFilterInfoCard`
- `ContractsSummaryStrip`
- `NextRouteHintCard`

These components own one coherent screen-overview responsibility. They receive
plain values, collections and callbacks. They do not subscribe to Zustand and
do not own effects, timers, actions or modals.

### Market

`src/features/market/components/MarketOverview.tsx`

- `MarketStatusSummary`
- `CompactCitySummary`
- `MarketTabSegment`
- `MarketCityChip`

`src/features/market/components/MarketOpportunityCards.tsx`

- `TradeOpportunityCard`
- `OpportunityCard`

The opportunity score normalization, labels and visual thresholds moved with
the cards without changing their constants, boundaries, labels or variants.
Opportunity detection, matching and navigation remain in `MarketScreen`.

## State ownership before / after

| Concern | Before | After |
|---|---|---|
| Contract state/actions | `ContractsScreen` | `ContractsScreen` |
| Market state/actions | `MarketScreen` | `MarketScreen` |
| Modal visibility/selection | Screen containers | Screen containers |
| Filtering/sorting/preview maps | Screen containers | Screen containers |
| Trade and acceptance rules | Existing domain helpers + screens | Unchanged |
| Presentational Zustand subscriptions | 0 | 0 |

No state was duplicated and no display component can mutate domain state.

## Metrics

| Metric | Before | After |
|---|---:|---:|
| `MarketScreen.tsx` LOC | 2696 | 2170 |
| `ContractsScreen.tsx` LOC | 2272 | 1981 |
| Combined screen LOC | 4968 | 4151 |
| Market embedded visual components | 7 | 1 container-local + 6 extracted |
| Contracts embedded visual components | 7 | 3 container-local + 4 extracted |
| Market direct Zustand subscriptions | 30 | 30 |
| Contracts direct Zustand subscriptions | 28 | 28 |
| Extracted component Zustand subscriptions | 0 | 0 |
| Market `useEffect` count | 6 | 6 |
| Contracts `useEffect` count | 5 | 5 |

The subscription and effect counts intentionally did not change. This phase
changes ownership of rendering only; it does not introduce an additional tick
consumer or broaden an existing selector.

## Render and tick ownership

- Market game-day and six-hour time buckets remain in `MarketScreen`.
- Contract quarter-hour preview buckets remain in `ContractsScreen` and the
  existing active-delivery card.
- Extracted components have no `useEffect`, timeout, interval or store access.
- Existing memoized product and contract cards were not refactored merely to
  reduce line count.
- Modal callbacks still terminate directly in the container action handlers.

Expected render-frequency change: **none**.

## Files changed for Phase 2D

- `src/screens/MarketScreen.tsx`
- `src/screens/ContractsScreen.tsx`
- `src/features/market/components/MarketOverview.tsx`
- `src/features/market/components/MarketOpportunityCards.tsx`
- `src/features/contracts/components/ContractsOverview.tsx`
- `scripts/market-contracts-presentational-extraction-test.ts`
- `scripts/contracts-screen-layout-regression-test.ts`
- `scripts/market-product-card-layout-regression-test.ts`
- `docs/release-audit/V1_1_PHASE_2D_MARKET_CONTRACTS_EXTRACTION.md`

The two existing layout tests were updated only to follow their current
canonical token/alias (`MIN_TOUCH_TARGET` and
`marketScrollBottomPadding = contentBottomPadding`). No assertion was removed
and no runtime file was changed to satisfy those stale source-string checks.

## Validation results

### Required checks

- `npx tsc --noEmit` — PASS
- `npm run validate:store-production` — PASS
- `npm run backend:verify` — PASS; Firestore emulator suite 65/65
- `git diff --check` — PASS

### Focused structural / UI checks

- `market-contracts-presentational-extraction-test.ts` — PASS
- `contracts-screen-layout-regression-test.ts` — PASS (12/12)
- `market-product-card-layout-regression-test.ts` — PASS (58/58)
- `market-tutorial-regression-test.ts` — PASS (45/45)
- `market-buy-cash-preview-regression-test.ts` — PASS (21/21)
- `market-live-cache-regression-test.ts` — PASS (35/35)
- `performance-regression-test.ts` — PASS
- `tab-navigation-performance-regression-test.ts` — PASS

### Contracts

- contract generation reliability — PASS (18/18)
- contract scheduler performance — PASS (13/13)
- contract availability — PASS (13/13)
- contract generation health — PASS (32/32)
- contract generation diversity — PASS
- contract/truck eligibility — PASS (28/28)
- active-job accept/fuel warning — PASS (28/28)

### Marketplace / offline / account safety

- marketplace UI and state regression — PASS
- marketplace purchase deadlock — PASS (83/83)
- marketplace startup reconciliation — PASS (39/39)
- marketplace transaction integrity — PASS (25/25)
- marketplace response contract — PASS
- offline progression smoke — PASS (71/71)
- offline delivery progression — PASS (67/67)
- offline economy — PASS (52/52)
- account sign-out/deletion — PASS (41/41)
- cross-platform account deletion — PASS (30/30)
- App Store privacy/account — PASS (18/18)
- ad privacy — PASS (44/44)

## Pre-existing non-Phase-2D test debt observed

These failures are outside the touched execution paths and reproduce against
unchanged source:

- `release-regression-contract-transfer-navigation-test.ts`: one stale guest
  leaderboard copy assertion.
- `phase3-smoke-test.ts`: four stale static assertions for the earlier embedded
  `UpgradesScreen` route.
- `global-economy-client-regression-test.ts`: one static initialization-order
  assertion still scans the pre-Phase-2C ownership location; live/cache market
  behavior passed its dedicated 35/35 suite.

They are not runtime regressions introduced by Phase 2D and were not weakened
or modified in this phase.

## Diff audit

- Gameplay/balance values changed: **no**
- Contract generation/rewards/reputation changed: **no**
- Marketplace rules/backend changed: **no**
- Save or cloud schema changed: **no**
- Auth/account deletion/privacy changed: **no**
- Navigation routes changed: **no**
- ATT/IDFA code introduced: **no**
- New dependency: **no**
- New listener/timer/subscription: **no**
- Android/iOS conditional behavior changed: **no**

## Remaining risks and next phase

- `ProductMarketCard`, `ContractCard` and `ActiveDeliveryCard` remain large.
  Their extraction should wait for display-model boundaries so business-derived
  calculations are not duplicated in children.
- Address the three pre-existing static-test debts in a dedicated regression
  triage rather than mixing them into this structural change.
- The next V1.1 feature phase can add seasons/challenges/company stats under
  dedicated feature folders, without extending these screen containers.

V1_1_PHASE_2D_VERIFIED

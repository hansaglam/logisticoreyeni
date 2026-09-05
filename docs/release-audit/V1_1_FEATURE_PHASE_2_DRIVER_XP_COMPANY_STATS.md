# LogistiCore V1.1 Feature Phase 2 — Driver XP / Company Stats

## Status

`V1_1_FEATURE_PHASE_2_FOUNDATION_VERIFIED`

This phase adds an additive, informational progression foundation. It does not change delivery rewards, reputation, contract generation, marketplace authority, leaderboard scoring, authentication, privacy, account deletion, or backend behavior. No production UI flag was enabled.

## Progression authority map

| Value | Authority | Notes |
|---|---|---|
| Marketplace cash and fleet | Trusted backend | Existing marketplace/server-state reconciliation remains unchanged. |
| Leaderboard inputs and score | Trusted backend | Existing `serverState` and leaderboard callables remain the source of truth. New stats are not read by leaderboard code. |
| Seasons/challenges | Trusted backend | Existing callable/history-backed authority remains unchanged. Driver XP is not a challenge input. |
| Player level, legacy player XP | Client-local canonical | Existing behavior; unchanged by this phase. |
| Driver XP and level | Client-local canonical | Awarded only by local delivery settlement. Cloud save persists it, but it is not represented as server-authoritative. |
| Delivery lifetime counters, distance, revenue | Client-local canonical, informational | Updated at the existing settlement boundary and never used for rewards or leaderboard scoring. |
| Marketplace purchase/sale counters | Client-local informational projection of trusted receipts/reconciliation | Purchases use the returned backend transaction ID; sales use authoritative sold-truck tombstones. |
| Cash/fleet/warehouse/reputation peaks | Derived | Monotonic minima captured from current player state. |
| Pre-V1.1 lifetime distance, revenue, early/on-time history | Unavailable/deferred | Deliberately not fabricated. UI labels detailed history as starting with V1.1. |

## Driver progression model

The existing shipped driver XP values remain the save-compatible lifetime-XP field (`driver.xp`). A typed `DriverProgress` read model exposes:

- `level`
- `xp`
- `xpIntoLevel`
- `xpForNextLevel`
- `lifetimeXp`

The legacy thresholds remain unchanged:

| Level | Lifetime XP |
|---:|---:|
| 1 | 0 |
| 2 | 100 |
| 3 | 250 |
| 4 | 500 |
| 5 | 1,150 |

Levels 6–50 use deterministic integer thresholds. The post-level-5 step cost is 750 XP for level 6 and increases by 100 XP per level (850, 950, ...). This produces quadratic cumulative growth rather than exponential growth. It preserves fast early progression and gives bounded long-term headroom. Level 5 remains the existing specialty unlock point.

Driver level is display/progression-only in this phase. No new fuel, speed, time, reward, reputation, market, or contract effect was added. The pre-existing contract driver-level eligibility rule was preserved unchanged.

## XP sources

XP is granted only by successful delivery completion through the existing settlement path. The existing formula retains its trusted local inputs:

- route distance
- contract type/difficulty modifier
- on-time status

Failed or cancelled deliveries grant zero driver XP. Incident/choice button handling no longer applies `driverXpDelta`, preventing an interaction-driven XP source. Marketplace activity does not grant driver XP.

Because delivery settlement remains local, driver XP is explicitly classified as local progression. It must not be promoted to a trusted reward, leaderboard, or challenge input without a future server settlement journal.

## Duplicate protection

Successful delivery stats reuse the existing delivery `settlementId`. Driver XP continues to be protected by the existing delivery completion guards (terminal status, settlement fields, completion notification/event, and finance ledger identity). `CompanyStats.appliedEventIds` adds a bounded, save-persisted receipt layer so the same settlement cannot increment stats twice after foreground retry, offline settlement, save reload, or cloud restore.

Failure/cancellation uses `delivery-failure:<deliveryId>`. Marketplace purchases use the backend transaction ID. Marketplace sales use `marketplace-sale:<soldTruckId>`. Receipt history is bounded to 256 entries; permanent delivery terminal state and the existing settlement guards remain the primary long-lived completion protection.

## CompanyStats schema

`CompanyStats` schema version 1 contains:

- delivery totals: completed, failed, early, on-time, late
- completed distance and delivery revenue
- marketplace purchases and sales
- peak cash, owned vehicles, warehouses, and reputation
- aggregate driver lifetime XP
- tracking start/coverage metadata
- bounded applied-event receipts

All numeric inputs are normalized to finite, non-negative values. Counts are integral. These fields are informational and do not grant rewards, affect rankings, or unlock paid content.

## Migration strategy

The save version was not changed. `companyStats` is an optional additive payload field.

For an old save with no stats:

- current completed/failed/late counters become conservative minimums
- current fleet, warehouse, cash, reputation, and aggregate driver XP become conservative peak minimums
- historical distance, historical revenue, early deliveries, and on-time deliveries start at zero
- `historicalDataComplete=false` communicates that detailed lifetime history begins with V1.1
- the first authoritative marketplace tombstone snapshot becomes a baseline and does not invent historical sales

Fresh games mark the empty marketplace baseline as initialized, so their first real sale is counted. Missing/malformed values normalize safely without destructive migration.

## Save, cloud, and account behavior

Serialization, fallback normalization, and hydration include the optional stats object. Receipts survive JSON/cloud round trips. Cloud behavior remains whole-save/account-owner scoped; no independent stats merge or cross-account global cache was introduced. Consequently:

- old saves load safely
- current account stats travel with that account's save
- account switching continues to use existing owner-UID isolation
- guest-to-linked behavior remains governed by the existing cloud conflict/link flow
- marketplace canonical cash/fleet reconciliation still wins over stale saves

No cloud schema, Firestore rule, callable, or backend server-state change was made for this phase.

## Delivery and offline settlement

The same completion action handles live and offline completions. A successful completion atomically updates the driver, player settlement, and CompanyStats within the existing store transition. Punctuality uses the canonical reputation settlement classification. Failed/critically failed/cancelled paths increment only failure stats and apply no success XP. Existing delivery rewards and reputation outcomes are unchanged.

Offline progression regression suites confirm settlement occurs once, rewards and fuel are not duplicated, and repeated hydration does not settle again.

## Marketplace statistics

- Purchase count is applied only after a successful callable result and uses its authoritative transaction ID.
- Sale count is derived during marketplace reconciliation from authoritative `soldTruckTombstones`.
- Existing players' first tombstone set is a baseline, avoiding fabricated history.
- Existing marketplace cash/fleet authority and reconciliation rules were not changed.

## Minimal internal UI

A read-only company progress card was added to the Company screen. It displays the first driver's level/XP bar and selected informational lifetime values. It owns no action and has no store subscription of its own; the container passes a memoized display model.

Flags:

- `EXPO_PUBLIC_ENABLE_DRIVER_PROGRESSION`
- `EXPO_PUBLIC_ENABLE_COMPANY_STATS`

Internal profile: `true`. Store production profile: `false`. The production validator rejects either incomplete feature when enabled. The UI requires both flags and therefore remains hidden in production.

## Files changed for Phase 2

- `.env.example`
- `app.config.js`
- `src/config/backendRoadmap.ts`
- `src/config/storeProductionPolicy.ts`
- `src/domain/companyStats.ts`
- `src/features/companyStats/CompanyProgressFoundationCard.tsx`
- `src/screens/FleetScreen.tsx`
- `src/screens/MoreScreen.tsx`
- `src/screens/VehicleMarketplaceScreen.tsx`
- `src/simulation/driverProgress.ts`
- `src/storage/saveGame.ts`
- `src/store/gameStore.ts`
- `src/types/game.ts`
- `scripts/driver-progression-company-stats-test.ts`
- `scripts/seasons-challenges-ui-regression-test.ts` (internal profile fixture updated for the two new required flags)

The working tree also contains earlier Phase 1/2C/2D work. Those unrelated changes were preserved and not reverted.

## Validation results

| Validation | Result |
|---|---|
| `npx tsx scripts/driver-progression-company-stats-test.ts` | PASS |
| `npx tsc --noEmit` | PASS |
| `npm run validate:store-production` | PASS |
| `npm run backend:verify` | PASS; backend build/typecheck, consistency, emulator and cloud-save suites; 69 backend tests passed |
| `git diff --check` | PASS; only existing LF/CRLF conversion warnings |
| Offline delivery settlement regression | PASS |
| Offline delivery progress regression | PASS |
| Offline progression smoke | PASS |
| Phase 3 smoke (driver XP/contract behavior) | PASS, 115 assertions |
| Seasons/challenges foundation | PASS, 26 assertions |
| Seasons/challenges UI regression | PASS, 32 assertions |
| Leaderboard regression/eligibility/score V2 | PASS |
| Marketplace regression/deadlock/startup reconciliation/UI | PASS |
| Account sign-out/deletion regression | PASS, 41 assertions |
| App Store privacy/account regression | PASS, 18 assertions |
| Cloud save conflict and production audit | PASS |
| Performance and tab-navigation regression | PASS |

The initially invoked filename `offline-delivery-settlement-test.ts` does not exist; the canonical `offline-delivery-settlement-regression-test.ts` was run and passed. This was a command-name correction, not a product failure.

## Remaining risks and deferred work

- Driver XP and CompanyStats are client-local/informational; they are not suitable for server rewards or competitive ranking.
- Exact pre-V1.1 distance, revenue, early/on-time, and marketplace transaction history remains unknown by design.
- The bounded stats receipt list is supplemental; long-lived delivery idempotency continues to rely on canonical terminal/settlement guards.
- The minimal UI still needs real-device Android/iOS layout QA before flags are enabled beyond internal builds.
- A future trusted delivery settlement journal is required before seasons/challenges or rewards consume these metrics.
- Final polished progression/profile UI, driver perks, achievements, and challenge coupling are intentionally deferred.

## Next recommended phase

Run the combined internal Android/iOS QA build with both Phase 2 flags enabled, validate old-save migration and account switching on devices, then design the polished progression UI. Any server-reward integration should be a separate backend-authoritative settlement phase.

V1_1_FEATURE_PHASE_2_FOUNDATION_VERIFIED

# LogistiCore V1.1 Feature Phase 4 — Market Alerts, Local Notifications, Analytics

## Scope and outcome

Phase 4 adds an internal-only retention/observability foundation without changing marketplace authority, game economy, rewards, authentication, privacy or backend behavior. Marketplace activity is derived only from canonical backend responses/reconciliation, mirrored into the existing Phase 3 Inbox, and optionally emitted through the existing Expo local-notification service while the app is backgrounded.

No analytics SDK was present. A typed, fail-open provider boundary was added and deliberately defaults to no-op/deferred. No remote push infrastructure was added.

## Authority map

| Source | Classification | Phase 4 use |
|---|---|---|
| Successful `purchaseVehicleListing` result applied by `applyMarketplacePurchaseResult` | Canonical client result from trusted backend response | Purchase inbox alert, optional local OS notification, idempotent analytics success |
| `soldTruckIds` in authoritative marketplace reconciliation | Trusted backend-derived state | Sale inbox alert, optional local OS notification, idempotent analytics observation |
| First sold-tombstone reconciliation for an existing save | Trusted but historical/baseline-only | Establishes baseline; emits no retroactive alerts |
| Canonical listing response | Trusted backend response | Model supports listing expiration, but emission is deferred until a durable transition identity is available |
| Existing global market snapshots | Trusted/read-only for price display | Existing user-created price alarms remain separate; automatic opportunity generation deferred |
| UI taps, optimistic cash/fleet, local listing assumptions | Unsafe/deferred | Never used to create marketplace success alerts or analytics success |

## Market alert model

`CanonicalMarketAlert` contains:

- stable `id` and `dedupeKey`
- supported canonical type
- bounded product copy
- `createdAt` and optional `expiresAt`
- `relatedRoute`
- explicit `sourceAuthority`

Enabled sources:

- `market-purchase:<transactionId>` from a canonical purchase result
- `market-sale:<sold-tombstone-id>` from authoritative reconciliation

`marketplace_listing_expired` remains typed but is not emitted in Phase 4 because the current response does not expose a durable transition receipt suitable for restart-safe notification dedupe. Random or pseudo-AI opportunities were not created.

## Notification architecture

The implementation reuses `expo-notifications` through `src/services/notifications.ts`:

1. Canonical event is observed.
2. Persisted receipt and existing Inbox item are committed first.
3. Preference is checked.
4. Foreground events remain Inbox-only.
5. Background events query current OS permission without prompting.
6. A local notification uses the deterministic receipt identifier.

The old `MARKET_OS_NOTIFICATIONS_ENABLED=false` policy for price-alarm scheduling remains unchanged. Phase 4 marketplace activity is separately guarded by `MARKET_ALERTS_ENABLED` and `NOTIFICATION_CENTER_ENABLED`.

## Permission strategy

- No permission prompt occurs at first launch, reconciliation or background event.
- The prompt is contextual: it occurs when the player first enables a marketplace notification preference.
- `permissionAsked` prevents repeated prompts from toggle churn.
- Denied/undetermined permission never blocks gameplay or Inbox delivery.
- The internal settings surface displays `Açık`, `Kapalı` or `Henüz sorulmadı`.

## Inbox integration

No second inbox/store was created. Alerts use the Phase 3 `ProgressionFoundationState.inbox` and its 150-item retention policy. Marketplace receipts are separately bounded to 250 identities. Opening a marketplace alert:

- marks the existing Inbox item read,
- emits a non-transactional typed analytics open event when enabled,
- routes through the canonical `vehicleMarketplace` navigation request.

Old saves normalize to empty receipts and conservative disabled preferences. The initial marketplace sale reconciliation establishes a no-notification baseline, preventing first-upgrade spam.

## Analytics architecture and events

Repository audit found no Firebase Analytics or other analytics provider. No dependency was added. `src/services/analytics.ts` provides:

- a small typed V1.1 event catalog,
- an injectable provider boundary,
- allowed/bounded parameter keys and values,
- explicit rejection of email, UID, token, authorization, cash, save, device and free-text/message keys,
- fail-open dispatch with no retry loop,
- default no-op behavior until a privacy-reviewed provider is selected.

Catalog:

- App: `app_open`, `session_start`
- Seasons: `seasons_screen_view`, `challenge_claim_tap`, `challenge_claim_success`, `challenge_claim_failure`
- Progression: `driver_level_up`, `achievement_unlocked`, `progress_history_view`
- Market: `marketplace_view`, `marketplace_purchase_success`, `marketplace_sale_observed`, `market_alert_open`
- Inbox: `inbox_view`, `inbox_item_open`

Transactional success events are wired only after canonical success/reconciliation. Purchase, sale and achievement events use bounded persisted receipts. Analytics provider failure returns false and cannot reject a gameplay transaction.

## Privacy review

- No ATT or IDFA path was introduced.
- No Firebase Messaging dependency was added.
- No push token registration or upload exists.
- No APNs/FCM remote sender or backend notification worker exists.
- No email, raw UID, auth token, Apple authorization code, save payload, exact device identifier, exact cash balance or free-form user text is accepted by the analytics boundary.
- iOS non-personalized ads/privacy behavior is unchanged.

## Persistence, reset and dedupe

Notification preferences, market activity receipt IDs and analytics receipt IDs are additive fields inside the existing owner-scoped progression foundation. Existing save normalization and cloud serialization carry these fields without a save-version bump or destructive migration. Receipt collections are bounded to 250; Inbox remains bounded to 150.

Account switching continues to load the target account's owner-scoped save, so Inbox/preferences/receipts are not copied globally. Existing new-game/account reset creates empty receipts and conservative preferences. Account deletion and cloud schemas/backend collections were not changed.

## Internal settings UI

The existing `İlerleme ve Geçmiş` screen now contains a compact internal-only notification preference card for:

- vehicle sale alerts
- marketplace activity alerts
- challenge updates
- season updates

The Phase 3 Inbox badge and route remain the single notification-center entry point. There is no new bottom-tab badge or Settings redesign.

## Feature flags

| Feature | Internal | Store production | Device QA status |
|---|---:|---:|---|
| Phase 1 — Seasons | true | false | Android linked E2E incomplete; combined QA pending |
| Phase 1 — Challenges | true | false | Android linked claim/double-tap/network cases pending |
| Phase 2 — Driver progression | true | false | Code/regression verified; Android+iOS visual QA pending |
| Phase 2 — Company stats | true | false | Code/regression verified; Android+iOS visual QA pending |
| Phase 3 — Achievements | true | false | Code/regression verified; Android+iOS visual QA pending |
| Phase 3 — Season history | true | false | Code/regression verified; canonical final-rank snapshot deferred |
| Phase 3 — Inbox | true | false | Code/regression verified; Android+iOS visual QA pending |
| Phase 4 — Market alerts | true | false | Foundation tests verified; background device QA pending |
| Phase 4 — Notification center | true | false | Foundation tests verified; OS permission/device QA pending |
| Phase 4 — V1.1 analytics | true | false | No-op provider verified; provider selection intentionally deferred |

The store production validator rejects all incomplete V1.1 flags when true. `.env.production` keeps them false; `.env.internal` keeps the combined Phase 1–4 matrix true.

## Files changed in Phase 4

- `.env.example`, `.env.internal`, `.env.production`
- `app.config.js`
- `src/config/backendRoadmap.ts`
- `src/config/storeProductionPolicy.ts`
- `src/domain/progressionFoundation.ts`
- `src/domain/v11Notifications.ts`
- `src/services/analytics.ts`
- `src/services/notifications.ts`
- `src/store/gameStore.ts`
- `src/types/game.ts`
- `src/features/progression/ProgressHistoryScreen.tsx`
- `src/features/seasons/SeasonsChallengesScreen.tsx`
- `src/screens/VehicleMarketplaceScreen.tsx`
- `scripts/market-alerts-notifications-analytics-test.ts`
- `scripts/seasons-challenges-ui-regression-test.ts` (internal flag fixture only)

The working tree already contained earlier Phase 1–3 and Phase 2C/2D changes. Those changes were preserved. No Phase 4 backend source, Firestore rule, marketplace authority, economy, reward, auth or dependency change was made.

## Validation

| Validation | Result |
|---|---|
| `npx tsc --noEmit` | PASS |
| `npm run validate:store-production` | PASS |
| `scripts/market-alerts-notifications-analytics-test.ts` | PASS — 36 assertions |
| Seasons/challenges foundation + UI | PASS — 26 + 32 assertions |
| Achievements/history/inbox | PASS |
| Driver progression/CompanyStats | PASS |
| Marketplace regression/transaction/UI/startup reconciliation | PASS |
| Leaderboard regression/server authority | PASS |
| Delivery completion/settlement | PASS |
| Offline delivery progress/settlement | PASS |
| Existing OS notifications | PASS — 61 assertions |
| Account switch isolation | PASS/MITIGATED |
| Account sign-out/deletion | PASS — 41 assertions |
| App Store privacy/account | PASS — 18 assertions |
| Cloud save conflict/production/size | PASS |
| Performance/screen-open/tab navigation | PASS |
| `git diff --check` | PASS; repository line-ending warnings only |

## Remaining risks and deferred work

- Real Android/iOS background notification delivery, OS settings return flow, 360 px layout and account-switch device behavior require the combined internal device QA build.
- Analytics intentionally sends no data until a privacy-reviewed provider is supplied.
- Remote push, push tokens, APNs/FCM delivery and backend push workers remain a separate post-QA phase.
- Listing-expired alerts require a durable backend transition identity before activation.
- Automated price/opportunity alerts remain deferred; no reliable, product-approved baseline was inferred.
- Phase 1 linked claim E2E gaps documented in Phase 1C.2 remain open device-QA work, but are not a Phase 4 code regression.

V1_1_FEATURE_PHASE_4_FOUNDATION_VERIFIED

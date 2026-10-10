# Map V2 — Multimodal UI foundation (Step 28)

**Status:** production-safe **presentation only** — **not live RAIL activation**  
**Date:** 2026-09-22  
**Rollout default:** `MULTIMODAL_FEATURE_ROLLOUT = MULTIMODAL_OFF`  
**Preview gate:** `EXPO_PUBLIC_MAP_V2_MULTIMODAL_UI_PREVIEW=true` **and** `__DEV__` **and** rollout still `MULTIMODAL_OFF`

## 1. Purpose

Establish player-facing UI architecture for Step 27 ROAD→RAIL→ROAD offers: native Contracts presentation, gated visibility, disabled CTA, no gameplay.

This step does **not** accept offers, create shipments, reserve fleet, move money, settle, or persist offers.

## 2. Existing Contracts UI audit

Production **İşler** surface is `src/screens/ContractsScreen.tsx` (header “Sözleşmeler”).

| Concern | Existing architecture |
| --- | --- |
| Tabs | In-screen segments via `ContractsTabBar`: Müsait / Aktif / Tamamlanan. **No extra main tab.** |
| Main nav | Ana, Harita, Yönetim, İşler, Piyasa — unchanged |
| Cards | Inline `ContractCard` — dark card, 12 radius, cyan product icon, route + cargo + compact tonnes, payment + “İş kârı” |
| Detail / accept | `ContractQuickActionSheet` (bottom sheet) → `startDelivery` / assignment modal |
| Empty / loading | `EmptyState` (“Şu anda piyasada sözleşme yok”, “Yeni sözleşmeler hazırlanıyor…”) |
| Money | `formatMoney` (`$1,234`) |
| Duration / deadline | compact `Xs Ydk` / `Teslim …` from contract hours |
| Cargo | `ProductIcon` + `getProductName` |
| Cities | `getCityName` / `formatCityLocative` |
| List | `FlatList`, `keyExtractor` = entity id |
| Theme | `colors` navy/near-black, `spacing`, `MIN_TOUCH_TARGET` 44 |
| ROAD pool | `selectAvailableContractsForUi(contracts)` from live `generateContracts` |

ROAD cards already show estimated operational profit. Step 28 does **not** show RAIL `expectedGrossMargin` or `railCarrierCost` to players (those are not live ROAD pre-accept cost decomposition of the rail carrier).

## 3. Integration point

Fourth **secondary** segment on the same Contracts screen: **Raylı** (`key: 'rail'`), only when the internal UI preview gate is on.

## 4. Why this integration

Smallest change that keeps ROAD list/order/count identical when the feature is invisible. No new main tab, no interleaving RAIL rows into Müsait, no layout placeholder when OFF.

## 5. Rollout gating

`src/domain/multimodalUiPreviewGate.ts`

Visible iff:

1. `MULTIMODAL_FEATURE_ROLLOUT === 'MULTIMODAL_OFF'` (gameplay still off)
2. `__DEV__`
3. `EXPO_PUBLIC_MAP_V2_MULTIMODAL_UI_PREVIEW === 'true'`

Env override **alone** is fail-closed in non-DEV / production. UI preview ≠ INTERNAL_TEST activation (Step 29).

## 6. Production OFF behavior

Gate false ⇒ `HIDDEN_RAIL_PREVIEW_SESSION`, three tabs only, no generator call, no Raylı section, no blank rail spacer, ROAD `ContractCard` + `handleQuickStartDelivery` unchanged.

## 7. Internal preview behavior

Deterministic seed `rail-ui-preview-v1`. `loadPreviewRailOffers` returns a **separate** `{ offers, viewModels }` session. Offers are **not** inserted into `availableContracts` / `Contract[]`. Banner: “Demiryolu Taşımacılığı · iç önizleme”. CTA remains disabled. State is ephemeral (`selectedRailOfferId` only).

## 8. Offer card

`MultimodalRailOfferCard`: origin→destination, Demiryolu Taşımacılığı badge, cargo + tonnes, payment, süre vs teslim, Truck→Rail→Truck strip, readiness chip. Muted steel left accent (not full-card cyan).

## 9. Detail view

`MultimodalRailOfferDetailModal` — same bottom-sheet pattern as `ContractQuickActionSheet`.

Sections: header route/badge/cargo; **Taşıma Planı**; **Teklif** (payment, estimated duration, deadline, tonnes); **Hazırlık**; **Nasıl çalışır?**

## 10. Mode sequence UX

`MultimodalModeStrip`: Kamyon → Tren → Kamyon with icons **and** labels, wrapping for `<360dp`, `accessibilityLabel` text equivalent. No loop animation.

## 11. Fleet readiness UX

Structural `STRUCTURALLY_READY` vs current fleet: `READY_PREVIEW` / `FLEET_PREPARATION_REQUIRED` / `UNAVAILABLE` / `COMING_SOON` via presentation mapping — missing trucks are **preparation**, not “invalid contract”.

## 12. Third-party RAIL wording

Player copy: tren etabı üçüncü taraf lojistik taşıyıcı; oyuncu trene sahip olmaz; ilk/son mil kendi kamyonları. No locomotive/wagon/fuel/garage selectors.

## 13. Disabled CTA

Label **Yakında**. `disabled` + `accessibilityState.disabled`. `onPress` is a no-op. Not bound to `gameStore`, money, fleet, or save.

## 14. No acceptance

`canAcceptNow` stays false. Ready fleet does not enable the button. No fake success, no active job navigation.

## 15. Presentation adapter

`src/domain/presentation/multimodalRailOfferPresentation.ts` (no React). Formats Step 27 **snapshots** only. Fail-closed on unknown schema / NaN money. Omits hashes, OSM ids, policy names, `ROAD_RAIL_ROAD` enum, carrier cost, margin.

## 16. Localization

Follows existing Turkish hardcoded Contracts copy. Player terms: Demiryolu Taşımacılığı, Kamyon, Tren, Yakında, Filo hazırlığı gerekli. Cities/cargo via existing helpers.

## 17. Accessibility

Card `accessibilityRole="button"` with origin/destination/cargo/payment/rail summary. Mode strip has text equivalent. Disabled CTA announces disabled. Touch targets follow 44pt.

## 18. Responsive

`minWidth: 0`, wrap, `adjustsFontSizeToFit` on payment, sheet `ScrollView`, no fixed 400dp card width.

## 19. Empty / loading / error

Empty: “Şu anda uygun demiryolu taşıma teklifi bulunmuyor.”  
Unexpected: “Demiryolu teklifleri şu anda gösterilemiyor.”  
Malformed offer skipped (not a partial card). ROAD loading skeleton unchanged. Preview generation is sync but isolated so a future async load can set `loading` without mixing into ROAD.

## 20. Performance

No Skia, no MapScreen, no full ROAD/RAIL/SEA graphs, no Dijkstra on render. Compact access JSON loaded only if preview enabled. Memoized session; list keys = `offerId`.

## 21. Domain / UI separation

Generator → view model → list → detail. No payment/tariff/duration/deadline recomputation in JSX.

## 22. No persistence

No `railOffers` on `SaveGamePayload`. `SAVE_GAME_VERSION` remains **6**.

## 23. No settlement

UI must not call `getMultimodalSettlementId` / `buildMultimodalSettlementId`.

## 24. Manual QA

Required for this step (player-facing UI). See regression report. If Android toolchain is missing: `ANDROID_MANUAL_QA_BLOCKED_TOOLCHAIN`.

## 25. Known limitations

- Preview requires DEV + env; production cannot accidentally show RAIL UI via env alone.
- CTA is non-operational even with a ready fleet.
- Terminal names are generic (“Demiryolu terminali”) until verified player-facing names exist.
- Carrier cost / margin remain internal/DEV inspector only.
- Active multimodal **timeline** is not a live job (no Step 29 execution).

## 26. Step 29 handoff

INTERNAL_TEST activation may consider a controlled accept path. Step 28 must not implement `acceptMultimodalOffer`, reservation, money, settlement, or live RAIL execution.

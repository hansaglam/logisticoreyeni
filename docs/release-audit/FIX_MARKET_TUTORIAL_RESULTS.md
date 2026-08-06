# FIX: Market Tutorial — Results

**Date:** 2026-08-06  
**Scope:** Piyasa ekranı ilk giriş eğitimi + manuel yardım  
**Verdict:** Implementation complete

---

## 1. Otomatik İlk Giriş Davranışı

- Piyasa ekranı layout hazır olduktan sonra (`onLayout` + `InteractionManager.runAfterInteractions`) otomatik başlar
- Koşullar: `marketTutorialCompleted !== true` veya `marketTutorialVersion < MARKET_TUTORIAL_VERSION`
- Engeller: onboarding devam ediyor, offline summary, delivery incident, auth conflict, rewarded ad, ekran modalları açık
- Sabit `setTimeout` kullanılmaz

## 2. Manuel Soru İşareti Girişi

- Header sağda `[ ? ]` + `[ Yenile ]` (8 px gap, 44×44 px)
- `accessibilityLabel`: “Piyasa eğitimi”
- Manuel açılış tamamlanmış state’i sıfırlamaz; eğitim baştan oynatılır

## 3. Eğitim Adımları (7)

| # | Başlık | Hedef |
|---|--------|-------|
| 1 | Şehirleri karşılaştır | `city-chips` |
| 2 | Arzı takip et | `stock-badge` |
| 3 | Fiyat hareketini oku | `price-trend` |
| 4 | Uygun fiyattan satın al | `buy-button` |
| 5 | Depola veya başka şehre taşı | `warehouse-transfer` |
| 6 | Gerçek kârı hesapla | `profit-summary` |
| 7 | Piyasayı düzenli takip et | merkez tooltip · CTA “Piyasayı Keşfet” |

Unavailable kısa akış: şehirler → ürünler → yenile (3 adım)

## 4. Spotlight / Ölçüm Sistemi

- `MarketTutorialTarget` + `measureInWindow` registry
- `SpotlightMask` ile delik vurgusu; hedef dışı karartma
- Hedef yoksa crash yok → merkez tooltip + `[market-tutorial] target-missing` log

## 5. Scroll Davranışı

- Adım değişiminde hedefe scroll → ölç → step commit → overlay
- Scroll sırasında tooltip gizlenir (`tooltipVisible=false`)
- Scroll bitince `onMomentumScrollEnd` / `onScrollEndDrag` ile tek remeasure
- ~~Kullanıcı scroll yaparsa periyodik yeniden ölçüm (600 ms)~~ → kaldırıldı (stability fix)

## 6. Modal Çakışma Koruması

- Trade / alert / detail modalları açıkken auto-start ve help disabled
- Tutorial açıkken `handleBuyProductPress` erken return (buy action tetiklenmez)
- Spotlight hole üzerinde touch blocker

## 7. Save Davranışı

- `marketTutorialCompleted`, `marketTutorialVersion` GameState + save payload
- Tamamla / Atla → `completeMarketTutorial()` (version = 1, completed = true)
- Manuel tekrar completed state’i değiştirmez
- Cloud save ile taşınır (ownerUid isolation mevcut save modeliyle)

## 8. Cached / Unavailable Davranışı

- **Cached:** tam akış + “Son kayıtlı piyasa verileri gösteriliyor.”
- **Unavailable:** 3 adımlı kısa akış; boş şehir/ürün ekranında crash yok

## 9. Accessibility

- Modal `accessibilityViewIsModal`
- Tooltip `accessibilityRole="alert"` + live region
- Help button `accessibilityRole="button"` + label
- Reduce motion → fade animasyonu kapalı

## 10. Değişen Dosyalar

**Yeni:**
- `src/config/marketTutorial.ts`
- `src/tutorial/marketTutorialState.ts`
- `src/components/market/marketTutorialSteps.ts`
- `src/components/market/marketTutorialTargetRegistry.ts`
- `src/components/market/MarketTutorialTarget.tsx`
- `src/components/market/MarketTutorialOverlay.tsx`
- `src/components/market/MarketTutorialHelpButton.tsx`
- `src/hooks/useMarketTutorial.ts`
- `scripts/market-tutorial-regression-test.ts`

**Güncellenen:**
- `src/types/game.ts`
- `src/storage/saveGame.ts`
- `src/store/gameStore.ts`
- `src/screens/MarketScreen.tsx`
- `src/components/ui/AppScreen.tsx`

## 11. Test Sonuçları

| Komut | Sonuç |
|-------|-------|
| `npm run typecheck` | PASS |
| `npm run verify` | PASS |
| `npx tsx scripts/market-tutorial-regression-test.ts` | PASS |
| `npx expo export --platform android` | PASS |
| `npx expo export --platform ios` | PASS |
| `git diff --check` | PASS |

## 12. Final Android / iOS Build Gereksinimi

- Bu görevde AAB/APK/IPA/Xcode Archive üretilmedi
- Export bundle doğrulaması tamamlandı

---

## Kabul Kriterleri

| Kriter | Durum |
|--------|-------|
| İlk girişte eğitim açılır | ✅ |
| Tekrar girişte rahatsız etmez | ✅ |
| Soru işareti ile tekrar açılır | ✅ |
| Kısa ve anlaşılır 7 adım | ✅ |
| Gerçek Piyasa elementleri | ✅ |
| Al/sat/depo mantığı doğru | ✅ |
| Küçük ekran uyumu (360–430 px tooltip max width) | ✅ |
| Modal/scroll çakışması yok | ✅ |

---

## Transition and Tooltip Stability Fix

**Date:** 2026-08-06

### 1. Kesin kök neden

`onNext` / `onBack` doğrudan `setStepIndex` çağırıyordu; `prepareStep` (scroll + measure) asenkron sürerken butonlar aktif kalıyordu. Hızlı tap’ler kuyruğa alınmış birden fazla `stepIndex` artışı üretiyordu (1 → 3/4 sıçrama). Ayrıca overlay’deki **600 ms `setInterval`** sürekli `measureInWindow` + `setAnchorRect` tetikleyerek tooltip placement’ını (üst/alt) flip ettiriyor ve jitter oluşturuyordu.

### 2. Çoklu tap nedeni

- UI kilidi yoktu (`isPreparingStep` butonları disable etmiyordu)
- Handler’da sync re-entry guard yoktu
- `setStepIndex` measure tamamlanmadan commit ediliyordu
- Functional update bile olsa ardışık tap’ler ayrı render cycle’larında birikiyordu

### 3. Step transition state machine

`TutorialTransitionState`: `idle | scrolling | measuring | animating`

Canonical action: `requestStepChange('next' | 'previous')`

Akış: lock al → scroll → measure → `setStepIndex` commit → unlock

### 4. Async race koruması

- `transitionSequenceRef` — stale scroll/measure sonuçları yok sayılır
- `transitionLockRef` — sync çift tap engeli
- Tutorial kapanınca sequence invalidate + timer cleanup

### 5. 600 ms ölçüm kararı

**Kaldırıldı.** Yerine:

- `onScrollEndDrag` / `onMomentumScrollEnd` → tek debounced remeasure
- Step değişiminde tek prepare ölçümü
- `isMeaningfullyDifferentRect` (3 px epsilon) — gereksiz state update yok

### 6. Tooltip jitter çözümü

- Koordinatlar `normalizeTutorialRect` ile yuvarlanır
- Sub-epsilon rect farkında `setAnchorRect` atlanır
- Geçiş sırasında `tooltipVisible=false` — eski kutu hareket etmez

### 7. Placement hysteresis

`computeTooltipLayout` + `placementRef`: mevcut placement geçerliyken korunur; `TOOLTIP_PLACEMENT_HYSTERESIS_PX` (24) ile 1–2 px ölçüm farkında top↔bottom flip engellenir.

### 8. Android sonucu

- Scroll end callback ile measure
- Hardware back transition sırasında `onRequestClose` disabled
- Export bundle PASS

### 9. iOS sonucu

- `onMomentumScrollEnd` bounce sonrası tek ölçüm
- Safe area layout stabilizasyonu
- Export bundle PASS

### 10. Test sonuçları

| Komut | Sonuç |
|-------|-------|
| `npm run typecheck` | PASS |
| `npm run verify` | PASS |
| `npx tsx scripts/market-tutorial-regression-test.ts` | PASS |
| `npx expo export --platform android` | PASS |
| `npx expo export --platform ios` | PASS |

### 11. Gerçek cihaz manuel test gereksinimi

1. İleri’ye tek tap → tam 1 adım
2. İleri’ye 10 hızlı tap → yalnız 1 adım
3. Scroll gereken adımda tooltip sallanmamalı
4. Büyük font / orientation değişimi
5. Background/foreground + soru işaretiyle replay

### Değişen dosyalar (stability fix)

- `src/hooks/useMarketTutorial.ts` — state machine + `requestStepChange`
- `src/components/market/MarketTutorialOverlay.tsx` — presentational, lock UI
- `src/components/market/marketTutorialLayout.ts` — epsilon + hysteresis (yeni)
- `src/components/ui/AppScreen.tsx` — scroll end props
- `src/screens/MarketScreen.tsx` — overlay props + scroll end
- `scripts/market-tutorial-regression-test.ts` — transition/stability tests

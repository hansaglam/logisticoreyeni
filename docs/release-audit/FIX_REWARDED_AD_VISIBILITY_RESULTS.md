# FIX_REWARDED_AD_VISIBILITY_RESULTS

**Tarih:** 2026-08-06  
**Görev:** Ödüllü reklam giriş noktalarının görünmemesi (özellikle Harita aktif teslimat kartı)

---

## 1. Kök neden

Üç ana sorun tespit edildi:

1. **UI tamamen gizleniyordu:** `AdRewardButton`, `DeliveryBoostPanel` ve `DashboardDailyOpsBonusCard` bileşenleri `isAdProviderAvailable()` false olduğunda `return null` yapıyordu. Bu fonksiyon consent beklerken, SDK henüz init olmamışken veya reklam yüklenmemişken de false döndüğü için tüm rewarded girişleri kayboluyordu.

2. **Harita ekranında entegrasyon yoktu:** `MapTruckTrackingCard` aktif teslimat kartını gösteriyordu ancak `DeliveryBoostPanel` veya herhangi bir hızlandırma CTA'sı bağlı değildi. Boost yalnızca `ContractsScreen` teslimat detayında vardı.

3. **Tek global `rewardedLoaded` bayrağı:** `adProvider.ts` tek global lifecycle kullanıyordu; placement bazlı preload/state ayrımı yoktu. `delivery_boost` ve `daily_operations` birbirinin durumunu eziyordu.

---

## 2. Rewarded provider yapısı

| Dosya | Rol |
|-------|-----|
| `src/config/rewardedPlacements.ts` | Canonical placement config (`delivery_boost`, `daily_operations`), `getRewardedPlacementConfig()`, production ID doğrulama |
| `src/services/adProvider.ts` | Merkezi rewarded provider; per-placement preload state, `preloadRewardedPlacement()`, `getRewardedPlacementState()`, `areAdsFeatureEnabled()` |
| `src/hooks/useRewardedPlacement.ts` | React hook + fail-visible durum mesajları |
| `src/services/adsConsentService.ts` | UMP consent, `canRequestAdsAfterConsent()` |
| `src/simulation/deliveryAdBoost.ts` | `getDeliveryAdBoostEligibility()`, `applyDeliveryRewardedBoost()` |

**Yeni API'ler:**
- `areAdsFeatureEnabled()` — yalnız `EXPO_PUBLIC_ADS_ENABLED` kontrolü (UI gizleme için tek kapı)
- `getRewardedPlacementState(placement)` — placement bazlı runtime durum
- `preloadRewardedPlacement(placement)` / `preloadAllTrackedRewardedPlacements()`
- `getRewardedPlacementDiagnosticSnapshot(placement)` — internal debug (masked)

---

## 3. Placement listesi

| Placement | Slot ID | Android/iOS unit | Ekran |
|-----------|---------|------------------|-------|
| `delivery_boost` | `delivery_boost` | `EXPO_PUBLIC_DELIVERY_BOOST_REWARDED_*` veya bundled constants | Harita kartı, Teslimat detayı |
| `daily_operations` | `daily_ops_bonus` | `EXPO_PUBLIC_ADMOB_DAILY_REWARDED_*` veya bundled constants | Dashboard günlük operasyon kartı |

Diğer slotlar (`contract_refresh`, `market_analysis`, `maintenance_discount`) aynı genel rewarded unit'i kullanır; `AdRewardButton` fail-visible davranışıyla güncellendi.

---

## 4. Harita entegrasyonu

`MapTruckTrackingCard.tsx` aktif teslimat kartına progress bar altında **compact** `DeliveryBoostPanel` eklendi:

- Başlık: **Teslimatı Hızlandır**
- CTA: `Reklam İzle · -X sa Y dk` (hazır olduğunda)
- Alt bilgi: `0/2 kullanıldı`
- Tıklanınca onay modalı: tahmini süre, kullanım hakkı, Reklamı İzle / Vazgeç
- Kart yüksekliği boost alanı için genişletildi; rota/yakıt/mesafe bilgileri korundu

Harita ve teslimat detayı aynı `gameStore.applyAdReward('delivery_boost')` + `delivery.deliveryAdBoost` state'ini paylaşır.

---

## 5. Fail-visible UI durumları

UI artık yalnızca `areAdsFeatureEnabled() === false` iken gizlenir. Runtime durumlarında alan görünür kalır:

| Durum | Kullanıcı mesajı |
|-------|------------------|
| `loading` / `idle` | Reklam hazırlanıyor… |
| `consent-required` | Reklamları kullanmak için gizlilik tercihini tamamla. |
| `no-fill` | Şu anda uygun reklam bulunamadı. Biraz sonra tekrar dene. |
| `network-error` | Bağlantı sorunu. Biraz sonra tekrar dene. |
| `limit-reached` | Bu teslimat için hızlandırma sınırına ulaştın. |
| `remaining-time-too-short` | Kalan süre hızlandırma için çok kısa. |
| `incident-pending` | Önce bekleyen operasyon kararını tamamla. |
| `truck-out-of-fuel` | Yakıt bittiği için hızlandırma kullanılamaz. |
| `cooldown` | Kısa süre sonra tekrar deneyebilirsin. |
| `showing` | Reklam açılıyor… |

---

## 6. Consent davranışı

1. App boot → `gatherAdsConsentIfNeeded()`
2. Consent tamamlanınca → `initializeAdProvider()` + `preloadAllTrackedRewardedPlacements()`
3. Consent beklenirken reklam alanı **gizlenmez**; consent-required mesajı gösterilir
4. Hesap Ayarları → Gizlilik ve Çerez Ayarları akışı mevcut UMP entegrasyonu üzerinden çalışmaya devam eder

---

## 7. Internal / production config

| Profil | `ADS_ENABLED` | `ADS_USE_TEST_IDS` | Davranış |
|--------|---------------|-------------------|----------|
| Internal test | `true` | `true` | Google test ID, UI görünür |
| Production | `true` | `false` | Gerçek placement ID'ler (bundled + env override) |

Env değişkenleri:
- `EXPO_PUBLIC_ADS_ENABLED`
- `EXPO_PUBLIC_ADS_USE_TEST_IDS`
- `EXPO_PUBLIC_DELIVERY_BOOST_REWARDED_ANDROID_ID` / `_IOS_ID`
- `EXPO_PUBLIC_ADMOB_DAILY_REWARDED_ANDROID_ID` / `_IOS_ID`

`validateProductionRewardedPlacementIds()` production profilde çözümlenen ID'leri doğrular.

---

## 8. Android sonucu

- Aynı business logic (`deliveryAdBoost`, `adProvider`, placement config)
- Preload consent sonrası başlar; dismiss sonrası bounded retry (30s)
- Reward yalnız `EARNED_REWARD` sonrası uygulanır
- `expo export --platform android` başarılı

---

## 9. iOS sonucu

- Android ile aynı placement modeli ve UI bileşenleri
- ATT/UMP akışı mevcut `attService` + `adsConsentService` üzerinden
- `expo export --platform ios` başarılı

---

## 10. Diğer rewarded girişleri

| Konum | Slot | Durum |
|-------|------|-------|
| Dashboard | `daily_ops_bonus` | Fail-visible; consent/loading mesajları |
| Contracts detay | `delivery_boost` | Fail-visible; harita ile paylaşımlı state |
| Contracts | `contract_refresh` | `AdRewardButton` fail-visible |
| Market detay | `market_analysis` | `AdRewardButton` fail-visible |
| Fleet kartı | `maintenance_discount` | `AdRewardButton` fail-visible |
| **Harita Kamyon Takip** | `delivery_boost` | **YENİ — compact panel** |

---

## 11. Değişen dosyalar

**Yeni:**
- `src/config/rewardedPlacements.ts`
- `src/hooks/useRewardedPlacement.ts`
- `scripts/rewarded-ad-visibility-regression-test.ts`
- `docs/release-audit/FIX_REWARDED_AD_VISIBILITY_RESULTS.md`

**Güncellenen:**
- `src/services/adProvider.ts` — per-placement state, preload, `areAdsFeatureEnabled()`
- `src/components/monetization/DeliveryBoostPanel.tsx` — compact mode, fail-visible
- `src/components/monetization/AdRewardButton.tsx` — fail-visible
- `src/components/monetization/DashboardDailyOpsBonusCard.tsx` — fail-visible
- `src/components/map/MapTruckTrackingCard.tsx` — harita boost entegrasyonu
- `src/simulation/deliveryAdBoost.ts` — `formatBoostDurationLabel()`, consent mesajları

---

## 12. Test sonuçları

| Komut | Sonuç |
|-------|-------|
| `npm run typecheck` | PASS |
| `npm run verify` | PASS |
| `npx tsx scripts/rewarded-ad-visibility-regression-test.ts` | **43/43 PASS** |
| `npx tsx scripts/delivery-rewarded-boost-regression-test.ts` | **40/40 PASS** |
| `npx tsx scripts/monetization-smoke-test.ts` | **44/44 PASS** |
| `npx expo config --type public` | PASS |
| `npx expo export --platform android` | PASS |
| `npx expo export --platform ios` | PASS |

AAB/APK/IPA/Xcode Archive üretilmedi (görev kapsamı dışı).

---

## 13. Gerçek cihaz manuel test gereksinimi

Aşağıdaki senaryolar gerçek Android ve iPhone'da doğrulanmalıdır:

1. Internal test build → consent tamamla
2. Harita → aktif teslimat kartında **Teslimatı Hızlandır** alanının görünmesi
3. Loading → ready CTA geçişi
4. Reklam izle → erken kapat (boost yok) → tekrar izle → tamamla (süre azalması)
5. Harita marker ilerlemesi + teslimat detayında aynı kullanım sayısı
6. 3. kullanım engeli (2/2)
7. Dashboard günlük operasyon kartı görünürlüğü
8. App background/foreground + internet kes/aç → alan kaybolmamalı
9. Android back / iOS ATT-UMP lifecycle

---

## Kabul kriterleri

| Kriter | Durum |
|--------|-------|
| Harita aktif teslimat kartında hızlandırma alanı görünür | ✅ |
| Reklam hazır değilken alan kaybolmaz | ✅ |
| Loading, consent, no-fill, error durumları görünür | ✅ |
| Daily operations ve diğer girişler erişilebilir | ✅ |
| Reward yalnız EARNED_REWARD sonrası | ✅ |
| Android ve iOS aynı business logic | ✅ |
| Production/test ID ayrımı korunur | ✅ |

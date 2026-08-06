# FIX: Delivery Rewarded Boost — Results

**Date:** 2026-08-06  
**Scope:** Production-safe optional rewarded ad acceleration for active deliveries  
**Verdict:** Implementation complete; production requires dedicated AdMob placement IDs via env.

---

## 1. Mevcut Rewarded Altyapı

| Bileşen | Konum | Davranış |
|---------|-------|----------|
| Rewarded instance | `src/services/adProvider.ts` | Tek merkezi `RewardedAd`; slot parametresi ile unit ID seçimi |
| Load/show | `preloadRewardedAd()` / `showRewardedAd(slotId?)` | Consent sonrası preload; `isShowingAd` global mutex |
| Ödül | `RewardedAdEventType.EARNED_REWARD` | Yalnız bu event `rewardGrantedForImpression` set eder |
| Close | `RewardedAdEventType.CLOSED` | Ödül vermez; sonraki preload |
| Duplicate guard | `rewardGrantedForImpression` + impression id | Aynı gösterimde çift callback engellenir |
| Unit ID | `src/config/adMobConstants.ts`, `src/config/adMob.ts` | Internal: Google test ID; production: gerçek unit |
| Consent | `src/services/adsConsentService.ts` | `canRequestAdsAfterConsent()` false iken yükleme/gösterim kapalı |
| UMP | `adsConsentService` + `adProvider` init zinciri | Consent tamamlanmadan SDK reklam yüklemez |

Teslimat hızlandırma mevcut provider üzerine `slotId: 'delivery_boost'` ile eklendi; yeni interstitial/banner yok.

---

## 2. Yeni Delivery Boost Domain Modeli

`Delivery` tipine eklendi (`src/types/game.ts`):

```typescript
deliveryAdBoost?: {
  usedCount: number;
  totalReducedMs: number;
  lastRewardedAt?: number;
  processedRewardIds: string[];
}
```

- Save migration: `normalizeDelivery()` → `normalizeDeliveryAdBoostFields()` (`deliveryIncidents.ts`, `saveGame.ts`)
- Eski save varsayılanı: alan yok → boost state oluşturulmaz; eligibility `usedCount = 0`
- Bounded: `usedCount ≤ 2`, `processedRewardIds` son 10 ID

---

## 3. Hızlandırma Oranı ve Limit

Canonical config: `src/config/deliveryAdBoost.ts`

| Sabit | Değer |
|-------|-------|
| `DELIVERY_AD_BOOST_ENABLED` | `true` |
| `DELIVERY_AD_BOOST_REDUCTION_RATIO` | `0.25` (kalan sürenin %25'i) |
| `DELIVERY_AD_BOOST_MAX_USES` | `2` / teslimat |
| `DELIVERY_AD_BOOST_MAX_TOTAL_RATIO` | `0.50` (başlangıç süresinin max %50'si) |
| `DELIVERY_AD_BOOST_MIN_REMAINING_MS` | `5 * 60 * 1000` (5 dk gerçek ms) |
| `DELIVERY_AD_BOOST_COOLDOWN_MS` | `30 * 1000` |

Reduction: `remainingMs * 0.25`, total cap ve kalan süre ile clamp; minimum 1 game tick.

---

## 4. Eligibility Kuralları

Canonical helper: `getDeliveryAdBoostEligibility()` — `src/simulation/deliveryAdBoost.ts`

Kapalı durumlar:

- Teslimat aktif değil / tamamlanmak üzere
- Pending delivery incident
- Yakıtsız durmuş araç (`out-of-fuel`)
- Reklam hazır değil / consent hazır değil
- Kullanım limiti (2/teslimat veya %50 total)
- Kalan süre < 5 dk
- Global cooldown (30 sn, `monetization.lastDeliveryBoostAdAt`)
- Başka reward işlemi (`globalProcessing`)

Kiralık araç engel değil.

---

## 5. Reward Idempotency

`applyDeliveryRewardedBoost({ deliveryId, rewardId, earnedAt })`:

- Yalnız `EARNED_REWARD` sonrası çağrılır (`gameStore.applyAdReward`)
- `rewardId` benzersiz; `processedRewardIds` içinde tekrar reddedilir
- Eligibility action içinde yeniden doğrulanır (UI sonucu tek başına güvenilmez)
- Close / cancel / load error boost vermez
- Çift tap: `isShowingAd` mutex + `loading` state

---

## 6. Simulation / Yakıt Entegrasyonu

`applyDeliveryBoostSim()` → `updateDeliveryProgressWithFuel()` (canonical):

- Zaman “silinmez”; simülasyon belirli süre ileri sarılır
- Yakıt tüketimi gidilen mesafe ile orantılı
- Yakıt yetmezse kısmi ilerleme + `out-of-fuel` pause
- Completion yalnızca progress + fuel threshold sağlanınca (`completeDeliveryById`)
- Ödeme/XP/reputation tek sefer (`gameStore` completion zinciri)

---

## 7. Incident Davranışı

- Pending incident varken eligibility `incident-pending`
- UI: “Önce bekleyen operasyon kararını tamamla.”
- Boost yeni incident roll tetiklemez (incident trigger zincirine dokunulmadı)

---

## 8. UI Giriş Noktaları

| Surface | Bileşen |
|---------|---------|
| Aktif teslimat kartı (İşler) | `DeliveryBoostPanel` — `ContractsScreen.tsx` `ActiveDeliveryCard` |

UX:

- Başlık: “Teslimatı Hızlandır”
- Alt metin: “Reklam izle, kalan süreyi %25 azalt.”
- CTA: “Reklam İzle · -X dk” + “1/2 kullanıldı”
- Confirm modal → Reklamı İzle / Vazgeç
- Durum mesajları: loading, no-fill, network, limit, incident, success (spec §9)

---

## 9. Save / Offline Davranışı

- `deliveryAdBoost` save payload'da persist edilir
- `usedCount`, `totalReducedMs`, `processedRewardIds` restore sonrası korunur
- Offline progression ayrı kanal; boost `updateDeliveryProgressWithFuel` kullanır — çift uygulama yok
- Boost sonrası timestamp tabanlı offline tick normal devam eder

---

## 10. AdMob Placement Gereksinimleri

| Platform | Env override | Fallback constant |
|----------|--------------|-------------------|
| Android | `EXPO_PUBLIC_DELIVERY_BOOST_REWARDED_ANDROID_ID` | `ADMOB_DELIVERY_BOOST_REWARDED_UNIT_IDS.android` |
| iOS | `EXPO_PUBLIC_DELIVERY_BOOST_REWARDED_IOS_ID` | `ADMOB_DELIVERY_BOOST_REWARDED_UNIT_IDS.ios` |

- Internal / test: Google test rewarded ID (`shouldUseTestAdUnitIds()`)
- Production profile: gerçek unit zorunlu; Google sample ID (`3940256099942544`) reddedilir
- **Production önerisi:** AdMob Console'da ayrı “delivery boost” rewarded unit oluşturup env ile set edin (şu an general rewarded ile aynı ID paylaşılıyor; slot ayrımı kodda hazır)

---

## 11. Değişen Dosyalar

**Yeni:**

- `src/config/deliveryAdBoost.ts`
- `src/config/adMobConstants.ts` (headless-safe IDs)
- `src/simulation/deliveryAdBoost.ts`
- `src/components/monetization/DeliveryBoostPanel.tsx`
- `scripts/delivery-rewarded-boost-regression-test.ts`

**Güncellenen:**

- `src/types/game.ts` — `DeliveryAdBoostState`
- `src/types/monetization.ts` — `lastDeliveryBoostAdAt`, effect type
- `src/config/adMob.ts` — delivery boost unit resolver
- `src/config/monetization.ts` — slot config
- `src/services/adProvider.ts` — slot-based unit, `isRewardedAdShowing()`
- `src/simulation/adRewardGrants.ts` — per-delivery limit kaldırıldı
- `src/simulation/deliveryIncidents.ts` — `normalizeDelivery()` boost alanları
- `src/storage/saveGame.ts` — import düzeltmesi
- `src/store/gameStore.ts` — `delivery_boost` apply zinciri
- `src/screens/ContractsScreen.tsx` — `DeliveryBoostPanel`
- `scripts/monetization-smoke-test.ts` — yeni model testleri

---

## 12. Test Sonuçları

| Komut | Sonuç |
|-------|-------|
| `npm run typecheck` | PASS |
| `npm run verify` | PASS |
| `npx tsx scripts/delivery-rewarded-boost-regression-test.ts` | **40/40 PASS** |
| `npx tsx scripts/monetization-smoke-test.ts` | **44/44 PASS** |
| `npx tsx scripts/offline-delivery-progress-regression-test.ts` | PASS |
| `npx tsx scripts/random-events-regression-test.ts` | PASS |
| `npx tsx scripts/tab-navigation-performance-regression-test.ts` | PASS |
| `npx tsx scripts/ads-config-test.ts` | PASS |
| `npx expo config --type public` | PASS |
| `npx expo export --platform android` | PASS |
| `npx expo export --platform ios` | PASS |
| `git diff --check` | PASS (no conflict markers) |

Regression test kapsamı: eligibility matrix, %25/%50 cap, idempotency, fuel partial, save migration, AdMob placement format.

---

## 13. Production Config Gereksinimi

```env
EXPO_PUBLIC_ADS_ENABLED=true
EXPO_PUBLIC_ADS_USE_TEST_IDS=false
EXPO_PUBLIC_ADS_MODE=production

# Önerilen — AdMob Console'dan ayrı unit:
EXPO_PUBLIC_DELIVERY_BOOST_REWARDED_ANDROID_ID=ca-app-pub-XXXX/YYYY
EXPO_PUBLIC_DELIVERY_BOOST_REWARDED_IOS_ID=ca-app-pub-XXXX/ZZZZ
```

Internal Testing: `EXPO_PUBLIC_ADS_USE_TEST_IDS=true` ile Google test rewarded kullanılır.

---

## 14. Final Android / iOS Build Gereksinimi

- Bu görevde **AAB, APK, IPA veya Xcode Archive üretilmedi** (spec uyumu)
- Export bundle doğrulaması tamamlandı; mağaza build'i CI/release pipeline ile ayrı adımda
- Production build öncesi: dedicated delivery boost unit ID'leri env'e eklenmeli

---

## Kabul Kriterleri Özeti

| Kriter | Durum |
|--------|-------|
| İsteğe bağlı rewarded only | ✅ |
| Yalnız EARNED_REWARD boost | ✅ |
| %25 kalan süre / reklam | ✅ |
| Max 2 kullanım / teslimat | ✅ |
| Max %50 total hızlandırma | ✅ |
| Canonical sim + yakıt | ✅ |
| Duplicate ödeme/reward yok | ✅ |
| Incident pending kapalı | ✅ |
| Save/offline uyumlu | ✅ |
| Android/iOS aynı davranış | ✅ |

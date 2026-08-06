# FIX: ContractsScreen UI + Contract Generation Reliability — Results

**Date:** 2026-08-06  
**Verdict:** Implementation + tests PASS — gerçek cihaz doğrulaması gerekli

---

## 1. Neden 5–10 dakika sıfır kaldı?

Birleşik kök nedenler:

1. **Havuz doluyken kamyon şehri playable üretimi bloke** — `maxAvailableContracts` (24) dolunca `ensurePlayableContractSupply` erken çıkıyordu; Bursa’da kamyon olsa bile İstanbul/Ankara çıkışlı işler listeyi dolduruyordu.
2. **Manuel yenileme yetersiz** — `refreshContractsFromMarket` yalnızca `available < 10` iken üretiyordu; dolu havuzda `needed = 0`.
3. **Ekran açılışı generation tetiklemiyordu** — `notifyContractsScreenOpened` yalnızca tutorial state güncelliyordu.
4. **Playable fallback gecikmesi** — `playableContractFallbackHours: 6` oyun saati; oyun duraklatılınca uzun boşluk.
5. **Starter destination bug** — `bursa→bursa` denemesi Bursa playable üretimini zayıflatıyordu.

---

## 2. First generation zinciri (yeni)

```
load save → normalize contracts
→ initializeGame finally: isGameReady
→ bootstrapContractsIfNeeded()
   → shouldRefreshContracts / per-city gap
   → refreshContractsFromMarket({ emergency: true })
   → ensureMinimumEligibleContracts()
      → expireOldContracts
      → freeContractPoolSlots (kamyon şehirleri için yer aç)
      → ensurePlayableContractSupply (forceFallback)
      → refreshContractsFromMarket (global min)
→ ContractsScreen open → bootstrapContractsIfNeeded() tekrar
→ advanceTime → processContractGenerationSchedule → ensureMinimumEligibleContracts
```

---

## 3. Minimum eligible garantisi

`contractGenerationBalance`:

| Sabit | Değer |
|-------|-------|
| `minAvailableContractsPerIdleTruckCity` | 2 |
| `minGlobalEligibleContracts` | 6 |
| `minPlayerLevelEligibleContracts` | 2 |
| `bootstrapMaxContractsPerPass` | 8 |
| `playableContractFallbackHours` | 1 (6’dan düşürüldü) |

Canonical helper: `ensureMinimumEligibleContracts()`

---

## 4. Manuel yenileme

- Boş liste veya `eligibleCount === 0` → **emergency** → cooldown bypass
- `ensureMinimumEligibleContracts` gerçek üretim yapar
- UI: loading, cooldown mesajı, “Piyasayı Yenile” CTA

---

## 5. Header düzeltmesi

- Paylaşılan `ScreenHeader` + `leftAction` / `rightAction`
- Eşit 48px side slot, başlık matematiksel merkez
- `[ ? ]  Sözleşmeler  [ ↻ ]`

---

## 6. Test sonuçları

| Komut | Sonuç |
|-------|-------|
| `npm run typecheck` | PASS |
| `npm run verify` | PASS |
| `contract-generation-reliability-test.ts` | 14/14 |
| `contracts-screen-layout-regression-test.ts` | 11/11 |
| `npx expo export --platform android` | PASS |
| `npx expo export --platform ios` | PASS |

**AAB/APK/IPA üretilmedi.**

---

## 7. Değişen dosyalar

- `src/config/balance.ts`
- `src/simulation/contracts.ts`
- `src/simulation/starterContracts.ts`
- `src/store/gameStore.ts`
- `src/screens/ContractsScreen.tsx`
- `src/components/ui/ScreenHeader.tsx`
- `scripts/contract-generation-reliability-test.ts` (yeni)
- `scripts/contracts-screen-layout-regression-test.ts` (yeni)
- `package.json`

---

## 8. Manuel cihaz testi

1. Tek kamyon Bursa’da → açılışta ≤ birkaç saniye içinde işler
2. En az 2 Bursa çıkışlı, en az 1 kapasite-uygun
3. Header ortalı, ? solda, yenile sağda
4. Manuel yenile boş listede iş üretir
5. Diğer şehir işlerinde “Şehirde kamyon yok” kuralı korunur

# Depolar Ekranı Kompakt UI Redesign — Sonuç Raporu

**Tarih:** 2026-08-13  
**Kapsam:** Yalnız presentation katmanı; iş mantığı ve persistence korundu.

---

## Eski Ekranın En Büyük UI Problemleri

| Problem | Etki |
|--------|------|
| 4 ayrı özet kartı | Üst bölüm ~2× fazla dikey alan |
| Büyük strateji/ipucu banner | Gereksiz scroll |
| Depo kartında 4 metrik + progress bar + 3 eşit ağırlıklı buton | Bilgi yoğunluğu, zayıf aksiyon hiyerarşisi |
| Transfer bölümü tam kart + ayrı header | Boş state ~84px+, aktif state çok uzun |
| Fırsat kartları büyük, kalın border | Sayfa parçalı ve uzun hissi |
| Çoklu neon border / glow | Görsel gürültü |
| Tutarsız spacing (12/20/32 karışık) | Premium panel hissi zayıf |

---

## Yeni Section Hiyerarşisi

1. **Header** — `Depolar` + subtitle, `?` (tutorial) + `+` (fırsatlara scroll), 44px hit target
2. **Depo Özeti** — tek parent summary card, 2×2 stat grid
3. **Depo İpucu** — compact insight banner (~52px), expandable detay
4. **Depolarım** — section header + kompakt depo kartları
5. **Yoldaki Transferler** — tek compact card
6. **Yeni Depo Fırsatları** — ilk 3 + “Tüm Fırsatları Gör (N)”
7. **Depo Stratejisi** — accordion (~56px kapalı)

Tutorial target sırası korundu (`warehouse-header`, `special-products`, `stock-management`, `city-warehouse-link`, `capacity`).

---

## Summary Card Değişimi

**Önce:** 4 bağımsız bordered kart (Toplam Stok, Kapasite, Günlük Gider, Transfer).

**Sonra:** `Depo Özeti` başlıklı tek container:
- 2×2 `statCell` (background tint, border yok)
- Renk hiyerarşisi: stok yeşil, kapasite mavi, gider amber, transfer cyan/mavi
- Transfer hücresi tıklanabilir → transfer bölümüne scroll

Tahmini yükseklik: **~140px** (önceki 4 kart ~220–260px).

---

## Warehouse Card Yeni Yapısı

```
[icon] İzmir                    >
Normal Depo · Sv.1

Kapasite | Doluluk | Gider
Stok değeri                 $X

[ Stokları Gör ]  [ Transfer ]  [⋯]

Sv.1 → Sv.2 · Yükselt · $X   (yalnız upgrade mümkünse)
```

- Primary: **Stokları Gör** (mavi, flex)
- Secondary: **Transfer** (outline)
- Tertiary: **Yükselt** (text CTA, disabled + helper when needed)
- **Maksimum Seviye** metni max level'da
- Empty state: kompakt “Stok yok” + “Piyasaya Git”
- Genişletilmiş stok listesi korundu (`WarehouseStockRow`)

Tahmini collapsed yükseklik: **~190–210px** (önce ~280px+).

---

## Transfer Alanı

Tek `compactCard`:
- **Boş:** header + “Henüz transfer yok” + “Yeni Transfer” (~64–72px)
- **Aktif:** şehir → şehir · ETA satırları (max 3 + “+N daha”)
- Geçmiş transferler linki + modal korundu

---

## Fırsat Kartı

- Yatay kompakt layout, `maxHeight: 150`
- Küçük amber outline `N sinyal` badge
- İki kolon: Normal / Soğuk fiyat + günlük
- CTA: **Depoyu İncele** → mevcut tip seçim sheet’i
- Kart gap: 10px, ilk 3 preview + modal “Tüm Fırsatları Gör”

---

## Strategy Accordion

- Kapalı: **56px** min-height, “3 kısa ipucu”
- Açık: 3 bullet, “Daha Fazla” → rehber dialog

---

## Scroll Uzunluğu (Tahmini)

| Bölüm | Önce (yaklaşık) | Sonra (yaklaşık) |
|-------|-----------------|------------------|
| Özet | 220–260px | ~140px |
| İpucu banner | 80–100px | ~52px |
| Depo kartı (×1) | ~280px | ~200px |
| Transfer boş | ~84px | ~68px |
| Fırsat kartı (×3) | ~180px × 3 | ~135px × 3 |
| Strateji kapalı | ~48px | ~56px |

**Tek depo + 3 fırsat senaryosu:** ~**900–1100px** → ~**650–750px** (~%25–30 kısalma).

---

## Spacing & Tema

`warehouseLayout` token’ları: page 16, section 16, card 14, gap 10/8/4.  
Outer kartlarda tek navy border; neon glow kaldırıldı.

---

## Android / iOS Export

| Platform | Sonuç |
|----------|-------|
| `npx expo export --platform android` | **PASS** |
| `npx expo export --platform ios` | **PASS** |

AAB/APK/IPA/Xcode Archive **üretilmedi** (istek gereği).

---

## Test Sonuçları

| Komut / Test | Sonuç |
|--------------|-------|
| `npm run typecheck` | PASS |
| `npm run verify` | PASS |
| `scripts/warehouse-screen-ui-regression-test.ts` | PASS (yeni) |
| `scripts/warehouse-system-test.ts` | PASS |
| `scripts/warehouse-stock-transfer-test.ts` | PASS |
| `scripts/tutorial-target-layout-regression-test.ts` | PASS |
| `git diff --check` | PASS |

---

## Korunan Fonksiyonlar

- Yeni depo satın alma / tip seçimi
- Stok görüntüleme ve satış
- Transfer başlatma (`WarehouseStockTransferModal`)
- Depo yükseltme (`upgradeWarehouse`)
- Kapasite, doluluk, günlük gider, sinyaller
- Soğuk depo kuralları
- Tutorial target layout (`stretch` modları)
- Tab bar bottom padding (`useTabBarLayout`)

---

## Değişen Dosyalar

- `src/screens/WarehouseScreen.tsx`
- `src/components/warehouse/WarehouseOverviewGrid.tsx`
- `src/components/warehouse/WarehouseInfoBanner.tsx`
- `src/components/warehouse/OwnedWarehouseCard.tsx`
- `src/components/warehouse/OwnedWarehousesSection.tsx`
- `src/components/warehouse/WarehouseTransfersSection.tsx`
- `src/components/warehouse/WarehouseOpportunityCard.tsx`
- `src/components/warehouse/WarehouseOpportunitiesSection.tsx`
- `src/components/warehouse/WarehouseStrategyTips.tsx`
- `src/components/warehouse/warehouseTheme.ts`
- `scripts/warehouse-screen-ui-regression-test.ts`
- `package.json` (verify pipeline)

# FIX: Dashboard Background Layering — Results

**Date:** 2026-08-06  
**Scope:** Ana sayfa (Dashboard) arka plan asset ve katman analizi + UI düzeltmesi  
**Verdict:** Layering simplified; muddy appearance addressed

---

## 1. Aktif component zinciri

```
App.tsx (tab: dashboard)
  └── DashboardScreen.tsx
        ├── DashboardBackground (absolute fill, pointerEvents: none)
        └── ScrollView
              ├── DashboardResourceBar
              ├── DashboardHeroCard  ← port background burada
              ├── DashboardAlertBanner
              ├── … diğer kartlar
              └── DashboardModuleGrid
```

Ana ekran route’u: `DashboardScreen` (HomeScreen / MainScreen yok).

---

## 2. Asset kullanımı

| Asset | Kullanılıyor mu? | Component | Konum |
|-------|------------------|-----------|--------|
| `dashboard-grid-overlay.png` | Evet | `DashboardBackground` | Tam ekran arka plan |
| `dashboard-grid-overlay.png` | ~~Evet~~ **Kaldırıldı** | ~~`DashboardHeroCard`~~ | Hero içi grid kaldırıldı |
| `dashboard-port-background.png` | Evet | `DashboardHeroCard` | Sağ %34, düşük opaklık |

Registry: `src/assets/dashboardAssets.ts`  
Flag’ler: `useGridOverlay`, `usePortBackground`

---

## 3. Önceki katman sırası (sorunlu)

### Tam ekran (`DashboardBackground`)
1. `navyBase` — `colors.background` (#040A14)
2. `gridOverlay` — `resizeMode: cover`, opacity **0.04**
3. `navyOverlay` — `rgba(5, 11, 20, **0.68**)` ← çok güçlü scrim

### Hero kart (`DashboardHeroCard`)
1. `leftPanel` — solid surface %62
2. `portBackground` — sağ %39, opacity **0.125**
3. `portBlend` — surface %50 opacity (geçiş bandı)
4. `portTint` — ek koyu katman
5. `DashboardCardGridOverlay` — üst %36, efektif ~0.028×0.07
6. `content` — metrikler / metin

**Ek:** Grid hem tam ekranda hem hero’da → çift doku.  
**Platform:** Android / iOS aynı branch; platform-specific render yok.

---

## 4. Kök neden

| Kategori | Etki |
|----------|------|
| **Dark scrim fazla güçlü** | `navyOverlay` 0.68 — grid + zemin çamurlu/speckled görünüyor |
| **Layering yanlış** | Port (sıcak turuncu liman fotoğrafı) + çoklu yarı saydam katman + grid |
| **Grid overlay fazla / çift** | Tam ekran + hero kart üstünde ikinci grid |
| **Port resize/opacity** | 0.125 opacity hâlâ sıcak tonları içeriğe taşıyordu |
| **Hero card çakışması** | `portBlend` + `portTint` + grid metin alanında kirli doku |

Asset’ler bozuk değil; **port fotoğrafı çok detaylı/sıcak tonlu** — dekoratif kullanımda agresif scrim ve düşük opaklık gerekir. Grid asset parlak cyan çizgili — yüksek scrim altında “lekeli” algısı yaratıyordu.

---

## 5. Yapılan düzeltme

### `DashboardBackground.tsx`
- Scrim: **0.68 → 0.36** (`DASHBOARD_BG_SCRIM_OPACITY`)
- Grid: **0.04 → 0.022** (`DASHBOARD_BG_GRID_OPACITY`)
- Alt vignette eklendi (hafif derinlik, `%34` yükseklik)
- `navyBase` + grid + scrim + vignette — port tam ekranda yok

### `DashboardHeroCard.tsx`
- Hero içi **grid overlay kaldırıldı** (çift doku giderildi)
- `leftPanel` / `portBlend` / `portTint` → **`portMute` + `portEdgeFade`** (2 katman)
- Port opacity: **0.125 → 0.058** (`DASHBOARD_HERO_PORT_OPACITY`)
- Port genişliği: %39 → **%34**; `portMute` sıcak tonları nötralize eder
- Kart zemini: solid `colors.surface` — metin alanı temiz

### `dashboardTheme.ts`
Merkezi opacity token’ları:
- `DASHBOARD_BG_GRID_OPACITY = 0.022`
- `DASHBOARD_BG_SCRIM_OPACITY = 0.36`
- `DASHBOARD_HERO_PORT_OPACITY = 0.058`
- `DASHBOARD_CARD_GRID_OPACITY = 0.035`

### `DashboardCardGridOverlay.tsx`
Varsayılan opacity 0.07 → **0.035** (ileride kart dekoru için)

---

## 6. Yeni görsel hedef

- Temiz koyu lacivert zemin
- Grid yalnızca tam ekranda, neredeyse fark edilmez dekor
- Hero’da hafif liman hissi (sağ kenar), metinle yarışmaz
- Kart okunabilirliği korunur
- Android / iOS tutarlı (aynı RN katmanları)

---

## 7. Android / iOS

- Aynı component yapısı; platform-specific branch yok
- `expo export --platform android` — PASS
- `expo export --platform ios` — PASS
- AAB/APK/IPA üretilmedi (talimat gereği)

---

## 8. Değişen dosyalar

- `src/components/dashboard/DashboardBackground.tsx`
- `src/components/dashboard/DashboardHeroCard.tsx`
- `src/components/dashboard/DashboardCardGridOverlay.tsx`
- `src/components/dashboard/dashboardTheme.ts`
- `docs/release-audit/FIX_DASHBOARD_BACKGROUND_LAYERING_RESULTS.md` (bu dosya)

**Dokunulmadı:** business logic, navigation, store, backend.

---

## 9. Test sonuçları

| Komut | Sonuç |
|-------|-------|
| `npm run typecheck` | PASS |
| `npm run verify` | PASS |
| `npx expo export --platform android` | PASS |
| `npx expo export --platform ios` | PASS |
| `git diff --check` | (çalışma ağacındaki diğer değişikliklerle birlikte kontrol edilmeli) |

---

## 10. Manuel doğrulama önerisi

Gerçek cihazda kontrol edin:
1. Ana sayfa arka planı düz, koyu lacivert — çamur/leke yok
2. Şirket hero kartı sol taraf temiz okunur
3. Sağ kenarda çok hafif liman atmosferi
4. Modül kartları ve alt bölüm yeterli kontrast
5. Tab bar / safe area boşluğu değişmedi
6. 360px ve 430px genişliklerde hero port kırpılması

---

## Kabul kriterleri

| Kriter | Durum |
|--------|-------|
| Asset’ler doğru kullanılıyor | ✅ |
| Kirli/çamurlu görünüm giderildi | ✅ (katman sadeleştirme) |
| Premium koyu lacivert his | ✅ |
| Kart okunabilirliği | ✅ |
| Android / iOS tutarlı | ✅ |
| Business logic dokunulmadı | ✅ |

# FIX: Yönetim Paneli — Hesap ve Liderlik Kartları

**Tarih:** 2026-08-06  
**Kapsam:** UI / navigation only — oyun mantığı, backend, Firestore rules değiştirilmedi.

---

## 1. Yönetim paneli componenti

| Özellik | Değer |
|---------|-------|
| **Panel component** | `src/components/navigation/QuickAccessMenu.tsx` |
| **Açılış noktası** | `src/components/navigation/GameTabBar.tsx` — merkez `quickAccess` butonu |
| **Kart config** | `src/navigation/quickAccessConfig.ts` → `buildQuickAccessItems()` |
| **Navigation handler** | `App.tsx` → `handleQuickAccess()` + `gameStore.navigationRequest` / `pendingMoreSubRoute` |
| **Modal tipi** | `Modal` (transparent, fade) — bottom sheet değil |
| **Panel konumu** | `bottom: tabBarHeight + centerButtonLift + 8` — bottom tab üstünde |
| **Önceki maxHeight** | Ekranın %52'si |
| **Yeni maxHeight** | Ekranın %85'i (`QUICK_ACCESS_PANEL_MAX_HEIGHT_RATIO = 0.85`) |
| **Scroll** | `ScrollView` içinde 2 sütunlu grid; küçük ekranlarda kaydırılabilir |

---

## 2. Yeni kartlar

### Liderlik
- **Etiket:** Liderlik
- **Alt metin:** Haftalık sıralama
- **İkon:** `trophy` (amber ton)
- **Badge:** Yok (yalnızca gerçek claim durumlarında badge kullanılır; Görevler kartı mevcut davranışı korur)

### Hesap
- **Etiket:** Hesap
- **Alt metin:** Auth durumuna göre dinamik:
  - Misafir → `Misafir hesap`
  - Bağlı → `Bağlı hesap`
  - Hazır değil → `Profil ve ayarlar`
- **İkon:** `account` (mavi/cyan ton)
- **E-posta gösterilmez**

---

## 3. Kart sırası (2×4 grid)

```
Filo            Mağaza
Depolar         Finans
Araç Pazarı     Görevler
Liderlik        Hesap
```

`QUICK_ACCESS_CARD_ORDER` array sırası bu düzeni üretir. Araç Pazarı feature flag kapalıysa 7 kart (Liderlik ve Hesap korunur).

---

## 4. Navigation hedefleri

| Kart | Hedef | Akış |
|------|-------|------|
| Liderlik | `MoreScreen` → `LeaderboardScreen` | `pendingMoreSubRoute: 'leaderboard'` |
| Hesap | `MoreScreen` → `AccountSection` (scroll) | `pendingMoreSubRoute: 'account'` |
| Mevcut 6 kart | Değişmedi | fleet / shop / warehouse / finance / vehicleMarketplace / missions |

**Tap akışı:** tap → tap lock → panel close → `requestAnimationFrame` → navigation → lock release (450 ms).

Hesap kartı login modalını doğrudan açmaz; Şirket ekranındaki `AccountSection`'a scroll eder.

---

## 5. Panel yükseklik / scroll davranışı

- `maxHeight`: ekran yüksekliğinin %85'i (82–88% aralığında)
- İçerik `ScrollView` içinde
- Kart yüksekliği 84px → 76px (%~10 küçültme); `minHeight` 76px, touch target ≥ 44px
- Tile gap: 10px → 14px (12–16px aralığı)
- Büyük ekranlarda gereksiz boşluk yok; küçük ekranlarda scroll aktif

---

## 6. Safe area davranışı

- Panel `bottomOffset` ile tab bar + merkez buton yüksekliğinin üstüne konumlanır
- iOS: `SafeAreaView` (GameTabBar) home indicator alanını hesaba katar
- Android: `onRequestClose` ile back tuşu paneli kapatır
- Panel açıkken backdrop alttaki Piyasa ekranına dokunmayı engeller

---

## 7. Accessibility

| Kart | accessibilityLabel | accessibilityHint |
|------|-------------------|-------------------|
| Liderlik | Liderlik tablosunu aç | Haftalık sıralamayı ve kendi dereceni görüntüler |
| Hesap | Hesap ayarlarını aç | Profil, giriş ve hesap seçeneklerini görüntüler |
| Tüm kartlar | `accessibilityRole="button"` | `adjustsFontSizeToFit` + `minimumFontScale` ile %120–150 font scale desteği |

---

## 8. Leaderboard unavailable davranışı

- Liderlik kartı her zaman panelde görünür
- `LEADERBOARD_ENABLED` false olsa bile `LeaderboardScreen` açılır; ekran mevcut unavailable/maintenance mesajlarını gösterir
- Sahte sıralama veya sabit badge eklenmedi
- Backend / leaderboard servisi değiştirilmedi

---

## 9. Değişen dosyalar

| Dosya | Değişiklik |
|-------|-----------|
| `src/navigation/quickAccessConfig.ts` | **Yeni** — kart config, sıra, layout sabitleri |
| `src/navigation/quickAccessTypes.ts` | `leaderboard` action eklendi |
| `src/components/navigation/QuickAccessMenu.tsx` | 8 kart, tap lock, a11y, layout |
| `App.tsx` | leaderboard + account navigation |
| `src/store/gameStore.ts` | `pendingMoreSubRoute` → `'account'` |
| `src/screens/MoreScreen.tsx` | account scroll, leaderboard guard kaldırıldı |
| `scripts/management-panel-regression-test.ts` | **Yeni** — regression test |
| `docs/release-audit/FIX_MANAGEMENT_PANEL_ACCOUNT_LEADERBOARD_RESULTS.md` | **Yeni** — bu rapor |

---

## 10. Test sonuçları

| Komut | Sonuç |
|-------|-------|
| `npm run typecheck` | ✅ PASS |
| `npm run verify` | ✅ PASS |
| `npx tsx scripts/management-panel-regression-test.ts` | ✅ 31/31 PASS |
| `npx expo export --platform android` | ✅ PASS |
| `npx expo export --platform ios` | ✅ PASS |
| `git diff --check` | ✅ PASS |

---

## 11. Android / iOS manuel test gereksinimi

Gerçek cihazda kontrol listesi:

1. Merkez butona bas → Yönetim paneli açılır
2. 8 kart görünür (Araç Pazarı flag'e bağlı)
3. Son satıra scroll et → Liderlik ve Hesap erişilebilir
4. Liderlik kartına bas → LeaderboardScreen açılır, geri dön
5. Hesap kartına bas → Şirket ekranı AccountSection'a scroll eder, geri dön
6. Mevcut 6 kartın her biri doğru ekrana gider
7. Android back → panel kapanır (navigation tetiklenmez)
8. iPhone home indicator ile panel çakışmaz
9. Büyük font (%150) ile kart metinleri okunur
10. Çift tap → tek navigation

**Beklenen:** 8 kart, doğru navigation, bottom tab çakışması yok, çift navigation yok, eski kartlar bozulmaz.

---

## Kabul kriterleri

| Kriter | Durum |
|--------|-------|
| Yönetim panelinde toplam 8 kart | ✅ |
| Liderlik doğru mevcut ekrana gider | ✅ |
| Hesap doğru mevcut ekrana gider | ✅ |
| Kart sırası 2×4 grid | ✅ |
| Küçük ekranlarda son satır erişilebilir | ✅ (scroll) |
| Bottom navigation ile çakışma yok | ✅ |
| Çift navigation oluşmaz | ✅ (tap lock) |
| Mevcut 6 kart bozulmaz | ✅ |

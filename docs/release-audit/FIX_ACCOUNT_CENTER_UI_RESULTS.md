# FIX_ACCOUNT_CENTER_UI_RESULTS

**Tarih:** 2026-08-06  
**Kapsam:** Hesap ekranı → sekmeli **Hesap Merkezi** yeniden tasarımı

---

## 1. Önceki hesap ekranı sorunları

| Sorun | Açıklama |
|-------|----------|
| Tek monolitik kart | `AccountSection.tsx` (~1590 satır) tüm hesap, bulut, liderlik ve tehlikeli işlemleri tek kartta topluyordu |
| Tekrarlayan kullanıcı adı CTA | Hem `usernameSetupCard` hem `primaryActionRow` içinde “Kullanıcı Adı Oluştur/Düzenle” |
| Çift liderlik girişi | `AccountStatusRow` + ayrı `leaderboardEntry` satırı |
| Eş anlamlı sync butonları | “Senkronize Et” + “Bulut Kaydını Kontrol Et” aynı ekranda |
| Hesap durumu tekrarı | Hero, status panel ve ayarlar bölümünde aynı bilgiler |
| Deep-link scroll hack | `pendingMoreSubRoute: 'account'` menüde scroll ile bölüme kaydırıyordu |
| Gizlilik linkleri yoktu | Uygulama içinde `Linking.openURL` ile yasal URL’ler bağlı değildi |
| Tercih toggles yoktu | Bildirim/ses/titreşim için kalıcı tercih deposu yoktu |

---

## 2. Yeni ekran yapısı

```
MoreScreen
  ├── menu → AccountSection (kompakt özet kartı)
  └── route: 'account' → AccountCenterScreen (tam ekran)
        ├── Header: Hesap Merkezi
        ├── Segmented tabs: Profil | Hesap | Tercihler
        └── useAccountCenter() hook (iş mantığı)
```

- **Route:** `MoreScreen` `MoreRoute` tipine `'account'` eklendi; Quick Access / `pendingMoreSubRoute` doğrudan `setRoute('account')` kullanır.
- **İş mantığı:** `src/hooks/useAccountCenter.ts` — auth, cloud sync, account switch B-002, logout, delete; mevcut handler’lar taşındı, yeniden yazılmadı.

---

## 3. Profil sekmesi

Sıra: Profil özeti → Oyuncu Kimliği → Şirket Kimliği → Liderlik

- Avatar / baş harf rozeti, provider badge (GOOGLE / APPLE / MİSAFİR), bulut durumu
- Seviye, sözleşme, araç, depo istatistikleri (2×2 grid, 360px uyumlu)
- **Tek** “Kullanıcı Adı Oluştur” CTA (`Oyuncu Kimliği` kartında)
- Şirket kimliği: ad, seviye, şirket puanı (`calculateCompanyScore`), merkez şehir (salt okunur)
- Liderlik: `fetchWeeklyLeaderboard` ile haftalık sıra; backend yoksa “Liderlik servisine şu anda ulaşılamıyor” — sahte veri yok

---

## 4. Hesap sekmesi

Sıra: Hesap bağlantısı → Bulut kaydı → Hesap işlemleri

- Misafir: Google / Apple bağlama
- Bağlı hesap: maskeli e-posta, provider, son senkronizasyon (`formatRelativeSaveAgo`)
- Bulut kaydı: `resolveCloudSaveDisplayInfo` ile tek durum kartı + tek CTA
- İşlemler: Hesap Değiştir (B-002), Çıkış Yap
- Geçiş / kurtarma banner’ları: `isSwitchingAccount`, `isAccountSwitchRecoveryRequired`

---

## 5. Tercihler sekmesi

Sıra: Uygulama → Gizlilik ve destek → Hakkında → Tehlikeli işlemler

- **Uygulama:** Bildirimler, Titreşim, Ses, Gelir özeti, Dil (Türkçe — bilgi)
- **Gizlilik:** Privacy Policy, Privacy Choices (UMP `showAdsPrivacyOptionsForm`), Account Deletion info, Support
- **Hakkında:** Sürüm, build, kayıt tarihi, yasal belgeler
- **Tehlikeli işlemler:** Varsayılan kapalı accordion; Çıkış Yap + iki aşamalı Hesabı Sil

---

## 6. Tekrarlanan alanların temizliği

| Önce | Sonra |
|------|-------|
| 2× kullanıcı adı CTA | 1× (Profil → Oyuncu Kimliği) |
| 2× liderlik girişi | 1× liderlik kartı |
| Senkronize Et + Bulut Kontrol | Tek CTA: “Şimdi Senkronize Et” veya “Bulut Kaydını Görüntüle” (çakışma) |
| Gömülü tam hesap UI | Kompakt `AccountSection` + tam `AccountCenterScreen` |

---

## 7. Cloud save davranışı

- Durumlar: Senkronize, Bekliyor, Çevrimdışı, Çakışma, Yeniden denenecek, Bağlantı gerekli, Kurtarma
- `handleManualSync` / `handleCheckCloud` hook’tan yeniden kullanılır
- Çakışmada CTA → `handleCheckCloud`; normal durumda → `handleManualSync`

---

## 8. Account switch davranışı

- `useAccountCenter.ts` içinde korunan akış: `syncBeforeAccountTransition` → `beginGoogleAccountSwitchSelection` → conflict dialog → `commitAccountSwitch` / `rollbackAccountSwitch`
- `if (isSwitchingAccount) return` çift tap koruması
- `isVehicleMarketplaceOperationActive` guard’ları aynı

---

## 9. Privacy linkleri

| Başlık | URL |
|--------|-----|
| Gizlilik Politikası | https://hansaglam.github.io/logisticore-legal/privacy-policy/ |
| Gizlilik ve Çerez Ayarları | https://hansaglam.github.io/logisticore-legal/privacy-choices/ (+ UMP form) |
| Hesap Silme Bilgileri | https://hansaglam.github.io/logisticore-legal/account-deletion/ |
| Destek | https://hansaglam.github.io/logisticore-legal/support/ |

`src/utils/legalLinks.ts` — `Linking.canOpenURL` + hata mesajı

---

## 10. Android sonucu

- Tam ekran route, geri butonu (`ScreenHeader.onBack`)
- `Switch` native toggle
- `expo export --platform android` — **BAŞARILI** (`dist/`)
- AAB/APK üretilmedi (talimat gereği)

---

## 11. iOS sonucu

- `AppScreen` embedded + safe area
- Apple provider badge ve Apple link butonu (iOS)
- `expo export --platform ios` — **BAŞARILI** (`dist/`)
- IPA / Xcode Archive üretilmedi (talimat gereği)

---

## 12. Accessibility

- Sekmeler: `tablist` / `tab`, `accessibilityState.selected`
- Switch satırları: `accessibilityLabel`, `accessibilityRole="switch"`
- Tehlikeli işlemler: `accessibilityState.expanded`
- Geçiş banner’ları: `accessibilityLiveRegion="polite"`
- Minimum 44px dokunma alanı (tab, toggle satırları)

---

## 13. Değişen dosyalar

**Yeni**
- `src/screens/AccountCenterScreen.tsx`
- `src/hooks/useAccountCenter.ts`
- `src/utils/legalLinks.ts`
- `src/utils/accountCenterCloudStatus.ts`
- `src/services/appPreferences.ts`
- `scripts/account-center-ui-regression-test.ts`
- `scripts/extract-use-account-center.mjs`

**Güncellenen**
- `src/components/AccountSection.tsx` (kompakt giriş kartı)
- `src/screens/MoreScreen.tsx` (`account` route)
- `src/services/adsConsentService.ts` (`showAdsPrivacyOptionsForm`)
- `scripts/account-switch-flow-test.ts`
- `scripts/account-switch-isolation-security-test.ts`
- `scripts/management-panel-regression-test.ts`
- `scripts/auth-production-audit-test.ts`
- `scripts/cloud-save-production-audit-test.ts`
- `scripts/release-regression-contract-transfer-navigation-test.ts`

---

## 14. Test sonuçları

| Komut | Sonuç |
|-------|-------|
| `npm run typecheck` | PASS |
| `npm run verify` | PASS |
| `npx tsx scripts/account-center-ui-regression-test.ts` | **69/69 PASS** |
| `npx tsx scripts/account-switch-flow-test.ts` | PASS |
| `npx tsx scripts/management-panel-regression-test.ts` | PASS |
| `npx expo export --platform android` | PASS |
| `npx expo export --platform ios` | PASS |

---

## 15. Gerçek cihaz manuel test gereksinimi

Aşağıdaki akışlar gerçek Android + iPhone’da doğrulanmalıdır:

1. Hesap Merkezi aç (Şirket → Hesap Merkezini Aç veya Quick Access → Hesap)
2. Üç sekme gezinimi
3. Kullanıcı adı oluştur / düzenle (klavye + geri tuşu)
4. Liderlik ekranına git
5. Senkronize et / internet kapat → bulut durumu
6. Hesap değiştir → vazgeç → rollback
7. Tercih toggle’ları
8. Privacy / Support linkleri (harici tarayıcı)
9. UMP gizlilik formu
10. Çıkış ve hesap silme onayları
11. Büyük font (%150) ve küçük ekran (360px)

**Not:** `appPreferences` toggles AsyncStorage’a yazılır; `notifications.ts` henüz bu tercihleri okumuyor — oyun içi bildirim davranışına bağlamak ayrı bir entegrasyon adımıdır.

---

## Kabul kriterleri

| Kriter | Durum |
|--------|-------|
| 3 net sekme | ✅ |
| Tek kullanıcı adı CTA | ✅ |
| Hesap / cloud / tercihler ayrı | ✅ |
| Liderlik + username state tutarlı | ✅ |
| Tehlikeli işlemler ayrı ve güvenli | ✅ |
| LogistiCore premium tasarım dili | ✅ |
| Android / iOS aynı business logic | ✅ |
| B-002 account switch korundu | ✅ |

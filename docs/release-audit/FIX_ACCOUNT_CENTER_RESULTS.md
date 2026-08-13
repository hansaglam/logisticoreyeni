# Hesap Merkezi Premium UI Redesign — Sonuç Raporu

**Tarih:** 2026-08-13  
**Kapsam:** Profil / Hesap / Tercihler — yalnız presentation katmanı.

---

## Eski UI’ın Ana Problemleri

| Problem | Etki |
|--------|------|
| 4 ayrı metric box (profil hero) | ~100px gereksiz yükseklik |
| Uzun liste kartları (Şirket Kimliği) | Düşük bilgi yoğunluğu, uzun scroll |
| Teknik hesap/bulut etiketleri | Kurumsal his yok |
| Büyük action butonları (Hesap İşlemleri) | Çıkış/değiştir fazla baskın |
| Klasik ayarlar listesi | Premium oyun hissi zayıf |
| Tehlikeli bölümde çıkış + silme | Yanlış hiyerarşi |
| Tutarsız spacing (20–32px) | Parçalı görünüm |

---

## Profil — Yeni Hiyerarşi

1. **Ana Profil Kartı** — avatar 56px, isim, provider + güven badge, inline stats (`Sv.2 · N sözleşme · N araç · N depo`)
2. **Oyuncu Kimliği** — compact tıklanabilir `@username` satırı + helper
3. **Şirket Özeti** — HQ satırı + 2×2 `AccountMetric` grid
4. **Liderlik Tablosu** — kompakt action row (secondary)

Tahmini profil sekmesi kısalması: **~25–35%**.

---

## Hesap — Yeni Hiyerarşi

1. **Bağlı Hesap** — provider, masked email, BAĞLI badge (misafir: link CTA’lar)
2. **Bulut Koruması** — öne çıkan kart; `İlerlemen güvende` yalnız synced state; `Senkronize Et` CTA
3. **Hesap Yönetimi** — `Hesap Değiştir` + `Çıkış Yap` action rows (warning tone, destructive değil)

---

## Tercihler — Yeni Hiyerarşi

1. **Uygulama** — tek kart, 4 toggle (64px satır)
2. **Dil** — tek compact row
3. **Gizlilik ve Destek** — 4 kompakt link satırı
4. **Hakkında** — `1.0.17 · Build N` + kayıt tarihi + Yasal Belgeler
5. **Tehlikeli İşlemler** — collapsed accordion (~56px), yalnız hesap silme

Çıkış yap Tercihler’den kaldırıldı → Hesap sekmesinde.

---

## Azaltılan Kart / Spacing

| Alan | Önce | Sonra |
|------|------|-------|
| Section gap | 20px (`spacing.lg`) | 14px |
| Card padding | 20px | 14px |
| Profil hero stats | 4 bordered cells | 1 inline satır |
| Şirket bilgisi | 4 ayrı info row | 1 header + 2×2 grid |
| Hakkında | 3 row + action | 2 row + action |
| Danger zone | Koyu kırmızı full bg | Subtle red border |

---

## Yeni Ortak Bileşenler

- `AccountMetric` — 2×2 stat hücreleri
- `AccountSectionCard` — compact mode
- `AccountSettingRow` — 64px min height
- `AccountActionRow` — compact + warning tone
- `accountCenterTheme` — canonical spacing token’ları

---

## Cloud Protection Kartı

- Başlık: **Bulut Koruması**
- Badge: `SENKRONİZE` / `YENİDEN DENE` / vb. (canonical `resolveCloudSaveDisplayInfo`)
- Synced: yeşil **İlerlemen güvende** + son kayıt zamanı
- CTA: **Senkronize Et** (44px, compact)

---

## Dangerous Actions

- Collapsed: 56px, subtle border (tam kırmızı arka plan yok)
- Expanded: açıklama + tek destructive `Hesabı Sil` butonu
- Çıkış yap bu bölümden çıkarıldı

---

## Android / iOS Export

| Platform | Sonuç |
|----------|-------|
| `npx expo export --platform android` | **PASS** |
| `npx expo export --platform ios` | **PASS** |

AAB/APK/IPA/Xcode Archive **üretilmedi**.

---

## Test Sonuçları

| Komut / Test | Sonuç |
|--------------|-------|
| `npm run typecheck` | PASS |
| `npm run verify` | PASS |
| `account-center-ui-regression-test.ts` | PASS (74) |
| `account-switch-flow-test.ts` | PASS |
| Tutorial target layout | PASS |
| `git diff --check` | PASS |

---

## Korunan Fonksiyonlar

Google/Apple link, account switch, logout, cloud sync/retry, username, leaderboard identity, tüm toggles, dil, gizlilik, destek, yasal belgeler, hesap silme, tutorial target’ları (`profile`, `cloud-save`, `preferences`).

---

## Değişen Dosyalar

- `src/screens/AccountCenterScreen.tsx`
- `src/components/accountCenter/*` (tabs, hero, theme, metric, danger zone)
- `scripts/account-center-ui-regression-test.ts`
- `package.json` (verify pipeline)

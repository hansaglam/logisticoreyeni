# Legal Pages — Results

**Date:** August 6, 2026  
**Repository:** [hansaglam/logisticore-legal](https://github.com/hansaglam/logisticore-legal)  
**Status:** Published to GitHub (main branch)

---

## 1. Kaldırılan CTA Butonları

- Account Deletion: **Request Account Deletion** büyük mailto butonu kaldırıldı
- Support: **Contact Support** büyük mailto butonu kaldırıldı
- `assets/styles.css` içinden `.cta-button` kaldırıldı
- Inline JS / clipboard / `site.js` yok

---

## 2. Yeni İletişim Kartları

Sade `.contact-card` bileşenleri:

- **Account Deletion:** “Request deletion by email”
- **Support:** “Contact Support”

Kart içeriği:

- Email (görünür + seçilebilir)
- Subject (görünür metin)

Küçük metin `mailto:` bağlantısı var; mailto çalışmasa da adres ve konu manuel kullanılabilir.

---

## 3. Görünür E-posta ve Konu Bilgileri

| Sayfa | Email | Subject |
|-------|-------|---------|
| Account Deletion | ethemsincarbusiness@gmail.com | LogistiCore Account Deletion Request |
| Support | ethemsincarbusiness@gmail.com | LogistiCore Support Request |

---

## 4. Account Deletion Web Request Yolu

Sayfa sırası (Google Play web deletion source uyumlu):

1. Başlık + LogistiCore / Ethem Sincar
2. **Request deletion by email** kartı (ilk ekranda)
3. Include only / Do not include
4. Delete from the App
5. What we delete
6. Data we may retain
7. Questions

Normal işlem süresi: within **30 days**. Uygulamayı yeniden yükleme zorunluluğu yok.

---

## 5. Support Yapısı

1. Sayfa başlığı  
2. Contact Support kartı  
3. Account and sign-in  
4. Cloud save  
5. Advertising and rewards  
6. Marketplace  
7. Account deletion → `../account-deletion/`  
8. Bug reports  
9. Privacy and data → Privacy Policy / Privacy Choices / Account Deletion  
10. Contact details  

---

## 6. Accessibility

- Semantik `<section>` + `aria-labelledby`
- Heading sırası korunuyor
- Mailto görünen etiketi = e-posta adresi
- `overflow-wrap: anywhere` ile mobil taşma önlendi
- User-select engellenmedi
- Tracking / script yok

---

## 7. Validation Sonucu

```bash
npx tsx scripts/legal-pages-validation-test.ts
```

**218/218 PASS** ✅

---

## 8. Commit Hash

```
abb14fc fix: simplify legal contact and deletion flows
```

Git root: `C:/Users/ahmet/LogistiCore/logisticore-legal`

---

## 9. Push Sonucu

**Başarılı** — `main` → `origin/main` (`a71d27d..abb14fc`)

Ana LogistiCore oyun repository’sine commit/push **yapılmadı**.

---

## 10. Final URL’ler

| Page | URL |
|------|-----|
| Home | https://hansaglam.github.io/logisticore-legal/ |
| Privacy Policy | https://hansaglam.github.io/logisticore-legal/privacy-policy/ |
| Privacy Choices | https://hansaglam.github.io/logisticore-legal/privacy-choices/ |
| Account Deletion | https://hansaglam.github.io/logisticore-legal/account-deletion/ |
| Support | https://hansaglam.github.io/logisticore-legal/support/ |

---

## Mağaza Formları İçin Hızlı Referans

- **Privacy policy URL:** `https://hansaglam.github.io/logisticore-legal/privacy-policy/`
- **Account deletion URL (Play):** `https://hansaglam.github.io/logisticore-legal/account-deletion/`
- **Privacy choices URL (App Store):** `https://hansaglam.github.io/logisticore-legal/privacy-choices/`
- **Support email:** ethemsincarbusiness@gmail.com
- **Android package / iOS bundle:** `com.ethemsincar.logisticore`

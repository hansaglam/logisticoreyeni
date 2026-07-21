# LogistiCore V1 — Android Gerçek Cihaz Smoke Checklist

Manuel smoke test listesi. Her madde için: **PASS** / **FAIL** / **SKIP** işaretle; FAIL durumunda kısa not ekle.

**Ön koşullar**
- [ ] Release veya debug APK gerçek Android cihazda yüklü
- [ ] İnternet bağlantısı açık (auth / cloud save / leaderboard için)
- [ ] Temiz kurulum veya test hesabı hazır

---

## Auth

| # | Test | Beklenen | Sonuç | Not |
|---|------|----------|-------|-----|
| A1 | Anonymous başlatma | Oyun hesap oluşturmadan açılır, ilerleme kaydedilir | | |
| A2 | Google ile bağlanma | Hesap bağlama akışı tamamlanır, hata vermez | | |
| A3 | Cloud save | Uygulama kapat-aç sonrası para, filo, görevler korunur | | |
| A4 | Leaderboard entry | Bağlı hesapla skor tabloya yansır veya giriş CTA çalışır | | |

---

## Gameplay

| # | Test | Beklenen | Sonuç | Not |
|---|------|----------|-------|-----|
| G1 | İlk sözleşme alma | Contracts'tan uygun iş seçilir, ekip atanır | | |
| G2 | Teslimat başlatma | Aktif teslimat listede/haritada görünür, progress artar | | |
| G3 | Teslimat tamamlama | Ödeme gelir, kamyon varış şehrinde kalır (toast/hint) | | |
| G4 | Driver XP artışı | Teslimat sonrası şoför XP / seviye ilerlemesi görünür | | |
| G5 | Milestone progress | Dashboard / Missions milestone ilerlemesi güncellenir | | |
| G6 | Haftalık görev progress | Haftalık sekmede sayaç artar | | |
| G7 | World event üretimi | Aktif dünya olayı badge/kart olarak görünür | | |
| G8 | Market alım/satım | Şehir piyasasından alım veya satım işlemi tamamlanır | | |
| G9 | Depo satış | Warehouse'tan ürün satışı nakit getirir | | |
| G10 | Truck bakım | Filo'da tamir/bakım yapılır, kondisyon artar | | |
| G11 | Truck upgrade | Upgrade satın alınır, stat/bonus yansır | | |
| G12 | Özel sözleşme başlatma | Bulk / fragile / urgent vb. tip iş alınabilir (uygunluk varsa) | | |
| G13 | Prestijli iş itibar block | Düşük itibarla prestijli iş engellenir, mesaj net | | |
| G14 | Kamyon konum değişimi | Filo → Yönlendir ile boş transfer tamamlanır; Contracts uygunluk güncellenir | | |

---

## UI

| # | Ekran | Kontrol | Sonuç | Not |
|---|-------|---------|-------|-----|
| U1 | Dashboard | Hero, sıradaki hamle, stat grid, modül grid okunur; crash yok | | |
| U2 | Contracts | Uygun çıkış şehri özeti, kart/detay deadline bilgisi görünür | | |
| U3 | Map | Kamyon takibi, aktif rota, deadline/ETA satırı | | |
| U4 | Market | Fiyat, olay etkisi, al/sat akışı | | |
| U5 | Warehouse | Doluluk, envanter, satış | | |
| U6 | Fleet | Kamyon şehri, Yönlendir, bakım/upgrade | | |
| U7 | Missions | Görevler / Haftalık / Başarılar sekmeleri net | | |
| U8 | Leaderboard | Liste yüklenir, hesap CTA (anon ise) | | |
| U9 | Account | Profil, bağlama, ayarlar | | |

---

## Kritik UX doğrulama (simülasyon riskleri)

| # | Risk | Doğrulama | Sonuç | Not |
|---|------|-----------|-------|-----|
| R1 | Kamyon hedef şehirde kalır | Teslimat sonrası Contracts "Uygun çıkış: X" ve Fleet konum eşleşir | | |
| R2 | Şehir uyumsuzluğu | Uygun olmayan işte "Bu şehirde boşta kamyon yok" + yönlendirme ipucu | | |
| R3 | Deadline anlaşılır | Acil işte ceza uyarısı; aktif teslimatta teslim vs varış süresi | | |
| R4 | Geç teslim riski | Tahmini varış > deadline ise "Deadline riski" görünür | | |

---

## Regresyon hızlı kontrol

- [ ] Uygulama arka plana alınıp geri gelince state bozulmuyor
- [ ] Bildirim / dialog kapatma geri tuşu ile tutarlı
- [ ] Düşük bellek cihazda scroll takılması yok (Dashboard, Contracts, Market)

---

## Özet

| Alan | PASS | FAIL | SKIP |
|------|------|------|------|
| Auth | | | |
| Gameplay | | | |
| UI | | | |
| UX riskleri | | | |

**Test eden:** _______________  
**Tarih:** _______________  
**Cihaz / Android sürümü:** _______________  
**APK build:** _______________

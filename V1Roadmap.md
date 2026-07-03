# LogistiCore — V1 Roadmap

V1 hedefi: Oyuncunun tek bir oturumda **sözleşme taşımacılığı**, **depo ticareti** ve **filoyu büyütme** döngülerini uçtan uca deneyimleyebildiği, offline çalışan, kayıt yükleyen bir internal test sürümü.

## V1 Hedef Oyun Döngüsü

1. Sözleşme al
2. Kamyon ve şoför ata
3. Teslim et
4. Para kazan
5. Kamyon bakım/tamir yap
6. Piyasadan ürün satın al
7. Ürünü depoda beklet
8. Fiyat yükselince sat
9. Yeni kamyon satın al
10. Yeni depo satın al
11. Daha büyük sözleşmelere gir
12. Şirketini büyüt

---

## 1. Core Loop

### Contract Delivery Loop (Taşımacılık)

```
Piyasa / İşler → Sözleşme seç → Ekip ata (kamyon + şoför) → Teslimat → Ödeme + kâr → Filo bakımı
```

**Oyuncu deneyimi:** Şehirler arası fiyat/stok farklarından iş bulur, kapasite ve riski değerlendirir, teslimatı tamamlayınca nakit ve itibar kazanır. Kazanç filo genişletme ve depo yatırımına aktarılır.

**Mevcut durum:** Bu döngünün büyük kısmı çalışıyor (sözleşme üretimi, ekip seçimi, teslimat simülasyonu, ödeme, tamir).

**V1 tamamlanması için:** Daha büyük sözleşmelere geçişin ekonomiyle dengelenmesi, finans ekranında gerçek gelir/gider kalemlerinin net yansıması.

---

### Trading / Warehouse Loop (Depo Ticareti)

```
Piyasa analizi → Şehirde ürün satın al → Depoya stokla → Fiyat yükselince sat → Ticaret kârı
```

**Oyuncu deneyimi:** Taşımacılık dışında ikinci bir gelir kanalı. Düşük fiyatlı şehirden alır, depoda bekletir, yüksek fiyatlı şehirde veya aynı şehirde fiyat artınca satar.

**Mevcut durum:** Veri modeli ve ekran iskeleti var; **alım/satım aksiyonları ve stok mutasyonu yok**.

**V1 tamamlanması için:** Ürün satın alma, depo envanteri, kapasite sınırı, satış ve kâr hesabı store’a bağlanmalı.

---

### Fleet Growth Loop (Şirket Büyümesi)

```
Kâr biriktir → Kamyon/şoför al → Depo aç → Daha büyük işlere gir → Şirket değerini artır
```

**Oyuncu deneyimi:** Kazanılan para yeni varlıklara dönüşür; filo ve depo kapasitesi arttıkça daha yüksek ödemeli sözleşmelere erişilir.

**Mevcut durum:** Kamyon ve şoför satın alma çalışıyor. Depo açma UI’da stub. `companyLevel` ve milestone sistemi tanımlı değil / kullanılmıyor.

**V1 tamamlanması için:** Depo satın alma, dengeli fiyatlandırma, basit büyüme kilometre taşları (ör. tamamlanan sözleşme sayısı, filo büyüklüğü).

---

## 2. Current Implemented Systems

| Sistem | Durum | Notlar |
|--------|--------|--------|
| **Contracts** | ✅ Çalışıyor | Dinamik üretim, filtreleme, kâr/risk analizi, ekip seçim modalı, piyasa fırsatı bağlantısı |
| **Fleet** | ✅ Çalışıyor | Kamyon listesi, durum, aktif teslimat, tamir |
| **Drivers** | ✅ Çalışıyor | Filo sekmesi altında; işe alma mağazadan |
| **Deliveries** | ✅ Çalışıyor | İlerleme, tamamlama, başarısızlık, şehir stok güncellemesi |
| **Finance** | ⚠️ Kısmi | Nakit, tahmini kâr, şirket değeri; ticaret/depo kalemleri placeholder |
| **Market** | ⚠️ Kısmi | Şehir stok/fiyat analizi, fırsat tarayıcı; **doğrudan alım/satım yok** |
| **Warehouse** | ⚠️ Kısmi | Başlangıç deposu gösterimi; **stok yazma, satın alma, satış yok** |
| **Save/Load** | ✅ Çalışıyor | AsyncStorage, otomatik kayıt, yükleme/sıfırlama (Debug) |
| **Event Log** | ✅ Çalışıyor | Kalıcı kayıt; teslimat, filo, piyasa olayları; Dashboard’da özet |
| **Notifications** | ✅ Çalışıyor | Geçici toast (teslimat başladı/tamamlandı); eventLog’dan ayrı |

### Ek altyapı (destekleyici)

- **Map:** Aktif teslimatlar, rota, depo şehirleri
- **Dashboard:** Özet, son olaylar, piyasa haberleri, duraklat/devam
- **Economy tick:** Günlük şehir stok/fiyat, yakıt, sözleşme yenileme
- **Debug ekranı:** Simülasyon testleri, kayıt yönetimi

### İlgili dosyalar

| Alan | Dosya |
|------|--------|
| Store | `src/store/gameStore.ts` |
| Tipler | `src/types/game.ts` |
| Kayıt | `src/storage/saveGame.ts` |
| Denge | `src/config/balance.ts` |
| Sözleşme sim | `src/simulation/contracts.ts` |
| Teslimat sim | `src/simulation/delivery.ts` |
| Ekonomi sim | `src/simulation/economy.ts` |
| Toast | `src/components/GameToast.tsx` |

---

## 3. Missing V1 Systems

Aşağıdakiler V1 hedef döngüsünü tamamlamak için **henüz eksik veya sadece iskelet** halinde:

| Eksik sistem | Açıklama |
|--------------|----------|
| **Market product buy action** | Oyuncunun şehir piyasasından ürün satın alması (`buyProduct` store aksiyonu) |
| **Warehouse stock inventory** | `storedProducts` alanının oyun içinde güncellenmesi ve UI’da canlı stok |
| **Product sell action** | Depodan veya şehirden ürün satışı (`sellProduct`) |
| **Warehouse capacity enforcement** | Depo kapasitesi aşımının engellenmesi / uyarı |
| **Trade profit calculation** | Alım-satım farkının hesaplanması ve Finance’e yansıması |
| **Open new warehouse** | `openWarehouse(cityId)` — UI stub, store’da yok |
| **Warehouse daily cost** | Günlük depo kirası/maliyetinin nakitten düşülmesi |
| **Better company growth milestones** | `companyLevel`, kilometre taşları, unlock mantığı |
| **Balanced truck/depot pricing** | Kamyon ve depo fiyatlarının ekonomiyle uyumu |
| **Recurring driver salary** | Şoför maaşının periyodik nakit düşümü (şu an tahmin UI’da) |
| **Finance trade/depot rows** | “Yakında” placeholder satırlarının gerçek veriyle doldurulması |

### Bilinçli olarak V1 dışı (şimdilik)

- Cloud save / backend senkronizasyonu
- IAP, reklam, leaderboard
- Kamyon satma / şoför çıkarma
- Manuel şoför–kamyon eşleştirme (teslimat dışı)
- Tam oyuncu event log ekranı

---

## 4. V1 Completion Checklist

Her madde **oyuncu olarak uçtan uca test edilebilir** olmalı.

### Taşımacılık döngüsü

- [ ] Yeni oyun başlatılır (kayıt yoksa otomatik oluşur)
- [ ] İlk sözleşme listede görünür ve seçilebilir
- [ ] Kamyon ve şoför atanır (Ekibi Seç modalı)
- [ ] Teslimat haritada ilerler ve tamamlanır
- [ ] Para kazanılır (nakit artar, teslimat toast + event log)
- [ ] Kamyon tamir edilebilir (yeterli nakit + boşta kamyon)

### Ticaret / depo döngüsü

- [ ] Piyasadan ürün satın alınır (şehir + ürün + miktar)
- [ ] Depoda stok görünür (`storedProducts` güncellenir)
- [ ] Depo kapasitesi aşılamaz (veya net uyarı verilir)
- [ ] Fiyat değişince (ekonomi tick) ürün satılabilir
- [ ] Ticaret kârı Finance ekranına yansır

### Büyüme döngüsü

- [ ] Yeni kamyon satın alınır (Filo → Mağaza)
- [ ] Yeni depo açılır (Warehouse → şehir seçimi)
- [ ] Daha büyük / yüksek ödemeli sözleşme alınabilir (kapasite + nakit yeterli)
- [ ] Şirket büyümesi hissedilir (filo, depo, nakit, tamamlanan iş sayısı)

### Kalıcılık ve geri bildirim

- [ ] Oyun kapatılıp açıldığında ilerleme korunur
- [ ] Teslimat tamamlama event log’da kalır (toast kısa, log kalıcı)
- [ ] Kritik hatalar oyuncuya anlaşılır mesajla gösterilir

---

## 5. Do not implement backend yet

> **Not:** Backend, IAP, reklamlar, leaderboard ve cloud save **V1 internal test tamamlandıktan sonra** planlanacaktır.

V1 odak noktası:

- Offline, tek cihazda çalışan tam oyun döngüsü
- Local save (`AsyncStorage`) ile kararlı test
- Ekonomi ve UI dengesinin oyuncu geri bildirimiyle iyileştirilmesi

Backend ve canlı servis entegrasyonu için ayrı plan: `src/config/backendRoadmap.ts` (referans; V1 kapsamı dışı).

---

## Özet

| Döngü | V1 hazırlık |
|-------|-------------|
| Sözleşme → Teslimat → Para | ~%85 — çekirdek akış çalışıyor |
| Piyasa → Depo → Ticaret kârı | ~%20 — model + UI var, aksiyonlar eksik |
| Kâr → Filo/Depo → Büyüme | ~%50 — kamyon/şoför var, depo ve milestone eksik |

**V1 “bitti” sayılması için:** Yukarıdaki checklist’in tamamı işaretlenebilir olmalı; özellikle depo ticareti ve depo satın alma store’a bağlanmalıdır.

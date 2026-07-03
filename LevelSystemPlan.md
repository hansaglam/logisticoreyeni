# LogistiCore — Şirket Seviye Sistemi Planı

> Şirket seviyesi, oyuncunun operasyon kapasitesini temsil eden ana ilerleme omurgasıdır.  
> Bu belge V1 kapsamını, seviye aşamalarını ve gelecek sistemleri tanımlar.

---

## 1. Genel Amaç

Şirket seviyesi oyuncunun operasyon kapasitesini temsil eder. Oyuncu XP kazanarak seviye atlar; her yeni seviye daha geniş bir lojistik imparatorluğuna kapı açar.

Level arttıkça:

- **Daha büyük sözleşmeler** — tonaj ve ödeme tavanı yükselir
- **Daha iyi kamyonlar** — yeni filo modelleri mağazada açılır
- **Daha kaliteli şoförler** — acemi → standart → deneyimli işe alım havuzu genişler
- **Yeni şehirlerde depo açma** — lojistik ağını Türkiye geneline yayma
- **Daha büyük depo kapasitesi** — stok ve ticaret hacmi artar
- **Yeni lojistik türleri** — tren, gemi, uçak (ileride)
- **Yurt dışı pazarı** — uluslararası taşımacılık (ileride)

Seviye sistemi üç ana döngüyü birbirine bağlar:

```
Teslimat / Ticaret → XP → Level Up → Yeni kilitler → Daha büyük operasyonlar
```

Maksimum seviye: **30** (Level 1–10 aktif oynanabilir; Level 11–30 kilitli / yakında).

---

## 2. V1'de Gerçekten Çalışacak Sistemler

V1 için yalnızca aşağıdaki sistemler **aktif ve oynanabilir** olacak. Backend, IAP veya çok oyunculu altyapı gerektirmez.

| Sistem | Açıklama | Mevcut altyapı |
|--------|----------|----------------|
| **XP kazanma** | Teslimat, ticaret, satın alma ve yatırım olaylarından XP | `src/simulation/leveling.ts`, `levelBalance.xpRewards` |
| **Level atlama** | XP eşiği dolunca otomatik seviye artışı, fazla XP taşması | `applyXpToPlayer()` |
| **Kamyon level kilidi** | Mağazada kamyonlar seviyeye göre kilitli / açık | `levelBalance.truckUnlockLevels` |
| **Şoför kalite kilidi** | Acemi / standart / deneyimli şoförler seviyeye göre işe alınabilir | V1'de eklenecek |
| **Depo açma / yükseltme level kilidi** | 2. ve 3. depo, büyük depo yükseltmesi seviyeye bağlı | `levelBalance.warehouseUnlockLevels` |
| **Sözleşme tonaj / seviye kilidi** | Büyük tonajlı işler daha yüksek seviye gerektirir | `contractTonnageByLevel`, `requiredLevel` |
| **Dashboard level progress bar** | Mevcut XP, sonraki seviye eşiği, ilerleme oranı | `getLevelProgress()` |
| **Level up notification** | Seviye atlayınca toast + event log kaydı | `addCompanyXp()`, `GameToast` |
| **Debug XP test butonları** | Internal test için manuel XP ekleme / seviye kontrolü | Debug ekranı |

### V1 XP eşik formülü

```
xpToNextLevel = round(100 × level^1.45)
```

Bu formül mevcut `calculateXpToNextLevel()` ile uyumludur; erken seviyeler hızlı, üst seviyeler daha yavaş ilerler.

### V1 kilitleme özeti

| Kilit türü | Level 1 | Level 2 | Level 3 | Level 4 | Level 5 | Level 6+ |
|------------|---------|---------|---------|---------|---------|----------|
| Max sözleşme tonajı | 25 t | 40 t | 60 t | 60 t | 90 t | 120 t (Lv 8) |
| 2. depo | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| 3. depo / yeni şehir | — | — | — | ✓ | ✓ | ✓ |
| Büyük depo yükseltme | — | — | — | — | ✓ | ✓ |
| Kamyon: Ford Cargo | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Kamyon: Volvo FH | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| Kamyon: Mercedes Actros | — | — | ✓ | ✓ | ✓ | ✓ |
| Şoför: Acemi | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Şoför: Standart | — | — | ✓ | ✓ | ✓ | ✓ |
| Şoför: Deneyimli | — | — | — | — | — | ✓ (Lv 6) |

---

## 3. V1'de Sadece Kilitli / Gelecek Olarak Gösterilecek Sistemler

Bu sistemler V1'de **oynanabilir değildir**. UI'da "Yakında" veya "Level X'te açılacak" etiketiyle listelenir; ilerleme çubuğu ve seviye aşamalarında görünür kalır.

| Sistem | Önizleme seviyesi | UI davranışı |
|--------|-------------------|--------------|
| **Yurt dışı pazarı** | Level 12 | Kilitli kart, "Yakında" rozeti |
| **Tren taşımacılığı** | Level 16 | Harita / filo sekmesinde gri ikon |
| **Gemi taşımacılığı** | Level 21 | Liman noktası kilitli |
| **Uçak kargo** | Level 26 | Hava terminali kilitli |
| **Gümrük sistemi** | Level 12+ | Yurt dışı ile birlikte önizleme |
| **Liman deposu** | Level 21+ | Depo türü listesinde kilitli |
| **Hava kargo terminali** | Level 26+ | Depo türü listesinde kilitli |

Bu öğeler oyuncuya **hedef ve motivasyon** sağlar; V1'de tıklanınca bilgilendirme modalı açılır, gerçek simülasyon çalışmaz.

---

## 4. Seviye Aşamaları

### Level 1–3: Yerel Başlangıç

**Tema:** Tek şehir / bölgesel operasyon, küçük işler, öğrenme eğrisi.

- Küçük kamyonlar (Starter, Ford Cargo)
- Acemi şoförler
- 25 tonluk küçük sözleşmeler
- Başlangıç şehirleri: **İzmir, Bursa, Antalya** (ana merkez seçimi)
- Tek depo ile başlangıç

**Oyuncu hissi:** "Küçük bir nakliye firması kuruyorum."

---

### Level 4–6: Türkiye İçi Büyüme

**Tema:** Ağ genişlemesi, orta ölçekli operasyonlar.

- Yeni şehirlerde depo açma (3. depo hakkı — Level 4)
- Orta tonajlı sözleşmeler (40–60 ton)
- Daha iyi kamyonlar (Volvo FH, Mercedes Actros)
- Standart şoförler (Level 3+)
- Deneyimli şoförler (Level 6)

**Oyuncu hissi:** "Türkiye içinde birkaç noktada operasyon yürütüyorum."

---

### Level 7–10: Ulusal Lojistik Ağı

**Tema:** Büyük sözleşmeler, ağır yük, ulusal marka.

- Büyük sözleşmeler (90 ton — Level 5; 120 ton — Level 8)
- Deneyimli şoförler
- Büyük depo yükseltmeleri
- Soğutmalı / özel taşıma hazırlığı (Level 7 — V1'de kilit önizlemesi)
- Level 10: **"Ulusal Lojistik Şirketi"** unvanı

**Oyuncu hissi:** "Türkiye'nin her yerine taşıyorum; büyük işlere hazırım."

---

### Level 11–15: Yurt Dışı Pazar Hazırlığı

**Tema:** Sınır ötesi lojistik vizyonu.

- Şimdilik **kilitli / yakında** olarak göster
- UI'da Avrupa / Orta Doğu pazar kartları
- Gümrük sistemi önizlemesi
- Level 12: Yurt dışı pazarı "Yakında" rozeti

**Oyuncu hissi:** "Sırada dünya var — henüz açılmadı ama hedefim belli."

---

### Level 16–20: Tren Lojistiği

**Tema:** Demiryolu intermodal taşımacılık.

- Şimdilik **kilitli / yakında** olarak göster
- Tren rotaları haritada gri çizgiler
- Level 16: Tren taşımacılığı "Yakında" rozeti

**Oyuncu hissi:** "Demiryolu ağımı kuracağım — yakında."

---

### Level 21–25: Gemi Lojistiği

**Tema:** Denizyolu ve liman operasyonları.

- Şimdilik **kilitli / yakında** olarak göster
- Liman deposu önizlemesi
- Level 21: Gemi taşımacılığı "Yakında" rozeti

**Oyuncu hissi:** "Limanlarım ve gemi filom olacak — yakında."

---

### Level 26–30: Hava Kargo ve Global Lojistik

**Tema:** Küresel lojistik devi.

- Şimdilik **kilitli / yakında** olarak göster
- Hava kargo terminali önizlemesi
- Level 26: Hava kargo "Yakında" rozeti
- Level 30: **"Global Lojistik Devleri"** — maksimum seviye

**Oyuncu hissi:** "Dünya çapında operasyon — nihai hedef."

---

## 5. Önerilen Level Unlock Tablosu

| Level | Açılan / değişen içerik | Not |
|-------|-------------------------|-----|
| **1** | Başlangıç şehirleri, küçük kamyonlar, acemi şoförler, 25 ton sözleşmeler | Oyun başlangıcı |
| **2** | İkinci depo hakkı, 40 ton sözleşmeler, Volvo FH | İlk büyüme adımı |
| **3** | Standart şoförler, Mercedes Actros, 60 ton sözleşmeler | Filo kalitesi artışı |
| **4** | Yeni şehirlerde depo açma (3. depo) | Ağ genişlemesi |
| **5** | 90 ton sözleşmeler, orta depo yükseltme | Büyük işlere giriş |
| **6** | Deneyimli şoförler | Operasyonel verimlilik |
| **7** | Soğutmalı / özel taşıma hazırlığı (önizleme) | V1'de bilgi kartı |
| **8** | 120 ton büyük sözleşmeler | Ağır yük kapasitesi |
| **10** | **Ulusal Lojistik Şirketi** unvanı | Milestone kutlaması |
| **12** | Yurt dışı pazarı — **yakında** | Kilitli önizleme |
| **16** | Tren taşımacılığı — **yakında** | Kilitli önizleme |
| **21** | Gemi taşımacılığı — **yakında** | Kilitli önizleme |
| **26** | Hava kargo — **yakında** | Kilitli önizleme |
| **30** | Maksimum seviye — Global Lojistik | XP çubuğu dolu kalır |

### Şoför kalite kilitleri (V1 hedefi)

| Kalite | Min. level | Örnek profil |
|--------|------------|--------------|
| Acemi | 1 | Düşük deneyim, düşük maaş, hızlı işe alım |
| Standart | 3 | Dengeli istatistikler, orta maaş |
| Deneyimli | 6 | Yüksek deneyim, düşük kaza riski, yüksek maaş |

---

## 6. XP Kaynakları

XP aşağıdaki olaylardan gelmelidir. Her kaynak hem ilerlemeyi hızlandırır hem de oyuncuyu ana döngülere yönlendirir.

| Olay | XP mantığı | V1 durumu |
|------|------------|-----------|
| **Teslimat tamamlamak** | Mesafe + net kâr + risk bonusu | ✅ `calculateDeliveryXp()` |
| **Kârlı ticaret yapmak** | Kâr miktarına göre ölçeklenir | ✅ `calculateTradeSaleXp()` |
| **Yeni kamyon satın almak** | Sabit ödül: 30 XP | ✅ `xpRewards.truckPurchase` |
| **Şoför işe almak** | Sabit ödül: 10 XP | ✅ `xpRewards.driverHire` |
| **Yeni depo açmak** | Sabit ödül: 40 XP | ✅ `xpRewards.warehouseOpen` |
| **Depo yükseltmek** | Sabit ödül: 25 XP | ✅ `xpRewards.warehouseUpgrade` |
| **Büyük sözleşme tamamlamak** | Tonaj / kâr çarpanı ile ek bonus | V1'de teslimat XP'sine entegre |

### Teslimat XP formülü (referans)

```
baseXp = 25
distanceXp = distanceKm / 20
profitXp = max(0, netProfit) / 1000
riskBonus = high: 25 | medium: 10 | low: 0
totalXp = max(1, round(baseXp + distanceXp + profitXp + riskBonus))
```

### Ticaret XP formülü (referans)

```
tradeXp = max(1, round(10 + profit / 1500))   // yalnızca kârlı satışta
```

XP kaynakları **negatif olaylardan düşülmez** (başarısız teslimat, zararlı ticaret XP vermez ama ceza da uygulanmaz).

---

## 7. V1 Kuralı

V1 kapsamında **eklenmeyecek** sistemler:

- Backend / cloud save / sunucu senkronizasyonu
- IAP (uygulama içi satın alma)
- Reklam entegrasyonu
- Leaderboard / sıralama tablosu
- Multiplayer / rekabet modu
- Gerçek yurt dışı taşımacılık simülasyonu
- Tren / gemi / uçak lojistik simülasyonu
- Gümrük, liman deposu, hava terminali mekanikleri

V1'de **yalnızca** şunlar eklenecek / tamamlanacak:

1. Level sistemi altyapısı (XP, level up, progress bar)
2. V1 kilitleri (kamyon, şoför kalitesi, depo, sözleşme tonajı)
3. Kilitli / yakında UI önizlemeleri (Level 11–30)
4. Level up bildirimi ve debug test araçları

### İlgili dosyalar (referans)

| Dosya | Rol |
|-------|-----|
| `src/simulation/leveling.ts` | XP hesaplama, level up, kilit sorguları |
| `src/config/balance.ts` → `levelBalance` | Seviye dengesi, unlock eşikleri |
| `src/store/gameStore.ts` → `addCompanyXp` | XP uygulama ve kayıt |
| `src/types/game.ts` → `Player` | `level`, `xp`, `companyLevel` alanları |
| `src/screens/DashboardScreen.tsx` | Progress bar ve seviye özeti |

---

## Özet

| Aşama | Level | Durum |
|-------|-------|-------|
| Yerel başlangıç | 1–3 | V1 aktif |
| Türkiye içi büyüme | 4–6 | V1 aktif |
| Ulusal lojistik ağı | 7–10 | V1 aktif |
| Yurt dışı hazırlık | 11–15 | Kilitli / yakında |
| Tren lojistiği | 16–20 | Kilitli / yakında |
| Gemi lojistiği | 21–25 | Kilitli / yakında |
| Hava kargo & global | 26–30 | Kilitli / yakında |

Şirket seviyesi, LogistiCore'un uzun vadeli ilerleme omurgasıdır. V1 bu omurgayı **Level 1–10** arasında oynanabilir hale getirir; Level 11–30 ise oyuncuya gelecek içeriği göstererek retention sağlar.

# Logisticore - Game Design Document

## 1. Oyun Özeti

Logisticore, mobil odaklı bir lojistik şirketi yönetim ve ekonomi simülasyonu oyunudur.

Oyuncu kamyon sürmez. Oyuncunun görevi; şehirler arasındaki üretim, tüketim, stok ve fiyat değişimlerini analiz ederek en kârlı lojistik ağını kurmaktır.

Oyuncu başlangıçta 1 kamyon, 1 depo, 1 şoför ve 20.000$ sermaye ile başlar. Zamanla filosunu büyütür, yeni şoförler işe alır, depolar açar, farklı şehirlerde faaliyet gösterir ve piyasa fırsatlarını değerlendirerek şirketini büyütür.

Oyunun temel amacı sadece daha fazla kamyon almak değildir. Ana amaç, ekonomi verilerini doğru okuyarak doğru zamanda doğru yükü doğru şehre taşımaktır.

---

## 2. Ana Oyun Fikri

Oyunun temeli şu ekonomi döngüsüne dayanır:

Şehir üretir → şehir tüketir → stok değişir → fiyat değişir → nakliye ihtiyacı oluşur → sözleşme doğar → oyuncu taşır → şehir stokları güncellenir → piyasa yeniden hesaplanır.

Bu döngü elle yazılmış görevlerle değil, dinamik bir ekonomi algoritmasıyla çalışır.

Oyunda hiçbir sözleşme sabit olarak yazılmamalıdır. Sözleşmeler şehirlerin üretim fazlası, tüketim ihtiyacı, stok durumu, fiyat farkı, uzaklık, yakıt fiyatı ve teslim süresine göre otomatik oluşmalıdır.

---

## 3. Hedef Platform

İlk hedef platform:

- Mobil
- iOS
- Android

İlk sürüm dikey ekran mobil kullanımına uygun tasarlanacaktır.

İleri vadede tablet ve PC versiyonu düşünülebilir.

---

## 4. Hedef Oyuncu Kitlesi

Hedef oyuncular:

- Tycoon oyunlarını sevenler
- Ekonomi simülasyonu sevenler
- Lojistik / taşımacılık temalı oyunlardan hoşlananlar
- Strateji ve veri analizi sevenler
- Euro Truck Simulator evrenini seven ama araç sürmek yerine şirket yönetmek isteyen oyuncular
- OpenTTD, Capitalism Lab, Transport Tycoon, Industry Giant tarzı oyunları seven oyuncular

---

## 5. Ana Oynanış Döngüsü

Oyuncunun tekrar eden ana döngüsü:

1. Şehirlerdeki piyasa verilerini inceler.
2. Sözleşmeleri kontrol eder.
3. En kârlı veya stratejik sözleşmeyi seçer.
4. Uygun kamyonu ve şoförü görevlendirir.
5. Yakıt, süre, kapasite ve risk hesabı yapar.
6. Teslimat tamamlanır.
7. Gelir, gider ve kâr hesaplanır.
8. Şehir stokları ve fiyatlar güncellenir.
9. Oyuncu kazancıyla filo, depo, şoför veya araştırma yatırımı yapar.
10. Daha büyük ve karmaşık rotalara geçer.

---

## 6. Başlangıç Senaryosu

Oyuncu oyuna şu kaynaklarla başlar:

| Kaynak          |   Değer |
| --------------- | ------: |
| Para            | 20.000$ |
| Kamyon          |  1 adet |
| Şoför           |  1 adet |
| Depo            |  1 adet |
| Depo Kapasitesi | 100 ton |
| Başlangıç Şehri |   İzmir |
| Şirket Seviyesi |       1 |

Başlangıç şehirleri:

| Şehir    | Ana Üretimler                         | Ana Tüketimler         |
| -------- | ------------------------------------- | ---------------------- |
| İzmir    | Meyve, zeytin, tekstil                | Elektronik, makine     |
| İstanbul | Elektronik, tekstil, tüketim ürünleri | Gıda, çelik, yakıt     |
| Ankara   | Savunma, elektronik, makine           | Gıda, tekstil          |
| Bursa    | Otomotiv, tekstil, makine             | Çelik, elektronik      |
| Antalya  | Turizm, gıda tüketimi                 | İçecek, sebze, mobilya |

---

## 7. Şehir Sistemi

Her şehir kendi ekonomisine sahip olmalıdır.

Her şehirde şu veriler bulunur:

| Değişken              | Açıklama                |
| --------------------- | ----------------------- |
| population            | Şehir nüfusu            |
| industryLevel         | Sanayi seviyesi         |
| tourismLevel          | Turizm seviyesi         |
| agricultureLevel      | Tarım seviyesi          |
| demandMultiplier      | Genel tüketim katsayısı |
| productionMultiplier  | Genel üretim katsayısı  |
| fuelPriceModifier     | Yakıt fiyat etkisi      |
| trafficDifficulty     | Teslim süresi etkisi    |
| warehouseCostModifier | Depo kira etkisi        |

Örnek şehir veri modeli:

```js
const city = {
  id: "izmir",
  name: "İzmir",
  population: 4200000,
  industryLevel: 0.65,
  tourismLevel: 0.45,
  agricultureLevel: 0.8,
  productionMultiplier: 1.0,
  demandMultiplier: 1.0,
  fuelPriceModifier: 0.95,
  trafficDifficulty: 0.85,
  warehouseCostModifier: 1.0,
  products: {
    fruit: {
      stock: 500,
      productionPerDay: 120,
      consumptionPerDay: 40,
      basePrice: 900,
    },
    textile: {
      stock: 300,
      productionPerDay: 80,
      consumptionPerDay: 45,
      basePrice: 1400,
    },
  },
};
```

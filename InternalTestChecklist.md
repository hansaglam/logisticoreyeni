# LogistiCore — Internal Test Checklist

Internal test build doğrulama listesi. Her maddeyi manuel test edin ve sonucu işaretleyin.

## Oyun başlangıç ve kayıt

- [ ] **Yeni oyun açılışı** — Kayıt yokken uygulama açılır, "Oyun yükleniyor..." sonrası Dashboard gelir.
- [ ] **Auto save load testi** — Oyunu kapat/aç; kaldığın yerden devam etmeli (para, zaman, sözleşmeler).

## Sözleşme ve teslimat

- [ ] **Sözleşme üretme testi** — Debug veya piyasa yenileme ile yeni işler listelenir.
- [ ] **İş alma testi** — Boş kamyon + şoför ile sözleşme başlatılır, yakıt düşer.
- [ ] **Teslimat progress testi** — Harita/Filo’da aktif teslimat ilerlemesi görünür.
- [ ] **Teslimat tamamlama testi** — Teslimat bitince para/kazanç güncellenir, kamyon boşa döner.

## Ekonomi ve filo

- [ ] **Para/kâr güncelleme testi** — Finans ekranı nakit ve giderleri doğru gösterir.
- [ ] **Kamyon kondisyon düşme testi** — Teslimat sonrası kondisyon azalır.
- [ ] **Tamir testi** — Filo ekranından tamir yapılır, para düşer, kondisyon 100 olur.
- [ ] **Fleet status testi** — Boşta/yolda kamyon ve şoför sayıları doğru.

## Piyasa ve depo

- [ ] **Market fırsat testi** — Piyasa ekranı fırsat tarayıcı ve uyarıları gösterir.
- [ ] **Warehouse ekran testi** — Depo kapasitesi ve maliyet özeti açılır, crash olmaz.
- [ ] **Finance ekran testi** — Gelir/gider dökümü ve şirket değeri görünür.

## Platform

- [ ] **Android safe area testi** — Alt navigasyon çubuğu ile tab bar çakışmaz.
- [ ] **iOS safe area testi** — Home indicator ile içerik çakışmaz.

## Debug (geliştirici)

- [ ] More → Simülasyon Testi erişilebilir.
- [ ] +1 / +6 / +24 saat, sözleşme üret, ekonomi tick çalışır.
- [ ] Save Now / Clear Save / Reset Game test butonları çalışır.

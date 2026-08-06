# FIX: Kiralık Kamyon Süresi Dolunca Yaşam Döngüsü

**Tarih:** 2026-08-06  
**Kapsam:** Domain/store/UI — backend, Firestore rules değiştirilmedi.

---

## 1. Kök neden

Eski `processExpiredTruckLeases` yalnızca **boşta** kiralık kamyonları `leaseExpired: true` ile pasifleştiriyordu. Araç filoda kalıyor, sözleşme seçim listelerinde görünüyor ve oyuncu teslimat başlatırken geç "Kiralama süresi dolan kamyon yönlendirilemez." hatası alıyordu. Aktif teslimattaki araçlar hiç işlenmiyordu.

---

## 2. Kiralama lifecycle modeli

**Dosya:** `src/simulation/rentalTruckLifecycle.ts`

| Helper | Açıklama |
|--------|----------|
| `getRentalTruckStatus()` | Canonical durum: active, expiring-soon, expired-idle, return-pending, returned |
| `processExpiredRentalTrucks()` | Zaman/hydrate/offline tick'lerinde toplu işlem |
| `returnExpiredRentalTruck()` | Idempotent tek araç iadesi |
| `getVisibleFleetTrucks()` | Filo görünürlüğü |
| `getAssignableTrucks()` / `getContractEligibleTrucks()` / `getTransferEligibleTrucks()` | Seçim listeleri |

**Truck modeli:** `rentalLifecycle?: { expiryWarningSentAt, expiredNotificationSentAt, returnPendingSince, returnedAt }`

**Uyarı eşiği:** `src/config/rentalTruck.ts` → 24 oyun saati (168 saatlik kira süresinin ~%14'ü)

---

## 3. Boşta araç expiry davranışı

Süre dolduğunda (`expired-idle`):

- Kamyon **filodan tamamen çıkarılır** (pasif bayrak değil)
- Şoför ataması, transfer ve depo transferi referansları temizlenir
- Dorseler ayrılır
- Uygulama içi + (izin varsa) cihaz bildirimi: araç adıyla

Örnek: *"Fordan CargoPro aracının kiralama süresi sona erdi."*

---

## 4. Aktif teslimat expiry davranışı

Teslimat sırasında süre dolarsa:

- Araç **silinmez** → `return-pending` (`rentalLifecycle.returnPendingSince`)
- Teslimat normal tamamlanır (ödeme/XP tek sefer)
- Yeni işe atanamaz
- Filoda **"TESLİMAT SONRASI İADE"** badge'i
- Teslimat bitince otomatik iade + bildirim: *"...kiralama şirketine iade edildi ve filodan çıkarıldı."*

---

## 5. Filo ve selector temizliği

- `FleetScreen` → `getVisibleFleetTrucks()` ile render
- `assignmentOptions` → `lease_expired` issue + `currentTime` kontrolü
- Sözleşme sheet'leri süresi dolan seçimi otomatik temizler
- `startDelivery` / transfer → araç adıyla erken `LEASE_EXPIRED` mesajı (son aşama generic hata yerine)

---

## 6. Offline / hydrate davranışı

`processExpiredLeases` çağrı noktaları:

- Oyun zamanı ilerlemesi (`advanceGameTime`)
- Teslimat tamamlanınca
- Save hydrate sonrası (`hydrate-rental-expiry`)
- Debug expire lease

Processor idempotent — aynı expiry tekrar bildirim üretmez (`rentalLifecycle` + stable notification id).

---

## 7. Uygulama içi bildirimler

| Tür | Başlık örneği |
|-----|---------------|
| `rental-expiring-soon` | Kiralama süresi yaklaşıyor |
| `rental-expired` | Kiralık araç filodan çıkarıldı |
| `rental-return-pending` | Kiralama süresi sona erdi |
| `rental-returned` | Araç iade edildi |

Tüm metinlerde **gerçek kamyon adı** kullanılır. `actionTarget: 'fleet'`.

---

## 8. Android cihaz bildirimi

- Kanal: `fleet-updates` ("Filo Güncellemeleri")
- `sendFleetRentalLocalNotification()` — izin yoksa sessizce atlanır
- Stable `identifier` ile duplicate önlenir

---

## 9. iOS cihaz bildirimi

- Aynı `expo-notifications` helper (platform-specific adapter yok)
- İzin reddedilmişse yalnız in-app bildirim
- Bildirime basınca `App.tsx` → Filo sekmesi (truck detail'e gitmez)

---

## 10. Save migration

- `rentalLifecycle` alanı opsiyonel — eski save'ler migrate gerektirmez
- Hydrate sırasında `processExpiredLeases('hydrate-rental-expiry')` geçmişte sona ermiş boşta araçları temizler
- Aktif teslimattaki süresi dolmuş araç → return-pending
- Delivery history kayıtları korunur

---

## 11. Edge-case sonuçları

| Durum | Davranış |
|-------|----------|
| Expiry + teslimat başlat aynı anda | `isTruckEligibleForNewAssignment` erken reddeder |
| Expiry + delivery completion aynı tick | Önce teslimat, sonra processor iade eder |
| Offline expiry | `advanceGameTime` → processor |
| return-pending + idle | Sonraki processor çağrısında iade |
| Duplicate processor | Idempotent, bildirim tekrarlanmaz |
| İzin reddedilmiş cihaz | In-app bildirim çalışır |

---

## 12. Değişen dosyalar

| Dosya | Değişiklik |
|-------|-----------|
| `src/simulation/rentalTruckLifecycle.ts` | **Yeni** — canonical lifecycle |
| `src/config/rentalTruck.ts` | **Yeni** — uyarı eşiği |
| `src/types/game.ts` | `RentalTruckLifecycle`, tipler |
| `src/store/gameStore.ts` | `processExpiredLeases` rewrite, hydrate, delivery guards |
| `src/simulation/dailyOperatingCosts.ts` | Eski processor kaldırıldı, re-export |
| `src/simulation/delivery.ts` | Assignment eligibility |
| `src/utils/assignmentOptions.ts` | `lease_expired` issue |
| `src/screens/FleetScreen.tsx` | `getVisibleFleetTrucks` |
| `src/components/fleet/OwnedTruckCard.tsx` | Return-pending badge |
| `src/components/contracts/*` | currentTime + seçim temizliği |
| `src/services/notifications.ts` | fleet-updates kanalı |
| `App.tsx` | Bildirim tap → Filo |
| `scripts/rental-truck-expiry-regression-test.ts` | **Yeni** |

---

## 13. Test sonuçları

| Komut | Sonuç |
|-------|-------|
| `npm run typecheck` | ✅ PASS |
| `npm run verify` | ✅ PASS |
| `npx tsx scripts/rental-truck-expiry-regression-test.ts` | ✅ 31/31 PASS |
| `npx expo export --platform android` | ✅ PASS |
| `npx expo export --platform ios` | ✅ PASS |
| `git diff --check` | ✅ PASS (whitespace düzeltildi) |

---

## 14. Android/iOS manuel test gereksinimi

1. Kısa süreli kiralık kamyon oluştur (`debugExpireLeaseTruck` veya zaman ilerlet)
2. Boşta expiry → filodan kaybolma + bildirimde araç adı
3. Sözleşme seçiminde görünmeme
4. Teslimat sırasında expiry → "TESLİMAT SONRASI İADE" badge
5. Teslimat tamamlanınca otomatik iade
6. Arka planda expiry → cihaz bildirimi (izin verilmişse)
7. Bildirime bas → Filo ekranı
8. Uygulama kapat/aç → duplicate bildirim yok

---

## Kabul kriterleri

| Kriter | Durum |
|--------|-------|
| Süresi dolan boşta kamyon filoda görünmez | ✅ |
| Süresi dolmuş araç yeni işe atanamaz | ✅ |
| Aktif teslimattaki araç ortada silinmez | ✅ |
| Teslimat sonrası otomatik iade | ✅ |
| Bildirimde gerçek araç adı | ✅ |
| Duplicate bildirim yok | ✅ |
| Offline/save/load korunur | ✅ |
| Android/iOS aynı iş mantığı | ✅ |

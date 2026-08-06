# Test Results

Denetim tarihi: 2026-08-05

## Zorunlu komutlar

| Komut | Sonuç | Kanıt/not |
|---|---|---|
| `npm run typecheck` | PASS | TypeScript error 0 |
| `npm run verify` | PASS | Typecheck + require-cycle kontrolleri geçti. İlk sandbox çalışması EPERM verdi; sandbox dışı aynı komut geçti. |
| `npm run backend:verify` | PASS | Backend typecheck/build, consistency, emulator, cloud save audit geçti |
| `npm run validate:production-build` | PASS | 0 failed; project/package/region/signing/SHA kontrolleri geçti |
| `npm run production:backend-check` | PASS | 8 deployed function, missing/wrong region 0, stale false, 6 composite index |
| `npx expo config --type public` | PASS-with-findings | Package/bundle/project doğru; test ads ve diagnostics açık |
| `npx expo config --type introspect` | PASS-with-findings | Apple Sign-In entitlement var; APNs development, ATS arbitrary loads, default iOS build 1 |
| `npx expo export --platform android` | PASS | 1770 module, Hermes bundle 7.43 MB |
| `npx expo export --platform ios` | PASS | 1768 module, Hermes bundle 7.42 MB |
| `npx expo-doctor` | FAIL | 14/17; Expo patch, app config heuristic, non-CNG native sync uyarıları |

## Backend emulator ve production

- Firestore emulator: **40 pass / 0 fail**.
- Global economy production health:
  - project: `logisticore-53ab4`
  - snapshot stale: false
  - expected history: 56
  - actual history: 56
  - fuel price finite: 1.64 (audit anı)
- Production backend:
  - deployed function: 8
  - missing: 0
  - wrong region: 0
  - marketplace callable active: true
  - cleanup worker active: true
  - missing index group: 0
- Auth provider console configuration CLI tarafından okunamadı; gerçek cihaz doğrulaması gerekiyor.

## Mevcut regression/smoke scriptleri

Toplam çalıştırılan TypeScript test/smoke scripti: **62**  
Sonuç: **56 PASS / 6 FAIL**

### PASS — 56

- ads-config-test.ts
- auth-production-audit-test.ts
- backend-function-consistency-test.ts
- cargo-capacity-smoke-test.ts
- cash-flow-audit-test.ts
- city-expansion-smoke-test.ts
- cloud-save-conflict-test.ts
- cloud-save-production-audit-test.ts
- cloud-save-size-test.ts
- contract-availability-smoke-test.ts
- contract-generation-diversity-test.ts
- contract-generation-health-test.ts
- contract-truck-eligibility-test.ts
- core-game-production-readiness-test.ts
- delivery-completion-city-test.ts
- delivery-completion-location-test.ts
- delivery-incidents-smoke-test.ts
- delivery-start-capacity-test.ts
- economy-health-test.ts
- economy-retention-30day-test.ts
- fleet-economy-balance-test.ts
- fuel-price-quote-test.ts
- global-economy-client-regression-test.ts
- global-economy-clock-test.ts
- global-economy-production-health-test.ts
- global-market-snapshot-test.ts
- leaderboard-client-config-test.ts
- map-coordinate-roundtrip-test.ts
- map-road-network-test.ts
- map-route-coverage-test.ts
- map-truck-position-test.ts
- market-screen-consistency-test.ts
- monetization-smoke-test.ts
- offline-delivery-progress-regression-test.ts
- offline-economy-test.ts
- offline-progression-smoke-test.ts
- onboarding-smoke-test.ts
- online-global-market-test.ts
- random-events-regression-test.ts
- release-regression-contract-transfer-navigation-test.ts
- retention-manual-test.ts
- roadside-fuel-test.ts
- smart-game-tips-test.ts
- tab-navigation-performance-regression-test.ts
- test-globals.ts
- trailer-system-smoke-test.ts
- truck-fuel-system-test.ts
- truck-out-of-fuel-test.ts
- truck-refuel-domain-test.ts
- truck-refuel-render-loop-test.ts
- truck-route-heading-test.ts
- username-validation-test.ts
- vehicle-speed-eta-balance-test.ts
- warehouse-stock-transfer-test.ts
- warehouse-system-test.ts
- world-events-smoke-test.ts

### FAIL — 6

1. `account-switch-flow-test.ts`
   - Beklenen eski metin: `Google Hesabından Çıkış Yap`.
   - Güncel UI/provider-neutral metinle static assertion uyuşmuyor.
   - Test stale; ayrıca bağımsız kod incelemesi gerçek rollback blocker'ı B-002'yi buldu.

2. `debug-contract-generation-test.ts`
   - 6 failure: Ankara–Trabzon ve Adana–Diyarbakır rotalarının uncalibrated/empty/unreachable olması bekleniyor.
   - Güncel catalog bu rotaları calibrated/routable yaptığı için fixture stale.

3. `phase3-smoke-test.ts`
   - 111 pass / 1 fail.
   - Eski `More` ekranında “Geliştirmeler” modülü bekliyor; güncel erişim Fleet üzerinden.

4. `time-progression-audit-test.ts`
   - 32 pass / 2 fail.
   - Eski minimum offline threshold nedeniyle 1 dakikanın progress üretmemesini bekliyor; güncel gerçek-zaman modeli 1 dakikayı işler.

5. `vehicle-marketplace-create-chain-test.ts`
   - Google-spesifik auth mesajı bekliyor; güncel provider-neutral “hesabını bağla” metniyle uyuşmuyor.

6. `vehicle-marketplace-ui-test.ts`
   - `tsx/esbuild`, React Native `index.js` içindeki Flow `typeof` sözdizimini parse edemiyor.
   - Uygulama runtime hatası değil; test runner/harness uyumsuzluğu.

## Önemli domain metrikleri

### Core readiness

- 80 pass / 0 fail.
- New player playable: true.
- Contract viability: %100.
- Profitable contracts: %99.2.
- Median profit margin: %35.
- Cash/ledger mismatch: 0.
- Duplicate settlement: 0.
- Negative fuel: 0.
- Buy/sell exploit: 0.
- Stuck job: 0.
- Save payload: 14,641 byte.
- NaN/Infinity: 0/0.

### Contract health

| Seviye | Generated | Profitable | Median payment | Median cost | Median margin |
|---|---:|---:|---:|---:|---:|
| L1 | 144 | 144 | $2,099 | $1,331 | %35.8 |
| L5 | 144 | 144 | $3,067 | $1,798 | %41.8 |
| L11 | 144 | 144 | $5,245 | $3,130 | %41.6 |

Impossible capacity, route not found, invalid ve viability reject sayıları üç seviyede de 0.

### Cash flow

| Profil | Income | Expense | Net cash | Ledger mismatch | Minimum cash |
|---|---:|---:|---:|---:|---:|
| L1 | $46,050 | $7,907 | $58,143 | 0 | $20,000 |
| L5 | $77,450 | $10,765 | $156,685 | 0 | $90,000 |
| L11 | $124,550 | $15,210 | $409,340 | 0 | $300,000 |

### Offline/fuel

- `%34 -> 10 dk offline` ilerledi.
- Yeterli sürede completion, ikinci hydrate'da duplicate yok.
- Yakıt yolda biterse partial progress ve pause doğru.
- Truck/warehouse transfer offline completion doğru.
- Yakıt testleri: 40 pass / 0 fail.

### Long simulation

- 7 ve 30 günlük headless test geçti.
- 30. gün cash: yaklaşık $23,208.97.
- Completed deliveries: 31.
- Negative cash day: 0.
- Duplicate/NaN/stuck invariant ihlali bulunmadı.

## Android release artifact

- Mevcut AAB: `android/app/build/outputs/bundle/release/app-release.aab`
- Boyut: 78,389,751 byte.
- Sürüm: 1.0.10 / versionCode 11.
- Önceki aynı çalışma oturumunda `bundleRelease` başarılı olmuştur.
- Final merged manifest restricted permission ve default branding bulguları nedeniyle bu AAB mağazaya gönderilmemelidir.

## Çalıştırılamayan/kanıtlanmayan

- Signed iOS archive/IPA: Windows ortamı ve repo içinde iOS native/EAS profile yok.
- `npx expo run:ios`: çalıştırılmadı; macOS/Xcode gerekir.
- Gerçek cihaz Google/Apple login, rewarded ad, push, 30 dk profiling.
- Destructive production marketplace/account-deletion canary: bu audit read-only tutulduğu için çalıştırılmadı.

## Sonuç

Test kapsamı güçlü olsa da güvenlik/data isolation ve store-policy blocker'ları vardır.

**RELEASE BLOCKED**

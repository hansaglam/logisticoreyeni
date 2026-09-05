# LogistiCore V1.1 Feature Phase 1C — Internal Seasons / Challenges UI

## Sonuç

`V1_1_FEATURE_PHASE_1C_CODE_VERIFIED_INTERNAL_DEVICE_PENDING`

Phase 1B'de doğrulanan server-authoritative seasons/challenges altyapısı için ilk internal mobil UI tamamlandı. Production feature flag'leri kapalı kaldı; backend, rules, save/cloud schema, auth ve navigation tab yapısı değiştirilmedi.

## Navigation entry

- Canonical giriş: `Şirket (More) → Sezonlar ve Görevler`.
- Yeni bottom tab veya public route eklenmedi.
- Giriş ve embedded screen route'u birlikte `SEASONS_ENABLED && CHALLENGES_ENABLED` ile korunuyor.
- Leaderboard açıksa ekrandaki kompakt CTA mevcut Leaderboard ekranını açıyor; ikinci bir sıralama sistemi oluşturulmuyor.

## Screen architecture

- `SeasonsChallengesScreen`: auth, canonical fetch, refresh, period rollover ve claim orchestration.
- `ChallengeCard`: yalnız presentational title/description/progress/reward/status/claim UI.
- `claimFlow`: claim eligibility, stable retry envelope, friendly errors, timeout ve rollover saf yardımcıları.
- `claimReconciliation`: mevcut marketplace reconciliation action'ı üzerinden authoritative cash uygulaması.

Ekran bölümleri:

1. Season header: sezon adı, reset countdown ve ayrı sezon puanı.
2. Daily challenges.
3. Weekly challenges.
4. Opsiyonel mevcut leaderboard girişi.
5. Yalnız internal build'de kompakt diagnostics.

Disabled/deferred katalog girdileri istemci görünümünden ayrıca filtreleniyor; backend response yine canonical kaynaktır.

## Data flow

```text
screen focus/mount
→ linked auth doğrulaması
→ getCurrentSeason callable
→ getChallengeProgress callable
→ users/{uid}/seasonProgress/{seasonKey} owner-read
→ presentational state
```

- Challenge progress local gameStore'dan türetilmiyor.
- Season points para, reputation, level veya leaderboard score ile birleştirilmiyor.
- Ekranda broad Zustand subscription yok.
- Root/global tick subscription yok.

## Claim flow

Claim yalnız şu koşullarda açılır:

- challenge completed,
- not claimed,
- iki feature flag açık,
- linked (non-anonymous) Firebase account,
- başka claim veya canonical refresh beklemiyor.

Akış:

1. Challenge+period için transaction/idempotency UUID'leri bir kez oluşturulur.
2. Duplicate tap ref tabanlı senkron guard ile engellenir.
3. `claimChallengeReward` callable çağrılır.
4. Timeout/network belirsizliğinde aynı request envelope saklanır ve retry aynı key'i kullanır.
5. Success receipt alındıktan sonra cash ve season points ayrı canonical kaynaklardan reconcile edilir.
6. Challenge progress yeniden çağrılır ve claimed state server'dan render edilir.

`already-claimed` korkutucu hata değildir: marketplace cash reconciliation ve progress refresh çalışır, UI canonical claimed state'e döner.

## Cash reconciliation

- `player.money` UI içinde doğrudan değiştirilmez.
- Claim success sonrası `getMyVehicleListings()` authoritative reconciliation payload'ı alınır.
- Mevcut `applyVehicleMarketplaceReconciliation()` action'ı cash ve fleet'i atomik uygular.
- Uygulanan local cash, backend receipt'teki `cashAfter` ile cent hassasiyetinde doğrulanır.
- Reconciliation başarısızsa success gösterilmez; aynı idempotent claim attempt retry için korunur.

## Season-points reconciliation

- Points canonical path: `users/{uid}/seasonProgress/{seasonKey}`.
- Rules yalnız owner read'e izin verir; client write hâlâ kapalıdır.
- Claim success sonrası okunan points değeri backend receipt'teki `seasonPointsAfter` ile eşleşmeden success tamamlanmaz.
- Ekran ilk açılışta points belgesi yoksa 0, erişilemezse `—` gösterir; uydurma puan üretmez.

## Guest behavior

- Anonymous/missing auth hiçbir challenge mutation çağrısı yapmaz.
- Ekran bağlı hesap gereksinimini kullanıcı dostu metinle gösterir.
- CTA mevcut Account Center'a yönlendirir.
- Raw backend reason/UID/token kullanıcıya gösterilmez.

## Refresh and rollover

- Mount, successful claim ve aktif ekran foreground dönüşünde refresh.
- Polling yok.
- Yalnız countdown için screen-local 60 saniyelik timer vardır; unmount'ta temizlenir.
- Daily/weekly `endsAt` geçilirse bir önceki period için yalnız bir rollover refresh yapılır.
- Rollover sırasında eski claim envelope ve pending state temizlenir.
- Device clock yalnız reset display/rollover probe içindir; period key ve claim geçerliliği backend tarafından belirlenir.

## Feature flags

| Profile | Seasons | Challenges |
|---|---:|---:|
| Local/internal `.env.internal` | `true` | `true` |
| Store production `.env.production` | `false` | `false` |

Expo public config ile doğrulandı:

- internal: `buildProfile=internal`, seasons=`true`, challenges=`true`
- production: `buildProfile=production`, seasons=`false`, challenges=`false`

Store production validator her iki flag'in yanlışlıkla `true` olmasını reddediyor. `.env.internal` ve `.env.production` gitignored profile dosyalarıdır; remote CI/EAS internal build kullanılırsa aynı iki değer build environment'a açıkça verilmelidir.

## Files changed

- `.env.internal` (local, gitignored internal profile override)
- `src/screens/MoreScreen.tsx`
- `src/features/seasons/SeasonsChallengesScreen.tsx`
- `src/features/seasons/types.ts`
- `src/features/challenges/ChallengeCard.tsx`
- `src/features/challenges/claimFlow.ts`
- `src/features/challenges/claimReconciliation.ts`
- `src/services/challengeService.ts`
- `src/config/storeProductionPolicy.ts`
- `scripts/seasons-challenges-ui-regression-test.ts`
- `docs/release-audit/V1_1_FEATURE_PHASE_1C_INTERNAL_CHALLENGES_UI.md`

## Test results

| Validation | Result |
|---|---|
| `npx tsc --noEmit` | PASS |
| `npm run validate:store-production` | PASS |
| Backend typecheck/build/function consistency/cycle checks | PASS |
| Backend Firestore emulator suites | PASS — 69 tests |
| Cloud save conflict + production audit | PASS |
| `seasons-challenges-ui-regression-test.ts` | PASS — 32 |
| `seasons-challenges-foundation-test.ts` | PASS — 26 |
| Leaderboard regression/eligibility/cross-platform | PASS |
| Cash-flow audit | PASS — 42 |
| Marketplace transaction integrity | PASS — 25 |
| Marketplace startup reconcile | PASS — 39 |
| Account sign-out/deletion | PASS — 41 |
| App Store privacy/account | PASS — 18 |
| Offline delivery regression | PASS — 67 |
| Offline progression smoke | PASS — 71 |
| Tab navigation performance regression | PASS — 29 |
| `git diff --check` | PASS (line-ending notices only) |

`npm run backend:verify` ilk çalışmada bu repo dışındaki çalışan bir Firestore Emulator'ın 8080 portunu kullanması nedeniyle wrapper seviyesinde durdu. Aynı backend build/typecheck/consistency/cycle adımları geçti; Firestore suite ayrı ve izole 8180 emulator üzerinde 69/69 geçti; ardından iki cloud-save suite de geçti. Ürün/backend regresyonu bulunmadı.

## Performance impact

- More root'a game tick subscription eklenmedi.
- Screen yalnız açık route iken mount olur.
- Challenge cards memoized ve plain props alır.
- Network request dedupe ref ile sağlandı.
- Claim/refresh aynı anda çalışmaz.
- AppState ve countdown listener'larının cleanup'ı component içinde colocated.
- Analytics için canonical service bulunmadığından yeni dependency veya paralel analytics katmanı eklenmedi.

## Internal device verification checklist

1. Internal config'i doğrula:
   `LOGISTICORE_BUILD_PROFILE=internal npx expo config --type public`
2. Cache temizleyerek native internal build başlat:
   `LOGISTICORE_BUILD_PROFILE=internal npx expo run:android`
3. macOS/iOS için:
   `LOGISTICORE_BUILD_PROFILE=internal npx expo run:ios`
4. Guest hesabında entry ve Account Center CTA'yı doğrula.
5. Linked test hesabında daily/weekly listeleri ve season points'i doğrula.
6. Marketplace purchase/sale ile gerçek challenge tamamla.
7. Claim'e hızlı çift dokun; tek reward oluştuğunu doğrula.
8. Claim sırasında ağı kesip geri aç; retry'nin duplicate reward üretmediğini doğrula.
9. Background/foreground sonrası progress'in yenilendiğini doğrula.
10. 360–430 px cihazlarda uzun Türkçe metin, scroll sonu ve safe area'yı doğrula.
11. Production profile config'te entry'nin tamamen kaybolduğunu doğrula.

## Remaining risks

- Gerçek cihazda native layout/touch ve callable timeout UX henüz manuel doğrulanmadı.
- Gerçek UTC daily/weekly rollover'ın ekran açıkken davranışı internal cihazda beklenerek doğrulanmalı.
- Remote internal build sistemi gitignored `.env.internal` dosyasını almayacağı için flag'ler build environment'a ayrıca tanımlanmalı.
- Analytics canonical servisi olmadığı için Phase 1C event telemetry deferred bırakıldı.

## Final status

V1_1_FEATURE_PHASE_1C_CODE_VERIFIED_INTERNAL_DEVICE_PENDING

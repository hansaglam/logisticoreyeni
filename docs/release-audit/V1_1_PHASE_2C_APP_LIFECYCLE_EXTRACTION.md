# LogistiCore V1.1 Phase 2C — App Lifecycle Orchestration Extraction

## Sonuç

`App.tsx` composition root olarak korundu. Yerel-first boot, native uygulama lifecycle'ı, foreground/background işlemleri ve post-startup görevleri dört odaklı hook'a ayrıldı. Oyun dengesi, save/cloud şeması, backend, auth/account deletion davranışı, navigasyon ve UI değiştirilmedi.

Phase 2C.1 triage ile sekiz eski assertion'ın Phase 2C kaynaklı olmadığı kanıtlandı ve testler canonical davranışları doğrulayacak şekilde güncellendi. Kod/regression doğrulaması tamamlandı. Windows ortamında signed iOS archive üretilemediği için yalnız `IOS_ARCHIVE_PREFLIGHT_PENDING` kalıyor.

## Orijinal App.tsx sorumlulukları

- Firebase/Auth başlangıcını paralel başlatma
- Google Sign-In konfigürasyonu ve Firebase runtime tanılama
- local save recovery probe ve recovery ekranı
- game store hydration/initializeGame
- Android immersive mode kurulumu ve refresh subscription
- notification handler ve notification response navigation routing
- AppState foreground/background yönetimi
- foreground offline progression, market refresh, leaderboard ve marketplace reconciliation
- background timestamp ve lifecycle save flush
- privacy/UMP tabanlı reklam başlangıcı
- map asset preload
- startup marketplace reconciliation ve cloud sync başlangıcı
- internal test money auth/Firestore listener lifecycle'ı
- AppShell, tab navigasyonu, game loop ve global modal composition'ı

AppShell'e ait navigation/render sorumlulukları App.tsx içinde bırakıldı. Lifecycle extraction, UI screen veya navigation route sahipliğini değiştirmedi.

## Çıkarılan lifecycle sınırları

### `useAppBootstrap`

- Local-first save recovery probe
- Paralel anonymous/Firebase Auth bootstrap
- Recovery sonrası yeniden probe
- `initializeGame` ve boot phase yönetimi
- Production/Firebase başlangıç tanılaması

### `useNativeAppLifecycle`

- Android immersive mode subscription
- Notification handler kurulumu
- Notification response → canonical navigation/store routing
- Subscription cleanup

### `useAppStateLifecycle`

- Tek root AppState transition listener'ı
- Foreground offline progression
- Market/leaderboard/marketplace foreground işleri
- Cloud save foreground retry
- Inactive/background timestamp checkpoint
- Background lifecycle save
- Pending InteractionManager save task dedupe ve cleanup

### `usePostStartupLifecycle`

- Ready sonrasında UMP/privacy-first ads bootstrap
- Ready sonrasında map preload
- Marketplace startup reconciliation
- Reconciliation sonrasında cloud sync başlangıcı
- Internal test money listener başlangıcı ve cleanup

## Initialization sırası

1. `APP_START` ve build fingerprint instrumentation composition root'ta çalışır.
2. Cold-start recovery probe local persistence üzerinde çalışır.
3. Auth bootstrap ağ bağımlılığı olarak paralel başlar; ilk yerel render'ı bloklamaz.
4. Recovery sonucu güvenliyse `initializeGame` hydration çalışır.
5. `bootPhase=ready` ve `isGameReady=true` sonrasında AppShell görünür.
6. Ads bootstrap interaction sonrasına ertelenir; mevcut servis içindeki UMP → Mobile Ads → rewarded preload sırası korunur.
7. Map preload ve marketplace startup reconciliation yalnız ready sonrasında başlar.
8. Cloud sync, marketplace reconciliation tamamlandıktan sonra başlar.
9. Foreground offline progression yalnız `isGameReady` olduğunda uygulanır.

Bağımlı production sırası değişmedi. Bağımsız native listener effect'leri artık kendi hook'larında kayıtlıdır.

## Listener sahipliği

| Lifecycle kaynağı | Önceki sahip | Yeni sahip | Cleanup / tekillik |
|---|---|---|---|
| Root AppState foreground/background | `App.tsx` | `useAppStateLifecycle` | `subscription.remove()` |
| Cloud save foreground retry AppState | `cloudSaveSync.ts` ayrı listener | Root AppState akışına konsolide | İkinci listener kaldırıldı |
| Android immersive AppState refresh | `App.tsx` → `systemBars` | `useNativeAppLifecycle` → `systemBars` | subscription ve pending timeout temizlenir |
| Notification response | `App.tsx` | `useNativeAppLifecycle` | `notificationSub.remove()` |
| Game loop interval | `useGameLoop` | Değişmedi | `clearInterval` |
| Canonical auth listener | `authService` singleton hub | Değişmedi | Service-owned singleton |
| Internal test-money auth listener | `testMoneySyncService` | Başlatma sahipliği `usePostStartupLifecycle` | hook cleanup → `stopTestMoneySync` |
| Internal test-money Firestore snapshot | `testMoneySyncService` | Değişmedi | UID değişimi/stop sırasında unsubscribe |

App-global registration noktası sayısı 8'den 7'ye düştü. Runtime listener davranışı korunurken cloud retry için ikinci AppState listener kaldırıldı.

## Offline ve product invariant'ları

- Offline fixed operating costs: `0`
- Active delivery offline threshold: `15_000 ms`
- Normal idle offline threshold: `300_000 ms`
- Foreground catch-up: tek root AppState transition üzerinden
- Background timestamp: `inactive` ve `background` için korunuyor
- Lifecycle save: yalnız gerçek `background` durumunda flush ediliyor
- Aynı pending background save task'ı yeniden kayıt öncesinde iptal ediliyor

## Önce / sonra metrikleri

| Metrik | Önce | Sonra |
|---|---:|---:|
| `App.tsx` LOC | 733 | 442 |
| `App.tsx` içindeki `useEffect` | 8 | 4 |
| `App.tsx` içindeki `useLayoutEffect` | 2 | 2 |
| Root `App()` içindeki doğrudan lifecycle effect | 4 | 0 |
| App-global registration noktası | 8 | 7 |

Kalan dört `useEffect`, AppShell navigation/render performansı ve ziyaret edilen tab state'i içindir. Root store aboneliği yalnız `isGameReady` primitive selector'ıdır; tick bazlı geniş Zustand aboneliği eklenmedi.

## Değişen dosyalar

Production/runtime:

- `App.tsx`
- `src/hooks/useAppBootstrap.ts`
- `src/hooks/useAppStateLifecycle.ts`
- `src/hooks/useNativeAppLifecycle.ts`
- `src/hooks/usePostStartupLifecycle.ts`
- `src/storage/cloudSaveSync.ts`
- `src/utils/systemBars.ts`

Test harness / regression ownership güncellemeleri:

- `scripts/app-lifecycle-extraction-regression-test.ts`
- `scripts/validate-store-production-config.ts`
- `scripts/validate-production-build-config.ts`
- `scripts/app-store-privacy-account-regression-test.ts`
- `scripts/apple-cloud-save-link-regression-test.ts`
- `scripts/cold-start-performance-test.ts`
- `scripts/market-live-cache-regression-test.ts`
- `scripts/offline-delivery-progress-regression-test.ts`
- `scripts/offline-progression-smoke-test.ts`
- `scripts/os-notifications-test.ts`
- `scripts/performance-regression-test.ts`
- `scripts/release-blocker-startup-test.ts`
- `scripts/rental-truck-expiry-regression-test.ts`
- `scripts/tab-navigation-performance-regression-test.ts`
- `scripts/vehicle-marketplace-startup-reconcile-test.ts`
- `scripts/verify-ios-firebase-runtime-config.ts`

Test güncellemeleri assertion'ları kaldırmadı; implementation'ın artık App.tsx yerine ilgili lifecycle hook'unda bulunduğunu doğruluyor.

## Test sonuçları

Geçen:

- `npx tsc --noEmit`
- `npm run validate:store-production`
- `npm run backend:verify` — backend typecheck/build, 65 emulator testi, cloud conflict ve production cloud audit geçti
- `npx tsx scripts/app-lifecycle-extraction-regression-test.ts`
- `offline-delivery-progress-regression-test.ts` — 67/67
- `offline-progression-smoke-test.ts` — 71/71
- `time-progression-audit-test.ts` — 51/51
- `account-switch-flow-test.ts`
- `account-signout-deletion-regression-test.ts` — 41/41
- `app-store-privacy-account-regression-test.ts` — 18/18
- `ad-privacy-regression-test.ts` — 44/44
- `vehicle-marketplace-startup-reconcile-test.ts` — 39/39
- marketplace UI/domain regression testleri
- contract generation reliability ve scheduler performance testleri
- offline delivery settlement — 65/65
- `git diff --check`

Başarısız / tamamlanamayan:

- `npm run verify`: yalnız `verify-ios-apple-auth-config.ts` signed `LogistiCore.app` bulamadığı için durur. Bu bir Windows code regression sonucu değil, `IOS_ARCHIVE_PREFLIGHT_PENDING` durumudur.

Phase 2C.1 sonrası ayrıca geçen:

- `apple-cloud-save-link-regression-test.ts` — 40/40
- `offline-operating-cost-disabled-regression-test.ts` — 17/17

## Runtime davranış değişikliği

Gameplay/product davranış değişikliği: **YOK**.

Yalnız lifecycle güvenliği iyileştirmeleri:

- Cloud save foreground retry ayrı, cleanup'sız AppState listener yerine canonical root AppState transition'ına bağlandı.
- Pending background InteractionManager save işi duplicate registration ve unmount sırasında iptal ediliyor.
- Android immersive refresh timeout'u subscription cleanup sırasında temizleniyor.

Save formatı, cloud schema, auth/account deletion, backend, marketplace canonical state, contract economics, balance, map ve navigation davranışı değiştirilmedi. ATT/IDFA entegrasyonu eklenmedi.

## Kalan lifecycle riskleri

- Signed iOS archive ve gerçek cihaz lifecycle davranışı bu Windows ortamında doğrulanamadı.
- `cloudSaveSync` retry timer service-lifetime state olarak kalıyor; account deletion/reset yolları temizliyor. Bu fazda retry politikasını değiştirmemek için yeniden tasarlanmadı.

## Sonraki faz önerileri

1. macOS üzerinde signed iOS archive üretip `IOS_ARCHIVE_APP_PATH` ile Apple auth config testini çalıştır.
2. Android/iOS cihazda 10 background/foreground çevrimiyle listener ve offline duplicate ölçümü yap.

V1_1_PHASE_2C_CODE_VERIFIED_IOS_ARCHIVE_PENDING

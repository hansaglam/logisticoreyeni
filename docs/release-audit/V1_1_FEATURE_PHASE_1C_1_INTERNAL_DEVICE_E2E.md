# LogistiCore V1.1 Feature Phase 1C.1 — Internal Device E2E

Tarih: 2026-09-02
Kapsam: Seasons / Challenges internal mobile client doğrulaması
Kaynak değişikliği: Yok (bu aşamada yalnız build, cihaz/emülatör kontrolü ve raporlama yapıldı)

## Sonuç özeti

Android internal release APK native Android emülatöründe üretildi, kuruldu ve misafir akışı doğrulandı. Internal profile Seasons/Challenges bayraklarını açık; production profile aynı bayrakları kapalı üretmektedir. Misafir ekranı doğru kısıtlı durumu gösterdi, Account Center aksiyonu çalıştı, challenge mutation isteği üretmedi ve yaklaşık 360 dp genişlikte taşmadı. Beş background/foreground çevriminde crash veya render-loop görülmedi.

Tam E2E kabulü tamamlanamadı. Bu Windows ortamında gerçek iPhone/Xcode yoktur ve disposable linked production test hesabı/credential sağlanmamıştır. Dolayısıyla gerçek linked kullanıcı verisi, gerçek marketplace ilerlemesi, claim, double-tap, ağ kesintisi/retry ve client tarafı canonical cash/season-points reconciliation kanıtlanamamıştır. Phase 1C.2 sırasında production Cloud Logging erişimi `gcloud logging read` ile sağlanıp üç callable incelenmiştir; buna rağmen cihaz E2E boşlukları tahminle başarılı sayılmamıştır.

## Build ve feature flag doğrulaması

| Profil | LOGISTICORE_BUILD_PROFILE | Seasons | Challenges | Sonuç |
|---|---:|---:|---:|---|
| Internal | `internal` | `true` | `true` | PASS — Expo public config ve kurulu internal APK içindeki görünür giriş ile doğrulandı |
| Production | `production` | `false` | `false` | PASS (config/source guard) — production public config kapalı; store policy testi geçiyor |

- Android kimliği: `com.ethemsincar.logisticore`
- Kurulu artifact: versionName `1.0.32`, versionCode `33`
- Artifact: `android/app/build/outputs/apk/release/app-release.apk`
- Build komutu: `LOGISTICORE_BUILD_PROFILE=internal npx expo run:android --variant release --device Pixel_6 --no-bundler`
- Gradle sonucu: `BUILD SUCCESSFUL`
- Emülatörde önceki farklı imzalı paket nedeniyle ilk kurulum reddedildi. Yalnız disposable emülatördeki paket kaldırılıp üretilen APK yeniden kuruldu; kullanıcı/production cihaz verisine dokunulmadı.
- `.env.internal` ve `.env.production` git tarafından izlenmiyor. Repo içinde `eas.json` bulunmadığından ilerideki remote internal build, iki feature flag'i build ortamında açıkça tanımlamalıdır.
- Production route negative check: ekran importu ve menü girişi canonical feature flag guard'ı altında. Production config false olduğunda giriş render edilmez ve screen state'e geçiş yolu oluşturulmaz. Ayrı production APK gerçek cihaz UI kontrolü bu oturumda yapılmadı.

## Platform matrisi

| Alan | Android internal | iOS internal |
|---|---|---|
| Native build | PASS — release APK | BLOCKED — Windows ortamında Xcode/macOS yok |
| Fiziksel cihaz | Emülatör ile doğrulandı; gerçek cihaz yok | Gerçek iPhone yok |
| Guest flow | PASS | NOT RUN |
| Linked flow | BLOCKED — disposable linked credential yok | NOT RUN |
| 360–430 px layout | PASS — yaklaşık 360 dp Android | NOT RUN |
| Background/foreground | PASS (guest, 5 çevrim) | NOT RUN |

Android sonucu native release emülatör doğrulamasıdır; kullanıcı talebindeki “real device” kriterinin yerini aldığı iddia edilmez.

## Guest flow

İzlenen yol: `Şirket/Yönetim → Sezonlar ve Görevler`.

- Ekran açıldı ve “Bağlı hesap gerekli” durumu render edildi: PASS
- “Hesap Merkezi” CTA etkin ve Account Center'a geçiş yaptı: PASS
- Raw `auth-required` / `server-state-not-initialized` kodu UI'da görünmedi: PASS
- Guest ekrana girişte challenge callable/mutation isteği oluşmadı: PASS (ADB logcat)
- Crash, `Maximum update depth` veya fatal React Native hatası oluşmadı: PASS

## Linked account flow

BLOCKED. Disposable linked production test hesabı ve interaktif provider credential/session mevcut değildi. Client state'i elle seed edilmedi ve backend authority taklit edilmedi.

Bu nedenle aşağıdakiler device E2E olarak doğrulanmadı:

- active season header ve season points
- daily/weekly challenge response rendering
- deferred/disabled challenge görünürlüğü
- mevcut leaderboard CTA'nın linked-user davranışı

Phase 1B backend canary ve mevcut otomatik testlerin başarılı olması bu mobil-client E2E adımlarının yerine geçirilmedi.

## Marketplace progress

BLOCKED. Linked test hesabı olmadan gerçek marketplace purchase/sale yapılamadı. İlerlemenin yalnız canonical backend refresh sonrasında değiştiği gerçek mobil client'ta doğrulanamadı. Client state'e manuel progress yazılmadı.

## Claim, double-tap ve timeout/retry

| Senaryo | Sonuç | Açıklama |
|---|---|---|
| İlk claim | BLOCKED | Tamamlanmış gerçek linked challenge yok |
| Canonical cash reconciliation | BLOCKED (device E2E) | Backend/emulator testleri geçiyor; gerçek mobil client çalıştırılmadı |
| Season points reconciliation | BLOCKED (device E2E) | Canonical Firestore sonucu gerçek mobil client'ta gözlenmedi |
| Claimed-state refresh | BLOCKED | Gerçek claim yapılamadı |
| Rapid double-tap | BLOCKED | Claimable gerçek challenge yok |
| Network timeout/retry | BLOCKED | Gerçek claim ve controllable linked session yok |
| Aynı idempotency key | BLOCKED (device E2E) | Backend testi kapsıyor; cihaz akışı gözlenmedi |

## Foreground / background

Seasons & Challenges guest ekranı aktifken Android uygulaması beş kez background/foreground yapıldı.

- Uygulama process'i yaşamaya devam etti: PASS
- Crash/render-loop: 0
- Guest modunda challenge callable isteği: 0 (beklenen davranış)
- Duplicate listener/claim state belirtisi: görülmedi
- Linked kullanıcıda “her canonical foreground başına tam bir refresh” sayımı: BLOCKED; linked oturum yok ve bu akış için production payload içermeyen structured client log mevcut değil

## Small-screen layout

Android emülatör `945x2100` ve density `420` ile yaklaşık 360 dp genişliğe getirildi.

- Uzun Türkçe guest metni: görünür
- CTA: erişilebilir ve clickable
- Scroll/bottom safe area: erişilebilir
- Yatay taşma, overlap, clipped CTA: görülmedi
- Test sonrası ekran ölçüsü fiziksel `1080x2400` değerine geri alındı

Linked challenge kartlarındaki progress/reward/claim satırları ve iOS küçük ekran görünümü doğrulanamadı.

## Period rollover

BLOCKED (device E2E). Gerçek linked session bulunmadığı için günlük rollover güvenle gözlenemedi. Mevcut production backend zamanı değiştirilmedi ve repoda device E2E için güvenli bir server-authoritative clock injection kullanılmadı. Otomatik period/claim testleri geçmektedir ancak cihaz kanıtı olarak sayılmamıştır.

## Production negative check

- `production` profile public config: Seasons `false`, Challenges `false`: PASS
- Store policy validator bu iki flag'in production'da kapalı olmasını doğruladı: PASS
- More/Company girişi canonical guard altında: PASS (source/config)
- Production artifact üzerinde fiziksel UI navigasyonu: NOT RUN
- Production flag değiştirilmedi.

## Log incelemesi

Android guest logcat:

- challenge mutation/callable: yok
- permission/index hatası: yok
- fatal exception/render loop: yok

İlk Firebase CLI denemesi:

`firebase functions:log --only getCurrentSeason,getChallengeProgress,claimChallengeReward -n 30 --project logisticore-53ab4`

İlk sonuç `Failed to retrieve log entries from Google Cloud.` olmuştur. Phase 1C.2 sırasında mevcut dar read-only Google Cloud oturumu ile `gcloud logging read` kullanılarak son yedi günlük üç callable kaydı başarıyla incelendi: 64 kayıt, 0 error, 0 warning, 0 permission/index/transaction hata eşleşmesi. Sekiz structured `[challenge-claim]` kaydı yalnız `uidHash`, challenge/period, sonuç ve reason alanlarını içeriyordu; raw UID, token veya save payload alanı yoktu. İki `success` kaydı aynı hash/challenge/period grubundaydı ve bir `already-claimed` sonucu ayrıca görüldü; backend idempotency testi de geçti. Bu log sonucu production log erişim engelini kapatır, fakat mobil double-tap E2E yerine geçmez.

## Validation

| Komut | Sonuç |
|---|---|
| `npx tsc --noEmit` | PASS |
| `npm run validate:store-production` | PASS (0 failed) |
| `npm run backend:verify` | PASS |
| Backend Firestore emulator suite | PASS — 69/69 test |
| Challenge backend tests | PASS — trusted progress, atomic/idempotent claim, invalid/stale/future fail-closed, direct write denial |
| `cloud-save-conflict-test` | PASS |
| `cloud-save-production-audit-test` | PASS |
| `git diff --check` | PASS; yalnız mevcut LF→CRLF çalışma ağacı uyarıları |

Backend emulator bu çalıştırmada normal portta başarıyla başladı; isolated-port fallback gerekmedi.

## Remaining risks / unblock koşulları

1. macOS + gerçek iPhone üzerinde signed internal build çalıştırılmalı.
2. Gerçek Android cihazda internal build tekrar kontrol edilmeli.
3. Disposable linked production hesapla purchase ve sale challenge tamamlanmalı.
4. İlk claim, rapid double-tap ve ağ kesintisi/retry gerçek client üzerinden yürütülmeli.
5. Marketplace cash, `seasonProgress` ve claim document değerleri client sonrası backend ile uzlaştırılmalı.
6. Linked ekranda beş foreground çevriminin request sayısı ölçülmeli.
7. Daily rollover gerçek linked session veya önceden var olan güvenli test harness ile doğrulanmalı.
8. Remote internal build kullanılacaksa gitignored env dosyalarına güvenmeden iki flag CI/EAS ortamında açıkça set edilmeli.

BLOCKED

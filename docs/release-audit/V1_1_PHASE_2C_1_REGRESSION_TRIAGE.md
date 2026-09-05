# LogistiCore V1.1 Phase 2C.1 — Regression Triage

## Sonuç

Sekiz başarısız assertion'ın hiçbiri Phase 2C lifecycle extraction tarafından oluşturulmadı. `HEAD` sürümündeki production kaynaklarında da beklenen eski stringlerin bulunmadığı doğrudan doğrulandı. Canonical runtime davranışları doğru olduğundan yalnız iki regression scripti güncellendi; runtime, ekonomi, auth, Apple Sign-In, account deletion, cloud schema ve Firestore rules değiştirilmedi.

## Phase 2C ilişki kanıtı

- Phase 2C başlamadan önceki `HEAD` (`d367053`) `AccountSection.tsx` içinde şu beş eski beklentinin hiçbirini taşımıyordu: `resolveAccountConnectionState`, `Şimdi Kaydet`, `secureFootnoteAmber`, `cloud-protected` ve rules dokümanında `request.resource.data.ownerUid`.
- `git blame`, canonical Account Center ayrımını `6d68ed5` (2026-08-06) commitine bağlıyor. Phase 2C'den önce `AccountCenterScreen → AccountConnectionTab → resolveCloudSaveDisplayInfo` aktifti.
- Gerçek owner rule `firestore.rules` içinde `request.resource.data.ownerUid == userId` olarak `6890a76` (2026-07-31) commitinden beri mevcut.
- Phase 2C öncesi `HEAD` gameStore içinde `reason: 'offline_skip'`, literal `maxOfflineCostPeriods: 0` ve `days: elapsedDays` bulunmuyordu.
- Offline canonical cap wiring'i `OFFLINE_CATCHUP_MAX_COST_PERIODS` ile `5c23d5e` (2026-08-14), debt üretmeyen cursor davranışı ise `6b8778c` (2026-08-29) geçmişine dayanıyor.
- Phase 2C production diff'i Account Center, Firestore rules, daily cost veya periodic cost hesaplarını değiştirmedi.

Sonuç: `E. REAL_REGRESSION_FROM_PHASE_2C` sınıfında assertion yoktur.

## Sekiz assertion sınıflandırması

| # | Failing assertion | Sınıflandırma | Kanıt ve canonical implementation | Runtime değişikliği? | Test değişikliği? | Final |
|---:|---|---|---|---|---|---|
| 1 | `AccountSection uses connection state` | `C. TEST_LOOKING_AT_OLD_FILE_OR_COMPONENT` | `AccountSection` artık yalnız kompakt Hesap Merkezi giriş kartıdır. Aktif state ownership `AccountCenterScreen` içindeki `resolveCloudSaveDisplayInfo` ve `AccountConnectionTab` üzerindedir. Bu yapı Phase 2C öncesi HEAD'de de mevcuttu. | Hayır | Evet; canonical screen ve tab wiring doğrulanıyor. | PASS |
| 2 | `manual save CTA` | `D. EXPECTATION_DRIFT` | Eski `Şimdi Kaydet` metni yerine display state `Şimdi Senkronize Et`, UI'da `Senkronize Et` gösterir. `handleCloudCta → vm.handleManualSync()` gerçek sync handler'ına bağlıdır. | Hayır | Evet; CTA sonucu ve handler bağlantısı birlikte doğrulanıyor. | PASS |
| 3 | `amber footnote for unverified cloud` | `C. TEST_LOOKING_AT_OLD_FILE_OR_COMPONENT` | `secureFootnoteAmber` eski style ismidir. Canonical `resolveCloudSaveDisplayInfo`, `retry` ve `link-required` durumları için `badgeVariant: 'amber'` döndürür. | Hayır | Evet; iki unverified state davranışsal test ediliyor. | PASS |
| 4 | `cloud-protected drives green copy` | `D. EXPECTATION_DRIFT` | Yeni Account Center display vocabulary'si `cloud-protected` yerine `synced` kullanır. `synced → success` ve `AccountConnectionTab` güvenli mesajı yalnız bu key ile gösterir. | Hayır | Evet; `synced/success` sonucu ve UI branch doğrulanıyor. | PASS |
| 5 | `create/update uses request.resource` | `C. TEST_LOOKING_AT_OLD_FILE_OR_COMPONENT` | Test deploy kaynağı olmayan `FIRESTORE_RULES.md` dokümanını tarıyordu. Canonical `firestore.rules`, save create/update için `request.resource.data.ownerUid == userId` şartını uygular; emulator rules testleri de geçti. | Hayır | Evet; gerçek rules source-of-truth taranıyor. | PASS |
| 6 | `offline path uses offline_skip` | `B. STALE_TEST` | Offline maliyet artık reason string ile değil `OFFLINE_CATCHUP_MAX_COST_PERIODS === 0` ve `buildPeriodicCostDeductions` sonucu ile kapatılır. 10 günlük elapsed için charge `0` olarak doğrulandı. | Hayır | Evet; string yerine canonical period sonucu test ediliyor. | PASS |
| 7 | `offline progression forces maxOfflineCostPeriods 0` | `B. STALE_TEST` | gameStore literal `0` değil canonical `OFFLINE_CATCHUP_MAX_COST_PERIODS` sabitini geçirir. `periodsCharged=0`, `totalAmount=0` ve cursor=`now` doğrulandı; sonraki online debt oluşmaz. | Hayır | Evet; cap ve cursor davranışı test ediliyor. | PASS |
| 8 | `online advanceTime still charges elapsed days` | `D. EXPECTATION_DRIFT` | Ürün kuralı tüm geçmiş elapsed günleri tek seferde kesmek değildir. Online path `ONLINE_TICK_MAX_COST_PERIODS` ile bounded period uygular ve `days: periodic.periodsCharged` kullanır. Bir uygun period için charge `1` ve pozitif total doğrulandı. | Hayır | Evet; bounded online period davranışı test ediliyor. | PASS |

## Runtime davranış doğrulaması

### Apple/cloud account connection

- Owner UID reconciliation ve foreign-owner conflict testleri geçti.
- Apple link sonrası force token refresh ve canonical auth wait bağlı.
- Cloud save atomic batch write, owner UID ve read-back verification bağlı.
- Failed/retry state amber, verified/synced state success olarak sonuçlanıyor.
- Manual sync CTA `useAccountCenter.handleManualSync` yoluna bağlı.
- Firestore emulator testleri save owner kuralını ve doğrudan yazma sınırlarını doğruladı.

### Offline operating costs

- Offline fixed operating costs: `0`.
- 10 günlük offline elapsed: `periodsCharged=0`, `totalAmount=0`.
- Offline cursor trusted `now` değerine ilerliyor; daha sonra historical debt oluşmuyor.
- Online uygun 24 saatlik dönem: yalnız bir bounded period charge ediliyor.
- Active delivery threshold `15 saniye`, idle threshold `5 dakika` kaldı.
- Delivery/transfer progression cost charging'den bağımsız çalışıyor.
- Duplicate settlement ve offline fuel davranışı ilgili suite'lerde yeşil.

## Test değişiklikleri

Yalnız:

- `scripts/apple-cloud-save-link-regression-test.ts`
- `scripts/offline-operating-cost-disabled-regression-test.ts`

Assertion silinmedi. Fragile source-string kontrolleri canonical state/result assertions ile değiştirildi ve rules testi gerçek deploy kaynağına yönlendirildi.

## Validation sonuçları

- `apple-cloud-save-link-regression-test.ts`: 40/40 PASS
- `offline-operating-cost-disabled-regression-test.ts`: 17/17 PASS
- `npx tsc --noEmit`: PASS
- `npm run validate:store-production`: PASS
- `npm run backend:verify`: PASS — backend build/typecheck, 65 emulator testi, cloud conflict ve production audit
- `app-lifecycle-extraction-regression-test.ts`: PASS
- `offline-delivery-progress-regression-test.ts`: 67/67 PASS
- `offline-progression-smoke-test.ts`: 71/71 PASS
- `account-signout-deletion-regression-test.ts`: 41/41 PASS
- `app-store-privacy-account-regression-test.ts`: 18/18 PASS
- `git diff --check`: PASS

## iOS archive durumu

`IOS_ARCHIVE_PREFLIGHT_PENDING`

Windows ortamında signed `.app` üretimi taklit edilmedi. macOS üzerinde Xcode, CocoaPods, geçerli Apple signing identity/provisioning profile ve repository bağımlılıkları hazırlandıktan sonra:

```bash
cd /path/to/LogistiCore
pod install --project-directory=ios
xcodebuild \
  -workspace ios/LogistiCore.xcworkspace \
  -scheme LogistiCore \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$PWD/build/LogistiCore.xcarchive" \
  archive

IOS_ARCHIVE_APP_PATH="$PWD/build/LogistiCore.xcarchive/Products/Applications/LogistiCore.app" \
  npx tsx scripts/verify-ios-apple-auth-config.ts
```

Gerekirse Xcode signing ortamında `DEVELOPMENT_TEAM=<TEAM_ID>` ve `-allowProvisioningUpdates` parametreleri eklenmelidir. Script ayrıca environment verilmezse `~/Library/Developer/Xcode/Archives` altındaki en yeni LogistiCore archive'ını otomatik arar.

## Final karar

Genuine unresolved product/runtime regression bulunmadı. Signed iOS archive doğrulaması code verification dışında cihaz/Mac preflight olarak bekliyor.

V1_1_PHASE_2C_CODE_VERIFIED_IOS_ARCHIVE_PENDING

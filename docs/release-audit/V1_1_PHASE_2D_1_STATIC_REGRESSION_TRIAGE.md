# LogistiCore V1.1 Phase 2D.1 — Static Regression Debt Triage

## Sonuç

Phase 2D sonrasında kalan altı kırmızı assertion ürün regresyonu değildir. Bunlar daha önce taşınmış canonical UI/lifecycle sahipliğini eski dosya veya inline kaynak metni üzerinden doğrulayan statik test borçlarıdır. Runtime kaynak kodu değiştirilmedi; yalnız testlerin hedefleri güncel canonical sahipliğe taşındı ve davranış kapsamı korundu.

## Assertion triage

| Test / failing assertion | Sınıflandırma | Eski beklenti | Canonical implementation ve kanıt | Runtime değişikliği | Test değişikliği | Final sonuç |
|---|---|---|---|---|---|---|
| `release-regression-contract-transfer-navigation-test.ts` — “Misafir kullanıcı için hesap bağlama açıklaması gösterilir” | `STALE_TEST` | `AccountCenterScreen.tsx` içinde `İlerlemeni korumak için Google veya Apple hesabını bağla` metni | Misafir hesap durumu `src/utils/accountConnectionState.ts` içindeki `case 'guest'` tarafından üretiliyor. Gerçek Liderlik Tablosu misafir yüzeyi `LeaderboardScreen.tsx` içindeki `GuestPromptCard`; route görünür kalıyor ve “Sıralamaya katılmak için hesabını bağla” CTA’sını gösteriyor. | Hayır | Assertion canonical guest-state helper’ı ve gerçek leaderboard prompt’unu birlikte doğrulayacak şekilde retarget edildi. | PASS |
| `phase3-smoke-test.ts` — “Filo UpgradesScreen yönlendirmesi” | `OLD_FILE_OR_COMPONENT_TARGET` | `FleetScreen.tsx` içinde `UpgradesScreen` adı | Filo artık `pendingFleetSubTab === 'upgrades'` isteğini `setActiveTab('upgrades')` ile karşılıyor ve aynı ekran içindeki canonical geliştirme sekmesine geçiyor. | Hayır | Sekme navigation contract’ı doğrulanıyor. | PASS |
| `phase3-smoke-test.ts` — “UpgradesScreen mevcut upgrade action” | `OLD_FILE_OR_COMPONENT_TARGET` | `src/screens/UpgradesScreen.tsx` içinde `upgradeTruck` | Filo geliştirme action sahipliği `src/components/fleet/FleetUpgradesPanel.tsx` içindedir; panel `upgradeTruck(selectedTruck.id, upgradeType)` çağrısını yapar. | Hayır | Assertion `FleetUpgradesPanel` action sahipliğine taşındı. | PASS |
| `phase3-smoke-test.ts` — “UpgradesScreen kamyon değiştir strip” | `OLD_FILE_OR_COMPONENT_TARGET` | Eski `UpgradesScreen` içinde `Kamyon Değiştir` kaynak metni | Canonical panel `SectionTitle title="Kamyon Seç"` ve `TruckPickerChip` listesini kullanıyor; seçili kamyon davranışı korunuyor. | Hayır | Güncel picker yapısı ve component ownership doğrulanıyor. | PASS |
| `phase3-smoke-test.ts` — “Filo UpgradesScreen embed route” | `OLD_FILE_OR_COMPONENT_TARGET` | Fleet içinde eski `<UpgradesScreen>` embed’i | `FleetScreen.tsx` canonical olarak `<FleetUpgradesPanel>` render ediyor. `MoreScreen` üzerindeki mevcut `route === 'upgrades'` deep-link yolu ayrıca korunuyor ve test edilmeye devam ediyor. | Hayır | Fleet embed assertion’ı canonical panel hedefiyle güncellendi; deep-link assertion’ları silinmedi. | PASS |
| `global-economy-client-regression-test.ts` — “current snapshot commits before optional history” | `STALE_TEST` | Canonical snapshot yorumundan sonra inline `const history = await repository.getHistory` kaynak metni | `gameStore.ts` önce canonical snapshot’ı `set(...)` ile commit ediyor; sonra bounded `fetchGlobalMarketHistoryEntries(repository, snapshot)` çağrısını ve `applyGlobalMarketHistory(...)` commit’ini yapıyor. Helper `INITIAL_GLOBAL_HISTORY_LIMIT` kullanıyor. Dedicated live/cache testi 35/35 geçti ve duplicate/startup wiring’i doğruladı. | Hayır | Assertion güncel bounded helper çağrısı ile history commit sırasını birlikte doğrulayacak şekilde güçlendirildi. | PASS |

## Phase 2D nedensellik kontrolü

- Assertion blame kayıtları guest kontrolünü `6d68ed50`, upgrades kontrollerini `d43d6d5f`, `391c9265` ve `6d68ed50`, global-ekonomi kontrolünü `6845c3ae` commitlerine bağlıyor.
- Canonical `FleetUpgradesPanel` ve bounded global history helper daha sonraki `5c23d5e` değişikliğiyle geldi; eski assertion’lar bu sahiplik değişimine uyarlanmamıştı.
- Phase 2D yalnız Market/Contracts presentational extraction sınırlarını değiştirdi. Bu triage kapsamındaki leaderboard, fleet-upgrade ve global-economy runtime kaynaklarında Phase 2D davranış değişikliği yoktur.
- Başlangıç öncesi kırmızı sonuçlar birebir yeniden üretildi: leaderboard 1, phase3 4, global economy 1 başarısız assertion. Test hedefleri düzeltildikten sonra altısının tamamı geçti.

## Canonical davranış doğrulaması

### Guest leaderboard

- Hesap kartı `onOpenLeaderboard` erişimini koruyor.
- Yönetim/More route’u `leaderboard` ekranına yönlendiriyor.
- Username bulunmayan bağlı kullanıcı “Kullanıcı Adı Oluştur” CTA’sını görüyor.
- Misafir kullanıcı route’tan dışlanmıyor; hesap bağlama açıklaması ve CTA’sı gösteriliyor.

### Fleet upgrades

- Filo geliştirme navigation isteği `pendingFleetSubTab` üzerinden canonical sekmeye taşınıyor.
- Upgrade mutation ekran container’ına geri taşınmadı; mevcut `FleetUpgradesPanel` action’ı kullanılıyor.
- Kamyon seçim strip’i ve More deep-link yolu korunuyor.

### Global economy initialization / live-cache

- Local-first boot ownership’i `useAppBootstrap()` içindedir.
- Foreground global-economy refresh ownership’i `useAppStateLifecycle()` içindedir.
- Snapshot commit ve optional bounded history yükleme sırası `gameStore.refreshMarketSnapshot()` içinde canonical kalmıştır.
- History hatası mevcut snapshot’ı düşürmez; live/cache state, retry error cleanup ve foreground wiring dedicated regression testiyle doğrulandı.
- Yeni veya duplicate initialization eklenmedi.

## Değişen dosyalar

- `scripts/release-regression-contract-transfer-navigation-test.ts`
- `scripts/phase3-smoke-test.ts`
- `scripts/global-economy-client-regression-test.ts`
- `docs/release-audit/V1_1_PHASE_2D_1_STATIC_REGRESSION_TRIAGE.md`

Production/runtime source değişikliği: **Yok**.

## Test sonuçları

| Komut | Sonuç |
|---|---|
| `npx tsx scripts/release-regression-contract-transfer-navigation-test.ts` | PASS — 13 assertion |
| `npx tsx scripts/phase3-smoke-test.ts` | PASS — 115/115 |
| `npx tsx scripts/global-economy-client-regression-test.ts` | PASS — 27/27 |
| `npx tsc --noEmit` | PASS |
| `npm run validate:store-production` | PASS |
| `npm run backend:verify` | PASS — emulator/backend zinciri dahil |
| `npx tsx scripts/market-live-cache-regression-test.ts` | PASS — 35/35 |
| `npx tsx scripts/tab-navigation-performance-regression-test.ts` | PASS |
| `npx tsx scripts/market-contracts-presentational-extraction-test.ts` | PASS |
| `git diff --check` | PASS |

## Kalan risk

Bu triage kapsamında çözülmemiş product/runtime regression yoktur. Testler hâlâ statik wiring doğrulaması yapıyor, fakat artık kaldırılmış component adları yerine güncel canonical sahipliği ve davranış zincirini birlikte kontrol ediyor.

V1_1_PHASE_2D_1_VERIFIED

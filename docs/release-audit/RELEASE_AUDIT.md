# LogistiCore V1 Bağımsız Release Audit

Denetim tarihi: 2026-08-05  
Denetlenen çalışma ağacı: `C:\Users\ahmet\LogistiCore`  
Kapsam: Android, iOS, Expo SDK 54, React Native New Architecture, Firebase/Auth/Firestore/Functions, local/cloud save, oyun simülasyonu, UI, performans ve reklamlar.

Bu denetimde kaynak kod değiştirilmedi. Denetim başlamadan önce çalışma ağacında bulunan `app.json` ve `android/app/build.gradle` sürüm değişiklikleri korunmuştur. Yalnız `docs/release-audit/` altındaki dört rapor oluşturulmuştur.

## 1. Executive summary

Çekirdek oyun simülasyonu güçlü durumdadır: 1.000 sözleşme örneği, 30 günlük headless simülasyon, yakıt/offline/idempotency, cash ledger, araç değerleme, global ekonomi, marketplace concurrency ve Firestore rule emulator testleri büyük ölçüde geçmiştir. Android ve iOS Hermes exportları başarılıdır; mevcut Android release AAB de üretilebilmiştir.

Buna rağmen mevcut yapı mağazaya gönderilemez. İki bağımsız güven sınırı/data isolation blocker'ı kanıtlandı:

1. Kullanıcının doğrudan yazabildiği `users/{uid}/saves/current` belgesi leaderboard skoru ve ilk marketplace canonical state'i için backend tarafından güvenilir kaynak kabul ediliyor. Manipüle edilmiş cash/filo/skor callable katmanına taşınabilir.
2. Google hesap değiştirme akışı yeni credential'ı aynı Auth instance'ına cloud doğrulaması ve kullanıcı kararından önce uygular. Cloud read hatasında veya yeni hesap seçim ekranındaki `Vazgeç` yolunda eski hesaba rollback yoktur; eski local save yeni UID ile yan yana kalır.

Ek olarak mevcut release ortamı test reklam ID'lerini ve geliştirici tanılama panelini açıyor, ATT/UMP consent uygulanmamış, Android release manifestinde oyun için gerekçesiz `SYSTEM_ALERT_WINDOW` bulunuyor ve uygulama hâlâ varsayılan Android/Expo launcher ile splash görsellerini kullanıyor.

## 2. Release readiness score

**52 / 100**

| Alan | Puan | Özet |
|---|---:|---|
| Build/config | 6/12 | Exportlar geçiyor; Expo Doctor 3 kontrolü geçemedi, iOS native archive yok |
| Auth/account isolation | 5/15 | Singleton iyi; hesap değişim rollback'i güvenli değil |
| Save/data safety | 8/13 | Checksum/migration/journal mevcut; corrupt local slot otomatik temizleniyor |
| Simulation/economy | 15/15 | Ana invariant ve uzun simülasyon testleri geçti |
| Backend/security | 7/17 | Rules ve concurrency iyi; cloud save trust boundary kritik açık |
| UI/navigation/safe area | 5/8 | Ortak safe-area altyapısı var; gerçek cihaz matrisi yapılmadı |
| Performance | 3/7 | Selector/timer statik kontrolleri iyi; gerçek cihaz 30 dk profiling yok |
| Monetization/policy | 1/8 | Reward gate doğru; store env ve consent hazır değil |
| Test/release process | 2/5 | Geniş test seti var; 6 script kırmızı, EAS/iOS release pipeline yok |

## 3. Blocker

### B-001 — Client-yazılabilir cloud save canonical marketplace cash/ownership ve leaderboard skorunu besliyor

- Severity: **BLOCKER**
- Affected files:
  - `firestore.rules:44-48`
  - `src/services/cloudSaveService.ts:390-493`
  - `backend/src/vehicleMarketplaceState.ts:78-185`
  - `backend/src/vehicleMarketplace.ts:287-358, 431-437`
  - `backend/src/leaderboard.ts:131-170`
- Exact code path:
  - Authenticated client → `users/{uid}/saves/current` write → marketplace state bootstrap veya `submitLeaderboardScore` → Admin SDK aynı client-yazılabilir payload'ı canonical kabul eder.
- Evidence:
  - Rule yalnız `ownerUid == uid` kontrolü yapıyor; `gameState.player.money`, trucks, level, reputation veya completed contracts server tarafından doğrulanmıyor.
  - Marketplace bootstrap `canonicalCash = player.money` ve truck snapshotlarını cloud save'den oluşturuyor.
  - Leaderboard callable skoru aynı belgeden hesaplıyor ve bunu “trusted save” olarak yorumluyor.
- Reproduction:
  1. Yeni authenticated kullanıcı ile kendi `saves/current` belgesine geçerli görünümlü fakat şişirilmiş cash/truck/progression payload'ı yaz.
  2. Username oluştur.
  3. Marketplace state henüz yokken listing/ensure akışını veya `submitLeaderboardScore` callable'ını çağır.
  4. Backend'in şişirilmiş client değerlerini canonical state/skor olarak kullandığını gözle.
- Impact:
  - Leaderboard manipülasyonu.
  - Marketplace'e sahte cash/araç sokma, gerçek oyunculara satış ve ekonomi kontaminasyonu.
  - “Backend-authoritative” ürün kararının ihlali.
- Recommended correction:
  - Canonical progression/cash/ownership için client-writeable cloud save'i source of truth yapma.
  - Marketplace ve leaderboard girdilerini server-owned state/receipts/ledger üzerinden üret.
  - En azından bootstrap'ı trusted migration/callable ile doğrula ve cloud save'deki gameplay alanlarını doğrudan canonical kabul etme.
  - Emulator'a “malicious owner cloud-save write cannot affect leaderboard/marketplace” testi ekle.
- Backend deploy required: **Evet** (Functions + Firestore rules/data migration)
- New AAB required: **Muhtemelen hayır**, client contract değişirse evet
- New iOS build required: **Muhtemelen hayır**, client contract değişirse evet

### B-002 — Hesap değiştirme atomik değil; cloud hata/iptal yolunda yeni UID ile eski local save yan yana kalıyor

- Severity: **BLOCKER**
- Affected files:
  - `src/services/authService.ts:1169-1244`
  - `src/components/AccountSection.tsx:799-879`
  - `src/storage/cloudSaveSync.ts:376-435`
- Exact code path:
  - `executeAccountSwitch` → mevcut save sync → `beginGoogleAccountSwitchSelection` → `signInWithCredential` → cloud read → kullanıcı conflict/new-account kararı.
- Evidence:
  - `signInWithCredential` satır 1201'de çalışıyor; cloud payload ancak satır 1206'da okunuyor.
  - Network/permission/corrupt hata yolunda fonksiyon `failed` döner fakat eski Firebase user'a rollback yapmaz.
  - Cloud save olmayan yeni hesap dialogundaki `Vazgeç` aksiyonu no-op'tur; Auth zaten yeni UID'dedir.
  - Eski local gameplay state bu sırada hâlâ bellekte/AsyncStorage'dadır.
- Reproduction:
  1. Google A hesabında local/cloud save ile “Hesap Değiştir” seç.
  2. Google B'yi seç.
  3. Credential uygulandıktan sonra cloud read'i offline/permission error ile başarısız kıl; alternatif olarak cloud'suz B hesabı ekranında `Vazgeç` seç.
  4. Firebase `currentUser` B iken A'nın local state'inin kaldığını doğrula.
  5. Sonraki manual/app-start sync'in yanlış UID'ye veri yazma riskini gözle.
- Impact:
  - UID'ler arası kayıt karışması, yanlış cloud overwrite, hesap izolasyonu ihlali ve veri kaybı.
- Recommended correction:
  - Account switch'i explicit transaction/state machine yap; eski user/session ve local owner bağını commit anına kadar koru.
  - Yeni credential sonrası cloud doğrulama başarısızsa güvenli rollback veya bloklayan recovery ekranı sağla.
  - `Vazgeç` gerçek rollback yapmalı; no-op olmamalı.
  - Auth UID değiştiği anda old-owner local save'in yeni UID'ye sync edilmesini invariant ile engelle.
- Backend deploy required: **Hayır**
- New AAB required: **Evet**
- New iOS build required: **Evet**

### B-003 — Mevcut store config reklam/consent açısından production-ready değil

- Severity: **BLOCKER**
- Affected files:
  - `.env:16,21-22` (git-ignore altında fakat mevcut build girdisi)
  - `app.config.js:62,89-98`
  - `src/config/adMob.ts:50-69`
  - `src/services/adProvider.ts:1-10`
- Exact code path:
  - Expo config env → `extra.ads.useTestIds=true` → `resolveAdsMode()` → Google `TestIds.REWARDED`.
  - Aynı env `BackendDiagnosticsPanel`'ı release'te görünür yapıyor.
- Evidence:
  - `npx expo config --type public` çıktısı: ads enabled, `useTestIds='true'`, backend diagnostics `true`.
  - ATT ve UMP entegrasyonu kaynakta açık TODO; yalnız `NSUserTrackingUsageDescription` eklenmiş.
- Reproduction:
  - Mevcut `.env` ile production export/AAB oluştur; diagnostics ve test rewarded ID'nin embedded config'ten seçildiğini doğrula.
- Impact:
  - Test reklamıyla mağaza build'i, gelir kaybı ve yanlış release davranışı.
  - EEA consent ve iOS tracking davranışının mağaza/mahremiyet beyanıyla uyuşmama riski.
  - Internal tanılama UI'sının son kullanıcıya sızması.
- Recommended correction:
  - Store profile'da test ID ve diagnostics'i zorunlu false yapan ayrı env/profile kullan.
  - Production validator bu iki flag true ise fail etmeli.
  - UMP consent ve gerekiyorsa ATT karar akışını gerçek cihazda doğrula; privacy labels/Data safety ile eşleştir.
- Backend deploy required: **Hayır**
- New AAB required: **Evet**
- New iOS build required: **Evet**

### B-004 — Android release AAB kısıtlı overlay permission taşıyor

- Severity: **BLOCKER**
- Affected files:
  - `android/app/src/main/AndroidManifest.xml:3-7`
  - merged release manifest: `android/app/build/intermediates/merged_manifest/release/processReleaseMainManifest/AndroidManifest.xml:11-16`
- Exact code path: checked-in manifest → Gradle manifest merge → final release AAB.
- Evidence:
  - Final release merged manifestte `android.permission.SYSTEM_ALERT_WINDOW` bulunuyor.
  - Lojistik oyununun temel işlevinde diğer uygulamaların üzerinde çizim gereksinimi bulunamadı.
- Reproduction:
  - `bundleRelease` sonrası merged manifesti veya AAB manifestini incele.
- Impact:
  - Google Play restricted permission/policy incelemesi ve reddedilme riski.
- Recommended correction:
  - Permission kaynağını kaldır; production merged manifestte bulunmadığını AAB üzerinden doğrula.
- Backend deploy required: **Hayır**
- New AAB required: **Evet**
- New iOS build required: **Hayır**

## 4. Critical

### C-001 — Corrupt/unsupported local save ana slotu kullanıcı recovery seçimi olmadan temizleniyor

- Severity: **CRITICAL**
- Affected files: `src/storage/saveGame.ts:900-1060, 1568-1625`
- Exact code path: AsyncStorage read → JSON/migration failure → backup key write → main save remove → initializeGame yeni oyun.
- Evidence: `parseAndMigrateRawSave` hem parse hem migration failure'da `clearMainSaveSlot()` çağırıyor.
- Reproduction: `logisticore_save_v1` içine bozuk JSON veya desteklenmeyen future version koyup uygulamayı başlat.
- Impact: Ana slot otomatik kaybolur. Raw backup aynı AsyncStorage'da tutulsa da oyuncu için görünür restore/export yolu kanıtlanmadı; cloud yoksa fiili veri kaybı yaşanabilir.
- Recommended correction: Ana slotu overwrite etmeden recovery ekranı/rollback sun; backup'ın kullanıcı tarafından geri yüklenebilirliğini test et.
- Backend deploy required: Hayır
- New AAB required: Evet
- New iOS build required: Evet

## 5. High

### H-001 — Store branding assetleri tanımlı değil; release Android varsayılan şablon ikon/splash kullanıyor

- Severity: **HIGH**
- Affected files: `app.json`, `app.config.js`, `android/app/src/main/res/mipmap-*`, `android/app/src/main/res/drawable-*/splashscreen_logo.png`
- Exact code path: configte `icon`, `adaptiveIcon`, `splash` yok → checked-in native default resources.
- Evidence: `ic_launcher.webp` Android robot template ikonudur; splash resmi grid/circle placeholder'dır. Asset ağacında app icon/splash bulunmadı.
- Reproduction: Mevcut AAB'yi kur veya native resource'u görüntüle.
- Impact: Bitmemiş uygulama görünümü, store listing/brand tutarsızlığı ve review kalite riski.
- Recommended correction: Production icon/adaptive icon/splash oluştur; Android ve iOS archive üzerinde doğrula.
- Backend deploy required: Hayır
- New AAB required: Evet
- New iOS build required: Evet

### H-002 — iOS store binary ve signing/entitlement zinciri doğrulanmadı

- Severity: **HIGH**
- Affected files: `app.config.js`, `app.json`; eksik: `eas.json`, repo içinde `ios/` native proje.
- Exact code path: Expo config plugin introspection mevcut; native App Store archive yok.
- Evidence:
  - `ios/` ve `eas.json` yok.
  - iOS export geçti fakat bu `.ipa`/Xcode archive değildir.
  - Introspection `CFBundleVersion=1`, `aps-environment=development`, `NSAllowsArbitraryLoads=true` gösterdi.
- Reproduction: `npx expo config --type introspect`; gerçek distribution archive olmadığı için final entitlements/provisioning doğrulanamaz.
- Impact: Apple Sign-In, Google callback, push, ATT, AdMob ve release signing mağazada kanıtlanmamış.
- Recommended correction: Belgelenmiş EAS/CI production profile ve signed IPA üret; entitlements ile gerçek cihaz auth/reward testlerini yap.
- Backend deploy required: Hayır
- New AAB required: Hayır
- New iOS build required: Evet

### H-003 — Altı regression/smoke scripti kırmızı

- Severity: **HIGH**
- Affected files: `scripts/account-switch-flow-test.ts`, `scripts/debug-contract-generation-test.ts`, `scripts/phase3-smoke-test.ts`, `scripts/time-progression-audit-test.ts`, `scripts/vehicle-marketplace-create-chain-test.ts`, `scripts/vehicle-marketplace-ui-test.ts`
- Exact code path: manuel toplu `npx tsx` test yürütümü.
- Evidence: 62 scriptte 56 pass / 6 fail.
- Reproduction: `scripts/` altındaki `*test.ts` ve `*smoke*.ts` dosyalarını sırayla çalıştır.
- Impact: CI güvenilir değil; gerçek regresyonlar ile eskimiş testler ayrılamıyor.
- Recommended correction: Güncel ürün kararına göre test fixture/assertionlarını düzelt; RN component testini Metro/Jest uyumlu runner'a taşı.
- Backend deploy required: Hayır
- New AAB required: Test düzeltmesi source davranışını değiştirmezse hayır
- New iOS build required: Test düzeltmesi source davranışını değiştirmezse hayır

### H-004 — Apple hesapları için aynı seviyede hesap değiştirme akışı bulunamadı

- Severity: **HIGH**
- Affected files: `src/components/AccountSection.tsx:799-910`, `src/services/appleAuthService.ts`
- Exact code path: görünür `Hesap Değiştir` aksiyonu her durumda Google picker'ı çağırır.
- Evidence: `executeAccountSwitch` yalnız `beginGoogleAccountSwitchSelection()` kullanıyor; Apple A → Apple B state machine bulunamadı.
- Reproduction: Apple ile bağlı iOS kullanıcıda Hesap Değiştir'i aç.
- Impact: Apple-only kullanıcı farklı Apple hesabına güvenli geçemez; ürün gereksinimi eksik.
- Recommended correction: Provider-aware switch akışı ve gerçek iOS test matrisi.
- Backend deploy required: Hayır
- New AAB required: Hayır
- New iOS build required: Evet

### H-005 — Release manifest eski storage izinleri ve `allowBackup=true` içeriyor

- Severity: **HIGH**
- Affected files: `android/app/src/main/AndroidManifest.xml:3-15`
- Exact code path: checked-in manifest → release merge.
- Evidence: `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`, `allowBackup=true` final merged manifestte mevcut.
- Reproduction: release merged manifesti incele.
- Impact: Gereksiz permission/data-safety yüzeyi; AsyncStorage save'in Android Auto Backup'a dahil olma ve hesap/cihaz restore davranışını karmaşıklaştırma riski.
- Recommended correction: Gereksiz izinleri kaldır; backup policy/data extraction rules tanımla ve UID isolation ile test et.
- Backend deploy required: Hayır
- New AAB required: Evet
- New iOS build required: Hayır

## 6. Medium

### M-001 — Expo Doctor 3 kontrolü geçemedi

- Severity: MEDIUM
- Affected files: `package.json`, `app.json`, `app.config.js`, checked-in `android/`
- Evidence: Expo `54.0.35`, beklenen `~54.0.36`; non-CNG native/config sync uyarısı; app.json/dynamic config uyarısı.
- Impact: Patch düzeyi hata düzeltmeleri ve native config drift riski.
- Recommended correction: Değişiklik yapmadan önce kontrollü upgrade/prebuild diff planı çıkar; Android checked-in native config ile app config'i tek pipeline'da senkronla.
- Backend deploy required: Hayır
- New AAB/iOS build: Evet

### M-002 — iOS ATS tüm HTTP trafiğine izin veriyor

- Severity: MEDIUM
- Affected path: Expo introspected `ios.infoPlist.NSAppTransportSecurity.NSAllowsArbitraryLoads=true`
- Evidence: `npx expo config --type introspect`.
- Impact: Gereksiz network attack surface ve App Review açıklama ihtiyacı.
- Recommended correction: Gerekli domain exceptionları dışında ATS'i kapat.
- Backend deploy required: Hayır
- New iOS build required: Evet

### M-003 — Debug mutasyon action'ları production JS bundle'da kalıyor

- Severity: MEDIUM
- Affected files: `src/store/gameStore.ts:8796-9035`, `src/screens/DebugSimulationScreen.tsx`
- Evidence: UI `__DEV__` ile gizli olsa da debug cash/time/reset actionları store API'sinde derleniyor.
- Impact: Attack surface/maintainability; yanlış route/flag açılması halinde oyuncu ekonomisi bozulabilir.
- Recommended correction: Build-time dev module boundary veya production no-op/fail-closed guard.
- Backend deploy required: Hayır
- New AAB/iOS build: Evet

### M-004 — Yerel save appVersion sabiti gerçek app sürümünden kopuk

- Severity: MEDIUM
- Affected file: `src/storage/saveGame.ts` (`APP_VERSION = '1.0.0'`)
- Evidence: Uygulama config sürümü 1.0.10 iken save metadata sabiti 1.0.0.
- Impact: Tanılama/migration metadata yanlış; destek olaylarında sürüm kaynağı güvenilmez.
- Recommended correction: Runtime Expo version'dan tek source kullan.
- Backend deploy required: Hayır
- New AAB/iOS build: Evet

### M-005 — Ağır harita ve dashboard görselleri bellek/performance açısından gerçek cihazda ölçülmedi

- Severity: MEDIUM
- Affected assets: iki harita PNG'si yaklaşık 2.6 MB, birden çok 0.8-1.7 MB UI asseti.
- Evidence: export asset listesi; gerçek cihaz memory profile yok.
- Impact: Düşük RAM Android'de decode spike/tab geçiş takılması riski.
- Recommended correction: 360 px/düşük RAM cihazda memory/Jank profiling; gerekli asset downscale/WebP değerlendirmesi.
- Backend deploy required: Hayır
- New AAB/iOS build: Yalnız asset değişirse

## 7. Low

### L-001 — Dead/legacy dosyalar ve deprecated adaptörler mevcut

- Severity: LOW
- Evidence: `CloudSaveSection.tsx`, `BottomTabBar.tsx`, `data/mapPositions.ts` aktif import taşımıyor; çeşitli deprecated aliaslar var.
- Impact: Yanlış implementasyona geri bağlanma ve bakım maliyeti.
- Recommended correction: Release sonrası import graph kanıtıyla temizle.
- Backend deploy required: Hayır
- New build required: Hayır, davranış değişmedikçe

### L-002 — Toolchain gelecekte Java 21 gerektirecek

- Severity: LOW
- Evidence: Firebase emulator, firebase-tools 15 ile Java <21 desteğinin kalkacağını uyardı.
- Impact: Yakın gelecekte CI emulator testleri kırılabilir.
- Recommended correction: CI JDK'ını 21'e sabitle.
- Backend deploy required: Hayır
- New build required: Hayır

## 8. Verified healthy systems

- Android package ve iOS bundle ID: `com.ethemsincar.logisticore`.
- Firebase project: `logisticore-53ab4`.
- Functions region: `us-central1`; 8 production function, eksik/wrong-region 0.
- Expo SDK 54, RN 0.81.5, New Architecture ve Hermes etkin.
- Firebase App/Auth singleton tek canonical modülde; emulator bağlantısı `src/` içinde yok.
- Google native config ile Android package/OAuth SHA doğrulamaları geçti.
- Apple Sign-In plugin, nonce/rawNonce ve token-null guard mevcut; entitlement introspectionda üretildi.
- Cloud save ownerUid, checksum, bounded payload, restore journal ve marketplace reconciliation testleri geçti.
- Global economy snapshot/history canlı ve güncel; 56/56 history kaydı, stale/duplicate problem yok.
- Firestore emulator: 40/40 test geçti; marketplace direct write denial ve concurrent double purchase testi geçti.
- Core game readiness: 80/80; 1.000 contract viability %100, profitable %99.2, duplicate settlement 0, negative fuel 0.
- Cash ledger mismatch 0; -$5.000 floor ve recovery testleri geçti.
- Offline delivery regression ve fuel sistemi testleri geçti.
- Android/iOS Hermes export başarılı.
- Rewarded ad grant yalnız `EARNED_REWARD` ile, close event tek başına ödül vermiyor; listener cleanup ve double-grant guard mevcut.

## 9. Unverified real-device cases

- Signed iOS `.ipa`/App Store archive ve distribution entitlements.
- Apple login, Apple A → Apple B, Google ↔ Apple linking ve revoke/credential edge cases gerçek iPhone'da.
- Google account picker ve Google A → B rollback gerçek Android release build'de.
- Rewarded AdMob production unit, no-fill, EEA UMP ve iOS ATT gerçek cihazda.
- Push notification APNs production token/entitlement.
- 360–430 px, font scale %120, keyboard ve modal stacking görsel matrisi.
- 50 hızlı tab geçişi, 30 dakika oturum, düşük RAM Android map memory/jank.
- Android Auto Backup restore ve UID isolation.
- Production canary marketplace transferi bu audit sırasında destructive test hesabı oluşturulmadan çalıştırılmadı; emulator concurrency ve production health read-only kontrolleri geçti.

## 10. Recommended fix order

1. B-001: Cloud save → marketplace/leaderboard trust boundary'yi kapat; rules + backend migration/deploy.
2. B-002: Account switch commit/rollback ve UID-local-save isolation invariantı.
3. B-003/B-004: Store env, consent ve Android restricted permission temizliği.
4. H-001/H-002: Production branding ve signed iOS archive pipeline.
5. H-003: Altı kırmızı testi güncelle ve temiz CI sağla.
6. H-004/H-005: Apple provider-aware switch ve backup/permission policy.
7. Expo patch/config drift, debug bundle yüzeyi ve gerçek cihaz performans matrisi.

## Final decision

# RELEASE BLOCKED

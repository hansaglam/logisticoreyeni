# Release Checklist

Durum anahtarı: `[x]` doğrulandı, `[ ]` açık, `[-]` bu ortamda doğrulanamadı.

## Release gate — zorunlu

- [ ] B-001: Client-writeable cloud save'in marketplace canonical cash/ownership kaynağı olması kaldırıldı.
- [ ] B-001: Leaderboard skoru server-owned state/receipt üzerinden hesaplanıyor.
- [ ] B-001: Malicious save emulator testi eklendi ve geçiyor.
- [ ] B-002: Account switch tüm hata/iptal yollarında eski UID veya güvenli recovery state'e dönüyor.
- [ ] B-002: Yeni UID'ye eski owner local save otomatik sync edilemiyor.
- [ ] B-003: Store build'de `EXPO_PUBLIC_ADS_USE_TEST_IDS=false`.
- [ ] B-003: Store build'de `EXPO_PUBLIC_BACKEND_DIAGNOSTICS_ENABLED=false`.
- [ ] B-003: UMP/ATT/privacy davranışı gerçek cihazda doğrulandı.
- [ ] B-004: Final Android AAB'de `SYSTEM_ALERT_WINDOW` yok.
- [ ] Altı kırmızı test düzeltildi; tüm suite yeşil.

## Build ve kimlikler

- [x] Android package `com.ethemsincar.logisticore`.
- [x] iOS bundle `com.ethemsincar.logisticore`.
- [x] Firebase project `logisticore-53ab4`.
- [x] Functions region `us-central1`.
- [x] Expo SDK 54 / RN New Architecture / Hermes.
- [x] Android release signing debug keystore kullanmıyor.
- [x] Android version 1.0.10 / versionCode 11 config ve native Gradle'da eşleşiyor.
- [ ] Expo patch `~54.0.36` uyumu veya bilinçli exclude kararı.
- [ ] `expo-doctor` 17/17.
- [ ] EAS/CI production profile dokümante edildi.
- [-] iOS `CFBundleVersion` App Store Connect'teki son build'den yüksek.
- [-] Signed IPA archive ve distribution entitlement kontrolü.
- [ ] Production launcher icon, adaptive icon ve splash eklendi.
- [ ] Android AAB üzerinde final icon/splash görsel kontrolü.
- [-] iOS 1024×1024 App Store icon doğrulaması.

## Auth

- [x] Firebase app singleton.
- [x] Firebase Auth singleton ve AsyncStorage persistence.
- [x] Anonymous bootstrap auth-ready sonrasında.
- [x] Google credential ve interactive picker yolu mevcut.
- [x] Apple nonce/rawNonce ve missing-token guard mevcut.
- [x] Provider conflict reason mapping mevcut.
- [ ] Google A → B network failure rollback testi.
- [ ] Cloud'suz yeni hesap ekranında `Vazgeç` gerçek rollback yapıyor.
- [ ] Apple A → Apple B provider-aware switch.
- [-] Google login/signout/account switch gerçek Android release build.
- [-] Apple login/link/switch gerçek iPhone distribution build.

## Save ve veri güvenliği

- [x] Local save version/migration.
- [x] Cloud ownerUid ve checksum.
- [x] Restore journal/idempotency bounded.
- [x] Marketplace tombstone reconciliation.
- [x] Save payload bounded (14,641 byte test fixture).
- [ ] Corrupt save ana slotu kullanıcı kararı olmadan silinmiyor.
- [ ] Backup için görünür restore/export akışı test edildi.
- [ ] Local save `appVersion` runtime config ile eşleşiyor.
- [ ] Android Auto Backup policy ve UID isolation tanımlı.
- [-] App kill sırasında gerçek cihaz restore testi.

## Simulation/economy

- [x] 1.000 contract viability/profit testleri.
- [x] Delivery settlement idempotency.
- [x] Fuel partial tick/out-of-fuel/settlement double-charge testleri.
- [x] Offline progress ve second hydrate dedupe.
- [x] Cash ledger equality ve -$5,000 floor/recovery.
- [x] Truck/trailer resale exploit testi.
- [x] Warehouse trade/transfer testleri.
- [x] Delivery incident/random event save/idempotency testi.
- [x] 7/30 gün headless simulation.
- [ ] Eskimiş time/phase3/debug-contract testleri güncel ürün kararıyla yeniden yeşil.

## Backend ve security

- [x] 8 production function mevcut ve us-central1.
- [x] Global economy snapshot/history sağlıklı.
- [x] Marketplace double purchase emulator testi.
- [x] Direct marketplace/leaderboard document write kapalı.
- [x] Firestore emulator 40/40.
- [x] Composite index health.
- [ ] Cloud save canonical trust boundary kapatıldı.
- [ ] Marketplace migration/reconciliation yeni trust modeline taşındı.
- [ ] Account deletion production canary ve orphan record 0.
- [-] Firebase Console Google/Apple provider ayarları CLI dışı manuel doğrulandı.
- [ ] App Check post-release kararı dokümante edildi (V1 blocker değil).

## UI/navigation/safe area

- [x] Aktif route zinciri ve ekran error boundary'leri mevcut.
- [x] Ortak safe-area/tab bottom inset altyapısı mevcut.
- [x] Map aktif zinciri `MapScreen -> WorldMapCanvas -> InteractiveTurkeyMap`.
- [x] Legacy Turkey/Network canvas aktif import değil.
- [ ] 360 px Android görsel matrisi.
- [ ] 430 px Android görsel matrisi.
- [ ] Küçük iPhone ve notch/Dynamic Island matrisi.
- [ ] Font scale %120.
- [ ] Keyboard açık username modalı.
- [ ] Modal stacking: incident + offline summary + auth conflict.
- [ ] Son list item tab bar altında kalmıyor (tüm ekranlar, gerçek cihaz).

## Performance

- [x] `useGameStore(state => state)` broad selector bulunmadı.
- [x] Ana AppState listener cleanup mevcut.
- [x] Game loop interval cleanup kodu mevcut.
- [x] Map marker memoization/static testler mevcut.
- [ ] 50 hızlı tab geçişi gerçek cihaz.
- [ ] Ana ↔ Harita 10 tur < hedef süre.
- [ ] İşler ↔ Piyasa 10 tur.
- [ ] Background/foreground 10 tur.
- [ ] 30 dakika oturumda listener/timer artışı yok.
- [ ] Düşük RAM Android map/image memory profile.

## Monetization ve privacy

- [x] Ödül yalnız `EARNED_REWARD` eventinde.
- [x] Close event sahte ödül vermiyor.
- [x] Impression başına double reward guard.
- [x] Android/iOS AdMob App ID ve production rewarded unit formatları mevcut.
- [ ] Production test ad flag kapalı.
- [ ] UMP consent flow.
- [ ] ATT karar akışı ve privacy label eşleşmesi.
- [ ] Rewarded no-fill/network/timeout gerçek cihaz testi.
- [ ] Play Data safety formu manifest ve SDK davranışıyla eşleşiyor.
- [ ] App Store Privacy Nutrition Labels doğrulandı.

## Android policy

- [ ] `SYSTEM_ALERT_WINDOW` final AAB'den kaldırıldı.
- [ ] `READ_EXTERNAL_STORAGE` ve `WRITE_EXTERNAL_STORAGE` gereksinimi kaldırıldı veya gerekçelendirildi.
- [ ] `allowBackup`/data extraction policy tanımlı.
- [x] Target SDK 36.
- [x] Release bundle Metro server gerektirmeden embedded Hermes bundle içeriyor.

## iOS policy

- [x] Sign in with Apple entitlement configte mevcut.
- [ ] Distribution archive entitlements production değerlerinde.
- [ ] `aps-environment=production` signed archive üzerinde doğrulandı.
- [ ] `NSAllowsArbitraryLoads` kaldırıldı veya gerekçelendirildi.
- [ ] ATT/UMP gerçek cihazda.
- [ ] Google iOS callback scheme gerçek archive içinde.

## Final go/no-go

- [ ] Tüm BLOCKER kapalı.
- [ ] Tüm CRITICAL kapalı.
- [ ] Store env snapshot onaylandı.
- [ ] Android signed AAB canary geçti.
- [ ] iOS signed IPA/TestFlight canary geçti.
- [ ] Real-device smoke checklist tamamlandı.

**Mevcut karar: RELEASE BLOCKED**

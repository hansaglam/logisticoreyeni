# Critical Findings

Bu dosya yalnız release'i durduran veya doğrudan veri/güvenlik riski taşıyan kanıtları özetler. Ayrıntılı alanlar `RELEASE_AUDIT.md` içindedir.

## B-001 — Client-authoritative cloud save backend ekonomisine sızıyor

**Severity: BLOCKER**

Kanıt zinciri:

```text
authenticated client
  -> users/{uid}/saves/current (owner write allowed)
  -> backend reads gameState.player.money / trucks / progression
  -> marketplaceState.canonicalCash / ownership OR leaderboard score
```

- `firestore.rules:44-48`: owner kendi save dokümanını oluşturup güncelleyebilir; payload şeması veya ekonomi değerleri doğrulanmaz.
- `backend/src/vehicleMarketplaceState.ts:78-185`: `player.money` doğrudan `canonicalCash` olur; truck listesi canonical ownership snapshot'ına çevrilir.
- `backend/src/vehicleMarketplace.ts:287-358`: state yoksa ilk listing transaction'ı save'den canonical state yaratır.
- `backend/src/leaderboard.ts:131-170`: callable aynı save'den skor hesaplar.

Risk: Yeni hesap kendi save'ini manipüle edip sahte cash/araç/skor üretebilir; marketplace üzerinden başka oyuncu ekonomisine aktarabilir.

Gerekli çözüm yönü: Server-owned progression ledger/snapshot; client save yalnız backup/cache olmalı. Rules ve Functions deploy gerekir.

## B-002 — Account switch sonrası rollback yok

**Severity: BLOCKER**

Kanıt zinciri:

```text
sync old account
  -> interactive Google picker
  -> signInWithCredential(new account)
  -> cloud read
  -> conflict/new-account choice
```

- `src/services/authService.ts:1201`: Auth yeni hesaba geçirilir.
- `src/services/authService.ts:1206-1212`: cloud read bundan sonra yapılır; hata yolunda yalnız failure döner.
- `src/components/AccountSection.tsx:832-879`: failure yolunda eski Auth user restore edilmez.
- `src/components/AccountSection.tsx:871`: cloud'suz yeni hesap dialogundaki `Vazgeç` no-op'tur.

Risk: Yeni UID aktifken eski local save kalır. Sonraki sync yanlış hesaba kayıt yazabilir; hesaplar arası veri karışması ve overwrite mümkündür.

Gerekli çözüm yönü: Auth/local owner değişimini tek commit noktasıyla yönet; her failure/cancel yolunda rollback veya bloklayan recovery uygula. Yeni Android ve iOS binary gerekir.

## B-003 — Store reklam/mahremiyet config'i internal test modunda

**Severity: BLOCKER**

- `.env`: `EXPO_PUBLIC_ADS_USE_TEST_IDS=true`, `EXPO_PUBLIC_BACKEND_DIAGNOSTICS_ENABLED=true`.
- `npx expo config --type public`: bu değerlerin release bundle config'ine aktarıldığını doğruladı.
- `app.config.js:62` ve `src/services/adProvider.ts:6-9`: ATT/UMP açık TODO.

Risk: Store build test reklamı ve geliştirici paneliyle çıkar; consent/privacy beyanı uyuşmazlığı doğabilir.

Gerekli çözüm yönü: Ayrı production profile, fail-closed validator, UMP/ATT gerçek cihaz doğrulaması. Yeni Android/iOS binary gerekir.

## B-004 — Android restricted overlay permission

**Severity: BLOCKER**

- Kaynak manifest: `android/app/src/main/AndroidManifest.xml:5`.
- Final release merged manifest: `android.permission.SYSTEM_ALERT_WINDOW` mevcut.
- Oyunda overlay temel işlevi bulunmadı.

Risk: Google Play restricted permission/policy reddi.

Gerekli çözüm yönü: Permission'ı kaldır; yeni AAB manifestini doğrula.

## C-001 — Corrupt save otomatik ana-slot temizliği

**Severity: CRITICAL**

- `src/storage/saveGame.ts`: parse/migration başarısızlığında raw backup yazılıyor, ardından `logisticore_save_v1` siliniyor.
- Kullanıcıya backup restore/export akışı kanıtlanmadı.

Risk: Cloud erişilemezken yeni oyun başlatma ve fiili ilerleme kaybı.

Gerekli çözüm yönü: Recovery UI ve explicit kullanıcı kararı; ana slot doğrulanmış restore/rollback öncesi silinmemeli.

## Release gate

Bu dört blocker ve bir critical kapanmadan store submission yapılmamalıdır.

**Karar: RELEASE BLOCKED**

# Hesap Merkezi — Çıkış Yap & Hesabı Sil P0 Denetim Raporu

**Tarih:** 2026-08-13  
**Kapsam:** Yayın öncesi güvenlik ve davranış denetimi + P0 düzeltmeler

---

## Özet

| İşlem | Önce | Sonra |
|-------|------|-------|
| Çıkış Yap | Çalışıyordu; sync fail → logout **iptal** | Best-effort sync; logout **devam** |
| Hesabı Sil | Gerçek deletion vardı; reauth **yok** | 2 aşamalı onay + reauth retry |
| Tehlikeli bölümde çıkış | Önceki UI’da vardı | Yalnız Hesap sekmesinde |

---

## 1. Çıkış Yap — Exact Zincir

```
AccountConnectionTab → onSignOut
  → useAccountCenter.handleGoogleSignOut()
    → showDialog (onay)
    → executeGoogleSignOut()
      → syncBeforeSignOutBestEffort() [saveGame + syncLocalSaveToCloud force]
      → signOutGoogleAccountToGuest()
        → clearGoogleSignInSessionStrict()
        → Firebase signOut(auth)
        → resetAuthService()
        → initAnonymousAuth()  // yeni guest UID
      → clearAccountScopedClientState()
      → rebindLocalSaveToAuth()  // ownerUid → yeni guest
      → refreshAccount / refreshCloudStatus
```

**Buton bağlantısı:** `AccountConnectionTab` → `onSignOut={vm.handleGoogleSignOut}` — `Pressable`/`AccountActionRow`, pointerEvents engeli yok.

---

## 2. Çıkış Yap — Bulunan Sorunlar & Düzeltmeler

| Sorun | Risk | Düzeltme |
|-------|------|----------|
| `syncBeforeAccountTransition` fail → logout iptal | Kullanıcı çıkamıyor | `syncBeforeSignOutBestEffort` — fail olsa da devam |
| Onay metni spec dışı | UX | “Çıkış yapmak istiyor musun?” + koruma mesajı |
| `ownerUid` eski linked UID’de kalabilir | Yanlış UID’ye yazım riski | `rebindLocalSaveToAuth()` logout sonrası |
| Username cache temizlenmiyordu | Eski kimlik UI’da | `setUsernameProfile(null)` clearAccountScopedClientState içinde |
| Sessiz sync fail | Kullanıcı bilgilendirilmiyor | Sync fail mesajı success alert’te |

**Korunan:** Marketplace listing cache temizliği, cloud sync state reset, `isSigningOut` guard, marketplace operation block.

---

## 3. Çıkış Sonrası State

| Alan | Davranış |
|------|----------|
| `auth.currentUser` | Yeni anonymous user |
| providerData | Eski linked hesap yok |
| Account UI | Guest / bağlı değil |
| Cloud write | `assertLocalSaveOwnerMatchesAuth` + yeni ownerUid |
| Marketplace cache | `activeMarketplaceListingIds: []` |
| Username cache | null |
| Local progress | Cihazda kalır; guest owner’a rebind |

**Ürün politikası:** Linked cloud save guest’e claim edilmez. Explicit account switch policy korunur.

---

## 4. Hesabı Sil — Exact Zincir

```
DangerZoneCard → onDelete → handleDeleteAccount()
  → Dialog 1: “Hesabı Sil” / Devam Et
  → Dialog 2: “Hesabı Kalıcı Olarak Sil”
  → runAccountDeletionFlow()
    → gameStore.deleteAccountAndCloudData()
      → deleteAccountAndCloudData() [accountDeletion.ts]
        1. beginAccountDeletion()
        2. deleteUserCloudData(uid)
           → prepareVehicleMarketplaceAccountDeletion() [backend Admin SDK]
              → marketplace cleanup
              → releaseUsernameForUid
              → recursiveDelete users/{uid}
              → deleteLeaderboardEntriesForUid
           → client batch delete (fallback)
        3. deleteCurrentFirebaseUser()  // deleteUser()
        4. clearLocalSave (fresh game)
        5. resetCloudSaveSyncState + resetCloudFirestoreCache
        6. initAnonymousAuth()
        7. endAccountDeletion()
```

**Gerçek deletion:** Evet — bilgi sayfası değil. `Hesap Silme Bilgileri` ayrı legal link.

---

## 5. Hesabı Sil — Bulunan Sorunlar & Düzeltmeler

| Sorun | Risk | Düzeltme |
|-------|------|----------|
| `requires-recent-login` → sadece hata | Silme tamamlanmıyor | `reauthenticateCurrentUser()` + `skipCloudDelete` retry |
| Üç parçalı onay (screen + hook) | Karmaşık UX | Tek hook’ta 2 dialog |
| Cloud silindikten sonra auth fail | Orphan auth user | Reauth retry yalnız auth+local adımları |
| Structured logging eksik | Debug zor | `accountLifecycleLog.ts` + diagnosticId |

**Henüz yok (bilinçli backlog):**
- Tek `deleteMyAccount()` callable adı (mevcut: `prepareVehicleMarketplaceAccountDeletion` + client batch)
- “SİL” text input onayı (2 destructive dialog ile korunuyor)

---

## 6. Backend Deletion Orchestration

`prepareVehicleMarketplaceAccountDeletion` (Firebase Callable):

- `request.auth.uid` — client UID gönderilmez
- Marketplace listing cleanup
- `releaseUsernameForUid` — yalnız eşleşen UID mapping
- `recursiveDelete(users/{uid})`
- `deleteLeaderboardEntriesForUid`

Rate limit: 3 / 24h per UID.

---

## 7. Cross-Platform Cleanup Matrisi

| Veri | Siliniyor mu? |
|------|----------------|
| Firestore user profile/saves/meta | ✅ (Admin recursive + client batch) |
| Username reservation | ✅ (UID match transaction) |
| Leaderboard entries | ✅ (Admin) |
| Marketplace active listings | ✅ (callable) |
| Firebase Auth user | ✅ (`deleteUser`) |
| Local save | ✅ (fresh game state) |
| Global prefs (dil/ses/titreşim) | ✅ Korunur |
| Başka UID verisi | ❌ Dokunulmaz |

---

## 8. Reauthentication

| Provider | Akış |
|----------|------|
| Google | `createGoogleFirebaseCredential({ forceInteractivePicker: true })` → `reauthenticateWithCredential` |
| Apple | `signInWithAppleAccount()` (fresh nonce) → `reauthenticateWithCredential` |
| Cancel | Hiçbir veri silinmez |
| Guest | Doğrudan local/anonymous cleanup |

---

## 9. Test Sonuçları

| Komut / Test | Sonuç |
|--------------|-------|
| `npm run typecheck` | PASS |
| `npm run verify` | PASS |
| `account-signout-deletion-regression-test.ts` | PASS (32) |
| `account-center-ui-regression-test.ts` | PASS |
| `account-switch-flow-test.ts` | PASS |
| `account-switch-isolation-security-test.ts` | PASS (verify içinde) |
| `expo export --platform android` | PASS |
| `expo export --platform ios` | PASS |
| `git diff --check` | PASS |

---

## 10. Gerçek Cihaz Testi (Manuel — Kalan)

### A — Çıkış Yap
1. Linked hesaba gir → cloud sync success
2. Hesap → Çıkış Yap → onay
3. UI guest; restart → otomatik linked dönmemeli
4. Yeni guest UID ≠ eski linked UID; ownerUid eşleşmeli

### B — Hesap Sil (test hesabı)
1. Username + cloud save + (varsa) listing + leaderboard
2. Tehlikeli İşlemler → 2 onay → reauth gerekirse tamamla
3. Auth user yok; Firestore user yok; username mapping yok
4. App restart → eski save restore olmamalı

---

## 11. Değişen Dosyalar

- `src/hooks/useAccountCenter.ts` — sign-out/delete P0
- `src/services/authService.ts` — `reauthenticateCurrentUser`
- `src/utils/accountDeletion.ts` — logging, skipCloudDelete, reauth helper
- `src/utils/accountLifecycleLog.ts` — structured logs
- `src/store/gameStore.ts` — deletion options
- `src/screens/AccountCenterScreen.tsx` — delete flow simplify
- `src/components/accountCenter/DangerZoneCard.tsx`
- `src/components/accountCenter/AccountPreferencesTab.tsx`
- `scripts/account-signout-deletion-regression-test.ts`
- `package.json` (verify)

---

## 12. AAB/APK/IPA

**Üretilmedi** (istek gereği).

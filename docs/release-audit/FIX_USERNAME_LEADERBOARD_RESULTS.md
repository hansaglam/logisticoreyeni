# FIX: Username + Leaderboard Services — Results

**Date:** 2026-08-06  
**Scope:** Kullanıcı adı oluşturma + haftalık liderlik tablosu servis hataları  
**Verdict:** Client düzeltmeleri tamamlandı — **production Functions deploy gerekli**

---

## 1. Username servis kök nedeni

**Birincil (production):** Username callables (`setUsername`, `checkUsernameAvailability`, `getUsernameProfile`) **Firebase production'da deploy edilmemiş**. Client `httpsCallable` çağrısı `functions/not-found` alıyor; eski kod bunu genel `service-unavailable` ("Servis geçici olarak kullanılamıyor") olarak gösteriyordu.

**İkincil (client):** Tüm catch blokları aynı mesaja düşüyordu; network/timeout/function-not-found ayrımı yoktu. Account switch sırasında stale response koruması yoktu.

---

## 2. Leaderboard servis kök nedeni

**Birincil (production):** `getLeaderboard` ve `submitLeaderboardScore` callables production'da **yok** (aynı eksik deploy bundle).

**İkincil (client):** `functions/not-found` → `service-unavailable` → genel "Sıralama yüklenemedi" mesajı. `server-state-not-initialized` backend reason'ı client'ta ayrı ele alınmıyordu.

**Üçüncül (ürün zinciri):** Username oluşturulamadığı için `submitLeaderboardScore` `username-required` döner; leaderboard katılımı username'e bağlı.

---

## 3. Function isimleri ve region

| Callable | Client | Backend export |
|----------|--------|----------------|
| Username profil | `getUsernameProfile` | `export const getUsernameProfile` |
| Müsaitlik | `checkUsernameAvailability` | `export const checkUsernameAvailability` |
| Claim | `setUsername` | `export const setUsername` |
| Leaderboard read | `getLeaderboard` | `export const getLeaderboard` |
| Score submit | `submitLeaderboardScore` | `export const submitLeaderboardScore` |
| Migration | — | `migrateLegacyServerState` |

**Region:** `us-central1` (client `FIREBASE_FUNCTIONS_REGION` + backend `VEHICLE_MARKETPLACE_FUNCTION_OPTIONS`)

**Not:** `createUsername` / `claimUsername` / `reserveUsername` yok — canonical API `setUsername`.

---

## 4. Firebase project

- **Project ID:** `logisticore-53ab4`
- **Client:** `EXPO_PUBLIC_FIREBASE_PROJECT_ID` / `expo.extra.firebase.projectId`

---

## 5. App Check durumu

- **Enforced:** Hayır (backend `onCall` options'ta `enforceAppCheck` yok; client App Check init yok)
- Hata sınıflandırması hazır (`app-check-failed`) ancak şu an aktif değil

---

## 6. Auth gereksinimi

| Servis | Gereksinim |
|--------|------------|
| Username | Signed-in, anonymous **reddedilir** |
| Leaderboard read | Signed-in, anonymous reddedilir |
| Leaderboard submit | Signed-in + `usernameSetupCompleted` |
| Client UI gate | Google veya Apple linked account (`isLeaderboardEligible`) |

---

## 7. Username transaction yapısı

Backend `setUsername` → `setUsernameTransaction()` (Firestore transaction):

1. Auth UID doğrula
2. Canonical username (`tr-TR` lowercase)
3. `usernames/{canonical}` registry kontrolü
4. `users/{uid}` profile güncelle
5. `publicProfiles/{uid}` güncelle
6. Mevcut season leaderboard entry varsa username merge
7. Atomik commit

Client **doğrudan yazmaz** — yalnız callable.

---

## 8. Firestore rules

| Path | Client read | Client write |
|------|-------------|--------------|
| `usernames/{canonical}` | ❌ | ❌ |
| `leaderboards/{season}/entries/{uid}` | ✅ (signedIn) | ❌ |
| `users/{uid}` username fields | — | ❌ (usernameFieldsUnchanged) |

B-001 trust boundary uyumlu: client save cash/score leaderboard'a taşınmaz.

---

## 9. Leaderboard veri kaynağı

- **Read:** `getLeaderboard` callable → `leaderboards/{seasonKey}/entries` (Admin SDK)
- **Score:** `submitLeaderboardScore` → server `users/{uid}/serverState/current` + `calculateLeaderboardScore()`
- **Client göndermez:** `companyScore`, `cash`, raw progression
- **Local save:** Leaderboard kaynağı değil

---

## 10. B-001 uyumluluğu

- Server-owned score path mevcut (`backend/src/leaderboardScore.ts`, `serverState.ts`)
- Client malicious save ile leaderboard spoof yok
- Production'da server state migration deploy sonrası gerekli (`migrateLegacyServerState`)

---

## 11–12. Android / iOS sonucu

- Ortak `callableServiceUtils.ts`, `usernameService.ts`, `leaderboardService.ts`
- Platform-specific business logic hack yok
- Auth stale guard, 25s timeout, structured `[username-service]` / `[leaderboard-service]` log
- Username success → `notifyUsernameProfileChanged()` → LeaderboardScreen auto-refresh
- `npx expo export` android/ios — PASS

---

## 13. Değişen dosyalar

| Dosya | Değişiklik |
|-------|------------|
| `src/services/callableServiceUtils.ts` | **Yeni** — error mapping, timeout, logging, auth stale guard |
| `src/services/usernameProfileEvents.ts` | **Yeni** — cross-screen username change notify |
| `src/services/usernameService.ts` | Structured errors, logging, stale auth, profile notify |
| `src/services/leaderboardService.ts` | Error codes, timeout, logging, malformed entry filter |
| `src/domain/usernameValidation.ts` | Specific user messages, new reason types |
| `src/components/username/UsernameSetupModal.tsx` | 450ms debounce, stale auth discard, generation guard |
| `src/screens/LeaderboardScreen.tsx` | Specific errors, username profile subscription + refresh |
| `scripts/username-leaderboard-service-regression-test.ts` | **Yeni** regression test |

---

## 14. Test sonuçları

| Komut | Sonuç |
|-------|--------|
| `npm run typecheck` | PASS |
| `npm run verify` | PASS |
| `npx tsx scripts/username-leaderboard-service-regression-test.ts` | **36 PASS, 0 FAIL** |
| `npm run test:rules` | **Script tanımlı değil** — `npm run backend:verify` emulator suite kullanın |
| `npx expo export --platform android` | PASS |
| `npx expo export --platform ios` | PASS |

Mevcut emulator testleri: `backend/test/username.emulator.test.ts`, `backend/test/leaderboard.emulator.test.ts`

---

## 15. Gerekli deploy komutları (production — otomatik çalıştırılmadı)

```bash
# 1. Backend functions (eksik 6 callable)
cd backend
npm run build
firebase deploy --only functions:setUsername,functions:checkUsernameAvailability,functions:getUsernameProfile,functions:submitLeaderboardScore,functions:getLeaderboard,functions:migrateLegacyServerState --project logisticore-53ab4

# 2. Firestore rules + indexes
firebase deploy --only firestore:rules,firestore:indexes --project logisticore-53ab4

# 3. Doğrulama
firebase functions:list --project logisticore-53ab4
npm run backend:verify
```

**Client build env:**
```
EXPO_PUBLIC_LEADERBOARD_ENABLED=true
EXPO_PUBLIC_FIREBASE_PROJECT_ID=logisticore-53ab4
```

---

## 16. Migration / backfill

- `migrateLegacyServerState` callable deploy sonrası dry-run + production migration
- Mevcut kullanıcılar için `users/{uid}/serverState/current` bootstrap gerekebilir
- Username registry backfill: kullanıcılar `setUsername` ile claim eder (otomatik backfill yok)

---

## 17. Manuel cihaz test gereksinimi

Functions deploy sonrası gerçek Android + iPhone'da:

1. Google/Apple bağlı hesap
2. Liderlik → username kartı
3. Geçersiz / alınmış / uygun isim
4. Submit + leaderboard refresh (restart gerekmemeli)
5. Account switch stale response testi
6. Network kesme / reconnect

---

## Kabul kriterleri

| Kriter | Durum |
|--------|-------|
| Username uygun olduğunda oluşturulur | Kod hazır — **deploy gerekli** |
| Aynı username ikinci kullanıcıya verilemez | Backend transaction ✅ |
| Registry client yazamaz | Rules ✅ |
| Leaderboard server-owned | Callable + serverState ✅ |
| Local save leaderboard kaynağı değil | ✅ |
| Username sonrası leaderboard refresh | `notifyUsernameProfileChanged` ✅ |
| Account switch stale guard | `isAuthContextStale` ✅ |
| Android = iOS business logic | Ortak services ✅ |
| Spesifik hata mesajları | ✅ (deploy sonrası doğrulanmalı) |

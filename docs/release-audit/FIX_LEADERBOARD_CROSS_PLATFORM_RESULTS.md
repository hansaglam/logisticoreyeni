# Leaderboard Cross-Platform (Android ↔ iOS) — Results

**Date:** 2026-08-13  
**Scope:** P0/P1 pre-release doğrulama — tek ortak liderlik tablosu, server-owned season/score, güvenlik  
**Builds:** AAB/APK/IPA/Xcode Archive **üretilmedi** (görev kapsamı dışı)

---

## Özet (Kabul Durumu)

| Kriter | Durum |
|--------|-------|
| Android ↔ iOS aynı Firebase production backend | **PASS** |
| Tek collection/path (`leaderboards/{seasonKey}/entries/{uid}`) | **PASS** |
| Season key server-owned | **PASS** |
| Score server-owned (`serverState` → `calculateLeaderboardScore`) | **PASS** |
| Platform filtresi yok | **PASS** |
| Google/Apple provider sıralamayı etkilemiyor | **PASS** |
| Cross-platform görünürlük (kod + emulator) | **PASS** |
| Same UID duplicate yok | **PASS** |
| Username cross-platform (server mapping) | **PASS** |
| Reputation `serverState` kaynaklı | **PASS** |
| Anonymous submit yok | **PASS** |
| Account switch reset | **PASS** |
| Firestore client write deny | **PASS** |
| Backend deploy gerekli mi? | **Hayır** (mevcut prod uyumlu; yalnız test/log eklendi) |

---

## 1. Mevcut Leaderboard Mimarisi

### Canonical akış

```
linked user (Google veya Apple, non-anonymous)
  → username (users/{uid} + usernameSetupCompleted)
  → ensureServerStateMigrated()
  → submitLeaderboardScore callable (client score göndermez)
  → backend: getLeaderboardSeasonKey(nowMs)
  → backend: serverState → calculateLeaderboardScore
  → upsert leaderboards/{seasonKey}/entries/{auth.uid}
  → getLeaderboard callable
  → sıralı response (companyScore DESC, uid ASC)
  → LeaderboardScreen render (platform filtresi yok)
```

### Dosya haritası

| Katman | Dosya |
|--------|-------|
| UI | `src/screens/LeaderboardScreen.tsx` |
| Client service | `src/services/leaderboardService.ts` |
| Submit eligibility | `src/domain/leaderboardSubmitEligibility.ts` |
| Screen state | `src/domain/leaderboardScreenState.ts` |
| Cloud sync hook | `src/storage/cloudSaveSync.ts` |
| Backend transaction | `backend/src/leaderboard.ts` |
| Score calculator | `backend/src/leaderboardScore.ts` |
| Season key | `backend/src/leaderboardSeason.ts` |
| Callables | `backend/src/index.ts` (`submitLeaderboardScore`, `getLeaderboard`) |
| Rules | `firestore.rules` |

### Kontrol sonuçları

| Soru | Sonuç |
|------|-------|
| Android/iOS farklı collection? | **Hayır** — `leaderboards/{seasonKey}/entries/{uid}` |
| `Platform.OS` ile farklı function adı? | **Hayır** — `submitLeaderboardScore`, `getLeaderboard` |
| Farklı Firebase project? | **Hayır** — `logisticore-53ab4` |
| iOS farklı projectId? | **Hayır** — `GoogleService-Info.plist` = `logisticore-53ab4` |
| seasonKey client’tan mı? | **Hayır (authoritative)** — submit/get backend `getLeaderboardSeasonKey(nowMs)`; client `getLeaderboardSeasonKey()` yalnız hata/fallback UI |
| Client timezone seasonKey etkisi? | **Yok (submit/get)** — backend UTC ISO hafta |
| Score client’tan mı? | **Hayır** — callable `score`/`companyScore` payload reddi |
| Username mapping aynı mı? | **Evet** — `users/{uid}.username` server-side |
| getLeaderboard platform filtresi? | **Yok** |
| Cache platforma göre ayrı mı? | **Hayır** — in-memory submit throttle; persistent platform cache yok |

---

## 2. Tek Canonical Leaderboard Path

```
leaderboards/{seasonKey}/entries/{uid}
```

Yasak path’ler (`leaderboards/android`, `entries_ios`, vb.) **kodda yok**.

Entry payload platform metadata içermiyor; ranking `platform` alanına bağlı değil.

---

## 3. Server-Owned Season Key

- **Backend:** `getLeaderboardSeasonKey(nowMs)` — UTC ISO-8601 (`2026-W33`)
- **submitLeaderboardScore:** `seasonKey` response’ta backend’den
- **getLeaderboard:** aktif sezon backend’den; geçmiş sezon `season-closed`
- **Client:** `fetchWeeklyLeaderboard` seasonKey göndermiyor (backend current season)

Android submit seasonKey = iOS submit seasonKey (aynı backend clock/UTC kuralı).

---

## 4. Score — Tek Server Kuralı

`calculateLeaderboardScore(extractCanonicalPlayerStateFromServerState(serverState))`

Kaynak alanlar (`serverState`):

- `cash`, `companyLevel`, `reputation`, `completedDeliveries`
- `ownedTrucks`, `warehouses`
- `failedDeliveries`, `lateDeliveries`

Client `companyScore` gönderemez (`index.ts` spoof guard). Max-score policy: daha yüksek skor korunur (`score-not-improved`).

Platforma özel score branch **yok**.

---

## 5. Reputation Senkronu

Leaderboard reputation **yalnız** `serverState.reputation` → `extractCanonicalPlayerStateFromServerState` → `calculateLeaderboardScore`.

Client-local reputation doğrudan submit’e yazılmaz. Kötü niyetli cloud save skoru değiştiremez (emulator test: `malicious cloud save write does not change leaderboard score` — **PASS**).

---

## 6. Firebase Project / Env Parity

| Alan | Android | iOS |
|------|---------|-----|
| projectId | `logisticore-53ab4` | `logisticore-53ab4` |
| storage bucket | `logisticore-53ab4.firebasestorage.app` | aynı |
| functions region | `us-central1` | `us-central1` |
| appId | platform-specific (normal) | platform-specific (normal) |

`app.config.js` → `extra.firebase` + `firebaseFunctionsRegion: 'us-central1'` her iki platform için ortak.

**Dev structured log eklendi:**

```text
[leaderboard-backend-config] {
  platform, projectId, functionsRegion, authenticated, anonymous,
  seasonKeySource: 'server'
}
```

---

## 7. Auth / User ID

- Entry key = Firebase `auth.uid`
- Google (`google.com`) ve Apple (`apple.com`) aynı koleksiyonda
- Provider type ranking’i etkilemez
- Anonymous → `anonymous-not-supported` (client callable çağırmaz; backend de reddeder)

---

## 8. Username Parity

- Canonical: `users/{uid}.username` + `usernameSetupCompleted`
- `LeaderboardScreen` username yoksa submit/fetch öncesi `username-required` UI
- Android’de oluşturulan username iOS response’unda görünür (aynı Firestore doc)
- Client-local username cache leaderboard sıralamasını etkilemez

---

## 9. Submit Eligibility

**Client (`getLeaderboardSubmitEligibility`):**

- linked + non-anonymous + Google/Apple
- anonymous → callable yok, `[leaderboard-submit-skipped]` (cooldown ile spam yok)

**Backend (transaction):**

- username + `usernameSetupCompleted`
- valid `serverState`

Username kontrolü backend’de authoritative; UI ayrıca `fetchUsernameProfile` ile erken gösterir.

---

## 10–11. getLeaderboard — Filtre ve Sıralama

Query:

```text
orderBy('companyScore', 'desc')
orderBy(FieldPath.documentId(), 'asc')
```

`where('platform', ...)` **yok**. Client-side platform filter **yok**.

---

## 12. Pagination

Cursor: `{ companyScore, uid }` — platform-bağımsız.

Emulator test: `cross-platform pagination returns mixed entries without platform cursor` — **PASS**.

---

## 13. Cache

- Submit throttle: in-memory (`lastSuccessfulSubmitAt`), platform key yok
- `leaderboard-cache-android` / `ios` **yok**
- Refresh → `fetchWeeklyLeaderboard` backend’den tam liste

---

## 14. Account Switch

`LeaderboardScreen`:

- `lastAuthUidRef` değişince → `resetLeaderboardSubmitCache()` + `{ status: 'loading' }`
- `isPlayer` = `item.uid === currentUid`

---

## 15–16. Cross-Device / Cross-Platform Senaryoları

| Senaryo | Emulator | Gerçek cihaz |
|---------|----------|--------------|
| Android + iOS aynı tablo | **PASS** | Manuel (aşağıda) |
| Same UID iki submit → tek entry | **PASS** | Manuel |
| androidtest > iostest sıra | **PASS** | Manuel |

---

## 18. Backend Response Shape

`getLeaderboard` döner:

- `seasonKey`, `seasonStartMs`, `seasonEndMs`
- `entries[]` (uid, username, companyName, companyScore, level, reputation, completedContracts, rank, updatedAtMs)
- `playerEntry`, `playerRank`, `hasMore`, `nextCursor`, `totalParticipants`

Email/provider **yok**.

---

## 19. Security

| Kontrol | Sonuç |
|---------|-------|
| Client direct write leaderboard | **DENY** (rules) |
| Callable submit (Admin SDK) | **ALLOW** |
| Client score spoof | **REJECT** |
| Android/iOS aynı model | **Evet** |

---

## 20. Duplicate Entry

Document ID = `uid`. Android + iOS submit → tek satır upsert. Max score korunur.

---

## 21. UI Parity

`LeaderboardScreen` platform-agnostic:

- Aynı backend response → aynı rank/username/score
- iOS/Android yalnız layout/font (sıralama verisi etkilenmez)

---

## 22. Structured Logs (yeni)

| Log | Ne zaman |
|-----|----------|
| `[leaderboard-backend-config]` | İlk submit/fetch (__DEV__) |
| `[leaderboard-cross-platform]` | Başarılı fetch/submit (__DEV__) |
| `[leaderboard-submit-skipped]` | Beklenen skip (cooldown) |
| `[leaderboard-service]` | Callable stage/result |

Production verbose kapalı (`__DEV__` guard).

---

## 23–25. Test Sonuçları

### Client / static

| Test | Sonuç |
|------|-------|
| `npm run typecheck` | **PASS** |
| `npm run verify` | **PASS** |
| `leaderboard-regression-test.ts` | **PASS** |
| `leaderboard-eligibility-test.ts` | **PASS** |
| `leaderboard-cross-platform-regression-test.ts` | **PASS** (yeni) |
| `username-leaderboard-service-regression-test.ts` | **PASS** |
| `reputation-regression-test.ts` | **PASS** |
| `account-switch-flow-test.ts` | **PASS** |

### Backend / emulator

| Test | Sonuç |
|------|-------|
| `npm run firebase:emulators:test` | **PASS** (49/49) |
| direct client write denied | **PASS** |
| trusted score from serverState | **PASS** |
| cross-platform shared table | **PASS** (yeni) |
| same UID no duplicate | **PASS** (yeni) |
| pagination mixed | **PASS** (yeni) |
| username required | **PASS** |
| max score policy | **PASS** |

### Export

| Komut | Sonuç |
|-------|-------|
| `npx expo export --platform android` | **PASS** |
| `npx expo export --platform ios` | **PASS** |
| `git diff --check` | **PASS** |

---

## 27. Backend Deploy

**Deploy gerekmez** — leaderboard cross-platform davranışı mevcut production Functions’ta zaten doğru.

Bu görevde değişenler:

- Client: dev diagnostic loglar (`leaderboardService.ts`)
- Test: `leaderboard-cross-platform-regression-test.ts`, emulator cross-platform testleri
- `package.json` verify zincirine yeni test

Functions kodu (`leaderboard.ts`, `index.ts`) **değiştirilmedi**.

---

## 28. Platform Özet Tablosu (Bölüm 30)

| Alan | Android | iOS |
|------|---------|-----|
| projectId | `logisticore-53ab4` | `logisticore-53ab4` |
| functions region | `us-central1` | `us-central1` |
| collection/path | `leaderboards/{seasonKey}/entries/{uid}` | aynı |
| platform filtresi | Yok | Yok |
| seasonKey source | Server | Server |
| score source | `serverState` + `calculateLeaderboardScore` | aynı |
| reputation sync | `serverState.reputation` | aynı |
| Google user | Eligible, shared table | Görünür |
| Apple user | Görünür | Eligible, shared table |
| Android → iOS visibility | Emulator **PASS** | — |
| iOS → Android visibility | — | Emulator **PASS** |
| same UID duplicate | **PASS** | **PASS** |
| username parity | Server `users/{uid}` | aynı |
| security | Callable-only write | aynı |
| AAB/APK/IPA | **Üretilmedi** | **Üretilmedi** |

---

## 26. Gerçek Cihaz — Kalan Manuel Kabul

Emulator + static audit tamamlandı. Production smoke için önerilen manuel checklist:

**A — Farklı kullanıcılar**

1. Android: Google A, username oluştur, leaderboard aç (submit)
2. iPhone: Apple B, username oluştur, leaderboard aç
3. Her iki cihazda refresh → karşı platform kullanıcısı görünmeli, sıra aynı

**B — Skor güncelleme**

1. Android’de şirket puanı artır → refresh iOS’ta yeni skor
2. iOS’ta artır → refresh Android’de yeni skor

**C — Aynı hesap**

1. Aynı Firebase hesabı iki cihazda → tek sıra satırı, duplicate yok

---

## Kod Değişiklikleri (bu audit)

| Dosya | Değişiklik |
|-------|------------|
| `src/services/leaderboardService.ts` | `[leaderboard-backend-config]`, `[leaderboard-cross-platform]` dev logları |
| `scripts/leaderboard-cross-platform-regression-test.ts` | Yeni static parity testi |
| `backend/test/leaderboard.emulator.test.ts` | Cross-platform + pagination + same-UID testleri |
| `package.json` | verify zincirine cross-platform test |

---

## Sonuç

Liderlik tablosu **tek backend, tek path, server-owned season/score** modeliyle Android ve iOS arasında cross-platform uyumlu. Platform filtresi, ayrı koleksiyon veya client score spoof yolu **yok**. Emulator ve regression testleri PASS. Production Functions deploy **gerekmez**. Gerçek cihaz smoke (Bölüm 26) yayın öncesi son adım olarak önerilir.

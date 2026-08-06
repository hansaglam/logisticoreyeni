# FIX: Market Live/Cache Banner — Results

**Date:** 2026-08-06  
**Scope:** Piyasa ekranı “Çevrimdışı piyasa verisi” uyarısının yanlış görünmesi  
**Verdict:** Implementation complete

---

## 1. Kesin kök neden

**Birincil:** `applyOfflineProgressionIfNeeded()` offline catch-up sonrası `globalMarketSyncStatus`'u **koşulsuz** `'offline-cache'` yapıyordu — başarılı live fetch (`'online'`) dahil.

**Boot sırası:**
1. `initializeGame()` → `await refreshMarketSnapshot()` → Firestore başarılı → `'online'`
2. `finally` → `applyOfflineProgressionIfNeeded('cold-start')` → **`'offline-cache'`** (üzerine yazıyor)

**Foreground:** Aynı downgrade App foreground’da tekrarlanıyordu.

Sonuç: kullanıcı internete bağlı olsa bile Piyasa ekranı cached banner gösteriyordu; “17 dk önce” cache timestamp’i doğruydu (gerçek son sync), ancak sync status yanlış düşürülmüştü.

**İkincil (dev):** `getGlobalEconomyRepository()` `__DEV__` modunda her zaman in-memory repo döndürüyordu; Firestore hiç denenmiyordu. `development-fallback` source `'online'` sayılmıyordu.

---

## 2. Live fetch kaynağı

| Katman | Kaynak |
|--------|--------|
| Production | Firestore `globalEconomy/current` via `FirestoreGlobalEconomyRepository` |
| Dev (Firebase yapılandırılmış) | Aynı Firestore path |
| Dev (Firebase yok) | `InMemoryGlobalEconomyRepository` (`development-fallback`) |
| Orchestrator | `gameStore.refreshMarketSnapshot()` |
| Auth gate | `initAnonymousAuth()` + `canReadGlobalEconomy({ authReady, userPresent })` |

---

## 3. Cache key ve timestamp

| Alan | Değer |
|------|--------|
| AsyncStorage key | `logisticore_global_economy_cache_v1` |
| Cache record | `{ snapshot, loadedAt, trusted: true, schemaVersion: 1 }` |
| UI timestamp | `globalMarketLastSyncedAtMs` ← `loadedAt` veya `serverTimeMs` |
| Save file | `cachedGlobalEconomySnapshot` persist; `globalMarketSyncStatus` persist **değil** |

---

## 4. Hata sınıflandırması

Yeni modül: `src/services/marketDataState.ts`

| Backend code | Market failure reason |
|--------------|----------------------|
| `unavailable` + offline | `network-unavailable` |
| `unavailable` + online | `function-unavailable` |
| `deadline-exceeded` | `timeout` |
| `permission-denied` | `permission-denied` |
| `unauthenticated` | `unauthenticated` |
| `not-found` | `document-missing` |
| `invalid-snapshot` / `parse-failed` | `malformed-response` |

Internal log: `[market-sync] { stage, source, status, failureReason, cacheAgeMs, hasCachedData, authReady, isOnline }`

---

## 5. Refresh davranışı

- Sağ üst refresh → `handleRefreshMarket()` → `await refreshMarketSnapshot()` (cooldown bypass)
- Duplicate request: `marketRefreshInFlightRef` + `globalMarketRefreshInFlight`
- Başarı: `fetchUiStatus = 'success'`, banner “Piyasa verileri güncellendi”
- Başarısızlık: cache korunur, mesaj “Canlı veriye ulaşılamadı. Son kayıtlı veriler gösteriliyor.”
- `maybeRefreshMarketSnapshot()` — ekran açılışı / foreground; `MARKET_REFRESH_COOLDOWN_MS = 60_000`

---

## 6. Lifecycle davranışı

| Tetikleyici | Davranış |
|-------------|----------|
| Cold start | `refreshMarketSnapshot` → offline progression (live korunur) |
| Foreground | `applyOfflineProgressionIfNeeded` → `maybeRefreshMarketSnapshot('foreground')` |
| Piyasa ekranı açılışı | `notifyMarketScreenOpened` → `maybeRefreshMarketSnapshot('screen-open')` |
| Manuel refresh | `refreshMarketSnapshot` (force, cooldown yok) |
| Economy tick (24h) | `refreshMarketSnapshot` |

Sürekli polling yok; minimum 60s cooldown otomatik refresh’lerde.

---

## 7. UI davranışı

| `marketDataState.status` | Banner |
|--------------------------|--------|
| `live` | Yok |
| `cached` | “Son kayıtlı piyasa verileri” (veya gerçek offline ise “Çevrimdışı…”) |
| `unavailable` | “Piyasa verilerine ulaşılamıyor” |
| `loading` | Loading state |

Cached metin: `Canlı piyasa verisine şu anda ulaşılamıyor. Son senkronizasyon: X dk önce.`

“Çevrimdışı” yalnız `network-unavailable` iken kullanılır.

---

## 8. Android / iOS sonucu

- Ortak `marketDataState.ts` + `gameStore.refreshMarketSnapshot`
- Platform-specific hack yok
- `npx expo export --platform android` — PASS
- `npx expo export --platform ios` — PASS

---

## 9. Değişen dosyalar

| Dosya | Değişiklik |
|-------|------------|
| `src/services/marketDataState.ts` | **Yeni** canonical state machine + cache age + logging |
| `src/store/gameStore.ts` | Live sync koruma, `maybeRefreshMarketSnapshot`, market sync log |
| `src/screens/MarketScreen.tsx` | Banner/state, refresh mesajları, metric strip label |
| `src/services/globalEconomyRepository.ts` | Dev’de Firebase varsa Firestore kullan |
| `App.tsx` | Foreground `maybeRefreshMarketSnapshot` |
| `scripts/market-live-cache-regression-test.ts` | **Yeni** regression test |

---

## 10. Test sonuçları

| Komut | Sonuç |
|-------|--------|
| `npm run typecheck` | PASS |
| `npm run verify` | PASS |
| `npx tsx scripts/market-live-cache-regression-test.ts` | **33 PASS, 0 FAIL** |
| `npx expo export --platform android` | PASS |
| `npx expo export --platform ios` | PASS |

---

## Kabul kriterleri

| Kriter | Durum |
|--------|-------|
| Canlı veri gelince cached uyarısı kaybolur | `preserveLiveMarketSync` + state machine |
| Refresh gerçek backend fetch yapar | `refreshMarketSnapshot` |
| Cache fallback korunur | Hata path değişmedi |
| Network vs backend hatası ayrılır | `classifyMarketFailureReason` |
| Android = iOS | Ortak service, platform hack yok |

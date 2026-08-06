# FIX: Map Truck Heading — Results

**Date:** 2026-08-06  
**Scope:** Harita ekranı aktif teslimat aracı ikonu yönü (Android + iOS ortak)  
**Verdict:** Implementation complete — manuel cihaz doğrulaması gerekli

---

## 1. Kesin kök neden

İki birleşik hata vardı; ikisi de platform-specific değildi:

### A. Yanlış asset base orientation (birincil — ~180° görsel hata)

`TRUCK_ICON_BASE_ROTATION_DEG` değeri `0` iken kod, MaterialCommunityIcons `truck-outline` ikonunun **0° rotasyonda sağa (+X)** baktığını varsayıyordu. Gerçekte ikon **0° rotasyonda sola (-X)** bakıyor. Route tangent 0° = sağa (+X) olduğundan, base offset eksikliği her iki platformda da ikonu yaklaşık **180° ters** gösteriyordu.

### B. Route-end heading vektörü (ikincil — rota sonu regresyonu)

`resolveRouteHeadingVector()` içinde `findNextDistinctRoutePoint(points, segmentIndex, current)` rota sonunda (`progress = 1`) `segmentIndex` ile geriye dönük arama yapınca **origin noktasını “next” sanıyordu**. Bu, `current → next` yerine `current → origin` vektörü üretip rota sonunda heading'i ters çeviriyordu.

**Doğrulanmadı / elendi:**
- Route direction ters değil — `routePoints` origin → destination sıralı, `progress` 0→1 ilerliyor
- Bearing vektörü ters değil — `dx = candidate.x - current.x` (current → next)
- Platform hack gerekmedi — `scaleX: -1`, `Platform.OS` offset yok

---

## 2. Route points sırası

- `getRoadRoute(originCityId, destinationCityId)` polyline'ı **origin → destination** sırasıyla döner
- İlk nokta origin şehrine yakın, son nokta destination şehrine yakın (regression test: `startNear < 0.2`, `endNear < 0.2`)
- `progress` 0 = origin yakını, 1 = destination yakını

---

## 3. Progress yönü

- `normalizeMapDeliveryProgress()` ile [0, 1] aralığına sıkıştırılır
- `centerDistance = progress * totalLength` — artan progress ileri segmentlere gider
- Segment index monoton artar; geriye gitmez

---

## 4. Kullanılan vektör formülü

Screen-space (Y aşağı, React Native koordinat sistemi):

```
dx = (next.x - current.x) * coordinateScaleX
dy = (next.y - current.y) * coordinateScaleY
rawHeadingDeg = atan2(dy, dx) * 180 / π
```

Rota sonunda ileri nokta yoksa son anlamlı segment yönü korunur:

```
dx = (current.x - previous.x) * coordinateScaleX
dy = (current.y - previous.y) * coordinateScaleY
```

`resolveRouteHeadingVector()` yalnızca `segmentIndex + 1` ve sonrasından ileri nokta arar; geriye dönük arama yalnızca fallback'tir.

---

## 5. Asset doğal yönü

- **İkon:** `GameIcon name="truck"` → MaterialCommunityIcons `truck-outline`
- **Doğal yön (0° rotation):** **sola (-X)** bakıyor
- Route tangent 0° = sağa (+X) — ikisi zıt yön

---

## 6. Asset base offset

```typescript
// src/components/map/mapTheme.ts
export const TRUCK_ICON_BASE_ROTATION_DEG = 180;
```

Android ve iOS aynı sabit; platform-specific hack yok.

---

## 7. Final heading formülü

```typescript
tangentDeg = getRouteHeadingAtProgress({ routePoints, progress, coordinateScaleX, coordinateScaleY })
finalHeadingDeg = normalizeHeadingDegrees360(
  normalizeHeadingDegrees(tangentDeg + TRUCK_ICON_BASE_ROTATION_DEG)
)
```

`WorldMapCanvas.tsx` → `displayHeadingDeg` → `AnimatedDeliveryTruckMarker` `truckAngle` (radyan).

Transform yapısı (değişmedi):
```
map pan/zoom
  → marker position (Animated.View)
    → rotationLayer: rotate(truckAngle)
      → scaleLayer: scale(1/zoom)  // inverse zoom, rotation'dan izole
        → truck icon
```

---

## 8. Android sonucu

- Ortak `getRouteHeadingDegrees()` + `TRUCK_ICON_BASE_ROTATION_DEG = 180` kullanılır
- Platform-specific offset veya mirror yok
- `npx expo export --platform android` — **PASS**
- **Manuel doğrulama:** gerçek Android cihazda aşağıdaki test listesi gerekli

---

## 9. iOS sonucu

- Android ile aynı helper ve sabit
- Rotation/scale katman ayrımı korundu (`AnimatedDeliveryTruckMarker`)
- `npx expo export --platform ios` — **PASS**
- **Manuel doğrulama:** gerçek iPhone'da aynı test listesi gerekli

---

## 10. Değişen dosyalar

| Dosya | Değişiklik |
|-------|------------|
| `src/components/map/mapTheme.ts` | `TRUCK_ICON_BASE_ROTATION_DEG = 180`, yorum düzeltmesi |
| `src/components/map/mapRoadUtils.ts` | Canonical `resolveRouteHeadingVector` (current→next), `getRouteHeadingDegrees`, `buildMapHeadingDebugPayload`, `logMapHeadingDebug` |
| `src/components/map/WorldMapCanvas.tsx` | Heading debug log entegrasyonu |
| `src/config/debug.ts` | `mapHeadingDebugEnabled` / `heading` flag |
| `scripts/map-truck-heading-regression-test.ts` | **Yeni** kapsamlı regression testi |
| `scripts/truck-route-heading-test.ts` | Base 180°, L-route segment testleri |
| `scripts/ios-map-heading-marker-regression-test.ts` | Display/base beklentileri güncellendi |
| `scripts/map-truck-position-test.ts` | Base sabit assertion |

---

## 11. Test sonuçları

| Komut | Sonuç |
|-------|-------|
| `npm run typecheck` | PASS |
| `npm run verify` | PASS |
| `npx tsx scripts/map-truck-heading-regression-test.ts` | **108 PASS, 0 FAIL** |
| `npx tsx scripts/truck-route-heading-test.ts` | **42 PASS, 0 FAIL** |
| `npx tsx scripts/ios-map-heading-marker-regression-test.ts` | **37 PASS, 0 FAIL** |
| `npx expo export --platform android` | PASS |
| `npx expo export --platform ios` | PASS |
| `git diff --check` | Uyarı: `dailyOperatingCosts.ts` EOF (bu fix kapsamı dışı) |

### Katalog rota heading örnekleri (tangent° / final° @ scale 1080×720)

Format: `tangent° / final°` (final = tangent + 180° base)

| Rota | p=0.1 | p=0.5 | p=0.9 |
|------|-------|-------|-------|
| Ankara → Bursa | 136.7° / 316.7° | -145.7° / 34.3° | 175.6° / 355.6° |
| Bursa → Ankara | -4.4° / 175.6° | 34.3° / 214.3° | -43.3° / 136.7° |
| İzmir → Bursa | -92.2° / 87.8° | -93.5° / 86.5° | 17.7° / 197.7° |
| Bursa → İzmir | -162.3° / 17.7° | 114.4° / 294.4° | 87.8° / 267.8° |
| Antalya → Bursa | -107.1° / 72.9° | -77.4° / 102.6° | -135.8° / 44.2° |
| Bursa → Antalya | 44.2° / 224.2° | 102.6° / 282.6° | 72.9° / 252.9° |

Kardinal sentetik (tangent): doğu 0°, batı 180°, güney 90°, kuzey -90°.  
Ters rotalar (Bursa↔Ankara tangent): >170° fark.

### Heading zinciri özeti

| Soru | Cevap |
|------|-------|
| İkon render | `AnimatedDeliveryTruckMarker.tsx` |
| Pozisyon | `getTruckPositionAlongRoadRoute()` |
| Heading | `getRouteHeadingDegrees()` → `getRouteHeadingAtProgress()` |
| routePoints sırası | origin → destination |
| progress | 0 → 1 |
| Asset doğal yön | Sola (-X) @ 0° |
| Base offset | +180° |
| scaleX mirror | Yok |
| Platform hack | Yok |

---

## 12. Debug (internal only)

`__DEV__` + `mapHeadingDebugEnabled` (veya `truck-debug` preset) açıkken:

```
[map-heading] { routeId, origin, destination, progress, currentPoint, nextPoint, rawHeadingDeg, assetBaseHeadingDeg, finalHeadingDeg }
```

Production'da görünmez; UID veya hassas veri loglanmaz.

---

## 13. Manuel cihaz test gereksinimi

Headless testler geçti; görsel doğrulama için gerçek cihazda:

1. Ankara → Bursa, Bursa → Ankara
2. İzmir → Bursa, Bursa → İzmir
3. Antalya → Bursa, Bursa → Antalya
4. Zoom/pan sırasında yön sabitliği
5. Background/foreground
6. Offline progression
7. Yeni rota başlangıcı

**Beklenen:** İkon her zaman hedef şehre doğru bakar; dönüşlerde segment tangent'ine uyar; Android ve iOS aynı davranır.

---

## Kabul kriterleri

| Kriter | Durum |
|--------|-------|
| İkon hedef yönüne bakar (Android + iOS) | Kod + test PASS — cihaz doğrulaması bekliyor |
| Ortak canonical heading helper | `getRouteHeadingDegrees()` |
| Vektör current → next | `candidate.x - current.x` |
| Asset base tek sabit | `TRUCK_ICON_BASE_ROTATION_DEG = 180` |
| Platform +180 hack yok | Doğrulandı |
| scaleX mirror yok | Doğrulandı |
| Zoom/pan lifecycle yönü bozmaz | Katman ayrımı korundu |
| AAB/APK/IPA üretilmedi | Uyuldu |

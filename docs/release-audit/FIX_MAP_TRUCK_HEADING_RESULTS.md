# FIX: Map Truck Heading / Route Pose — Results

**Date:** 2026-08-06  
**Scope:** P0 harita kamyon marker yönü (Android + iOS ortak business logic)  
**Verdict:** Implementation + regression tests PASS — gerçek cihaz manuel doğrulaması gerekli

---

## 1. Kesin kök neden

### Birincil: Asset forward angle kalibrasyonu eksik/yanlış (~180° görsel hata)

`TRUCK_ASSET_FORWARD_OFFSET_DEG` değeri `0` iken kod, MaterialCommunityIcons `truck-outline` ikonunun **0° rotasyonda sağa (+X)** baktığını varsayıyordu. Gerçekte ikon **0° rotasyonda sola (-X)** bakıyor (kabin sola).

Route tangent doğru hesaplanıyordu (ör. Ankara→Bursa p=0.5 tangent ≈ -145.7°), ancak marker rotation offset uygulanmadığı için kabin hareket yönünün **tersine** görünüyordu.

### İkincil (önceki fix'te): Rota sonu heading vektörü

`progress = 1` iken geriye dönük arama origin'i "next" sanabiliyordu. Bu, look-ahead + segment tangent sistemiyle giderildi.

### Elendi

- Route point sırası ters değil (`getRoadRoute` origin→destination)
- `atan2(dy, dx)` parametre sırası doğru
- `dy` çift ters çevrilmiyor
- `scaleX: -1` veya platform hack yok
- Rota/şehir özelinde `if` hack yok

---

## 2. Asset doğal yönü

| Özellik | Değer |
|---------|-------|
| İkon | `GameIcon name="truck"` → MaterialCommunityIcons `truck-outline` |
| 0° rotation doğal yön | **Sola (-X)** — kabin sola |
| Canonical sabit | `TRUCK_ASSET_FORWARD_OFFSET_DEG = 180` |

Sözleşme: `0° = ekranın sağı (doğu)`. Asset sola baktığı için forward angle = **180°**.

---

## 3. Eski vs yeni heading formülü

### Eski (hatalı)

```typescript
TRUCK_ASSET_FORWARD_OFFSET_DEG = 0; // veya + ile birleştirme
finalRotation = normalize(tangentDeg + 0); // kabin ters
```

### Yeni (canonical)

```typescript
// Pixel-space tangent (mapBounds width/height scale ile)
dx = (nextPx.x - currentPx.x) * coordinateScaleX;
dy = (nextPx.y - currentPx.y) * coordinateScaleY;
routeHeadingDeg = Math.atan2(dy, dx) * 180 / Math.PI;

// Look-ahead: currentDistance + ROUTE_HEADING_LOOK_AHEAD_PX (8px)
// Rota sonunda: behind → current tangent

finalRotationDeg = normalizeAngle(routeHeadingDeg - TRUCK_ASSET_FORWARD_OFFSET_DEG);
```

---

## 4. Canonical RoutePose modeli

Tek kaynak: `getRouteMarkerPose()` → `getRoutePoseAtProgress()`

```typescript
type RoutePose = {
  position: { x: number; y: number };  // normalize
  headingDeg: number;                  // tangent (asset offset öncesi)
  segmentIndex: number;
  segmentProgress: number;
};

type RouteMarkerPose = RoutePose & {
  markerHeadingDeg: number;            // tangent - assetForward, [0,360)
  positionPx: { x: number; y: number };
};
```

Pozisyon ve heading **aynı directed route point dizisinden** türetilir.

Directed route: `getRoadRoute(origin, dest)` — base polyline yönü eşleşmezse `reverse()`.

---

## 5. Look-ahead ve degenerate segmentler

| Parametre | Değer |
|-----------|-------|
| `ROUTE_HEADING_LOOK_AHEAD_PX` | **8** |
| Degenerate eşik | `Math.hypot(dx,dy) < POINT_EPS` (0.0001 norm / ~0.5px) |
| Rota sonu | behind→current tangent; son geçerli heading korunur |

`coordinateScaleX/Y` = `mapBounds.width/height` (production). Look-ahead piksel uzayında ölçülür.

---

## 6. Rotation normalization

```typescript
normalizeHeadingDegrees360(deg)  // [0, 360)
shortestHeadingDeltaDegrees(from, to)  // animasyon için 359°→1° kısa yol
```

Marker animasyonu `AnimatedDeliveryTruckMarker` içinde shortest-angle interpolation kullanır.

---

## 7. Ankara ↔ Bursa sonuçları

| Rota | p | Tangent° | Marker rotation° (tangent - 180) | Beklenen |
|------|---|----------|----------------------------------|----------|
| Ankara → Bursa | 0.5 | ≈ -145.7° | ≈ 34.3° | Kabin batı/kuzeybatı (Bursa) |
| Bursa → Ankara | 0.5 | ≈ 34.3° | ≈ 214.3° | Kabin doğu/güneydoğu (Ankara) |
| Complementary progress | — | — | ≈ 180° fark | Reverse invariant PASS |

Regression: `bursa-ankara-truck-route-regression-test.ts` — **20/20 PASS**

---

## 8. Diğer rota testleri (katalog)

`map-truck-heading-regression-test.ts` — Ankara↔Bursa, İzmir↔Bursa, Antalya↔Bursa @ p=0.1/0.5/0.9:

- Tangent finite, normalized [0,360)
- `final = tangent - assetForward` invariant
- İzmir↔Bursa reverse tangent >170° fark

`truck-route-heading-test.ts` — kardinal sentetik + Bursa↔Ankara + İzmir↔İstanbul + katalog smoke — **45/45 PASS**

---

## 9. Transform yapısı (değişmedi)

```
map pan/zoom
  → marker position (Animated.View)
    → rotationLayer: rotate(markerHeadingDeg)
      → scaleLayer: scale(1/zoom)
        → truck icon (truck-outline)
```

Zoom/pan heading'i etkilemez; heading map local pixel koordinatında hesaplanır.

---

## 10. Debug modu

`__DEV__` + debug flag açıkken:

```
[truck-route-pose] deliveryId=... origin=... destination=... progress=...
  segmentIndex=... currentPx=... aheadPx=... dx=... dy=...
  routeHeadingDeg=... assetForwardAngleDeg=... finalRotationDeg=...
```

Production'da kapalı.

---

## 11. Değişen dosyalar

| Dosya | Değişiklik |
|-------|------------|
| `src/components/map/mapTheme.ts` | `TRUCK_ASSET_FORWARD_OFFSET_DEG = 180` |
| `src/components/map/mapRoadUtils.ts` | Pixel-space look-ahead, `getRouteMarkerPose`, `getRoutePoseAtProgress`, `getRouteHeadingDegrees` (tangent - asset) |
| `src/components/map/WorldMapCanvas.tsx` | `getRouteMarkerPose` tek kaynak |
| `src/components/map/mapTruckLocation.ts` | `getRouteMarkerPose` tek kaynak |
| `scripts/truck-route-heading-test.ts` | Kardinal + L-route + katalog (map scale) |
| `scripts/map-truck-heading-regression-test.ts` | 108 assertion |
| `scripts/bursa-ankara-truck-route-regression-test.ts` | Ankara→Bursa destination-facing |
| `scripts/ios-map-heading-marker-regression-test.ts` | Offset 180° display beklentileri |
| `scripts/map-truck-position-test.ts` | Canonical pose |

---

## 12. Test sonuçları

| Komut | Sonuç |
|-------|-------|
| `npm run typecheck` | PASS |
| `npm run verify` | PASS |
| `truck-route-heading-test.ts` | **45 PASS** |
| `map-truck-heading-regression-test.ts` | **108 PASS** |
| `bursa-ankara-truck-route-regression-test.ts` | **20 PASS** |
| `ios-map-heading-marker-regression-test.ts` | **37 PASS** |
| `npx expo export --platform android` | PASS |
| `npx expo export --platform ios` | PASS |
| `git diff --check` | PASS (LF uyarıları only) |

**AAB/APK/IPA/Xcode Archive üretilmedi** (istek gereği).

---

## 13. Manuel cihaz testi (kalan)

Gerçek Android/iOS cihazda doğrulanacak:

1. Ankara → Bursa: kabin Bursa'ya
2. Bursa → Ankara: kabin Ankara'ya
3. İstanbul ↔ Antalya, İzmir ↔ Bursa matrisi
4. Zoom/pan sırasında yön sabitliği
5. Virajlarda tangent uyumu

---

## Kabul kriterleri

| Kriter | Durum |
|--------|-------|
| Pixel-space heading | ✅ |
| Tek asset calibration offset (180°) | ✅ |
| Rota/şehir özel hack yok | ✅ |
| `getRouteMarkerPose` tek kaynak | ✅ |
| Reverse route ~180° invariant | ✅ Test PASS |
| Marker konumu değişmedi | ✅ |
| Android/iOS ortak logic | ✅ |
| AAB/APK/IPA üretilmedi | ✅ |
| Gerçek cihaz görsel doğrulama | ⏳ Manuel |

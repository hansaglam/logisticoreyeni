# FIX iOS Map Marker Results — Heading + Stale Overlay

**Date:** 2026-08-06  
**Scope:** iOS TestFlight map regressions — truck heading reversed, stale route overlays  
**Status:** MITIGATED (code + headless tests; iPhone TestFlight re-verify required)

---

## 1. Ters Heading — Kesin Kök Neden

**Kök neden:** `AnimatedDeliveryTruckMarker` içinde **zoom telafisi (`scale`) ile heading (`rotate`) aynı Reanimated node’unda birleşik** uygulanıyordu:

```tsx
transform: [{ scale: inverseScale }, { rotate: `${degrees}deg` }]
```

iOS’ta Reanimated transform kompozisyonu Android’den farklı davranıyor; uniform olmayan kompozisyon sırası + parent `InteractiveTurkeyMap` scale katmanı içinde ikon yönü **~180° ters** görünebiliyordu. Bearing formülü doğruydu (Android kanıtı).

**Düzeltme:** Transform katmanları ayrıldı:

```
position layer (left/top)
  → rotation layer (rotate only)
      → scale layer (inverse zoom only)
          → truck icon
```

Heading artık map pan/zoom transform’undan izole.

---

## 2. Asset Base Yönü

| Constant | Value | Anlam |
|----------|-------|-------|
| `TRUCK_ICON_BASE_ROTATION_DEG` | `0` | MaterialCommunityIcons `truck-outline` doğal yönü **sağa** (0° = +X) |
| `TRUCK_ASSET_HEADING_OFFSET_DEG` | alias → `0` | Legacy alias |

Platform-specific `+180` hack **yok**.

---

## 3. Kullanılan Bearing Formülü

Canonical helper: `getRouteHeadingDegrees()` in `mapRoadUtils.ts`

```
dx = (next.x - previous.x) * coordinateScaleX
dy = (next.y - previous.y) * coordinateScaleY
tangentDeg = atan2(dy, dx) * 180/π     // Y-down screen space
displayDeg = normalizeHeadingDegrees360(tangentDeg + assetBaseHeadingDegrees)
```

- Progress’e yakın **look-ahead tangent** (`DEFAULT_ROUTE_HEADING_LOOK_AHEAD_DISTANCE`)
- Duplicate/zero-length segment → bir sonraki anlamlı segment veya `previousHeadingDeg` / `fallbackHeadingDeg`
- `[0, 360)` normalize: `((deg % 360) + 360) % 360`
- Aspect düzeltmesi: `coordinateScaleX/Y = mapBounds.width/height` (heading only)

---

## 4. iOS Transform Farkı

| Önce | Sonra |
|------|-------|
| scale + rotate tek `contentStyle` | rotation / scale ayrı `Animated.View` |
| Parent map scale ile karışık | Truck heading local rotation layer |
| `toDisplayAngle` marker içinde base offset | Base offset `getRouteHeadingDegrees` içinde (caller) |

`InteractiveTurkeyMap` parent transform değişmedi — Android davranışı korundu.

---

## 5. Eski Marker Kalma — Kesin Kök Neden

**Kök neden:** React Native SVG (iOS) **aynı React key ile Path `d` güncellemesini güvenilir repaint etmiyor**. Eski yapı:

- Route SVG key: yalnız `delivery.id`
- Rota topolojisi değişince (origin/dest) aynı key → **eski yeşil çizgi / şehir halkası görünümü kalıyordu**
- Truck key: `delivery-truck-${id}` — rota değişiminde remount yok

**Not:** Dinamik city node yok (şehir etiketleri PNG içinde). Kullanıcı “eski şehir marker” olarak gördüğü şey = **eski route overlay + endpoint halo hissi**.

---

## 6. Yeni Marker Identity / Key Yapısı

Modül: `src/components/map/mapMarkerState.ts`

| Marker | Key pattern |
|--------|---------------|
| Route path segment | `route-${deliveryId}-${routeVersion}-${role}` |
| Transfer route | `route-transfer-${transferId}-${routeVersion}` |
| Delivery truck | `truck-delivery-${deliveryId}-${routeVersion}` |
| Transfer truck | `truck-transfer-${transferId}-${routeVersion}` |
| City (future) | `city-${cityId}-${role}-${activeRouteId}` |

`routeVersion` = `origin|destination|contractId` topology fingerprint (progress tick’te **değişmez**).

---

## 7. Route Invalidation Davranışı

`buildMapOverlayRenderVersion()` — aktif delivery/transfer topology birleşimi.

**Artırılır when:**
- delivery start / hedef değişimi
- contractId (route identity) değişimi
- transfer start
- active delivery set değişimi

**Artırılmaz:** progress tick, zoom/pan.

**Remount:**
- `<Svg key={overlayRenderVersion}>` — delivery routes
- `<Svg key={`${overlayRenderVersion}-transfer`}>` — transfers
- Truck container `key={trucks-${overlayRenderVersion}}`

---

## 8. Offline / Hydrate Cleanup

`buildVisibleMapMarkers()` — immutable derived state:

- Yalnız `preparing | on_route | paused` delivery
- Yalnız `active | paused` transfer
- `completed | cancelled` filtrelenir
- Duplicate delivery id dedupe
- Heading cache key: `${id}:${routeVersion}` — topology değişince eski heading taşınmaz

---

## 9. Değişen Dosyalar

| File | Change |
|------|--------|
| `src/components/map/mapRoadUtils.ts` | `getRouteHeadingDegrees()` |
| `src/components/map/mapMarkerState.ts` | **new** — keys, routeVersion, `buildVisibleMapMarkers` |
| `src/components/map/AnimatedDeliveryTruckMarker.tsx` | Split transform layers |
| `src/components/map/WorldMapCanvas.tsx` | Derived markers, overlay keys, heading helper |
| `scripts/ios-map-heading-marker-regression-test.ts` | **new** — 36 assertions |

---

## 10. Test Sonuçları

```text
npm run typecheck                              → PASS
npm run verify                                 → PASS
npx tsx scripts/ios-map-heading-marker-regression-test.ts → 36 PASS / 0 FAIL
npx tsx scripts/truck-route-heading-test.ts    → 41 PASS / 0 FAIL
npx tsx scripts/map-truck-position-test.ts     → 60 PASS / 0 FAIL
npx expo export --platform ios                 → PASS
npx expo export --platform android             → PASS
git diff --check                               → PASS (LF warnings only)
```

AAB / APK / IPA / Archive **üretilmedi**.

---

## 11. Android Regression

- Transform layer split platform-agnostic
- Aynı bearing pipeline (`getRouteHeadingDegrees`)
- Platform branch eklenmedi
- Mevcut heading test suite tamamen yeşil

---

## 12. Final iOS Build Gereksinimi

**Yeni TestFlight build gerekli** — client-only değişiklik; backend deploy gerekmez.

---

## Manuel iPhone Checklist

1. İzmir → Bursa — kamyon doğu yönüne bakar
2. Bursa → Antalya — güneye doğru ilerlerken ikon ters değil
3. Antalya → Bursa — reverse rota, eski İzmir-Bursa çizgisi kalmaz
4. Bursa → İzmir
5. App background → foreground
6. Offline progress uygula → harita doğru konum/yön
7. Delivery complete → haritaya dön → eski rota yok
8. Yeni teslimat başlat → yalnız yeni overlay
9. 10 kez rota değiştir → stale path yok
10. Zoom/pan sırasında ikon yönü sabit (sadece pozisyon hareket eder)

**Beklenen:** Kamyon rota yönüne bakar; eski yeşil çizgi/halo kalmaz; Android görünümü değişmez.

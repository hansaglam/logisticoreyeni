# Vehicle Marketplace — Invalid Server Data Fix (P0)

**Date:** 2026-08-13  
**Scope:** `getVehicleMarketplaceListings` / `getMyVehicleListings` response contract, legacy listing normalization  
**Builds:** AAB/APK/IPA/Xcode Archive **üretilmedi**

---

## 1. Exact hata kaynağı

### Kullanıcı mesajı

```
"Sunucudan geçersiz veri alındı."
```

| Katman | Dosya | Mapping |
|--------|-------|---------|
| Screen error state | `VehicleMarketplaceScreen.tsx` | `mapFailureReasonToMarketplaceKind(reason)` → `invalid-response` |
| User message | `marketplaceErrorModel.ts` | `getMarketplaceKindMessage('invalid-response')` |
| Alternate path | `vehicleMarketplacePresentation.ts` | `getMarketplaceErrorMessage('invalid-request')` |

### Teknik kök neden

**Callable:** `getVehicleMarketplaceListings` (client: `VEHICLE_MARKETPLACE_CALLABLES.list`)

**Backend (eski):**

```typescript
listings: visibleDocs.map((document) => document.data())
```

Firestore `document.data()` doğrudan client’a gönderiliyordu:

| Problem | Etki |
|---------|------|
| `createdAt` / `updatedAt` / `expiresAt` → **Firestore Timestamp** | Callable JSON’da `{seconds,_seconds}` object; client yalnızca kısmi normalize ediyordu |
| Legacy alanlar (`truck`, `catalogId`, `available`, string `price`) | Parser/validator strict değildi → bazı listing’ler kırık |
| Tek bozuk listing | Tüm response güvenilmez; UI error veya crash riski |
| `invalid-request` reason | Kullanıcıya teknik schema mesajı gösteriliyordu |

**Client (eski):** `vehicleMarketplaceService.ts` → `normalizeListing()` yalnızca timestamp alanlarında; envelope/listing schema doğrulaması yoktu.

---

## 2. Yeni canonical contract

### List response (`getVehicleMarketplaceListings`)

```typescript
{
  ok: true,
  apiVersion: 1,
  listings: VehicleMarketplaceListingWire[], // primitive millis timestamps
  rejectedCount: number,                      // internal metric
  hasMore: boolean,
  nextCursor: { createdAt: number, id: string } | null
}
```

### Listing wire shape (client-facing)

- `createdAt`, `updatedAt`, `expiresAt` → **number (epoch ms)**
- `truckSnapshot` → plain object (no Timestamp/undefined)
- `status` → `active | sold | cancelled | expired | reserved` (`available` → `active` normalize)
- `askingPrice`, `recommendedPrice`, `version` → finite numbers

### Client parser

`src/domain/vehicleMarketplaceResponseParser.ts`

- `parseVehicleMarketplaceListResponse(raw)`
- `parseVehicleMarketplaceMyListingsResponse(raw)`
- Per-listing safe parse: invalid → log + skip (kalan listing’ler gösterilir)
- Envelope bozuksa → controlled `invalid-request` (auth/callable error ayrı kalır)

### Dev logs (hassas veri yok)

```text
[vehicle-marketplace-config] { platform, projectId, functionsRegion, callableName, featureEnabled }
[vehicle-marketplace-response] { stage, listingCount, invalidListingIndex, firestoreTimestampDetected, ... }
[vehicle-marketplace-invalid-listing] { index, listingIdMasked, field, reason }
```

---

## 3. Backend değişiklikleri

| Dosya | Değişiklik |
|-------|------------|
| `backend/src/vehicleMarketplaceSerialization.ts` | **Yeni** — `normalizeStoredMarketplaceListing`, `serializeMarketplaceListingsForClient`, `listingDtoToClientWire` |
| `backend/src/index.ts` | `getVehicleMarketplaceListings`, `getMyVehicleListings` serialized DTO döner |
| `backend/scripts/auditMarketplaceListings.ts` | Production dry-run audit (mutate etmez) |

**Legacy normalize örnekleri:**

- `status: 'available'` → `active`
- `truck` + `catalogId` → `truckSnapshot`
- `price` string → `askingPrice` number
- `condition: 0.82` → `82` (0–1 → 0–100)

**Güvenlik:** Ownership / transaction logic değişmedi. Yalnız read response serialization.

---

## 4. Client değişiklikleri

| Dosya | Değişiklik |
|-------|------------|
| `src/domain/vehicleMarketplaceResponseParser.ts` | Canonical parser + dev logs |
| `src/services/vehicleMarketplaceService.ts` | Parser entegrasyonu, `[vehicle-marketplace-config]` |
| `marketplaceErrorModel.ts` | User message: **"İlanlar şu anda yüklenemiyor. Tekrar dene."** |
| `vehicleMarketplacePresentation.ts` | Aynı user-facing mesaj (`invalid-request`) |

**Empty list:** `{ ok: true, listings: [] }` → empty state (error değil).

**Callable errors:** `catch` path → auth/network/timeout; success body parse edilmez.

---

## 5. Tek bozuk listing davranışı

```
20 listing → 1 malformed
→ backend: 19 serialized, rejectedCount=1, warn log
→ client: 19 gösterilir, invalid listing skip + dev log
→ ekran çökmez
```

---

## 6. Firebase config parity

| | Android | iOS |
|--|---------|-----|
| projectId | `logisticore-53ab4` | `logisticore-53ab4` |
| region | `us-central1` | `us-central1` |
| Parser | shared | shared |

`Platform.OS` response parsing yok.

---

## 7. Cache

Marketplace listing listesi için persistent malformed cache yok. Save cache (`vehicleMarketplace` in save game) reconciliation metadata only — parser değişikliği network success ile güncellenir.

---

## 8. Test sonuçları

| Test | Sonuç |
|------|-------|
| `npm run typecheck` | **PASS** |
| `npm run verify` | **PASS** |
| `scripts/marketplace-response-contract-test.ts` | **PASS** (yeni) |
| `npm run firebase:emulators:test` | **PASS** (50/50, serializer test dahil) |
| `npx expo export --platform android` | **PASS** |
| `npx expo export --platform ios` | **PASS** |
| `git diff --check` | **PASS** |

---

## 9. Backend deploy — **GEREKLİ**

Bu fix **Functions source değişikliği** içeriyor. Production’a deploy edilmeden client-only güncelleme kısmi iyileşme sağlar; tam fix için backend deploy şart.

```bash
firebase deploy --only functions:getVehicleMarketplaceListings,functions:getMyVehicleListings
```

Önce:

```bash
npm run backend:build
npm run firebase:emulators:test
```

**Migration:** Production listing audit (dry-run only, otomatik mutate yok):

```bash
npx tsx backend/scripts/auditMarketplaceListings.ts --dry-run
```

---

## 10. Manuel kabul (gerçek cihaz)

1. Linked account → Araç Pazarı aç → loading → listing veya empty state
2. **"Sunucudan geçersiz veri alındı" görünmemeli**
3. Retry çalışmalı
4. Android ilan oluştur → iOS refresh → görünmeli (cross-platform)
5. Purchase transaction diğer platformdan doğrulanmalı

---

## 11. Özet

| Madde | Durum |
|-------|-------|
| Exact invalid field bulundu | Firestore Timestamp + raw `document.data()` |
| Backend/client DTO aligned | **Evet** (`apiVersion: 1`) |
| Timestamp raw response’da yok | **Deploy sonrası** |
| Legacy listing normalize | **Evet** (backend serializer) |
| Tek bozuk listing tüm listeyi düşürmez | **Evet** |
| Callable errors doğru map | **Evet** |
| User technical schema mesajı | **Kaldırıldı** |
| Security/transactions | **Korundu** |
| AAB/APK/IPA | **Üretilmedi** |

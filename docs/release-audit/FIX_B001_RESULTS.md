# FIX B-001 Results — Server-Owned Trust Boundary

**Date:** 2026-08-06  
**Blocker:** B-001 — Client cloud save trusted for marketplace + leaderboard  
**Status:** MITIGATED (code-ready; production deploy pending)

---

## 1. Old Trust Path

| System | Old source | Exploit |
|--------|-----------|---------|
| Marketplace bootstrap | `users/{uid}/saves/current` via `buildMarketplaceStateFromCloudSave()` | Forged `player.money` → canonical cash; forged trucks → ownership |
| Leaderboard submit | `users/{uid}/saves/current` on **every** submit via `extractCanonicalPlayerState()` | Re-submit after save tampering → inflated score |
| Firestore rules | `saves/current` writable by owner with only `ownerUid` check | Full gameplay payload client-controlled |
| Post-bootstrap marketplace | `marketplaceState/current` (server-only) | Bootstrap-only exploit; later saves ignored |

**PoC confirmed:** `$987,654,321` cash, fake truck, score > 1M from client save manipulation.

---

## 2. New Canonical State

**Path:** `users/{uid}/serverState/current`  
**Writers:** Admin SDK / Cloud Functions only  
**Readers:** Owner (read-only)

### Fields (schema v1)

- `cash`, `ownedTruckIds`, `ownedTrailerIds`, `ownedTrucks[]`
- `warehouses[]`, `companyLevel`, `reputation`, `completedDeliveries`
- `failedDeliveries`, `lateDeliveries`, `companyName`
- `leaderboardScore` (cached server calculation)
- `schemaVersion`, `initialized`, `migrationCompleted`, `migrationSource`
- `sourceVersion`, `suspiciousFlags[]`, `updatedAt`, `createdAt`

### Trust rules

- Cloud save (`saves/current`) = backup/cache only — **never** read for marketplace/leaderboard canonical decisions
- Existing `marketplaceState/current` preserved when bootstrapping serverState
- Marketplace transactions mirror cash/fleet changes into serverState atomically

**New backend modules:**

- `backend/src/serverStateTypes.ts`
- `backend/src/serverState.ts`

---

## 3. Bootstrap Behavior

| Scenario | Behavior |
|----------|----------|
| Brand-new user, no docs | Server defaults: `$20,000`, starter truck (`truck-starter-1`), level 1, rep 50 |
| Existing `marketplaceState/current` | Import canonical cash/fleet into serverState (`migrationSource: marketplace`) |
| Malicious cloud save only | **Ignored** — defaults or existing marketplace canonical used |
| Leaderboard first submit | Creates serverState if missing (reads marketplace first, else defaults) |

---

## 4. Legacy Migration

**Callable:** `migrateLegacyServerState`  
**Options:** `{ dryRun?: boolean }`  
**Rate limit:** 3 / 24h per user

### Rules

- Idempotent — `migrationCompleted=true` → second call rejected
- If marketplaceState exists → **preserve marketplace canonical** (no save import)
- Else bounded import from cloud save:
  - Cash clamped `0 … 5,000,000`; flag if `> 500,000`
  - Trucks validated against `CANONICAL_TRUCK_MARKET_CATALOG`
  - Duplicate IDs rejected; invalid templates rejected
  - `purchasePrice` from catalog, not client
  - Max 20 trucks, bounded level/reputation/deliveries
- Dry-run script: `backend/scripts/migrateServerStateDryRun.ts` (no destructive auto-run)

**Production:** Run dry-run audit first; manual review for `suspicious-cash` flags before `--apply`.

---

## 5. Marketplace Changes

| Flow | Change |
|------|--------|
| `ensureVehicleMarketplaceState` | Bootstrap from serverState, not cloud save |
| `createVehicleListing` | Bootstrap from serverState; sync serverState after listing fee |
| `cancelVehicleListing` | Sync serverState after unlock |
| `purchaseVehicleListing` | Sync buyer + seller serverState after atomic transfer |
| `buildMarketplaceStateFromCloudSave` | Retained for migration tooling only — **not** used in live bootstrap |

Marketplace atomicity, idempotency, listing locks, and fee math unchanged.

---

## 6. Leaderboard Changes

| Before | After |
|--------|-------|
| Read `saves/current` every submit | Read `serverState/current` |
| Client `clientSaveVersion` hint (ignored anyway) | Score from server fields only |
| Client could inflate score via save | Malicious save has **no effect** |

Score still computed by `calculateLeaderboardScore()` — now fed from `extractCanonicalPlayerStateFromServerState()`.

Callable accepts refresh request only; **no client-supplied score/progression**.

---

## 7. Firestore Rules

```javascript
match /serverState/{documentId} {
  allow read: if isOwner(userId);
  allow write: if false;
}
```

Cloud save write remains allowed (backup). Marketplace, leaderboard, serverState direct writes denied.

---

## 8. Test Results

| Suite | Result |
|-------|--------|
| `npm run typecheck` | PASS |
| `npm run verify` | PASS |
| `npm run backend:verify` | PASS |
| Firebase emulator tests (46 tests) | **46/46 PASS** |
| `scripts/security-malicious-save-trust-test.ts` | Updated — run via emulator (JDK 21+ required on host) |

### New / updated tests

- `backend/test/serverState.emulator.test.ts` — rules deny, defaults, bounded migration, idempotency, dry-run
- `backend/test/leaderboard.emulator.test.ts` — serverState scoring, malicious save ignored
- `backend/test/vehicleMarketplace.emulator.test.ts` — bootstrap ignores cloud save
- `scripts/security-malicious-save-trust-test.ts` — PoC inverted (expects MITIGATED)

---

## 9. Remaining Risks

1. **Legacy users with real progress in cloud save only** — marketplace/leaderboard show server defaults until `migrateLegacyServerState` (bounded) is invoked
2. **Single-player local vs server divergence** — intentional; no silent overwrite of local save
3. **Delivery/progression sync V1** — no trusted delivery-receipt callable yet; serverState progression updates mainly via marketplace + migration
4. **Warehouse/fleet leaderboard components** — migration imports bounded warehouse snapshots; live progression not yet server-synced outside marketplace
5. **Production migration** — requires dry-run audit + manual review for suspicious accounts

---

## 10. Deploy Commands (DO NOT RUN AUTOMATICALLY)

### Functions to deploy

```bash
firebase deploy --only functions:createVehicleListing,functions:cancelVehicleListing,functions:purchaseVehicleListing,functions:getMyVehicleListings,functions:submitLeaderboardScore,functions:getLeaderboard,functions:migrateLegacyServerState
```

Or full functions deploy:

```bash
firebase deploy --only functions
```

### Rules

```bash
firebase deploy --only firestore:rules
```

### Indexes

No new composite indexes required for serverState (single-doc paths).

### Migration (production)

```bash
# Audit only
npx tsx backend/scripts/migrateServerStateDryRun.ts

# Per-user via client callable after review
# migrateLegacyServerState({ dryRun: true }) then { dryRun: false }
```

### Security PoC regression

```bash
firebase emulators:exec --only firestore "npx tsx scripts/security-malicious-save-trust-test.ts"
```

---

## 11. Client Build Required?

| Platform | Required? | Reason |
|----------|-----------|--------|
| **Android AAB** | **No** (for B-001 fix itself) | All changes are backend + rules; existing client callables unchanged |
| **iOS** | **No** (for B-001 fix itself) | Same |

**Recommended:** Deploy functions + rules first. Optionally expose `migrateLegacyServerState` in client settings for legacy users (future UI task).

---

## 12. Acceptance Criteria

| Criterion | Status |
|-----------|--------|
| Client save cannot change marketplace cash | ✅ |
| Client save cannot create fake ownership | ✅ |
| Client save cannot change leaderboard score | ✅ |
| Marketplace remains atomic | ✅ |
| Leaderboard server-calculated | ✅ |
| Cloud save backup function preserved | ✅ |

---

## 13. Files Changed (Summary)

- `backend/src/serverState.ts`, `serverStateTypes.ts` (new)
- `backend/src/vehicleMarketplace.ts` — serverState bootstrap + sync
- `backend/src/vehicleMarketplaceState.ts` — `buildMarketplaceStateFromServerState`
- `backend/src/leaderboard.ts` — serverState scoring
- `backend/src/leaderboardScore.ts` — `extractCanonicalPlayerStateFromServerState`
- `backend/src/index.ts` — `migrateLegacyServerState` callable
- `firestore.rules` — serverState deny write
- `backend/scripts/migrateServerStateDryRun.ts` (new)
- Tests + `scripts/security-malicious-save-trust-test.ts`

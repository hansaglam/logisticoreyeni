# LogistiCore V1.1 Feature Phase 1 — Weekly Seasons + Challenges Foundation

## Executive summary

Weekly Seasons ile Daily/Weekly Challenges için production-safe temel oluşturuldu. Mevcut ISO haftalık leaderboard kimliği ranking katmanı olarak yeniden kullanıldı; ikinci bir haftalık ranking sistemi kurulmadı. Client yalnız görüntüleme ve claim isteği yapabilir. Challenge ilerlemesi client sayaçlarından değil, backend tarafından üretilen canonical marketplace işlem geçmişinden türetilir. Reward claim; claim kaydı, canonical cash ve sezon puanını tek Firestore transaction’ında günceller.

Tam UI bu fazın dışında bırakıldı. Client servis entegrasyonu hazırdır; production ve internal feature flag’leri varsayılan olarak kapalıdır. Backend deploy edilmedi.

## Current architecture audit

| Sistem | Mevcut authority / capability | Phase 1 kararı |
|---|---|---|
| Weekly leaderboard | `leaderboards/{YYYY-Www}/entries/{uid}`, backend server clock ve `serverState` score | Aynı ISO week key sezon ranking katmanı olarak yeniden kullanıldı; score formülü değişmedi. |
| Delivery completion | Local simulation/store settlement; duplicate guards güçlü, fakat backend doğrudan trusted completion event almıyor | Challenge metriği olarak ertelendi. Client counter kabul edilmedi. |
| On-time delivery / distance / delivery revenue / reputation | Local save’de ölçülebilir, fakat backend claim anında bağımsız doğrulayamıyor | Deferred/disabled. |
| Marketplace purchase/sale | Firestore transaction, canonical buyer/seller UID, cash, ownership, receipt ve history | İlk enabled challenge metriklerinin source of truth’u. |
| Cash | Marketplace state + mirrored server state backend-authoritative | Cash reward iki canonical belgede atomik güncellenir. |
| Cloud/local save | Client gameplay persistence; challenge reward authority için güvenilmez | Save schema değiştirilmedi; challenge state save’e eklenmedi. |
| Account deletion | `users/{uid}` recursive delete | Claim ve season progress alt koleksiyonları otomatik kapsanır. |

## New models

### SeasonDefinition

- `key`: UTC ISO week key (`YYYY-Www`)
- `startsAt`, `endsAt`: exclusive end kullanan server-consistent epoch milliseconds
- `displayName`
- `sequence`
- `status`: `upcoming | active | ended`

Gün ve hafta helper’ları UTC sınırları kullanır. ISO week-year hesabı yıl geçişini destekler; örneğin 31 Aralık 2025 `2026-W01` olur.

### ChallengeDefinition

- `id`, `cadence`, `metric`, `target`
- conservative `reward`
- `title`, `description`
- `enabled`, `version`

### ChallengeProgress

- `challengeId`, `periodKey`
- bounded `current`, `target`
- `completed`, `claimed`
- optional completion/claim timestamps

Period key günlük ve haftalık ilerlemenin başka döneme sızmasını önler.

## Implemented challenge metrics

Enabled:

- `marketplace_purchases`
- `marketplace_sales`

Katalog dört aktif görev içerir:

- günlük 1 araç satın alma
- günlük 1 araç satışı
- haftalık 3 araç satın alma
- haftalık 2 araç satışı

Progress `users/{uid}/marketplaceHistory` içindeki backend-created transaction kayıtlarından, server period sınırlarıyla hesaplanır. Client’tan metric veya amount alanı alınmaz.

## Deferred metrics

Şunlar type sisteminde geleceğe hazırdır ancak enabled değildir:

- `deliveries_completed`
- `contracts_completed_on_time`
- `distance_completed`
- `money_earned_from_deliveries`
- `reputation_gained`

`daily_delivery_foundation_deferred` katalog girdisi `enabled: false` olarak tutulur ve claim `challenge-disabled` ile fail-closed olur. Bu metrikler ancak backend-authoritative delivery settlement/event journal sağlandıktan sonra açılmalıdır.

## Server-authoritative boundaries

- Callable UID yalnız `request.auth.uid` kaynağından gelir.
- Anonymous veya unauthenticated kullanıcı challenge mutation yapamaz.
- `claimChallengeReward` payload’ı yalnız `challengeId`, `periodKey`, `transactionId`, `idempotencyKey` kabul eder.
- Client progress amount, reward, UID, cash veya season point gönderemez.
- Active period backend `Date.now()` ile yeniden hesaplanır; device time future/stale period zorlayamaz.
- Marketplace history belgeleri client tarafından yazılamaz.
- `challengeClaims` ve `seasonProgress` client write’a kapalıdır.
- Claim document create, canonical cash update, server-state mirror ve season points update tek transaction’dadır.
- Aynı idempotency key önceki sonucu döndürür; farklı key ile ikinci claim `already-claimed` olur.

## Reward model

Phase 1 reward türleri:

- soft currency
- season points

Premium currency eklenmedi. Reputation reward type olarak desteklenebilir ama bu katalogda kullanılmıyor. Season points `users/{uid}/seasonProgress/{seasonKey}` altında sezon anahtarına izole edilir ve leaderboard score, player level veya reputation ile karıştırılmaz.

## Leaderboard integration

- Mevcut weekly leaderboard ve server-owned score formülü değişmedi.
- Season identity aynı `YYYY-Www` formatını kullanır.
- Client ve backend leaderboard ISO-week helper’ları local timezone sapmasını önlemek için UTC calendar getter’larına sabitlendi; 400 günlük parity matrisi geçti.
- Server response canonical key sağlar; client helper yalnız display/fallback amaçlıdır.
- İkinci leaderboard koleksiyonu veya alternatif score formülü eklenmedi.

## Backend functions added

- `getCurrentSeason`
- `getChallengeProgress`
- `claimChallengeReward`

Hepsi mevcut `us-central1`, Node 20 callable options ve linked-account auth yaklaşımını kullanır. Rate limits:

- read: 60/dakika
- claim: 30/saat, idempotency-aware

Bu fonksiyonlar bu fazda deploy edilmedi.

## Persistence and schema

Save-data formatı ve cloud save schema değişmedi. Yeni backend-only/additive paths:

- `users/{uid}/challengeClaims/{periodKey:challengeId}`
- `users/{uid}/seasonProgress/{seasonKey}`

State lazy oluşur. Mevcut kullanıcı money/fleet/reputation resetlenmez. Historical lifetime progress taranmaz; yalnız aktif günlük/haftalık canonical marketplace history penceresi değerlendirilir. Account deletion recursive user cleanup yeni belgeleri de siler.

## Client integration and feature flags

`challengeService` üç callable için read/claim contract’ını sağlar. Final ekran veya navigation entry eklenmedi.

- `EXPO_PUBLIC_ENABLE_SEASONS=false`
- `EXPO_PUBLIC_ENABLE_CHALLENGES=false`

Challenges yalnız seasons flag’i de açıkken etkinleşir. `.env.production` ve `.env.internal` explicit false’dur. Store production validator bu flag’lerin yanlışlıkla true olmasını reddeder.

## Security test results

- client arbitrary progress API yok
- invalid challenge ID reddedildi
- disabled challenge reddedildi
- incomplete claim reddedildi
- stale ve future period reddedildi
- direct claim write reddedildi
- direct season points write reddedildi
- claim atomic cash/state update geçti
- same-key retry idempotent
- different-key double claim reddedildi
- season points doğru season key altında kaldı
- another-user mutation callable payload ile mümkün değil; UID auth context’ten alınır

## Files changed

Domain/client:

- `src/features/seasons/types.ts`
- `src/features/seasons/periods.ts`
- `src/features/challenges/catalog.ts`
- `src/features/challenges/progress.ts`
- `src/services/challengeService.ts`
- `src/config/backendRoadmap.ts`
- `src/config/storeProductionPolicy.ts`
- `src/utils/leaderboardSeason.ts`
- `app.config.js`
- `.env.example`, `.env.internal`, `.env.production`

Backend/security:

- `backend/src/seasonPeriods.ts`
- `backend/src/challengeTypes.ts`
- `backend/src/challengeCatalog.ts`
- `backend/src/challenges.ts`
- `backend/src/index.ts`
- `backend/src/leaderboardSeason.ts`
- `backend/test/challenges.emulator.test.ts`
- `firestore.rules`

Tests/docs:

- `scripts/seasons-challenges-foundation-test.ts`
- `scripts/test-globals.ts` (headless Expo `ExecutionEnvironment` mock parity)
- `docs/release-audit/V1_1_FEATURE_PHASE_1_SEASONS_CHALLENGES_FOUNDATION.md`

## Validation results

| Validation | Result |
|---|---|
| `npx tsc --noEmit` | PASS |
| `npm run validate:store-production` | PASS |
| `npm run backend:verify` | PASS — 69 tests, emulator + cloud audits |
| `npx tsx scripts/seasons-challenges-foundation-test.ts` | PASS — 26/26 |
| Challenge emulator suite | PASS — progress, claim, rollover/security |
| Leaderboard regression | PASS |
| Leaderboard eligibility | PASS — 17/17 |
| Leaderboard cross-platform | PASS |
| Leaderboard score v2 | PASS — 53/53 |
| Delivery settlement | PASS — 65/65 |
| Phase 3 contract/delivery smoke | PASS — 115/115 |
| Cash-flow audit | PASS — 42/42 |
| Marketplace regression | PASS |
| Marketplace purchase/deadlock | PASS — 83/83 |
| Marketplace startup reconciliation | PASS — 39/39 |
| Account deletion regression | PASS — 41/41 |
| Offline economy | PASS — 52/52 |
| Offline progression | PASS — 71/71 |
| App Store privacy/account regression | PASS — 18/18 |
| `git diff --check` | PASS |

## Deployment plan

Review/onay sonrasında ayrı rollout fazında:

1. `firebase deploy --only functions:getCurrentSeason,functions:getChallengeProgress,functions:claimChallengeReward`
2. `firebase deploy --only firestore:rules`
3. Functions list/region doğrulaması (`us-central1`)
4. Linked test account canary: progress read, complete claim, same-key replay, second-key rejection
5. Canonical cash ve season points reconciliation doğrulaması
6. Internal flag’leri açıp read-only diagnostics/UI canary
7. Production flag’leri ancak log ve canary sağlıklıysa aç

Composite Firestore index gerekmez; history sorgusu tek `createdAt` alanında range/order kullanır.

## Remaining risks

- Delivery tabanlı challenge’lar trusted backend settlement journal olmadan açılamaz.
- Marketplace geçmiş sorgusu 500 belgeyle bounded’dır; mevcut düşük hedefler için güvenlidir. Daha yüksek hacimli hedeflerde server-maintained idempotent aggregates gerekir.
- Full polished UI, refresh/reconciliation UX ve notification flow sonraki fazdadır.
- Deploy sonrası gerçek project canary yapılmadan feature flag açılmamalıdır.

## Next phase recommendation

Önce backend deploy + canary review, ardından feature-flagged read-only challenge screen ve claim reconciliation UI geliştirilmelidir. Delivery challenge’ları için ayrı olarak server-authoritative delivery settlement event tasarımı yapılmalıdır; client save sayaçları kullanılmamalıdır.

V1_1_FEATURE_PHASE_1_FOUNDATION_VERIFIED

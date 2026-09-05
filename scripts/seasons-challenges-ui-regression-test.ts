import './test-globals';

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  canClaimChallenge,
  challengeAttemptKey,
  createChallengeClaimAttempt,
  getChallengeErrorMessage,
  hasChallengePeriodRolledOver,
  shouldRetainClaimAttempt,
} from '../src/features/challenges/claimFlow';
import { validateInternalProfileEnv, validateStoreProductionEnv } from '../src/config/storeProductionPolicy';

let passed = 0;
function check(condition: unknown, label: string) {
  assert.ok(condition, label);
  passed += 1;
  console.log(`  ✓ ${label}`);
}

console.log('\n=== Seasons / Challenges UI Regression ===');

const internalEnv = readFileSync('.env.internal', 'utf8');
const productionEnv = readFileSync('.env.production', 'utf8');
const screen = readFileSync('src/features/seasons/SeasonsChallengesScreen.tsx', 'utf8');
const card = readFileSync('src/features/challenges/ChallengeCard.tsx', 'utf8');
const more = readFileSync('src/screens/MoreScreen.tsx', 'utf8');
const service = readFileSync('src/services/challengeService.ts', 'utf8');
const reconciliation = readFileSync('src/features/challenges/claimReconciliation.ts', 'utf8');

check(internalEnv.includes('EXPO_PUBLIC_ENABLE_SEASONS=true'), 'internal seasons flag enabled');
check(internalEnv.includes('EXPO_PUBLIC_ENABLE_CHALLENGES=true'), 'internal challenges flag enabled');
check(productionEnv.includes('EXPO_PUBLIC_ENABLE_SEASONS=false'), 'production seasons flag disabled');
check(productionEnv.includes('EXPO_PUBLIC_ENABLE_CHALLENGES=false'), 'production challenges flag disabled');
check(
  validateInternalProfileEnv({
    EXPO_PUBLIC_ADS_ENABLED: 'true',
    EXPO_PUBLIC_ADS_USE_TEST_IDS: 'true',
    EXPO_PUBLIC_BACKEND_DIAGNOSTICS_ENABLED: 'true',
    EXPO_PUBLIC_ENABLE_SEASONS: 'true',
    EXPO_PUBLIC_ENABLE_CHALLENGES: 'true',
    EXPO_PUBLIC_ENABLE_DRIVER_PROGRESSION: 'true',
    EXPO_PUBLIC_ENABLE_COMPANY_STATS: 'true',
    EXPO_PUBLIC_ENABLE_ACHIEVEMENTS: 'true',
    EXPO_PUBLIC_ENABLE_SEASON_HISTORY: 'true',
    EXPO_PUBLIC_ENABLE_INBOX: 'true',
    EXPO_PUBLIC_ENABLE_MARKET_ALERTS: 'true',
    EXPO_PUBLIC_ENABLE_NOTIFICATION_CENTER: 'true',
    EXPO_PUBLIC_ENABLE_V11_ANALYTICS: 'true',
  }).length === 0,
  'internal validator accepts internal feature flags',
);
check(
  validateStoreProductionEnv({
    env: {
      EXPO_PUBLIC_ADS_ENABLED: 'true',
      EXPO_PUBLIC_ENABLE_SEASONS: 'true',
      EXPO_PUBLIC_ENABLE_CHALLENGES: 'true',
    },
  }).some((error) => error.includes('ENABLE_SEASONS')),
  'production validator rejects accidental enablement',
);

check(more.includes("setRoute('seasons-challenges')"), 'More navigation owns a single seasons entry');
check(more.includes('SEASONS_ENABLED && CHALLENGES_ENABLED'), 'navigation entry is feature guarded');
check(screen.includes('Günlük Görevler') && screen.includes('Haftalık Görevler'), 'daily and weekly sections render');
check(screen.includes('Bağlı hesap gerekli') && screen.includes('Hesap Merkezi'), 'guest state has polished account CTA');
check(screen.includes('Görevler yüklenemedi') && screen.includes('Sezon görevleri yükleniyor'), 'loading and error states render');
check(card.includes("progress.claimed ? 'Alındı'") && card.includes("claimable ? 'Hazır'"), 'completed and claimed states are distinct');
check(screen.includes('item.definition.enabled'), 'deferred challenges are hidden');

check(canClaimChallenge({ completed: true, claimed: false, linkedAccount: true, featuresEnabled: true, requestPending: false }), 'completed linked challenge is claimable');
check(!canClaimChallenge({ completed: true, claimed: false, linkedAccount: true, featuresEnabled: true, requestPending: true }), 'double tap is blocked');
check(!canClaimChallenge({ completed: true, claimed: true, linkedAccount: true, featuresEnabled: true, requestPending: false }), 'claimed challenge cannot be claimed again');
check(!canClaimChallenge({ completed: true, claimed: false, linkedAccount: false, featuresEnabled: true, requestPending: false }), 'guest mutation is blocked');

let sequence = 0;
const attempt = createChallengeClaimAttempt('daily_marketplace_sale', '2026-09-02', () => `id-${++sequence}`);
const retainedAttempt = shouldRetainClaimAttempt('timeout') ? attempt : null;
check(retainedAttempt?.idempotencyKey === attempt.idempotencyKey, 'timeout retry retains same idempotency key');
check(challengeAttemptKey(attempt.challengeId, attempt.periodKey) === '2026-09-02:daily_marketplace_sale', 'claim attempt is period scoped');
check(shouldRetainClaimAttempt('service-unavailable'), 'network failure keeps retry envelope');
check(!shouldRetainClaimAttempt('period-closed'), 'closed period discards stale envelope');
check(getChallengeErrorMessage('already-claimed').includes('daha önce'), 'already-claimed is friendly and non-scary');

const now = Date.UTC(2026, 8, 2, 12);
check(!hasChallengePeriodRolledOver(now, now + 1, now + 10_000), 'active period remains stable');
check(hasChallengePeriodRolledOver(now, now, now + 10_000), 'daily rollover triggers refresh');
check(hasChallengePeriodRolledOver(now, now + 10_000, now), 'weekly rollover triggers refresh');

check(service.includes("httpsCallable") && service.includes("'claimChallengeReward'"), 'claim uses canonical callable service');
check(service.includes("'seasonProgress'"), 'season points read canonical owner document');
check(reconciliation.includes('applyVehicleMarketplaceReconciliation'), 'cash uses canonical marketplace reconciliation');
check(screen.includes('pointsResult.points === result.seasonPointsAfter'), 'season points reconcile against claim receipt');
check(!screen.includes('player.money') && !screen.includes('setInterval(() => refresh'), 'screen has no optimistic cash write or polling');
check(!screen.includes('useGameStore((state) => state)'), 'screen has no broad Zustand subscription');
check(screen.includes("AppState.addEventListener('change'"), 'active screen refreshes on foreground with cleanup');

console.log(`\nResult: ${passed} passed, 0 failed`);

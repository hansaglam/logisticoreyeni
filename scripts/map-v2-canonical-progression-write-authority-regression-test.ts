/**
 * Step 29AO — post-migration local progression write authority.
 * Run: node --import tsx scripts/map-v2-canonical-progression-write-authority-regression-test.ts
 */
import './test-globals';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AUTHORITATIVE_CASH_LISTENER_ENABLED,
  AUTHORITATIVE_CASH_OVERLAY_ENABLED,
  CASH_AUTHORITY_VERSION_UNMIGRATED,
  canUseServerAuthoritativeSettlement,
} from '../src/domain/cashAuthority';
import {
  CANONICAL_PROGRESSION_ELIGIBILITY_AUTHORITY_STATUS,
  resolveProgressionEligibilityAuthority,
} from '../src/domain/canonicalProgressionEligibility';
import {
  CANONICAL_PROGRESSION_READ_AUTHORITY_ENV,
  CANONICAL_PROGRESSION_READ_AUTHORITY_STATUS,
  resolveEffectiveCompanyProgression,
  type EffectiveCompanyProgression,
} from '../src/domain/canonicalProgressionReadAuthority';
import {
  CANONICAL_PROGRESSION_LOCAL_WRITE_BLOCKED,
  CANONICAL_PROGRESSION_WAITING_FOR_SERVER,
  CANONICAL_PROGRESSION_WRITE_AUTHORITY_ENV,
  CANONICAL_PROGRESSION_WRITE_AUTHORITY_STATUS,
  CLIENT_PROGRESSION_WRITE_AUDIT,
  GUEST_LOCAL_PROGRESSION_WRITE_ALLOWED,
  LEGACY_LOCAL_PROGRESSION_WRITE_ALLOWED,
  applyGuardedCompanyReputation,
  applyGuardedCompanyXp,
  isCanonicalProgressionWriteAuthorityAllowed,
  resolveCanonicalProgressionWrite,
  type ClientProgressionWriteSource,
} from '../src/domain/canonicalProgressionWriteAuthority';
import { getSignedInCashAuthorityCoverage } from '../src/domain/signedInCashAuthorityCoverage';
import { MODE_OPERATIONAL_READINESS } from '../src/mapV2/domain/multimodal';
import { SAVE_GAME_VERSION } from '../src/storage/saveGame';
import type { Player } from '../src/types/game';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const writeDomain = read('src/domain/canonicalProgressionWriteAuthority.ts');
const writeService = read('src/services/canonicalProgressionWriteAuthority.ts');
const subscription = read('src/services/canonicalProgressionService.ts');
const eligibility = read('src/domain/canonicalProgressionEligibility.ts');
const gameStore = read('src/store/gameStore.ts');
const debugScreen = read('src/screens/DebugSimulationScreen.tsx');
const contracts = read('src/screens/ContractsScreen.tsx');
const shop = read('src/screens/ShopScreen.tsx');
const warehouse = read('src/screens/WarehouseScreen.tsx');

const previousWrite = process.env[CANONICAL_PROGRESSION_WRITE_AUTHORITY_ENV];
const previousRead = process.env[CANONICAL_PROGRESSION_READ_AUTHORITY_ENV];
delete process.env[CANONICAL_PROGRESSION_WRITE_AUTHORITY_ENV];
delete process.env[CANONICAL_PROGRESSION_READ_AUTHORITY_ENV];

function projection(
  partial: Partial<EffectiveCompanyProgression> &
    Pick<EffectiveCompanyProgression, 'status' | 'authorityClass' | 'source'>,
): EffectiveCompanyProgression {
  return {
    level: partial.level ?? null,
    xp: partial.xp ?? null,
    xpToNextLevel: partial.xpToNextLevel ?? null,
    totalXp: partial.totalXp ?? null,
    reputation: partial.reputation ?? null,
    revision: partial.revision ?? null,
    reason: partial.reason ?? null,
    status: partial.status,
    authorityClass: partial.authorityClass,
    source: partial.source,
  };
}

const guestProgression = projection({
  status: 'ready',
  authorityClass: 'GUEST_LOCAL',
  source: 'LOCAL_GUEST',
  level: 1,
  xp: 0,
  xpToNextLevel: 100,
  totalXp: 0,
  reputation: 40,
});
const legacyProgression = projection({
  status: 'ready',
  authorityClass: 'SIGNED_IN_LEGACY_LOCAL',
  source: 'LOCAL_LEGACY',
  level: 2,
  xp: 10,
  xpToNextLevel: 120,
  totalXp: 110,
  reputation: 55,
});
const canonicalProgression = projection({
  status: 'ready',
  authorityClass: 'SIGNED_IN_CANONICAL_SERVER',
  source: 'CANONICAL_SERVER',
  level: 4,
  xp: 12,
  xpToNextLevel: 200,
  totalXp: 400,
  reputation: 70,
});
const loadingProgression = projection({
  status: 'loading',
  authorityClass: 'SIGNED_IN_CANONICAL_LOADING',
  source: 'UNAVAILABLE',
  reason: 'CANONICAL_PROGRESSION_LOADING',
});
const unavailableProgression = projection({
  status: 'unavailable',
  authorityClass: 'SIGNED_IN_CANONICAL_UNAVAILABLE',
  source: 'UNAVAILABLE',
  reason: 'CANONICAL_PROGRESSION_MISSING_AFTER_CUTOVER',
});

function player(partial?: Partial<Player>): Player {
  return {
    companyName: 'Test',
    money: 1000,
    companyLevel: 1,
    level: 1,
    xp: 0,
    xpToNextLevel: 100,
    totalXp: 0,
    homeCityId: 'izmir',
    reputation: 40,
    completedContracts: 0,
    trucks: [],
    drivers: [],
    warehouses: [],
    trailers: [],
    ...partial,
  } as Player;
}

function write(progressionValue: EffectiveCompanyProgression, source: ClientProgressionWriteSource, gate = true) {
  return resolveCanonicalProgressionWrite({
    writeGateEnabled: gate,
    progression: progressionValue,
    source,
  });
}

assert.equal(isCanonicalProgressionWriteAuthorityAllowed(), false, 'A gate default off');
assert.equal(
  write(canonicalProgression, 'delivery_completed', false).decision,
  'LOCAL_AUTHORITATIVE',
  'A gate off stays local even for a canonical projection',
);

const guestWrite = write(guestProgression, 'delivery_completed');
assert.equal(guestWrite.decision, 'LOCAL_AUTHORITATIVE', 'A guest decision');
assert.equal(guestWrite.diagnostic, GUEST_LOCAL_PROGRESSION_WRITE_ALLOWED, 'A guest diagnostic');
const guestPlayer = player();
const guestXp = applyGuardedCompanyXp(guestPlayer, 100_000, guestWrite);
assert.equal(guestXp.applied, true, 'A guest xp applied');
assert.ok((guestXp.xpResult?.player.totalXp ?? 0) > 0, 'A guest totalXp advances');
assert.equal(guestXp.xpResult?.leveledUp, true, 'A guest level-up');
assert.ok((guestXp.xpResult?.player.level ?? 1) > 1, 'A guest level advances');
const guestReputation = applyGuardedCompanyReputation(
  { player: guestPlayer, reputationHistory: [] },
  {
    source: 'delivery-settlement',
    delta: 5,
    reason: 'delivery-on-time',
    idempotencyKey: 'guest-rep',
    createdAt: 1,
  },
  guestWrite,
);
assert.equal(guestReputation.result.applied, true, 'A guest reputation applied');
assert.equal(guestReputation.player.reputation, 45, 'A guest reputation value');

const legacyWrite = write(legacyProgression, 'mission_reward');
assert.equal(legacyWrite.decision, 'LOCAL_AUTHORITATIVE', 'B legacy decision');
assert.equal(legacyWrite.diagnostic, LEGACY_LOCAL_PROGRESSION_WRITE_ALLOWED, 'B legacy diagnostic');
const legacyPlayer = player({ level: 2, companyLevel: 2, xp: 10, totalXp: 110, reputation: 55 });
const legacyXp = applyGuardedCompanyXp(legacyPlayer, 25, legacyWrite);
assert.equal(legacyXp.applied, true, 'B legacy xp applied');
assert.equal(legacyXp.xpResult?.player.totalXp, 135, 'B legacy totalXp');
const legacyReputation = applyGuardedCompanyReputation(
  { player: legacyPlayer, reputationHistory: [] },
  {
    source: 'mission-reward',
    delta: 2,
    reason: 'mission-reward',
    idempotencyKey: 'legacy-rep',
    createdAt: 2,
  },
  legacyWrite,
);
assert.equal(legacyReputation.player.reputation, 57, 'B legacy reputation');

const canonicalXpWrite = write(canonicalProgression, 'truck_purchase');
assert.equal(canonicalXpWrite.decision, 'CANONICAL_SERVER_EXPECTED', 'C canonical xp decision');
const canonicalPlayer = player({ level: 3, companyLevel: 3, xp: 20, totalXp: 220, reputation: 61, money: 800 });
const blockedXp = applyGuardedCompanyXp(canonicalPlayer, 30, canonicalXpWrite);
assert.equal(blockedXp.applied, false, 'C canonical xp blocked');
assert.equal(canonicalPlayer.xp, 20, 'C local xp unchanged');
assert.equal(canonicalPlayer.totalXp, 220, 'C local totalXp unchanged');
assert.equal(canonicalPlayer.level, 3, 'C local level unchanged');
assert.equal(canonicalPlayer.money, 800, 'C unrelated money unchanged');
const canonicalReputationWrite = write(canonicalProgression, 'vehicle_recovery');
assert.equal(canonicalReputationWrite.decision, 'LOCAL_NON_AUTHORITATIVE_BLOCKED', 'C recovery blocked');
const blockedReputation = applyGuardedCompanyReputation(
  { player: canonicalPlayer, reputationHistory: [] },
  {
    source: 'delivery-operation',
    delta: -4,
    reason: 'operation-negative',
    idempotencyKey: 'canonical-rep',
    createdAt: 3,
  },
  canonicalReputationWrite,
);
assert.equal(blockedReputation.result.applied, false, 'C reputation not applied');
assert.equal(blockedReputation.player.reputation, 61, 'C reputation unchanged');
assert.equal(blockedReputation.reputationHistory.length, 0, 'C history not advanced');
assert.equal(canonicalReputationWrite.diagnostic, CANONICAL_PROGRESSION_LOCAL_WRITE_BLOCKED, 'C blocked diagnostic');

const duplicate = applyGuardedCompanyXp(canonicalPlayer, 30, write(canonicalProgression, 'delivery_completed'));
const duplicateAgain = applyGuardedCompanyXp(canonicalPlayer, 30, write(canonicalProgression, 'delivery_completed'));
assert.equal(duplicate.applied, false, 'D first duplicate blocked');
assert.equal(duplicateAgain.applied, false, 'D second duplicate blocked');
assert.equal(canonicalPlayer.totalXp, 220, 'D no local double grant');
assert.equal(write(canonicalProgression, 'delivery_completed').backendSource, 'CANONICAL_RECEIPT', 'D receipt is sole class');
assert.doesNotMatch(writeDomain, /setDoc|addDoc|updateDoc/, 'D domain does not write canonical xp');

assert.equal(write(loadingProgression, 'delivery_completed').decision, 'CANONICAL_LOADING_BLOCKED', 'E loading');
assert.equal(
  write(loadingProgression, 'debug').diagnostic,
  CANONICAL_PROGRESSION_WAITING_FOR_SERVER,
  'E loading diagnostic',
);
assert.equal(applyGuardedCompanyXp(canonicalPlayer, 10, write(loadingProgression, 'debug')).applied, false, 'E loading no write');
assert.equal(write(unavailableProgression, 'mission_reward').decision, 'CANONICAL_UNAVAILABLE_BLOCKED', 'E unavailable');
assert.equal(
  applyGuardedCompanyReputation(
    { player: canonicalPlayer, reputationHistory: [] },
    {
      source: 'mission-reward',
      delta: 1,
      reason: 'mission-reward',
      idempotencyKey: 'unavailable-rep',
      createdAt: 4,
    },
    write(unavailableProgression, 'mission_reward'),
  ).result.applied,
  false,
  'E unavailable reputation',
);
assert.equal(canonicalPlayer.reputation, 61, 'E unavailable did not change reputation');

const switchedAway = write(guestProgression, 'debug');
assert.equal(switchedAway.decision, 'LOCAL_AUTHORITATIVE', 'F sign-out returns guest local');
assert.equal(write(canonicalProgression, 'debug').decision, 'LOCAL_NON_AUTHORITATIVE_BLOCKED', 'F switch to canonical blocks');
assert.equal(write(legacyProgression, 'debug').decision, 'LOCAL_AUTHORITATIVE', 'F switch to legacy allows');
assert.doesNotMatch(writeService, /onSnapshot|boundUid|seenCanonicalUids/, 'F no second subscription');
assert.match(writeService, /getCanonicalProgressionReadSnapshot/, 'F uses existing snapshot');
assert.match(writeService, /getAccountStatus/, 'F uses account status');
assert.equal((subscription.match(/onSnapshot/g) ?? []).length, 1, 'F listener count stays 1');

const readProjection = resolveEffectiveCompanyProgression(
  {
    gateEnabled: false,
    auth: 'guest',
    uid: null,
    snapshot: {
      status: 'idle',
      uid: null,
      doc: null,
      fromCache: false,
      previouslyCanonicalForUid: false,
    },
  },
  guestPlayer,
);
assert.equal(readProjection.authorityClass, 'GUEST_LOCAL', 'G read guest unchanged');
assert.equal(readProjection.level, 1, 'G read level unchanged');
const eligibilityProjection = resolveProgressionEligibilityAuthority({
  eligibilityGateEnabled: false,
  progression: canonicalProgression,
  localLevel: 2,
  localReputation: 33,
});
assert.equal(eligibilityProjection.canEvaluate, true, 'G eligibility gate off still evaluates');
assert.equal(eligibilityProjection.level, 2, 'G eligibility stays on local level when gate off');
assert.doesNotMatch(eligibility, /canonicalProgressionWriteAuthority/, 'G eligibility module untouched');
assert.match(shop, /useEffectiveCompanyProgression/, 'G shop read remains');
assert.match(warehouse, /resolveProgressionEligibilityAuthority/, 'G warehouse eligibility remains');
assert.match(contracts, /selectPlayerLevel/, 'G contracts stay local');
assert.doesNotMatch(contracts, /canonicalProgressionWriteAuthority/, 'G contracts ignore write authority');
assert.equal(CANONICAL_PROGRESSION_READ_AUTHORITY_STATUS, 'CANONICAL_PROGRESSION_READ_AUTHORITY_PASS_INTERNAL_ONLY');
assert.equal(
  CANONICAL_PROGRESSION_ELIGIBILITY_AUTHORITY_STATUS,
  'CANONICAL_PROGRESSION_ELIGIBILITY_AUTHORITY_PASS_PARTIAL',
);

assert.match(gameStore, /applyGuardedCompanyXp/, 'store guards xp');
assert.match(gameStore, /commitCompanyReputation/, 'store guards reputation');
assert.match(gameStore, /if \(!guarded\.applied \|\| !guarded\.xpResult\)/, 'store skips save on blocked xp');
assert.match(gameStore, /Şirket seviye atladı/, 'local level toast remains for guest');
assert.match(gameStore, /İtibar güncellendi/, 'local reputation toast remains for guest');
assert.match(debugScreen, /Yerel şirket XP yazımı kapalı/, 'debug success copy is conditional');
assert.doesNotMatch(writeDomain, /saveGame|syncLocalSaveToCloud/, 'blocked write cannot upload itself');
assert.doesNotMatch(writeService, /saveGame|syncLocalSaveToCloud/, 'service does not upload progression');

const truckSet = gameStore.indexOf('trucks: [...state.player.trucks, newTruck]');
const truckXp = gameStore.indexOf("get().addCompanyXp(levelBalance.xpRewards.truckPurchase, 'truck_purchase')");
assert.ok(truckSet > 0 && truckSet < truckXp, 'C truck mutation stays before xp');

assert.equal(CLIENT_PROGRESSION_WRITE_AUDIT.length, 16, 'audit rows');
assert.ok(CLIENT_PROGRESSION_WRITE_AUDIT.some((row) => row.canonicalAction === 'BLOCK_NO_BACKEND' && row.trigger === 'operation_choice'));
assert.ok(CLIENT_PROGRESSION_WRITE_AUDIT.some((row) => row.canonicalBackendSource === 'ROAD_DELIVERY_COMPLETION'));

assert.equal(SAVE_GAME_VERSION, 6, 'save version');
assert.equal(CASH_AUTHORITY_VERSION_UNMIGRATED, 0);
assert.equal(AUTHORITATIVE_CASH_LISTENER_ENABLED, false);
assert.equal(AUTHORITATIVE_CASH_OVERLAY_ENABLED, false);
assert.equal(
  canUseServerAuthoritativeSettlement({
    signedInLinked: true,
    cashAuthorityVersion: 0,
    serverStateCashPresent: true,
    reconciliationActive: true,
    staleSaveProtectionActive: true,
  }).ready,
  false,
);
const coverage = getSignedInCashAuthorityCoverage();
assert.equal(coverage.criticalSignedInCashPathsTotal, 24);
assert.equal(coverage.criticalCanonicalizedCount, 0);
assert.equal(coverage.criticalBlockedCount, 24);
assert.equal(MODE_OPERATIONAL_READINESS.RAIL, 'FOUNDATION_ONLY');
assert.equal(MODE_OPERATIONAL_READINESS.SEA, 'FOUNDATION_ONLY');
assert.equal(MODE_OPERATIONAL_READINESS.AIR, 'FOUNDATION_ONLY');
assert.equal(
  CANONICAL_PROGRESSION_WRITE_AUTHORITY_STATUS,
  'CANONICAL_PROGRESSION_WRITE_AUTHORITY_PASS_INTERNAL_ONLY',
);
assert.doesNotMatch(read('src/data/routes.ts'), /canonicalProgressionWriteAuthority/);
assert.doesNotMatch(writeDomain, /routes\.ts/);

if (previousWrite === undefined) delete process.env[CANONICAL_PROGRESSION_WRITE_AUTHORITY_ENV];
else process.env[CANONICAL_PROGRESSION_WRITE_AUTHORITY_ENV] = previousWrite;
if (previousRead === undefined) delete process.env[CANONICAL_PROGRESSION_READ_AUTHORITY_ENV];
else process.env[CANONICAL_PROGRESSION_READ_AUTHORITY_ENV] = previousRead;

console.log('map-v2-canonical-progression-write-authority-regression-test: PASS');

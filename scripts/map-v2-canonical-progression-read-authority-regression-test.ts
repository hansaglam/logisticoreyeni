/**
 * Step 29AM — signed-in canonical progression read authority.
 * Run: node --import tsx scripts/map-v2-canonical-progression-read-authority-regression-test.ts
 */
import './test-globals';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { calculateXpToNextLevel } from '../src/config/levelConfig';
import {
  AUTHORITATIVE_CASH_LISTENER_ENABLED,
  AUTHORITATIVE_CASH_OVERLAY_ENABLED,
  CASH_AUTHORITY_VERSION_UNMIGRATED,
  canUseServerAuthoritativeSettlement,
} from '../src/domain/cashAuthority';
import {
  CANONICAL_COMPANY_PROGRESSION_SCHEMA_VERSION,
  CANONICAL_PROGRESSION_MIGRATION_POLICY_VERSION,
  createInitialCanonicalCompanyProgression,
} from '../src/domain/canonicalCompanyProgression';
import {
  CANONICAL_PROGRESSION_INVALID,
  CANONICAL_PROGRESSION_MISSING_AFTER_CUTOVER,
  CANONICAL_PROGRESSION_READ_AUTHORITY_ENV,
  CANONICAL_PROGRESSION_READ_AUTHORITY_STATUS,
  CANONICAL_PROGRESSION_UNSUPPORTED_SCHEMA,
  POST_CUTOVER_LOCAL_XP_TOAST_NON_AUTHORITATIVE,
  POST_MIGRATION_LOCAL_PROGRESSION_WRITES_NON_AUTHORITATIVE,
  PROGRESSION_UI_ELIGIBILITY_STILL_LOCAL,
  PUBLIC_MIGRATION_UI_UNWIRED,
  isCanonicalProgressionReadAuthorityAllowed,
  resolveEffectiveCompanyProgression,
  type CanonicalProgressionReadSnapshot,
} from '../src/domain/canonicalProgressionReadAuthority';
import { getSignedInCashAuthorityCoverage } from '../src/domain/signedInCashAuthorityCoverage';
import { MODE_OPERATIONAL_READINESS } from '../src/mapV2/domain/multimodal';
import {
  applyCanonicalProgressionReadSnapshot,
  clearCanonicalProgressionReadState,
  getCanonicalProgressionReadSnapshot,
} from '../src/services/canonicalProgressionService';
import { SAVE_GAME_VERSION } from '../src/storage/saveGame';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const domain = read('src/domain/canonicalProgressionReadAuthority.ts');
const service = read('src/services/canonicalProgressionService.ts');
const hook = read('src/hooks/useEffectiveCompanyProgression.ts');
const dashboard = read('src/screens/DashboardScreen.tsx');
const more = read('src/screens/MoreScreen.tsx');
const shop = read('src/screens/ShopScreen.tsx');
const account = read('src/screens/AccountCenterScreen.tsx');
const contracts = read('src/screens/ContractsScreen.tsx');
const tabBar = read('src/components/navigation/GameTabBar.tsx');
const warehouse = read('src/screens/WarehouseScreen.tsx');
const gameStore = read('src/store/gameStore.ts');
const rules = read('firestore.rules');
const issuance = read('backend/src/canonicalProductionRoadContractIssuance.ts');

const previousGate = process.env[CANONICAL_PROGRESSION_READ_AUTHORITY_ENV];
delete process.env[CANONICAL_PROGRESSION_READ_AUTHORITY_ENV];

const localTamper = {
  level: 30,
  companyLevel: 30,
  xp: 9_999,
  xpToNextLevel: 10_000,
  totalXp: 80_000,
  reputation: 100,
};

function canonicalDoc(uid: string, patch: Record<string, unknown> = {}) {
  const base = createInitialCanonicalCompanyProgression(uid, 1_700_000_000_000);
  return {
    ...base,
    level: 5,
    xp: 20,
    xpToNextLevel: calculateXpToNextLevel(5),
    totalXp: 420,
    reputation: 60,
    progressionRevision: 3,
    ...patch,
  };
}

function migratedDoc(uid: string) {
  return canonicalDoc(uid, {
    initializationSource: 'LEGACY_MIGRATION_BASELINE',
    baselineProvenance: {
      attestationClass: 'SERVER_ATTESTED_LEGACY_BASELINE',
      migrationPolicyVersion: CANONICAL_PROGRESSION_MIGRATION_POLICY_VERSION,
      migrationId: `progressionMigration:${uid}:v1`,
      baselineTotalXp: 400,
      baselineReputation: 60,
      sourceSnapshotHash: 'sha256:abc',
      cutoverAtMs: 1_700_000_000_000,
    },
  });
}

function snap(
  partial: Partial<CanonicalProgressionReadSnapshot> & Pick<CanonicalProgressionReadSnapshot, 'status' | 'uid'>,
): CanonicalProgressionReadSnapshot {
  return {
    doc: null,
    fromCache: false,
    previouslyCanonicalForUid: false,
    ...partial,
  };
}

function resolve(
  gateEnabled: boolean,
  auth: 'guest' | 'signed-in' | 'loading',
  uid: string | null,
  snapshot: CanonicalProgressionReadSnapshot,
  local = localTamper,
) {
  return resolveEffectiveCompanyProgression({ gateEnabled, auth, uid, snapshot }, local);
}

clearCanonicalProgressionReadState();

assert.equal(isCanonicalProgressionReadAuthorityAllowed(), false, 'A gate default off');
assert.equal(isCanonicalProgressionReadAuthorityAllowed({ envValue: undefined }), false, 'A missing env');
assert.equal(isCanonicalProgressionReadAuthorityAllowed({ envValue: 'INTERNAL_TEST' }), true, 'A internal');

const idle = snap({ status: 'idle', uid: null });
const guest = resolve(true, 'guest', null, idle, { ...localTamper, level: 4, xp: 12, reputation: 40 });
assert.equal(guest.authorityClass, 'GUEST_LOCAL', 'B guest class');
assert.equal(guest.source, 'LOCAL_GUEST', 'B guest source');
assert.equal(guest.level, 4, 'B guest level');
assert.equal(guest.xp, 12, 'B guest xp');
const guestAfter = resolve(true, 'guest', null, idle, { ...localTamper, level: 6, xp: 3, reputation: 41 });
assert.equal(guestAfter.level, 6, 'X guest gameplay follows local');
assert.equal(guestAfter.xp, 3, 'X guest xp follows local');

const legacy = resolve(true, 'signed-in', 'legacy-user', snap({ status: 'missing', uid: 'legacy-user' }));
assert.equal(legacy.authorityClass, 'SIGNED_IN_LEGACY_LOCAL', 'C legacy class');
assert.equal(legacy.level, 30, 'C legacy uses local');
assert.equal(legacy.reputation, 100, 'C legacy reputation');

const migrated = resolve(
  true,
  'signed-in',
  'migrated-user',
  snap({
    status: 'ready',
    uid: 'migrated-user',
    doc: migratedDoc('migrated-user'),
  }),
);
assert.equal(migrated.authorityClass, 'SIGNED_IN_CANONICAL_SERVER', 'D migrated class');
assert.equal(migrated.source, 'CANONICAL_SERVER', 'D migrated source');
assert.equal(migrated.level, 5, 'D migrated level');
assert.equal(migrated.xp, 20, 'D migrated xp');
assert.equal(migrated.reputation, 60, 'D migrated reputation');
assert.equal(migrated.xpToNextLevel, calculateXpToNextLevel(5), 'D server threshold');

const fresh = resolve(
  true,
  'signed-in',
  'new-user',
  snap({ status: 'ready', uid: 'new-user', doc: canonicalDoc('new-user', { initializationSource: 'NEW_CANONICAL_ACCOUNT_DEFAULTS' }) }),
);
assert.equal(fresh.level, 5, 'E new account canonical');
assert.equal(fresh.reputation, 60, 'E new account reputation');

assert.equal(migrated.level, 5, 'F local level tamper ignored');
assert.equal(migrated.xp, 20, 'G local xp tamper ignored');
assert.equal(migrated.reputation, 60, 'H local reputation tamper ignored');
assert.notEqual(migrated.level, localTamper.level, 'F not local level');

const updatedDoc = canonicalDoc('migrated-user', { level: 6, xp: 1, xpToNextLevel: calculateXpToNextLevel(6), progressionRevision: 4, totalXp: 500 });
applyCanonicalProgressionReadSnapshot({
  status: 'ready',
  uid: 'migrated-user',
  doc: updatedDoc,
  fromCache: false,
  previouslyCanonicalForUid: false,
});
const afterCanonical = resolve(true, 'signed-in', 'migrated-user', getCanonicalProgressionReadSnapshot());
assert.equal(afterCanonical.level, 6, 'I canonical update reflected');
assert.equal(afterCanonical.revision, 4, 'I revision');

const afterLocal = resolve(true, 'signed-in', 'migrated-user', getCanonicalProgressionReadSnapshot(), {
  ...localTamper,
  level: 11,
  xp: 15,
  reputation: 74,
});
assert.equal(afterLocal.level, 6, 'J local post-cutover update ignored');
assert.equal(afterLocal.xp, 1, 'J local xp ignored');
assert.equal(afterLocal.reputation, 60, 'J local reputation ignored');

assert.doesNotMatch(service, /saveGame|useGameStore|setDoc|updateDoc|setCanonical/, 'K L no save mirror or client write');
assert.match(service, /onSnapshot/);
assert.match(service, /includeMetadataChanges: true/);

clearCanonicalProgressionReadState();
assert.equal(getCanonicalProgressionReadSnapshot().uid, null, 'M sign-out clears uid');
assert.equal(getCanonicalProgressionReadSnapshot().doc, null, 'M sign-out clears doc');
const guestAfterSignOut = resolve(true, 'guest', null, getCanonicalProgressionReadSnapshot(), { level: 2, xp: 5, reputation: 10 });
assert.equal(guestAfterSignOut.level, 2, 'M guest does not keep prior canonical level');
assert.equal(guestAfterSignOut.source, 'LOCAL_GUEST', 'M guest source');

applyCanonicalProgressionReadSnapshot({
  status: 'ready',
  uid: 'user-a',
  doc: canonicalDoc('user-a', { level: 9, xp: 4, xpToNextLevel: calculateXpToNextLevel(9), reputation: 70, totalXp: 900, progressionRevision: 2 }),
  fromCache: false,
  previouslyCanonicalForUid: false,
});
const switched = resolve(
  true,
  'signed-in',
  'user-b',
  getCanonicalProgressionReadSnapshot(),
  { level: 3, xp: 1, reputation: 20 },
);
assert.equal(switched.status, 'loading', 'N account switch does not show user A');
assert.equal(switched.level, null, 'N no carry-over');
applyCanonicalProgressionReadSnapshot({
  status: 'missing',
  uid: 'user-b',
  doc: null,
  fromCache: false,
  previouslyCanonicalForUid: false,
});
const userB = resolve(true, 'signed-in', 'user-b', getCanonicalProgressionReadSnapshot(), { level: 3, xp: 1, reputation: 20 });
assert.equal(userB.authorityClass, 'SIGNED_IN_LEGACY_LOCAL', 'N user B legacy');
assert.equal(userB.level, 3, 'N user B local level');

const loading = resolve(true, 'signed-in', 'migrated-user', snap({ status: 'loading', uid: 'migrated-user', previouslyCanonicalForUid: true }));
assert.equal(loading.status, 'loading', 'O loading');
assert.equal(loading.level, null, 'O loading does not use local level');
assert.equal(loading.xp, null, 'O loading does not use local xp');
assert.equal(loading.reputation, null, 'O loading does not use local reputation');

const errored = resolve(true, 'signed-in', 'migrated-user', snap({ status: 'error', uid: 'migrated-user', previouslyCanonicalForUid: true }));
assert.equal(errored.status, 'unavailable', 'P error');
assert.equal(errored.level, null, 'P error does not use local');
assert.equal(errored.reason, 'CANONICAL_PROGRESSION_READ_ERROR', 'P reason');

const missing = resolve(
  true,
  'signed-in',
  'migrated-user',
  snap({ status: 'missing', uid: 'migrated-user', previouslyCanonicalForUid: true }),
);
assert.equal(missing.reason, CANONICAL_PROGRESSION_MISSING_AFTER_CUTOVER, 'Q missing after cutover');
assert.equal(missing.level, null, 'Q no local fallback');

const unsupported = resolve(
  true,
  'signed-in',
  'migrated-user',
  snap({
    status: 'ready',
    uid: 'migrated-user',
    doc: { ...canonicalDoc('migrated-user'), schemaVersion: CANONICAL_COMPANY_PROGRESSION_SCHEMA_VERSION + 1 },
    previouslyCanonicalForUid: true,
  }),
);
assert.equal(unsupported.reason, CANONICAL_PROGRESSION_UNSUPPORTED_SCHEMA, 'R unsupported schema');
assert.equal(unsupported.level, null, 'R no local fallback');

const invalid = resolve(
  true,
  'signed-in',
  'migrated-user',
  snap({
    status: 'ready',
    uid: 'migrated-user',
    doc: { ...canonicalDoc('migrated-user'), xp: -1 },
    previouslyCanonicalForUid: true,
  }),
);
assert.equal(invalid.reason, CANONICAL_PROGRESSION_INVALID, 'invalid doc');
assert.equal(invalid.level, null, 'invalid no local fallback');

const fixture = resolve(
  true,
  'signed-in',
  'migrated-user',
  snap({ status: 'ready', uid: 'migrated-user', doc: { level: 9, reputation: 80 } }),
);
assert.equal(fixture.level, null, 'fixture rejected');

const cached = resolve(
  true,
  'signed-in',
  'migrated-user',
  snap({ status: 'ready', uid: 'migrated-user', doc: canonicalDoc('migrated-user'), fromCache: true }),
);
assert.equal(cached.source, 'CANONICAL_CACHE', 'S cached canonical');
assert.equal(cached.level, 5, 'S cached level');
assert.notEqual(cached.level, localTamper.level, 'S cache is not the legacy save');

const offlineMiss = resolve(true, 'signed-in', 'migrated-user', snap({ status: 'error', uid: 'migrated-user', previouslyCanonicalForUid: true }));
assert.equal(offlineMiss.level, null, 'S no cache does not use local');

applyCanonicalProgressionReadSnapshot({
  status: 'ready',
  uid: 'rev-user',
  doc: canonicalDoc('rev-user', { progressionRevision: 5, level: 7, xp: 2, xpToNextLevel: calculateXpToNextLevel(7), totalXp: 700 }),
  fromCache: false,
  previouslyCanonicalForUid: false,
});
applyCanonicalProgressionReadSnapshot({
  status: 'ready',
  uid: 'rev-user',
  doc: canonicalDoc('rev-user', { progressionRevision: 4, level: 1, xp: 0, xpToNextLevel: calculateXpToNextLevel(1), totalXp: 0 }),
  fromCache: true,
  previouslyCanonicalForUid: true,
});
const kept = resolve(true, 'signed-in', 'rev-user', getCanonicalProgressionReadSnapshot());
assert.equal(kept.level, 7, 'older revision ignored');
assert.equal(kept.revision, 5, 'revision monotonic');

const gateOff = resolve(false, 'signed-in', 'migrated-user', snap({ status: 'ready', uid: 'migrated-user', doc: canonicalDoc('migrated-user') }));
assert.equal(gateOff.source, 'LOCAL_LEGACY', 'gate off stays local');
assert.equal(gateOff.level, 30, 'gate off shows local level');

const authLoading = resolve(true, 'loading', null, snap({ status: 'ready', uid: 'user-a', doc: canonicalDoc('user-a') }));
assert.equal(authLoading.level, null, 'auth loading withholds values');

assert.doesNotMatch(service, /serverState\.cash|cashAuthority|canonicalCash/, 'T no cash listener');
assert.equal(AUTHORITATIVE_CASH_LISTENER_ENABLED, false, 'T listener flag');
assert.equal(AUTHORITATIVE_CASH_OVERLAY_ENABLED, false, 'T overlay flag');
assert.equal(CASH_AUTHORITY_VERSION_UNMIGRATED, 0, 'U cashAuthorityVersion 0');
assert.equal(
  canUseServerAuthoritativeSettlement({
    signedInLinked: true,
    cashAuthorityVersion: 0,
    serverStateCashPresent: true,
    reconciliationActive: true,
    staleSaveProtectionActive: true,
  }).ready,
  false,
  'V settlement false',
);
const coverage = getSignedInCashAuthorityCoverage();
assert.equal(coverage.criticalSignedInCashPathsTotal, 24, 'cash paths 24');
assert.equal(coverage.criticalCanonicalizedCount, 0, 'canonicalized 0');
assert.equal(coverage.criticalBlockedCount, 24, 'blocked 24');

assert.doesNotMatch(contracts, /useEffectiveCompanyProgression/, 'W contracts source unchanged');
assert.match(contracts, /selectPlayerLevel/);
assert.match(issuance, /resolveCanonicalProgressionForIssuance/);
assert.doesNotMatch(issuance, /saves\/current/);

assert.match(gameStore, /addCompanyXp:/, 'X guest gameplay function remains');
assert.equal(SAVE_GAME_VERSION, 6, 'Y save version');
assert.equal(MODE_OPERATIONAL_READINESS.RAIL, 'FOUNDATION_ONLY', 'Z rail');
assert.equal(MODE_OPERATIONAL_READINESS.SEA, 'FOUNDATION_ONLY', 'Z sea');
assert.equal(MODE_OPERATIONAL_READINESS.AIR, 'FOUNDATION_ONLY', 'Z air');

assert.match(dashboard, /useEffectiveCompanyProgression/);
assert.match(dashboard, /Şirket ilerlemesi yükleniyor/);
assert.doesNotMatch(dashboard, /getLevelProgress\(player\)/);
assert.match(more, /useEffectiveCompanyProgression/);
assert.match(more, /İtibar/);
assert.match(shop, /useEffectiveCompanyProgression/);
assert.match(shop, /player\?\.level \?\? player\?\.companyLevel/);
assert.match(account, /useEffectiveCompanyProgression/);
assert.match(tabBar, /state\.player\.level/);
assert.match(warehouse, /resolveProgressionEligibilityAuthority/);
assert.match(gameStore, /Şirket seviye atladı/);
assert.match(gameStore, /İtibar güncellendi/);
assert.match(domain, /SIGNED_IN_MIGRATION_PENDING/);
assert.match(domain, /POST_MIGRATION_LOCAL_PROGRESSION_WRITES_NON_AUTHORITATIVE/);
assert.equal(CANONICAL_PROGRESSION_READ_AUTHORITY_STATUS, 'CANONICAL_PROGRESSION_READ_AUTHORITY_PASS_INTERNAL_ONLY');
assert.equal(PROGRESSION_UI_ELIGIBILITY_STILL_LOCAL, 'PROGRESSION_UI_ELIGIBILITY_STILL_LOCAL');
assert.equal(POST_MIGRATION_LOCAL_PROGRESSION_WRITES_NON_AUTHORITATIVE, 'POST_MIGRATION_LOCAL_PROGRESSION_WRITES_NON_AUTHORITATIVE');
assert.equal(POST_CUTOVER_LOCAL_XP_TOAST_NON_AUTHORITATIVE, 'POST_CUTOVER_LOCAL_XP_TOAST_NON_AUTHORITATIVE');
assert.equal(PUBLIC_MIGRATION_UI_UNWIRED, 'PUBLIC_MIGRATION_UI_UNWIRED');

const rulesBlock = rules.slice(rules.indexOf('match /canonicalCompanyProgression/{progressionId}'));
assert.match(rulesBlock, /allow read: if isOwner\(userId\)/);
assert.match(rulesBlock, /allow write: if false/);
assert.match(hook, /clearCanonicalProgressionReadState/);
assert.match(hook, /subscribeAuthState/);
assert.doesNotMatch(hook, /saveGame/);

if (previousGate === undefined) delete process.env[CANONICAL_PROGRESSION_READ_AUTHORITY_ENV];
else process.env[CANONICAL_PROGRESSION_READ_AUTHORITY_ENV] = previousGate;

console.log('map-v2-canonical-progression-read-authority-regression-test: PASS');

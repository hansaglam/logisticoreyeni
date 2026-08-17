/**
 * Simplified account + cloud restore flow regression guard.
 * Run: npx tsx scripts/account-cloud-login-regression-test.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  classifyLocalSave,
  isMeaningfulLocalSave,
  STARTER_MONEY,
} from '../src/utils/localSaveMeaning';
import { areLocalAndCloudSavesDifferent } from '../src/utils/saveConflictDetection';

let pass = 0;
let fail = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    pass += 1;
    console.log(`  ✓ ${label}`);
    return;
  }
  fail += 1;
  console.log(`  ✗ ${label}`);
}

const root = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

console.log('\n=== account-cloud-login-regression-test ===\n');

const login = read('src/services/accountCloudLogin.ts');
const hook = read('src/hooks/useAccountCenter.ts');
const auth = read('src/services/authService.ts');
const session = read('src/services/accountSaveConflictSession.ts');
const sync = read('src/storage/cloudSaveSync.ts');
const meaning = read('src/utils/localSaveMeaning.ts');

console.log('1. Meaningful local save detection');
const starter = {
  currentTime: 0,
  player: {
    companyName: 'LogistiCore Lojistik',
    money: STARTER_MONEY,
    level: 1,
    companyLevel: 1,
    xp: 0,
    homeCityId: 'izmir',
    trucks: [{ id: 't1' }],
    drivers: [{ id: 'd1' }],
    trailers: [],
    warehouses: [],
    completedContracts: 0,
  },
  activeDeliveries: [],
  activeTransfers: [],
  activeWarehouseStockTransfers: [],
} as import('../src/types/game').StoreGameState;
assert(!isMeaningfulLocalSave(starter), 'fresh starter state is not meaningful');
const progressed = {
  ...starter,
  player: { ...starter.player, completedContracts: 3, money: STARTER_MONEY + 5000 },
};
assert(isMeaningfulLocalSave(progressed), 'completed contracts make save meaningful');
assert(classifyLocalSave(starter).meaningful === false, 'classifyLocalSave starter');

console.log('\n2. Existing account login branch');
assert(auth.includes('completeExistingProviderAccountLogin'), 'credential-already-in-use uses existing login');
assert(auth.includes("completeExistingProviderAccountLogin(linkResult.pendingCredential, 'google')"), 'google existing-account branch');

console.log('\n3. Post sign-in save flow');
assert(login.includes('runPostSignInSaveFlow'), 'central post sign-in flow');
assert(login.includes('resolveSaveConflict'), 'resolveSaveConflict API');
assert(login.includes('authenticatedUid'), 'resolver uses authenticated UID');

console.log('\n4. Fresh install auto-restore');
assert(
  login.includes('!localMeaning.meaningful') && login.includes('restoreCloudSaveForUid'),
  'non-meaningful local auto cloud restore',
);

console.log('\n5. Real conflict only');
assert(meaning.includes('isMeaningfulLocalSave'), 'meaningful helper is canonical');
assert(login.includes('areLocalAndCloudSavesDifferent'), 'different-save detection');

console.log('\n6. No transition timeout in resolver');
assert(!login.includes('awaitBeforeDeadline'), 'no arbitrary account transition deadline');
assert(!login.includes('restoreGuestAnonymousSession'), 'no guest rollback in login service');

console.log('\n7. Session without credential');
assert(session.includes('authenticatedUid: string'), 'session stores UID not credential');
assert(!session.includes('credential: AuthCredential'), 'credential removed from session');

console.log('\n8. UI uses UID resolver');
assert(hook.includes('resolveSaveConflict({'), 'hook calls resolveSaveConflict');
assert(hook.includes('authenticatedUid'), 'hook passes authenticatedUid');
assert(hook.includes('İki farklı kayıt bulundu') || read('src/utils/accountLinkErrors.ts').includes('İki farklı kayıt bulundu'), 'conflict title');

console.log('\n9. Sync safety');
assert(sync.includes('isAutomaticCloudUploadBlockedBySaveFlow'), 'sync blocked during save flow check');

console.log('\n10. Save conflict detection');
assert(
  !areLocalAndCloudSavesDifferent(
    {
      companyName: 'A',
      money: 1000,
      level: 1,
      xp: 0,
      companyScore: 0,
      completedDeliveries: 0,
      trucksCount: 1,
      warehousesCount: 0,
      lastGameTime: 0,
      lastLocalSaveAt: 1,
    },
    {
      companyName: 'A',
      money: 1000,
      level: 1,
      xp: 0,
      companyScore: 0,
      completedDeliveries: 0,
      trucksCount: 1,
      warehousesCount: 0,
      lastGameTime: 0,
      lastLocalSaveAt: 2,
    },
  ),
  'similar saves not in conflict',
);

console.log('\n11. Empty cloud account conflict');
assert(
  login.includes('cloudSaveMissing: true'),
  'missing cloud with local progress returns conflict',
);
assert(login.includes("choice: 'cloud' | 'local' | 'fresh'"), 'fresh resolve choice');
assert(
  read('src/utils/accountLinkErrors.ts').includes('getEmptyCloudAccountConflictMessage'),
  'empty cloud copy helper',
);

console.log(`\nResult: ${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);

/**
 * Account sign-out + empty-cloud login isolation regression.
 * Run: npx tsx scripts/account-sign-out-isolation-regression-test.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

const hook = read('src/hooks/useAccountCenter.ts');
const login = read('src/services/accountCloudLogin.ts');
const sessionReset = read('src/utils/accountSessionReset.ts');
const errors = read('src/utils/accountLinkErrors.ts');

console.log('\n=== Account Sign-Out Isolation Regression ===\n');

console.log('Sign-out clears local progress');
assert(
  hook.includes('resetLocalSessionAfterLinkedAccountSignOut'),
  'linked sign-out resets local session',
);
assert(!hook.includes('rebindLocalSaveToAuth'), 'old ownerUid rebind removed');
assert(sessionReset.includes('clearSave()'), 'session reset clears save');
assert(sessionReset.includes('resetLeaderboardSubmitCache'), 'leaderboard cache reset');

console.log('\nEmpty cloud account does not auto-bind local progress');
assert(
  login.includes("cloud.reason === 'cloud-save-not-found'") &&
    login.includes('cloudSaveMissing: true'),
  'meaningful local + missing cloud returns conflict',
);
assert(
  login.includes("choice === 'fresh'") && login.includes('clearSave()'),
  'fresh choice clears local before starter bind',
);
assert(
  !login.match(
    /cloud-save-not-found[\s\S]{0,400}uploadLocalSaveForUid/,
  ),
  'missing cloud does not auto-upload local save',
);

console.log('\nConflict UI for empty cloud account');
assert(errors.includes('getEmptyCloudAccountConflictTitle'), 'empty cloud title helper');
assert(hook.includes('Yeni Oyun Başlat'), 'fresh start CTA');
assert(hook.includes("handleResolveAccountSaveConflict('fresh'"), 'fresh resolver wired');
assert(hook.includes('cloudSaveMissing'), 'cloudSaveMissing propagated in hook');

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) {
  process.exit(1);
}
console.log('✅ ALL PASS\n');

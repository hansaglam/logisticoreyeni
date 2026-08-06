/**
 * Leaderboard submit eligibility regression tests.
 * Run: npx tsx scripts/leaderboard-eligibility-test.ts
 */
import './test-globals';

import { readFileSync } from 'node:fs';

import {
  eligibilityReasonToSubmitErrorCode,
  getLeaderboardSubmitEligibility,
  isExpectedLeaderboardSubmitSkip,
} from '../src/domain/leaderboardSubmitEligibility';

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

console.log('\n=== Leaderboard Submit Eligibility ===\n');

console.log('Eligibility mapping');
{
  const guest = getLeaderboardSubmitEligibility(
    {
      isReady: true,
      isAnonymous: true,
      provider: 'guest',
      uid: 'guest-uid',
    },
    { featureEnabled: true, authReady: true },
  );
  assert(guest.eligible === false, 'anonymous guest is ineligible');
  if (!guest.eligible) {
    assert(guest.reason === 'anonymous-user', 'guest reason is anonymous-user');
    assert(
      eligibilityReasonToSubmitErrorCode(guest.reason) === 'anonymous-not-supported',
      'anonymous maps to anonymous-not-supported code',
    );
  }

  const linked = getLeaderboardSubmitEligibility(
    {
      isReady: true,
      isAnonymous: false,
      provider: 'google',
      uid: 'linked-uid',
    },
    { featureEnabled: true, authReady: true },
  );
  assert(linked.eligible === true, 'linked google user is eligible for submit attempt');
  if (linked.eligible) {
    assert(linked.uid === 'linked-uid', 'eligible result includes uid');
  }

  const missingUser = getLeaderboardSubmitEligibility(
    {
      isReady: true,
      isAnonymous: false,
      provider: 'google',
      uid: null,
    },
    { featureEnabled: true, authReady: true },
  );
  assert(missingUser.eligible === false, 'missing uid is ineligible');

  const notReady = getLeaderboardSubmitEligibility(
    {
      isReady: false,
      isAnonymous: true,
      provider: 'guest',
      uid: null,
    },
    { featureEnabled: true, authReady: false },
  );
  assert(notReady.eligible === false, 'auth not ready is ineligible');
}

console.log('\nExpected skip codes');
{
  assert(isExpectedLeaderboardSubmitSkip('anonymous-not-supported'), 'anonymous skip is expected');
  assert(isExpectedLeaderboardSubmitSkip('auth-required'), 'auth-required skip is expected');
  assert(isExpectedLeaderboardSubmitSkip('username-required'), 'username-required skip is expected');
  assert(!isExpectedLeaderboardSubmitSkip('network-error'), 'network-error is not an expected skip');
}

console.log('\nSource guards');
{
  const cloudSync = readFileSync('src/storage/cloudSaveSync.ts', 'utf8');
  assert(cloudSync.includes('getLeaderboardSubmitEligibility'), 'cloud save checks eligibility first');
  assert(cloudSync.includes('isExpectedLeaderboardSubmitSkip'), 'cloud save suppresses expected warnings');

  const leaderboardService = readFileSync('src/services/leaderboardService.ts', 'utf8');
  assert(
    leaderboardService.includes('getLeaderboardSubmitEligibility'),
    'leaderboard service uses eligibility gate',
  );
  assert(
    leaderboardService.includes('[leaderboard-submit-skipped]'),
    'skipped submit logs info once per reason',
  );

  const instrumentation = readFileSync('src/utils/renderRateInstrumentation.ts', 'utf8');
  assert(instrumentation.includes('RENDER_THRESHOLD'), 'render instrumentation uses rolling threshold');
  assert(!instrumentation.includes('renderCount > 50'), 'no lifetime renderCount threshold');
}

console.log(`\nResult: ${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);

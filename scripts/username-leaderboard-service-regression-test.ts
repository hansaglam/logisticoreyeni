/**
 * Username + leaderboard service regression tests.
 * Run: npx tsx scripts/username-leaderboard-service-regression-test.ts
 */
import './test-globals';

import { readFileSync } from 'node:fs';

import {
  mapBackendReasonToLeaderboardFailure,
  mapBackendReasonToUsernameFailure,
  mapFirebaseCallableToLeaderboardFailure,
  mapFirebaseCallableToUsernameFailure,
} from '../src/services/callableServiceUtils';
import {
  normalizeUsername,
  validateUsernameFormat,
  usernameReasonMessage,
} from '../src/domain/usernameValidation';
import { LEADERBOARD_CALLABLES } from '../src/services/leaderboardService';

let pass = 0;
let fail = 0;

function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    pass += 1;
    console.log(`  ✓ ${label}`);
    return;
  }
  fail += 1;
  console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
}

console.log('\n=== Username + Leaderboard Service Regression ===\n');

console.log('Username validation');
{
  assert(validateUsernameFormat('ab').ok === false, 'invalid short');
  assert(validateUsernameFormat('a'.repeat(21)).ok === false, 'invalid long');
  assert(validateUsernameFormat('  Ahmet  ').ok === true, 'whitespace trim');
  if (validateUsernameFormat('  Ahmet  ').ok) {
    assert(normalizeUsername('Ahmet') === normalizeUsername('ahmet'), 'case-insensitive canonical');
  }
  assert(validateUsernameFormat('admin').ok === false, 'reserved word');
  assert(validateUsernameFormat('amk123').ok === false, 'banned word');
  assert(validateUsernameFormat('___').ok === false, 'symbol only');
}

console.log('\nUsername error classification');
{
  assert(
    mapFirebaseCallableToUsernameFailure({ code: 'functions/not-found' }) === 'function-not-found',
    'function not found',
  );
  assert(
    mapFirebaseCallableToUsernameFailure({ code: 'functions/deadline-exceeded' }) === 'timeout',
    'timeout',
  );
  assert(
    mapFirebaseCallableToUsernameFailure({ code: 'functions/unauthenticated' }) === 'unauthenticated',
    'unauthenticated',
  );
  assert(
    mapFirebaseCallableToUsernameFailure({ code: 'functions/permission-denied' }) === 'permission-denied',
    'permission denied',
  );
  assert(
    mapBackendReasonToUsernameFailure('username-taken') === 'username-taken',
    'username taken backend reason',
  );
  assert(
    mapBackendReasonToUsernameFailure(undefined) === 'malformed-response',
    'malformed response',
  );
}

console.log('\nLeaderboard error classification');
{
  assert(
    mapFirebaseCallableToLeaderboardFailure({ code: 'functions/not-found' }) === 'function-not-found',
    'function not found',
  );
  assert(
    mapFirebaseCallableToLeaderboardFailure({ code: 'functions/unavailable' }) === 'function-unavailable',
    'function unavailable',
  );
  assert(
    mapBackendReasonToLeaderboardFailure('server-state-not-initialized') === 'server-state-missing',
    'server state missing',
  );
  assert(
    mapBackendReasonToLeaderboardFailure('username-required') === 'username-required',
    'username required',
  );
}

console.log('\nUser-facing messages are specific');
{
  assert(
    usernameReasonMessage('function-not-found').includes('ulaşılamıyor'),
    'function-not-found message',
  );
  assert(
    usernameReasonMessage('network-error').includes('Bağlantı'),
    'network message',
  );
  assert(usernameReasonMessage('username-taken').includes('kullanılıyor'), 'taken message');
  assert(
    usernameReasonMessage('service-unavailable') !== usernameReasonMessage('network-error'),
    'service vs network differ',
  );
}

console.log('\nWiring + trust boundary');
{
  const usernameService = readFileSync('src/services/usernameService.ts', 'utf8');
  const leaderboardService = readFileSync('src/services/leaderboardService.ts', 'utf8');
  const rules = readFileSync('firestore.rules', 'utf8');
  const gameStore = readFileSync('src/store/gameStore.ts', 'utf8');

  assert(usernameService.includes('notifyUsernameProfileChanged'), 'username success notifies listeners');
  assert(usernameService.includes('isAuthContextStale'), 'username stale auth guard');
  assert(leaderboardService.includes('withCallableTimeout'), 'leaderboard bounded timeout');
  assert(leaderboardService.includes(LEADERBOARD_CALLABLES.get), 'leaderboard uses getLeaderboard callable');
  assert(!leaderboardService.includes('companyScore: input'), 'no client score spoof path');
  assert(!gameStore.includes('syncLeaderboardEntry('), 'gameStore does not local-sync leaderboard');
  assert(rules.includes('match /usernames/{usernameNormalized}'), 'username registry rules exist');
  assert(rules.includes('allow create, update, delete: if false'), 'client write denied for leaderboard entries');
  assert(!usernameService.includes("Platform.OS === 'ios'"), 'no iOS username hack');
  assert(!leaderboardService.includes("Platform.OS === 'android'"), 'no Android leaderboard hack');
}

console.log('\nCallable names + region');
{
  const backend = readFileSync('backend/src/index.ts', 'utf8');
  const firebase = readFileSync('src/services/firebase.ts', 'utf8');
  assert(backend.includes("export const setUsername"), 'backend setUsername');
  assert(backend.includes("export const checkUsernameAvailability"), 'backend checkUsernameAvailability');
  assert(backend.includes("export const getLeaderboard"), 'backend getLeaderboard');
  assert(backend.includes("region: 'us-central1'"), 'backend us-central1');
  assert(firebase.includes("us-central1"), 'client us-central1');
}

console.log(`\n=== Results: ${pass} passed, ${fail} failed ===\n`);
if (fail > 0) {
  process.exit(1);
}

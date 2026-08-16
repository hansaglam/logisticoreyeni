/**
 * Leaderboard Android ↔ iOS cross-platform parity regression (static + config).
 * Run: npx tsx scripts/leaderboard-cross-platform-regression-test.ts
 */
import './test-globals';

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');

function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), 'utf8');
}

function readJson(rel: string): Record<string, unknown> {
  return JSON.parse(read(rel)) as Record<string, unknown>;
}

console.log('\n=== Leaderboard Cross-Platform Regression ===\n');

const leaderboardService = read('src/services/leaderboardService.ts');
const leaderboardScreen = read('src/screens/LeaderboardScreen.tsx');
const leaderboardBackend = read('backend/src/leaderboard.ts');
const backendIndex = read('backend/src/index.ts');
const firestoreRules = read('firestore.rules');
const firebaseTs = read('src/services/firebase.ts');
const eligibility = read('src/domain/leaderboardSubmitEligibility.ts');
const androidGs = readJson('google-services.json');
const iosPlist = read('GoogleService-Info.plist');

assert.equal(
  (androidGs.project_info as { project_id?: string })?.project_id,
  'logisticore-53ab4',
  'Android google-services project_id',
);
assert.match(iosPlist, /<key>PROJECT_ID<\/key>\s*<string>logisticore-53ab4<\/string>/);
assert.equal(read('.firebaserc').includes('"default": "logisticore-53ab4"'), true);
console.log('  ✓ Firebase projectId parity (Android + iOS + .firebaserc)');

assert.match(firebaseTs, /FIREBASE_FUNCTIONS_REGION = 'us-central1'/);
assert.match(backendIndex, /region: 'us-central1'/);
console.log('  ✓ Functions region us-central1 (client + backend)');

assert.match(leaderboardBackend, /leaderboards\/\$\{seasonKey\}\/entries\/\$\{uid\}/);
assert.doesNotMatch(leaderboardBackend, /leaderboards\/android/);
assert.doesNotMatch(leaderboardBackend, /leaderboards\/ios/);
assert.doesNotMatch(leaderboardBackend, /entries_android|entries_ios/);
console.log('  ✓ Canonical path leaderboards/{seasonKey}/entries/{uid}');

assert.doesNotMatch(leaderboardBackend, /where\('platform'/);
assert.doesNotMatch(leaderboardBackend, /Platform\.OS\s*===/);
assert.doesNotMatch(leaderboardScreen, /Platform\.OS\s*===/);
assert.doesNotMatch(leaderboardService, /Platform\.OS\s*===/);
assert.doesNotMatch(leaderboardService, /\.filter\([^)]*platform/i);
console.log('  ✓ No platform filter in backend query or client render');

assert.match(leaderboardService, /submitLeaderboardScore/);
assert.match(leaderboardService, /getLeaderboard/);
assert.doesNotMatch(leaderboardService, /companyScore:\s*input/);
assert.doesNotMatch(backendIndex, /record\.companyScore/);
assert.match(backendIndex, /'uid' in record \|\| 'score' in record \|\| 'companyScore' in record/);
console.log('  ✓ Score server-owned; client cannot spoof score/uid');

assert.match(leaderboardBackend, /getLeaderboardSeasonKey\(nowMs\)/);
assert.match(leaderboardBackend, /calculateLeaderboardScore/);
assert.match(leaderboardBackend, /extractCanonicalPlayerStateFromServerState/);
assert.match(read('backend/src/leaderboardScore.ts'), /reputation: state\.reputation/);
console.log('  ✓ Season key + score from serverState (reputation included)');

assert.match(firestoreRules, /match \/leaderboards\/\{seasonId\}\/entries\/\{entryId\}/);
assert.match(firestoreRules, /allow create, update, delete: if false/);
console.log('  ✓ Firestore client write denied for leaderboard entries');

assert.match(eligibility, /account\.provider !== 'google' && account\.provider !== 'apple'/);
assert.match(leaderboardService, /getLeaderboardSubmitEligibility/);
assert.match(leaderboardService, /\[leaderboard-submit-skipped\]/);
console.log('  ✓ Shared submit eligibility (linked Google/Apple; anonymous skipped quietly)');

assert.match(leaderboardScreen, /resetLeaderboardSubmitCache/);
assert.match(leaderboardScreen, /lastAuthUidRef/);
console.log('  ✓ Account switch resets leaderboard submit cache + screen state');

assert.doesNotMatch(leaderboardService, /leaderboard-cache-android|leaderboard-cache-ios/);
assert.doesNotMatch(leaderboardScreen, /AsyncStorage.*leaderboard/i);
console.log('  ✓ No platform-split leaderboard cache keys');

assert.match(leaderboardService, /\[leaderboard-backend-config\]/);
assert.match(leaderboardService, /\[leaderboard-cross-platform\]/);
console.log('  ✓ Structured dev logs present');

assert.match(leaderboardBackend, /orderBy\('companyScore', 'desc'\)/);
assert.match(leaderboardBackend, /orderBy\(FieldPath\.documentId\(\), 'asc'\)/);
assert.match(leaderboardBackend, /where\('scoreVersion', '==', LEADERBOARD_SCORE_VERSION\)/);
assert.match(read('backend/src/leaderboardScore.ts'), /LEADERBOARD_SCORE_VERSION = 2/);
console.log('  ✓ Backend sort: companyScore DESC, uid ASC tie-breaker (score v2 only)');

console.log('\n✅ ALL PASS\n');

/**
 * Weekly Missions backend foundation regression (static).
 * Run: npx tsx scripts/weekly-missions-backend-foundation-regression-test.ts
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

console.log('\n=== Weekly Missions Backend Foundation Regression ===\n');

const index = read('backend/src/index.ts');
const rules = read('firestore.rules');
const deletion = read('backend/src/accountDeletion.ts');
const missions = read('src/config/missions.ts');
const weeklyClient = read('src/data/weeklyObjectives.ts');
const milestones = read('src/data/milestones.ts');
const missionsScreen = read('src/screens/MissionsScreen.tsx');
const challenges = read('backend/src/challenges.ts');
const challengeCatalog = read('backend/src/challengeCatalog.ts');
const seasonRewards = read('backend/src/seasonRewards.ts');
const leaderboardSeason = read('backend/src/leaderboardSeason.ts');
const weeklyMissions = read('backend/src/weeklyMissions.ts');
const catalog = read('backend/src/weeklyMissionCatalog.ts');
const types = read('backend/src/weeklyMissionTypes.ts');
const delivery = read('backend/src/canonicalDeliveryCompletion.ts');
const week = read('backend/src/weeklyMissionWeek.ts');
const envExample = read('.env.example');

assert(week.includes('getLeaderboardSeasonKey'), 'week helper reuses leaderboard key');
assert(week.includes('getWeeklyPeriod'), 'week helper reuses season period');
assert(!week.includes('weekly_${'), 'no weekly_ prefix on mission week keys');
assert(types.includes("process.env[WEEKLY_MISSION_FLAG_ENV] === 'true'"), 'flag fail-closed');
assert(types.includes("WEEKLY_MISSIONS_BACKEND_ENABLED"), 'canonical flag name');
assert(catalog.includes('easy: 2_000'), 'easy cash 2000');
assert(catalog.includes('medium: 4_000'), 'medium cash 4000');
assert(catalog.includes('hard: 6_500'), 'hard cash 6500');
assert(types.includes('WEEKLY_MISSION_WEEKLY_CASH_CAP = 16_000'), 'weekly cap 16000');
assert(!catalog.includes('xp:'), 'catalog has no XP');
assert(!catalog.includes('reputation:'), 'catalog has no reputation');
assert(weeklyMissions.includes('selectWeeklyMissionRotation'), 'deterministic selector');
assert(weeklyMissions.includes("locked: true"), 'rotations lock on create');
assert(weeklyMissions.includes('transaction.create(ref, rotation)'), 'create-if-missing rotation');
assert(weeklyMissions.includes('canonicalCash'), 'claim dual-writes marketplace cash');
assert(delivery.includes('completedDeliveries: next'), 'delivery increment writes server counter');
assert(delivery.includes('transaction.create(completionRef'), 'delivery idempotency receipt');
assert(index.includes('export const getWeeklyMissions'), 'get callable');
assert(index.includes('export const claimWeeklyMissionReward'), 'claim callable');
assert(index.includes('resolveLeaderboardIdentity(request)'), 'linked-account identity helper still used');
assert(index.includes('export const recordCanonicalDeliveryCompletion'), 'delivery callable');
assert(index.includes('export const seedWeeklyMissionRotation'), 'scheduled rotation');
assert(index.includes("schedule: '15 0 * * *'"), 'scheduler after leaderboard seed');
assert(index.includes("['weekKey', 'missionId', 'idempotencyKey']"), 'claim keys only');
assert(!weeklyMissions.includes('input.reward'), 'claim ignores client reward');
assert(rules.includes('match /weeklyMissionTemplates/{missionId}'), 'template rules');
assert(rules.includes('match /weeklyMissionRotations/{weekKey}'), 'rotation rules');
assert(rules.includes('match /weeklyMissionClaims/{documentId}'), 'claim rules');
assert(rules.includes('match /weeklyMissionBaselines/{weekKey}'), 'baseline rules');
assert(rules.includes('match /canonicalDeliveryCompletions/{deliveryId}'), 'delivery receipt rules');
assert(deletion.includes('weeklyMissionClaims'), 'deletion mentions weekly claims');
assert(deletion.includes('recursiveDelete'), 'recursive user delete remains');
assert(envExample.includes('WEEKLY_MISSIONS_BACKEND_ENABLED=false'), 'env example fail-closed');
assert(missionsScreen.includes('getWeeklyObjectiveDefinitions'), 'old Weekly UI still wired');
assert(
  missionsScreen.includes('BACKEND_WEEKLY_MISSIONS_ENABLED'),
  'client gate present for Phase 2 dual-mode',
);
assert(
  !missionsScreen.includes("from '../services/weeklyMissionService'") ||
    missionsScreen.includes('BACKEND_WEEKLY_MISSIONS_ENABLED'),
  'backend service only behind client gate',
);
assert(weeklyClient.includes('WEEKLY_OBJECTIVE_TEMPLATES'), 'old weekly templates intact');
assert(missions.includes('STARTER_MISSIONS'), 'missions catalog intact');
assert(milestones.includes('MILESTONE_DEFINITIONS'), 'achievements catalog intact');
assert(challenges.includes('claimChallengeRewardTransaction'), 'challenges claim intact');
assert(challengeCatalog.includes('weekly_marketplace_purchases'), 'challenge catalog intact');
assert(seasonRewards.includes('claimSeasonRewardTransaction'), 'season rewards intact');
assert(leaderboardSeason.includes('getLeaderboardSeasonKey'), 'leaderboard week helper intact');

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) {
  process.exit(1);
}

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  ACHIEVEMENT_CATALOG,
  INBOX_RETENTION_LIMIT,
  addInboxItem,
  createDefaultProgressionFoundationState,
  deriveAchievementProgress,
  evaluateAchievementUnlocks,
  markAllInboxRead,
  markInboxRead,
  mergeCanonicalSeasonHistory,
  normalizeProgressionFoundationState,
  type AchievementEvaluationContext,
  type InboxItem,
  type SeasonHistoryEntry,
} from '../src/domain/progressionFoundation';
import { createCompanyStatsBaseline } from '../src/domain/companyStats';
import { getSeasonDefinitionFromKey } from '../src/features/seasons/periods';
import type { Driver, Player } from '../src/types/game';

const driver = { id: 'driver', name: 'Driver', level: 2, xp: 100, completedDeliveries: 0, onTimeDeliveries: 0 } as Driver;
const player = { money: 10_000, reputation: 40, completedContracts: 0, failedDeliveries: 0, lateDeliveries: 0, trucks: [{ id: 't1' }], warehouses: [], drivers: [driver] } as Player;
const baseStats = createCompanyStatsBaseline(player, 0);
const context = (patch: Partial<AchievementEvaluationContext> = {}): AchievementEvaluationContext => ({ player, companyStats: baseStats, ...patch });
const byId = (items: ReturnType<typeof deriveAchievementProgress>, id: string) => items.find((item) => item.achievementId === id)!;
const inboxItem = (id: string, createdAt: number, patch: Partial<InboxItem> = {}): InboxItem => ({ id, type: 'system', title: id, body: id, createdAt, authority: 'client-local-informational', ...patch });

console.log('\n=== Achievements / Season History / Inbox Foundation ===\n');

let state = createDefaultProgressionFoundationState();
assert.equal(byId(deriveAchievementProgress(state, context()), 'delivery_first').completed, false, 'locked');
const partialStats = { ...baseStats, deliveriesCompleted: 5 };
assert.equal(byId(deriveAchievementProgress(state, context({ companyStats: partialStats })), 'delivery_ten').current, 5, 'partial');
const exact = evaluateAchievementUnlocks(state, context({ companyStats: { ...baseStats, deliveriesCompleted: 10 } }), 1_000);
assert.equal(byId(exact.progress, 'delivery_ten').completed, true, 'exact complete');
assert.equal(byId(deriveAchievementProgress(exact.state, context({ companyStats: { ...baseStats, deliveriesCompleted: 99 } })), 'delivery_ten').current, 10, 'over target capped');
assert.ok(exact.unlockedIds.includes('delivery_first') && exact.unlockedIds.includes('delivery_ten'));
const replay = evaluateAchievementUnlocks(exact.state, context({ companyStats: { ...baseStats, deliveriesCompleted: 10 } }), 2_000);
assert.deepEqual(replay.unlockedIds, [], 'duplicate evaluation does not unlock twice');
assert.equal(replay.state.inbox.filter((item) => item.dedupeKey === 'achievement:delivery_ten').length, 1, 'duplicate achievement notification blocked');
const reloaded = normalizeProgressionFoundationState(JSON.parse(JSON.stringify(replay.state)), 2_100);
assert.equal(reloaded.achievementCompletedAt.delivery_ten, 1_000, 'reload preserves completion');
assert.deepEqual(normalizeProgressionFoundationState(undefined).inbox, [], 'old save starts empty');
assert.equal(baseStats.historicalDataComplete, false, 'incomplete historical stats remain marked');
const hiddenLocked = ACHIEVEMENT_CATALOG.find((item) => item.hidden)!;
assert.ok(hiddenLocked && !reloaded.achievementCompletedAt[hiddenLocked.id], 'hidden remains locked until achieved');
const hiddenUnlocked = evaluateAchievementUnlocks(reloaded, context({ player: { ...player, reputation: 95 } }), 3_000);
assert.ok(hiddenUnlocked.state.achievementCompletedAt[hiddenLocked.id], 'hidden unlock is deterministic');
assert.deepEqual(createDefaultProgressionFoundationState(), createDefaultProgressionFoundationState(), 'account states do not share references/data');

const seasonOne = getSeasonDefinitionFromKey('2026-W52')!;
const seasonTwo = getSeasonDefinitionFromKey('2027-W01')!;
assert.ok(seasonOne.endsAt <= seasonTwo.startsAt, 'year boundary deterministic');
const historyEntry: SeasonHistoryEntry = { seasonKey: '2026-W52', displayName: seasonOne.displayName, seasonPoints: 120, challengeCompletionCount: 4, endedAt: seasonOne.endsAt, readOnly: true };
state = mergeCanonicalSeasonHistory(createDefaultProgressionFoundationState(), [], '2026-W52', 1_000);
assert.equal(state.seasonHistory.length, 0, 'active season not fabricated into history');
state = mergeCanonicalSeasonHistory(state, [historyEntry], '2027-W01', 2_000);
assert.equal(state.seasonHistory.length, 1, 'first completed season captured');
assert.equal(state.seasonHistory[0].readOnly, true, 'previous season read-only');
assert.equal(state.activeSeasonKey, '2027-W01', 'new season active');
assert.equal(state.inbox.filter((item) => item.dedupeKey === 'season-ended:2026-W52').length, 1, 'rollover notification once');
state = mergeCanonicalSeasonHistory(state, [historyEntry], '2027-W01', 3_000);
assert.equal(state.seasonHistory.length, 1, 'history merge idempotent');
assert.equal(state.inbox.filter((item) => item.dedupeKey === 'season-ended:2026-W52').length, 1);

let inboxState = createDefaultProgressionFoundationState();
inboxState = addInboxItem(inboxState, inboxItem('one', 1, { dedupeKey: 'same', relatedRoute: 'seasons-challenges' }));
inboxState = addInboxItem(inboxState, inboxItem('two', 2, { dedupeKey: 'same' }));
assert.equal(inboxState.inbox.length, 1, 'inbox dedupe');
assert.equal(inboxState.inbox[0].relatedRoute, 'seasons-challenges', 'route target retained');
inboxState = markInboxRead(inboxState, 'one', 3);
assert.equal(inboxState.inbox[0].readAt, 3, 'mark read');
inboxState = addInboxItem(inboxState, inboxItem('three', 4));
inboxState = markAllInboxRead(inboxState, 5);
assert.ok(inboxState.inbox.every((item) => item.readAt), 'mark all read');
for (let index = 0; index < INBOX_RETENTION_LIMIT + 20; index += 1) inboxState = addInboxItem(inboxState, inboxItem(`bounded-${index}`, 10 + index));
assert.equal(inboxState.inbox.length, INBOX_RETENTION_LIMIT, 'bounded retention');
const accountA = normalizeProgressionFoundationState(inboxState);
const accountB = normalizeProgressionFoundationState(undefined);
assert.equal(accountB.inbox.length, 0, 'account isolation');
assert.notStrictEqual(accountA.inbox, accountB.inbox);

const domainSource = readFileSync('src/domain/progressionFoundation.ts', 'utf8');
const saveSource = readFileSync('src/storage/saveGame.ts', 'utf8');
const configSource = readFileSync('src/config/storeProductionPolicy.ts', 'utf8');
const screenSource = readFileSync('src/features/progression/ProgressHistoryScreen.tsx', 'utf8');
const moreSource = readFileSync('src/screens/MoreScreen.tsx', 'utf8');
const serviceSource = readFileSync('src/services/challengeService.ts', 'utf8');
const internalEnv = readFileSync('.env.internal', 'utf8');
const productionEnv = readFileSync('.env.production', 'utf8');
assert.ok(!domainSource.includes('reward: { cash'), 'achievement catalog has no cash rewards');
assert.ok(saveSource.includes('progressionFoundation?: ProgressionFoundationState'), 'save structure additive');
assert.ok(configSource.includes('EXPO_PUBLIC_ENABLE_ACHIEVEMENTS must remain false'), 'production flag fail-closed');
assert.ok(screenSource.includes('markAllProgressInboxRead'), 'inbox actions wired');
assert.ok(!/\bsetInterval\s*\(/.test(screenSource) && !/\bonSnapshot\s*\(/.test(screenSource), 'no polling/listener added');
assert.ok(moreSource.includes("setRoute('progress-history')"), 'single Company/More entry wired');
assert.ok(serviceSource.includes("collection(firestore, 'users', user.uid, 'seasonProgress')"), 'season history reads owner-scoped canonical progress');
assert.ok(serviceSource.includes('limit(53)') && serviceSource.includes('limit(500)'), 'canonical history reads bounded');
assert.ok(internalEnv.includes('EXPO_PUBLIC_ENABLE_ACHIEVEMENTS=true'));
assert.ok(productionEnv.includes('EXPO_PUBLIC_ENABLE_ACHIEVEMENTS=false'));

console.log('PASS — achievements, season history and inbox foundation');

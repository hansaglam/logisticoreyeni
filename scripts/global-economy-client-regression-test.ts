/** Global economy client/load/cache/fuel regression test. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import './test-globals';
import { CITIES } from '../src/data/cities';
import {
  canReadGlobalEconomy,
  categorizeGlobalEconomyClientError,
  parseFirestoreMillis,
  parseGlobalEconomyCurrentDocument,
  resolveGlobalEconomyClientState,
  validateGlobalEconomySnapshot,
} from '../src/services/globalEconomyClient';
import { buildGlobalEconomySnapshot } from '../src/simulation/globalMarketSnapshot';
import { selectFuelPriceState } from '../src/simulation/fuelPriceQuote';

let passed = 0;
function check(condition: unknown, label: string): void {
  assert.ok(condition, label);
  passed += 1;
  console.log(`  ok ${label}`);
}

console.log('\nGlobal economy client regression test');
const nowMs = 1_800_000_000_000;
const snapshot = buildGlobalEconomySnapshot({ cities: CITIES, nowMs });
const current = {
  epoch: snapshot.epoch,
  configVersion: snapshot.configVersion,
  generatedAt: snapshot.generatedAt,
  validUntil: snapshot.validUntil,
  serverTimeMs: nowMs,
  snapshot,
};

const parsed = parseGlobalEconomyCurrentDocument(current);
check(parsed.snapshot.epoch === snapshot.epoch, 'live snapshot success');
check(parsed.validation.marketDataValid, 'valid market snapshot');
check(parsed.validation.fuelPriceValid, 'valid market + valid fuel');
check(!canReadGlobalEconomy({ authReady: false, userPresent: true }), 'auth not ready blocks read');
check(canReadGlobalEconomy({ authReady: true, userPresent: true }), 'anonymous signed-in user can read');

check(categorizeGlobalEconomyClientError({ code: 'firestore/permission-denied' }) === 'permission-denied', 'permission-denied preserved');
check(categorizeGlobalEconomyClientError({ code: 'firestore/unavailable' }) === 'unavailable', 'unavailable preserved');
check(categorizeGlobalEconomyClientError({ code: 'firestore/not-found' }) === 'not-found', 'document not found preserved');
check(categorizeGlobalEconomyClientError({ code: 'firestore/deadline-exceeded' }) === 'deadline-exceeded', 'deadline-exceeded preserved');

const timestampMillis = parseFirestoreMillis({ toMillis: () => nowMs });
check(timestampMillis === nowMs, 'Firestore Timestamp parsed');
const serializedMillis = parseFirestoreMillis({
  seconds: Math.floor(nowMs / 1_000),
  nanoseconds: 0,
});
check(serializedMillis === nowMs, 'serialized cached Timestamp parsed');

const timestampParsed = parseGlobalEconomyCurrentDocument({
  ...current,
  generatedAt: { seconds: snapshot.generatedAt / 1_000, nanoseconds: 0 },
  snapshot: {
    ...snapshot,
    generatedAt: { seconds: snapshot.generatedAt / 1_000, nanoseconds: 0 },
    validUntil: { toMillis: () => snapshot.validUntil },
  },
});
check(timestampParsed.snapshot.generatedAt === snapshot.generatedAt, 'snapshot timestamp normalized for Hermes/cache');

const invalidFuelSnapshot = { ...snapshot, fuelPricePerLiter: Number.NaN };
const invalidFuelValidation = validateGlobalEconomySnapshot(invalidFuelSnapshot);
check(invalidFuelValidation.marketDataValid, 'valid market remains usable with invalid fuel');
check(!invalidFuelValidation.fuelPriceValid, 'invalid fuel capability isolated');

const liveState = resolveGlobalEconomyClientState({
  snapshot,
  trusted: true,
  syncStatus: 'online',
  loadedAt: nowMs,
  errorCode: 'unavailable',
});
check(liveState.source === 'live' && liveState.errorCode == null, 'retry success clears old error');
const cachedState = resolveGlobalEconomyClientState({
  snapshot,
  trusted: true,
  syncStatus: 'offline-cache',
  loadedAt: nowMs - 60_000,
  errorCode: 'unavailable',
});
check(cachedState.source === 'cached', 'live fail + valid cache');
const staleCachedState = resolveGlobalEconomyClientState({
  snapshot,
  trusted: true,
  syncStatus: 'offline-cache',
  loadedAt: nowMs - 30 * 24 * 60 * 60 * 1_000,
  errorCode: 'deadline-exceeded',
});
check(staleCachedState.source === 'cached', 'live fail + stale trusted cache is explicit cached state');
const unavailableState = resolveGlobalEconomyClientState({
  snapshot: null,
  trusted: false,
  syncStatus: 'error',
  errorCode: 'not-found',
});
check(unavailableState.source === 'unavailable', 'missing snapshot unavailable');

const liveFuel = selectFuelPriceState({ snapshot, trusted: true, syncStatus: 'online', development: false });
const cachedFuel = selectFuelPriceState({ snapshot, trusted: true, syncStatus: 'offline-cache', development: false });
const unavailableFuel = selectFuelPriceState({ snapshot: null, trusted: false, syncStatus: 'error', development: false });
const invalidFuel = selectFuelPriceState({ snapshot: invalidFuelSnapshot, trusted: true, syncStatus: 'online', development: false });
check(liveFuel.source === 'live' && Number.isFinite(liveFuel.pricePerLiter), 'fuel selector live');
check(cachedFuel.source === 'cached' && cachedFuel.purchaseAllowed, 'fuel selector cached trusted');
check(unavailableFuel.source === 'unavailable' && unavailableFuel.pricePerLiter == null, 'fuel selector unavailable');
check(invalidFuel.source === 'unavailable' && invalidFuel.errorCode === 'invalid-price', 'invalid fuel does not use fabricated fallback');

const storeSource = readFileSync(resolve(process.cwd(), 'src/store/gameStore.ts'), 'utf8');
const currentCommitIndex = storeSource.indexOf('// Current snapshot is canonical.');
const historyReadIndex = storeSource.indexOf(
  'const history = await fetchGlobalMarketHistoryEntries(repository, snapshot)',
  currentCommitIndex,
);
const historyCommitIndex = storeSource.indexOf(
  'applyGlobalMarketHistory(set, snapshot, history)',
  historyReadIndex,
);
check(
  currentCommitIndex >= 0 && historyReadIndex > currentCommitIndex && historyCommitIndex > historyReadIndex,
  'current snapshot commits before bounded optional history',
);
check(storeSource.includes('limit: INITIAL_GLOBAL_HISTORY_LIMIT'), 'initial history query is bounded');
check(storeSource.includes("globalMarketErrorCode: null"), 'successful retry clears store error');

const marketSource = readFileSync(resolve(process.cwd(), 'src/screens/MarketScreen.tsx'), 'utf8');
const refuelSource = readFileSync(resolve(process.cwd(), 'src/components/TruckRefuelSheet.tsx'), 'utf8');
check(marketSource.includes('cachedGlobalEconomySnapshot') && marketSource.includes('selectFuelPriceState'), 'MarketScreen uses canonical snapshot/fuel selector');
check(refuelSource.includes('cachedGlobalEconomySnapshot') && refuelSource.includes('resolveFuelPriceQuote'), 'TruckRefuelSheet uses same canonical snapshot');

console.log(`\nResult: ${passed} passed, 0 failed`);

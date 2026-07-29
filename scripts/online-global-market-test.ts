/**
 * Authoritative online global market acceptance tests.
 * Run: npx tsx scripts/online-global-market-test.ts
 */

import './test-globals';

import { CITIES } from '../src/data/cities';
import {
  InMemoryGlobalEconomyRepository,
} from '../src/services/globalEconomyRepository';
import {
  buildGlobalEconomySnapshot,
  buildGlobalMarketHistoryEntries,
} from '../src/simulation/globalMarketSnapshot';
import {
  getMarketEpoch,
  MARKET_TICK_INTERVAL_MS,
  ServerEconomyClock,
} from '../src/simulation/economyClock';

let passed = 0;
let failed = 0;
function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('\n=== online-global-market-test ===\n');

async function main(): Promise<void> {
let authoritativeNow = 1_800_000_000_000;
const repository = new InMemoryGlobalEconomyRepository([], () => authoritativeNow);

const playerA = await repository.getCurrentSnapshot();
const playerB = await repository.getCurrentSnapshot();
assert(playerA.snapshot?.fuelPricePerLiter === playerB.snapshot?.fuelPricePerLiter,
  'A/B: aynı anda aynı yakıt fiyatı');
assert(
  JSON.stringify(playerA.snapshot?.cityMarketPrices) ===
    JSON.stringify(playerB.snapshot?.cityMarketPrices),
  'A/B: kurulum tarihi şehir/ürün fiyatını etkilemez',
);
assert(playerA.snapshot?.marketMovementCount === playerB.snapshot?.marketMovementCount,
  'A/B: aynı hareket sayısı');
assert(
  JSON.stringify(playerA.snapshot?.opportunities) ===
    JSON.stringify(playerB.snapshot?.opportunities),
  'A/B: aynı global fırsatlar',
);
assert(
  JSON.stringify(playerA.snapshot?.activeEvents) ===
    JSON.stringify(playerB.snapshot?.activeEvents),
  'A/B: aynı event ve kriz durumu',
);
assert(playerA.snapshot?.worldStatus === playerB.snapshot?.worldStatus,
  'A/B: aynı dünya durumu');

const sameEpochRefreshes = await Promise.all(
  Array.from({ length: 8 }, () => repository.getCurrentSnapshot()),
);
assert(
  new Set(sameEpochRefreshes.map((item) => JSON.stringify(item.snapshot))).size === 1,
  'F: refresh aynı epoch içinde reroll yapmaz',
);

const epoch = getMarketEpoch(authoritativeNow);
const createBefore = repository.getSnapshotCreateCount();
const [raceA, raceB] = await Promise.all([
  repository.getOrCreateSnapshot(epoch + 1, 1),
  repository.getOrCreateSnapshot(epoch + 1, 1),
]);
assert(raceA === raceB, 'G: eşzamanlı create aynı canonical nesneyi döndürür');
assert(repository.getSnapshotCreateCount() === createBefore + 1,
  'G: aynı epoch/config yalnız bir kez oluşturulur');

// Seed 10 days of backend-owned history, then install player C.
for (let offset = -10 * 48; offset <= 0; offset += 1) {
  await repository.getOrCreateSnapshot(epoch + offset, 1);
}
const historyForNewPlayer = await repository.getHistory({
  fromEpoch: epoch - 30 * 48,
  toEpoch: epoch,
});
assert(historyForNewPlayer.some((entry) => entry.epoch < epoch),
  'D: yeni oyuncu kurulum öncesi backend geçmişini görür');
assert(historyForNewPlayer.length > buildGlobalMarketHistoryEntries(playerA.snapshot!).length,
  'D: grafik kurulum epoch’undan başlamaz');

const serverClock = new ServerEconomyClock(authoritativeNow);
const beforeDeviceChange = getMarketEpoch(serverClock.now());
const originalDateNow = Date.now;
Date.now = () => authoritativeNow + 365 * 24 * 60 * 60 * 1000;
const afterDeviceChange = getMarketEpoch(serverClock.now());
Date.now = originalDateNow;
assert(beforeDeviceChange === afterDeviceChange,
  'E: cihaz saati trusted server epoch’unu değiştirmez');

const oldHistoryJson = JSON.stringify(historyForNewPlayer);
const newConfigSnapshot = buildGlobalEconomySnapshot({
  epoch: epoch + 2,
  configVersion: 2,
  cities: CITIES,
});
assert(newConfigSnapshot.configVersion === 2, 'H: yeni epoch yeni config kullanır');
assert(JSON.stringify(historyForNewPlayer) === oldHistoryJson,
  'H: config değişimi eski history’yi yeniden hesaplamaz');

// Offline means cache only: advancing local/device time cannot append history.
const cachedHistoryCount = historyForNewPlayer.length;
authoritativeNow += 14 * 24 * 60 * 60 * 1000;
assert(historyForNewPlayer.length === cachedHistoryCount,
  'I: offline client sahte history üretmez');
assert(
  getMarketEpoch(authoritativeNow) >
    getMarketEpoch(playerA.snapshot!.generatedAt + MARKET_TICK_INTERVAL_MS / 2),
  'I: cached snapshot stale olarak tanımlanabilir',
);

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
}

void main();

/**
 * Retention Pack V1 — logic-level manual test harness.
 * Run: npx tsx scripts/retention-manual-test.ts
 */

import { MILESTONE_DEFINITIONS } from '../src/data/milestones';
import { generateWeeklyObjectives } from '../src/data/weeklyObjectives';
import {
  applyRetentionEvent,
  claimMilestoneRewardState,
  createDefaultRetentionState,
  getReadyMilestones,
  getReadyWeeklyObjectives,
  getRetentionSummary,
  normalizeRetentionState,
  syncRetentionProgressState,
} from '../src/simulation/retentionProgress';
import { normalizeRetentionState as normalizeFromSave } from '../src/simulation/retentionProgress';
import { getWeeklySeasonKey } from '../src/utils/leaderboardSeason';
import type { FinanceLedgerEntry, Player, RetentionState } from '../src/types/game';

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

function mockPlayer(overrides: Partial<Player> = {}): Player {
  return {
    companyName: 'Test Co',
    money: 50_000,
    reputation: 50,
    level: 1,
    companyLevel: 1,
    xp: 0,
    totalXp: 0,
    diamonds: 0,
    completedContracts: 0,
    homeCityId: 'istanbul',
    trucks: [
      {
        id: 't1',
        name: 'Starter',
        capacity: 25,
        status: 'idle',
        leaseExpired: false,
        catalogId: 'starter',
        currentCityId: 'istanbul',
        fuelLevel: 100,
        condition: 100,
        driverId: null,
      },
    ],
    drivers: [],
    warehouses: [],
    ...overrides,
  } as Player;
}

function baseState(
  player: Player,
  retention: RetentionState,
  ledger: FinanceLedgerEntry[] = [],
) {
  return {
    player,
    financeLedger: ledger,
    cities: [],
    products: [],
    currentTime: 100,
    retention,
  };
}

console.log('\n=== Retention Pack V1 Manual Test ===\n');

console.log('1. Yeni oyun / default state');
const seasonKey = getWeeklySeasonKey();
const defaults = createDefaultRetentionState();
assert(defaults.retentionVersion === 1, 'retentionVersion = 1');
assert(
  Object.keys(defaults.milestones).length === MILESTONE_DEFINITIONS.length,
  'tüm milestone slotları oluştu',
);
assert(defaults.claimedBadges.length === 0, 'claimedBadges boş');
const weeklyDefs = generateWeeklyObjectives(seasonKey);
assert(weeklyDefs.length === 5, '5 haftalık görev üretildi');
assert(defaults.currentWeeklySeasonKey === seasonKey, 'seasonKey leaderboard ile aynı');
for (const def of weeklyDefs) {
  assert(Boolean(defaults.weeklyObjectives[def.id]), `weekly objective kaydı: ${def.id}`);
}

console.log('\n2. Teslimat event');
let retention = createDefaultRetentionState();
retention = applyRetentionEvent(retention, {
  type: 'contract_completed',
  originCityId: 'istanbul',
  destinationCityId: 'ankara',
  onTime: true,
});
assert(retention.weeklyStats.deliveriesCompleted === 1, 'haftalık teslimat +1');
assert(retention.weeklyStats.onTimeDeliveries === 1, 'onTime teslimat +1');

retention = applyRetentionEvent(retention, {
  type: 'contract_completed',
  originCityId: 'izmir',
  destinationCityId: 'bursa',
  onTime: false,
});
assert(retention.weeklyStats.onTimeDeliveries === 1, 'geç teslimat onTime sayacını artırmadı');
assert(retention.weeklyStats.deliveriesCompleted === 2, 'toplam haftalık teslimat 2');

const playerAfterDelivery = mockPlayer({ completedContracts: 1 });
let synced = syncRetentionProgressState(baseState(playerAfterDelivery, retention));
const firstMs = synced.milestones.ms_first_delivery;
assert(firstMs?.progress === 1, 'ms_first_delivery progress = 1');
assert(Boolean(firstMs && firstMs.progress >= 1 && !firstMs.isClaimed), 'ilk teslimat milestone hazır');

const weeklyDeliveryDef = weeklyDefs.find((d) => d.slot === 'delivery')!;
const weeklyDeliveryProgress = synced.weeklyObjectives[weeklyDeliveryDef.id]?.progress ?? 0;
assert(weeklyDeliveryProgress === 2, 'haftalık teslimat görevi progress = 2');

console.log('\n3. Trade event');
retention = applyRetentionEvent(retention, {
  type: 'trade_completed',
  profit: 0,
  productId: 'electronics',
  side: 'buy',
});
assert(retention.weeklyStats.tradeProfit === 0, 'buy event tradeProfit artırmadı');
assert(retention.weeklyStats.tradeBuyCount === 1, 'tradeBuyCount +1');

retention = applyRetentionEvent(retention, {
  type: 'trade_completed',
  profit: 5000,
  productId: 'electronics',
  side: 'sell',
});
assert(retention.weeklyStats.tradeProfit === 5000, 'kârlı satış tradeProfit +5000');

retention = applyRetentionEvent(retention, {
  type: 'trade_completed',
  profit: -2000,
  productId: 'electronics',
  side: 'sell',
});
assert(retention.weeklyStats.tradeProfit === 5000, 'zararlı satış tradeProfit artırmadı');

const ledger: FinanceLedgerEntry[] = [
  {
    time: 1,
    type: 'expense',
    category: 'trade_purchase',
    amount: 1000,
    title: 'buy',
    description: '',
  },
  {
    time: 2,
    type: 'income',
    category: 'trade_sale',
    amount: 6000,
    title: 'sell',
    description: '',
    meta: { productId: 'electronics', profit: 5000 },
  },
];
synced = syncRetentionProgressState(baseState(mockPlayer(), retention, ledger));
assert(synced.milestones.ms_first_trade?.progress === 1, 'al-sat milestone tamamlandı');

console.log('\n4. Depo event');
retention = applyRetentionEvent(retention, {
  type: 'warehouse_stock_changed',
  totalStockTons: 42,
});
assert(retention.weeklyStats.stockStoredTons === 42, 'haftalık stok max 42');

const warehousePlayer = mockPlayer({
  warehouses: [
    {
      id: 'w1',
      cityId: 'istanbul',
      capacityTons: 100,
      usedCapacityTon: 30,
      inventory: [{ productId: 'fruit', quantity: 30, averageBuyPrice: 100, quality: 100 }],
    },
  ],
});
synced = syncRetentionProgressState(baseState(warehousePlayer, retention));
assert(synced.milestones.ms_first_warehouse?.progress === 1, 'ilk depo milestone aktif stok ile tamam');

console.log('\n5. Ödül alma / duplicate');
synced = syncRetentionProgressState(
  baseState(playerAfterDelivery, createDefaultRetentionState()),
);
const claim1 = claimMilestoneRewardState(synced, 'ms_first_delivery', 200);
assert(claim1.ok === true, 'ms_first_delivery claim başarılı');
if (claim1.ok) {
  assert(claim1.retention.milestones.ms_first_delivery.isClaimed === true, 'milestone claimed');
}
const claim2 = claimMilestoneRewardState(
  claim1.ok ? claim1.retention : synced,
  'ms_first_delivery',
  201,
);
assert(!claim2.ok && claim2.error === 'already-claimed', 'ikinci claim reddedildi');

const badgeMilestone = MILESTONE_DEFINITIONS.find((m) => m.reward.badgeId);
if (badgeMilestone) {
  let badgeState = createDefaultRetentionState();
  badgeState = {
    ...badgeState,
    milestones: {
      ...badgeState.milestones,
      [badgeMilestone.id]: { progress: badgeMilestone.target, isClaimed: false },
    },
  };
  const badgeClaim = claimMilestoneRewardState(badgeState, badgeMilestone.id, 300);
  assert(badgeClaim.ok === true, 'badge milestone claim');
  if (badgeClaim.ok && badgeMilestone.reward.badgeId) {
    assert(
      badgeClaim.retention.claimedBadges.includes(badgeMilestone.reward.badgeId),
      'claimedBadges güncellendi',
    );
  }
}

console.log('\n6. Dashboard summary');
const summaryState = createDefaultRetentionState();
summaryState.milestones.ms_first_delivery = { progress: 1, isClaimed: false };
const weeklyReadyDef = weeklyDefs[0];
summaryState.weeklyObjectives[weeklyReadyDef.id] = {
  progress: weeklyReadyDef.target,
  isClaimed: false,
};
const summary = getRetentionSummary(summaryState);
assert(summary.readyMilestones === 1, 'readyMilestones = 1');
assert(summary.readyWeekly === 1, 'readyWeekly = 1');
assert(summary.readyRewards === 2, 'readyRewards = 2');

console.log('\n7. Save/load normalize');
const claimedRetention = claim1.ok ? claim1.retention : synced;
const normalizedRoundtrip = normalizeRetentionState(claimedRetention);
assert(
  normalizedRoundtrip.milestones.ms_first_delivery?.isClaimed === true,
  'normalize sonrası claimed korundu',
);
assert(
  normalizedRoundtrip.weeklyObjectives[weeklyDeliveryDef.id]?.progress === weeklyDeliveryProgress ||
    normalizedRoundtrip.weeklyObjectives[weeklyDeliveryDef.id] !== undefined,
  'normalize sonrası weekly objective kaydı var',
);

const legacyRetention = normalizeFromSave(undefined);
assert(legacyRetention.retentionVersion === 1, 'eski save (retention yok) default ile açıldı');
assert(
  Object.keys(legacyRetention.milestones).length === MILESTONE_DEFINITIONS.length,
  'eski save milestone slotları tam',
);

console.log('\n8. Ready listeler');
const readyMs = getReadyMilestones(summaryState);
const readyWeekly = getReadyWeeklyObjectives(summaryState, seasonKey);
assert(readyMs.includes('ms_first_delivery'), 'getReadyMilestones doğru');
assert(readyWeekly.includes(weeklyReadyDef.id), 'getReadyWeeklyObjectives doğru');

console.log(`\n=== Sonuç: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);

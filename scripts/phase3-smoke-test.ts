/**
 * Retention Pack V1 Phase 3 — smoke test harness.
 * Run: npx tsx scripts/phase3-smoke-test.ts
 */

import './test-globals';

import { readFileSync } from 'node:fs';

import { STARTER_DRIVER } from '../src/data/drivers';
import { CITIES } from '../src/data/cities';
import { PRODUCTS } from '../src/data/products';
import { ROUTES } from '../src/data/routes';
import { STARTER_TRUCK } from '../src/data/trucks';
import { normalizeDriver } from '../src/data/drivers';
import { getContractTypeSpawnWeights, HIGH_REPUTATION_SUCCESS_BONUS } from '../src/config/contractTypes';
import { generateContracts } from '../src/simulation/contracts';
import { buildContractPreview } from '../src/simulation/contractPreview';
import {
  applyContractTypeToContract,
  getContractSelectionScoreInputs,
  getContractTypePenaltyMultiplier,
  normalizeContract,
  normalizeContractType,
  shouldGrantHighReputationBonus,
} from '../src/simulation/contractTypes';
import {
  applyDriverXp,
  calculateDriverDeliveryXp,
  computeDriverLevelFromXp,
  getDriverXpProgress,
  recordDriverDeliveryStats,
} from '../src/simulation/driverProgress';
import {
  applyRetentionEvent,
  createDefaultRetentionState,
  normalizeRetentionState,
} from '../src/simulation/retentionProgress';
import { ensureStarterContracts, generatePlayableContractsForOriginCity } from '../src/simulation/starterContracts';
import { DEFAULT_GLOBAL_ECONOMY } from '../src/simulation/economy';
import { getContractAvailability } from '../src/simulation/delivery';
import {
  applyTruckUpgrade,
  canUpgradeTruck,
  getCargoCapacityBonus,
  getDurabilityConditionLossReduction,
  getEngineDurationReduction,
  getFuelEfficiencyReduction,
  getTruckUpgradeCost,
  normalizeTruckUpgrades,
} from '../src/simulation/truckUpgrades';
import {
  getContractSpawnWeightMultiplier,
  forceCreateWorldEvent,
  getActiveWorldEvents,
} from '../src/simulation/worldEvents';
import { normalizeSavePayload } from '../src/storage/saveGame';
import { getContractAvailabilityLabel } from '../src/utils/contractAvailabilityDisplay';
import { buildContractCardBadges } from '../src/utils/contractBadges';
import type { City, Contract, Driver, Player, Product, Truck } from '../src/types/game';

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

function citiesToRecord(cities: City[]): Record<string, City> {
  return Object.fromEntries(cities.map((city) => [city.id, city]));
}

function countTypes(contracts: Contract[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const c of contracts) {
    const t = normalizeContractType(c);
    counts[t] = (counts[t] ?? 0) + 1;
  }
  return counts;
}

function mergeCounts(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = (out[k] ?? 0) + v;
  }
  return out;
}

function typeRatio(counts: Record<string, number>, type: string, total: number): number {
  return (counts[type] ?? 0) / Math.max(1, total);
}

function assertRatioInRange(
  counts: Record<string, number>,
  total: number,
  type: string,
  min: number,
  max: number,
  label: string,
): void {
  const r = typeRatio(counts, type, total);
  assert(
    r >= min && r <= max,
    label,
    `${type}=${(r * 100).toFixed(1)}% (hedef ${(min * 100).toFixed(0)}-${(max * 100).toFixed(0)}%)`,
  );
}

function sampleSelectedDistribution(
  playerLevel: number,
  playerReputation: number,
  targetCount = 800,
): { counts: Record<string, number>; total: number } {
  let counts: Record<string, number> = {};
  let total = 0;
  let batch = 0;
  while (total < targetCount && batch < 200) {
    const batchContracts = generateContracts(
      genBase.cities,
      genBase.routes,
      genBase.products,
      genBase.globalEconomy,
      [],
      {
        currentTime: genBase.currentTime + batch,
        maxNewContracts: genBase.maxNewContracts,
        playerLevel,
        playerReputation,
        idleTruckOriginCityIds: genBase.idleTruckOriginCityIds,
        ownedMaxTruckCapacity: 25,
      },
    );
    counts = mergeCounts(counts, countTypes(batchContracts));
    total += batchContracts.length;
    batch += 1;
  }
  return { counts, total };
}

function makeLegacyContract(): Contract {
  return {
    id: 'legacy_c1',
    originCityId: 'izmir',
    destinationCityId: 'ankara',
    productId: 'textile',
    amount: 12,
    cargoWeight: 12,
    payment: 5000,
    deadlineHours: 24,
    distanceKm: 580,
    urgency: 0.3,
    status: 'available',
    createdAt: 0,
    expiresAt: 99999,
    requiredLevel: 1,
  };
}

/** Sözleşme üretim testleri için yapay fazla/açık stok */
function buildGenerativeCityRecord(): Record<string, City> {
  const cities = structuredClone(CITIES);
  for (const city of cities) {
    for (const productId of Object.keys(city.products) as import('../src/types/game').ProductId[]) {
      const market = city.products[productId];
      const base = market.basePrice ?? 1000;
      market.currentPrice = base;
      if (city.id === 'izmir') {
        market.stock = 900;
        market.targetStock = 150;
        market.currentPrice = base * 0.85;
      } else {
        market.stock = 30;
        market.targetStock = 600;
        market.currentPrice = base * 1.2;
      }
    }
  }
  return citiesToRecord(cities);
}

function makeTypedContract(type: Contract['contractType'], overrides: Partial<Contract> = {}): Contract {
  const base = normalizeContract({
    ...makeLegacyContract(),
    id: `typed_${type}`,
    contractType: type ?? 'standard',
    riskLevel: type === 'standard' ? 'low' : 'medium',
    ...overrides,
  });
  if (type === 'high_reputation') {
    return {
      ...base,
      requiredReputation: 70,
      requiredDriverLevel: 2,
      bonusMultiplier: 1.35,
      penaltyMultiplier: 1.15,
    };
  }
  if (type === 'fragile') {
    return {
      ...base,
      recommendedTruckCondition: 70,
      bonusMultiplier: 1.25,
      penaltyMultiplier: 1.25,
    };
  }
  if (type === 'urgent') {
    return {
      ...base,
      bonusMultiplier: 1.2,
      penaltyMultiplier: 1.35,
      deadlineHours: 12,
      urgency: 0.85,
    };
  }
  if (type === 'bulk') {
    return { ...base, amount: 28, cargoWeight: 28, bonusMultiplier: 1.15 };
  }
  if (type === 'refrigerated') {
    return {
      ...base,
      productId: 'fruit',
      bonusMultiplier: 1.18,
      deadlineHours: 18,
    };
  }
  return base;
}

console.log('\n=== Retention Pack V1 Phase 3 Smoke Test ===\n');

// ---------------------------------------------------------------------------
// 1. Save migration
// ---------------------------------------------------------------------------
console.log('1. Save migration');

const legacyContract = makeLegacyContract();
const normalizedContract = normalizeContract(legacyContract);
assert(normalizedContract.contractType === 'standard', 'contractType yok → standard');
assert(normalizedContract.riskLevel === 'low', 'standard riskLevel = low');

const legacyDriver = normalizeDriver({
  ...STARTER_DRIVER,
  xp: undefined,
  level: undefined,
  completedDeliveries: undefined,
} as Driver);
assert((legacyDriver.level ?? 0) === 1, 'driver level default 1');
assert((legacyDriver.xp ?? -1) === 0, 'driver xp default 0');
assert((legacyDriver.completedDeliveries ?? -1) === 0, 'driver completedDeliveries default 0');

const legacyTruck = normalizeTruckUpgrades({
  ...STARTER_TRUCK,
  upgradeLevel: undefined,
  upgrades: undefined,
});
assert((legacyTruck.upgradeLevel ?? -1) === 0, 'truck upgradeLevel default 0');
assert(legacyTruck.upgrades?.engine === 0, 'truck upgrades default 0');

const legacyRetention = normalizeRetentionState({
  milestones: {},
  lifetimeStats: { cityDeliveryCounts: { izmir: 3 } },
});
assert(legacyRetention.lifetimeStats.urgentContractsCompleted === 0, 'retention urgent default 0');
assert(legacyRetention.lifetimeStats.cityDeliveryCounts.izmir === 3, 'retention city counts korunur');

const legacyPayload = normalizeSavePayload({
  version: 2,
  currentTime: 120,
  player: {
    companyName: 'Legacy Co',
    money: 30000,
    reputation: 40,
    level: 2,
    companyLevel: 2,
    trucks: [{ ...STARTER_TRUCK }],
    drivers: [{ ...STARTER_DRIVER, xp: undefined, level: undefined }],
    warehouses: [],
    homeCityId: 'izmir',
    completedContracts: 5,
  },
  cities: CITIES,
  products: PRODUCTS,
  routes: ROUTES,
  contracts: [legacyContract],
  activeDeliveries: [],
  globalEconomy: DEFAULT_GLOBAL_ECONOMY,
  marketNews: [],
  eventLog: [],
  financeLedger: [],
  retention: { lifetimeStats: { cityDeliveryCounts: {} } },
});

assert(legacyPayload.contracts[0]?.contractType === 'standard', 'normalizeSavePayload contractType');
assert((legacyPayload.player.drivers[0]?.level ?? 0) === 1, 'normalizeSavePayload driver level');
assert((legacyPayload.player.trucks[0]?.upgradeLevel ?? 0) === 0, 'normalizeSavePayload truck upgrades');

// Round-trip preserve typed values
const typedSave = normalizeSavePayload({
  version: 2,
  currentTime: 200,
  player: {
    companyName: 'Typed Co',
    money: 50000,
    reputation: 75,
    level: 4,
    companyLevel: 4,
    trucks: [
      normalizeTruckUpgrades({
        ...STARTER_TRUCK,
        upgradeLevel: 2,
        upgrades: { engine: 1, fuelEfficiency: 1, cargo: 0, durability: 0 },
      }),
    ],
    drivers: [
      normalizeDriver({ ...STARTER_DRIVER, xp: 260, level: 3, completedDeliveries: 8, onTimeDeliveries: 6 }),
    ],
    warehouses: [],
    homeCityId: 'izmir',
    completedContracts: 20,
  },
  cities: CITIES,
  products: PRODUCTS,
  routes: ROUTES,
  contracts: [
    normalizeContract({
      ...makeLegacyContract(),
      contractType: 'urgent',
      riskLevel: 'high',
      bonusMultiplier: 1.2,
    }),
  ],
  activeDeliveries: [],
  globalEconomy: DEFAULT_GLOBAL_ECONOMY,
  marketNews: [],
  eventLog: [],
  financeLedger: [],
});
assert(typedSave.contracts[0]?.contractType === 'urgent', 'typed contract korunur');
assert(typedSave.player.drivers[0]?.level === 3, 'driver level korunur');
assert(typedSave.player.trucks[0]?.upgrades?.engine === 1, 'truck upgrade korunur');

// ---------------------------------------------------------------------------
// 2. Contract type generation
// ---------------------------------------------------------------------------
console.log('\n2. Contract type generation');

const cityRecord = buildGenerativeCityRecord();
const genBase = {
  cities: cityRecord,
  routes: ROUTES,
  products: PRODUCTS,
  globalEconomy: DEFAULT_GLOBAL_ECONOMY,
  existing: [] as Contract[],
  currentTime: 48,
  maxNewContracts: 15,
  idleTruckOriginCityIds: ['izmir'],
};

const level1Sample = sampleSelectedDistribution(1, 30, 800);
const level1Counts = level1Sample.counts;
const level1Total = level1Sample.total;
assert(level1Total >= 500, 'level 1 dağılım örneği yeterli', `n=${level1Total}`);
assertRatioInRange(level1Counts, level1Total, 'standard', 0.74, 0.94, 'L1-2 standard %74-94');
assertRatioInRange(level1Counts, level1Total, 'urgent', 0.06, 0.26, 'L1-2 urgent %6-26');
assert((level1Counts.high_reputation ?? 0) === 0, 'level 1 high_reputation yok');
assert((level1Counts.fragile ?? 0) === 0, 'level 1 fragile yok');
assert((level1Counts.bulk ?? 0) === 0, 'level 1 bulk yok');
assert((level1Counts.refrigerated ?? 0) === 0, 'level 1 refrigerated yok');

const level3Sample = sampleSelectedDistribution(3, 50, 800);
const level3Counts = level3Sample.counts;
const level3Total = level3Sample.total;
assert(level3Total >= 500, 'level 3 dağılım örneği yeterli', `n=${level3Total}`);
assertRatioInRange(level3Counts, level3Total, 'standard', 0.55, 0.80, 'L3 standard %55-80');
assertRatioInRange(level3Counts, level3Total, 'urgent', 0.08, 0.25, 'L3 urgent %8-25');
assertRatioInRange(level3Counts, level3Total, 'fragile', 0.03, 0.15, 'L3 fragile %3-15');
assertRatioInRange(level3Counts, level3Total, 'bulk', 0.03, 0.15, 'L3 bulk %3-15');
assert((level3Counts.high_reputation ?? 0) === 0, 'L3 rep<70 high_reputation yok');

const level5Sample = sampleSelectedDistribution(5, 80, 800);
const level5Counts = level5Sample.counts;
const level5Total = level5Sample.total;
assert(level5Total >= 500, 'level 5 dağılım örneği yeterli', `n=${level5Total}`);
assertRatioInRange(level5Counts, level5Total, 'standard', 0.40, 0.65, 'L5 rep80 standard %40-65');
assertRatioInRange(level5Counts, level5Total, 'urgent', 0.10, 0.25, 'L5 rep80 urgent %10-25');
assertRatioInRange(level5Counts, level5Total, 'fragile', 0.05, 0.18, 'L5 rep80 fragile %5-18');
assertRatioInRange(level5Counts, level5Total, 'bulk', 0.04, 0.18, 'L5 rep80 bulk %4-18');
assertRatioInRange(level5Counts, level5Total, 'high_reputation', 0.03, 0.12, 'L5 rep80 prestijli %3-12');
const level5RefrigeratedRatio = typeRatio(level5Counts, 'refrigerated', level5Total);
assert(level5RefrigeratedRatio <= 0.08, 'L5 refrigerated düşük oran', `${(level5RefrigeratedRatio * 100).toFixed(1)}%`);

const level5Special =
  (level5Counts.urgent ?? 0) +
  (level5Counts.fragile ?? 0) +
  (level5Counts.bulk ?? 0) +
  (level5Counts.high_reputation ?? 0) +
  (level5Counts.refrigerated ?? 0);
const specialRatio = level5Special / Math.max(1, level5Total);
assert(specialRatio >= 0.35 && specialRatio <= 0.60, 'L5 rep80 özel tip toplam %35-60', `special=${(specialRatio * 100).toFixed(1)}%`);

function logDistribution(label: string, counts: Record<string, number>, total: number): void {
  const parts = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `${t}=${((n / total) * 100).toFixed(1)}%`)
    .join(', ');
  console.log(`  [denge] ${label} (n=${total}): ${parts}`);
}
logDistribution('L1 rep30', level1Counts, level1Total);
logDistribution('L3 rep50', level3Counts, level3Total);
logDistribution('L5 rep80', level5Counts, level5Total);

const productForType = PRODUCTS[0]!;
const baseForType = makeLegacyContract();
let sawFragileOrBulk = false;
let sawHighRep = false;
for (let seq = 1; seq <= 200; seq += 1) {
  const typed = applyContractTypeToContract({
    contract: baseForType,
    product: productForType,
    playerLevel: 5,
    playerReputation: 80,
    sequence: seq,
  });
  if (typed.contractType === 'fragile' || typed.contractType === 'bulk') {
    sawFragileOrBulk = true;
  }
  if (typed.contractType === 'high_reputation') {
    sawHighRep = true;
  }
}
assert(sawFragileOrBulk, 'level 5 applyContractType fragile/bulk atayabilir');
assert(sawHighRep, 'rep 80 applyContractType high_reputation atayabilir');

let sawSelectionBasis = false;
for (let seq = 1; seq <= 120; seq += 1) {
  const typed = applyContractTypeToContract({
    contract: { ...baseForType, payment: 4000, urgency: 0.2 },
    product: productForType,
    playerLevel: 5,
    playerReputation: 80,
    sequence: seq,
  });
  if (typed.contractType !== 'standard' && typed.selectionScoreBasis) {
    const scoreInputs = getContractSelectionScoreInputs(typed);
    assert(scoreInputs.payment <= typed.payment, 'selectionScoreBasis ödeme bonusu skora yansımaz');
    assert((scoreInputs.urgency ?? 0) <= (typed.urgency ?? 0), 'selectionScoreBasis urgency şişmez');
    sawSelectionBasis = true;
    break;
  }
}
assert(sawSelectionBasis, 'selectionScoreBasis özel tiplerde set');

const weightsL1 = getContractTypeSpawnWeights(1, 30);
assert(!weightsL1.some((w) => w.type === 'high_reputation'), 'spawn weights L1 high_rep yok');
const weightsL5 = getContractTypeSpawnWeights(5, 80);
assert(weightsL5.some((w) => w.type === 'high_reputation'), 'spawn weights rep70+ high_rep var');

const starterPlayer: Pick<Player, 'level' | 'companyLevel' | 'trucks' | 'drivers' | 'homeCityId'> = {
  level: 1,
  companyLevel: 1,
  trucks: [STARTER_TRUCK],
  drivers: [STARTER_DRIVER],
  homeCityId: 'izmir',
};
const starterBatch = generatePlayableContractsForOriginCity({
  contracts: [],
  cities: cityRecord,
  routes: ROUTES,
  products: PRODUCTS,
  globalEconomy: DEFAULT_GLOBAL_ECONOMY,
  player: starterPlayer,
  currentTime: 0,
  originCityId: 'izmir',
  truckCapacity: 25,
  count: 2,
});
assert(starterBatch.length > 0, 'starter batch üretildi');
assert(
  starterBatch.every((c) => normalizeContractType(c) === 'standard' || !c.contractType),
  'starter contracts standard',
);

const worldEvent = forceCreateWorldEvent('city_demand_boom', 5);
const activeEvents = worldEvent ? getActiveWorldEvents([worldEvent], 5) : [];
const spawnMult = getContractSpawnWeightMultiplier('izmir', 'ankara', 'textile', activeEvents);
assert(spawnMult >= 1 && spawnMult <= 1.35, 'worldEvents spawn weight clamp', `mult=${spawnMult}`);

// ---------------------------------------------------------------------------
// 3. Availability
// ---------------------------------------------------------------------------
console.log('\n3. Availability');

const truckAtOrigin: Truck = { ...STARTER_TRUCK, currentCityId: 'izmir', status: 'idle', condition: 85 };
const lowCondTruck: Truck = { ...truckAtOrigin, condition: 25 };
const driverL1: Driver = normalizeDriver({ ...STARTER_DRIVER, level: 1, assignedTruckId: null, status: 'idle' });

const highRepContract = makeTypedContract('high_reputation');
const repLowAvail = getContractAvailability(highRepContract, [truckAtOrigin], [driverL1], 5, 10, 50);
assert(repLowAvail.reason === 'REPUTATION_TOO_LOW', 'REPUTATION_TOO_LOW reason', repLowAvail.reason);
assert(repLowAvail.canStart === false, 'high_rep rep düşük → başlatılamaz');
assert(
  getContractAvailabilityLabel('REPUTATION_TOO_LOW') === 'İtibar yetersiz',
  'İtibar yetersiz label',
);

const driverLowContract = makeTypedContract('standard', { requiredDriverLevel: 3 });
const driverLowAvail = getContractAvailability(driverLowContract, [truckAtOrigin], [driverL1], 5, 10, 80);
assert(driverLowAvail.reason === 'DRIVER_LEVEL_TOO_LOW', 'DRIVER_LEVEL_TOO_LOW reason', driverLowAvail.reason);
assert(
  getContractAvailabilityLabel('DRIVER_LEVEL_TOO_LOW') === 'Şoför seviyesi yetersiz',
  'Şoför seviyesi yetersiz label',
);

const condBlock = getContractAvailability(makeLegacyContract(), [lowCondTruck], [driverL1], 3, 10, 50);
assert(condBlock.reason === 'TRUCK_CONDITION_TOO_LOW', 'kondisyon 30 altı hard block');

const fragileOk = getContractAvailability(
  makeTypedContract('fragile'),
  [{ ...truckAtOrigin, condition: 55 }],
  [driverL1],
  3,
  10,
  50,
);
assert(fragileOk.canStart === true, 'fragile 30+ kondisyon → başlatılabilir');

const capacityBlock = getContractAvailability(
  makeTypedContract('bulk', { cargoWeight: 50, amount: 50 }),
  [truckAtOrigin],
  [driverL1],
  5,
  10,
  50,
);
assert(
  capacityBlock.reason === 'NO_TRUCK_WITH_CAPACITY' || capacityBlock.reason === 'CAPACITY_INSUFFICIENT',
  'kapasite reason korunmuş',
  capacityBlock.reason,
);

// ---------------------------------------------------------------------------
// 4. Contract preview
// ---------------------------------------------------------------------------
console.log('\n4. Contract preview');

const previewTruck = { ...truckAtOrigin, condition: 55 };
const previewDriver = normalizeDriver({ ...STARTER_DRIVER, level: 2, status: 'idle' });

function previewFor(type: Contract['contractType']) {
  return buildContractPreview({
    contract: makeTypedContract(type),
    globalEconomy: DEFAULT_GLOBAL_ECONOMY,
    trucks: [previewTruck],
    drivers: [previewDriver],
    companyLevel: 4,
    currentTime: 48,
    truck: previewTruck,
    driver: previewDriver,
    playerReputation: type === 'high_reputation' ? 80 : 50,
    activeWorldEvents: activeEvents,
  });
}

const stdPreview = previewFor('standard');
assert(stdPreview.contractType === 'standard', 'preview standard type');
assert(stdPreview.estimatedGrossPayment > 0, 'preview standard ödeme > 0');

const urgentPreview = previewFor('urgent');
assert((urgentPreview.contractTypePaymentBonus ?? 0) > 0, 'urgent tip bonusu var');
assert((urgentPreview.contractTypePenaltyMultiplier ?? 1) > 1, 'urgent penalty mult > 1');

const fragilePreview = previewFor('fragile');
assert((fragilePreview.contractTypePaymentBonus ?? 0) > 0, 'fragile tip bonusu var');
assert(Boolean(fragilePreview.contractTypeWarning), 'fragile kondisyon warning');

const prestigePreview = previewFor('high_reputation');
assert(prestigePreview.contractTypeLabel === 'Prestijli', 'prestij label');
assert(shouldGrantHighReputationBonus(makeTypedContract('high_reputation')), 'prestij rep bonus flag');

const bulkPreview = previewFor('bulk');
assert((bulkPreview.estimatedFuelCost ?? 0) > 0, 'bulk yakıt maliyeti var');
assert((bulkPreview.estimatedMaintenanceCost ?? 0) > 0, 'bulk bakım maliyeti var');

const refrPreview = previewFor('refrigerated');
assert(refrPreview.contractType === 'refrigerated', 'refrigerated preview');
assert((refrPreview.contractTypePaymentBonus ?? 0) > 0, 'refrigerated bonus');

const stackedPayment =
  (prestigePreview.baseGrossPayment ?? 0) +
  (prestigePreview.contractTypePaymentBonus ?? 0) +
  (prestigePreview.worldEventPaymentBonus ?? 0);
assert(
  prestigePreview.estimatedGrossPayment <= stackedPayment * 1.05 + 1,
  'world event + tip bonus şişmiyor',
  `gross=${prestigePreview.estimatedGrossPayment} stacked≈${stackedPayment}`,
);

// ---------------------------------------------------------------------------
// 5. Delivery / driver XP (logic)
// ---------------------------------------------------------------------------
console.log('\n5. Delivery / driver XP');

const urgentContract = makeTypedContract('urgent');
const stdXp = calculateDriverDeliveryXp({
  contract: makeLegacyContract(),
  distanceKm: 400,
  onTime: true,
  success: true,
});
const urgentXp = calculateDriverDeliveryXp({
  contract: urgentContract,
  distanceKm: 400,
  onTime: true,
  success: true,
});
const lateXp = calculateDriverDeliveryXp({
  contract: urgentContract,
  distanceKm: 400,
  onTime: false,
  success: true,
});
assert(urgentXp > stdXp, 'urgent daha fazla XP');
assert(lateXp < urgentXp, 'geç teslimat XP azalır');

let testDriver = normalizeDriver({ ...STARTER_DRIVER, xp: 0, level: 1, completedDeliveries: 0, onTimeDeliveries: 0 });
testDriver = recordDriverDeliveryStats(testDriver, true);
assert(testDriver.completedDeliveries === 1, 'completedDeliveries +1');
assert(testDriver.onTimeDeliveries === 1, 'onTimeDeliveries +1');

const xpResult = applyDriverXp(testDriver, 110, urgentContract);
assert(xpResult.newLevel === 2, '100 XP → level 2');
assert(xpResult.leveledUp === true, 'level up flag');

let retention = createDefaultRetentionState();
retention = applyRetentionEvent(retention, { type: 'urgent_contract_completed' });
assert(retention.lifetimeStats.urgentContractsCompleted === 1, 'urgent retention +1');
retention = applyRetentionEvent(retention, { type: 'urgent_contract_completed' });
assert(retention.lifetimeStats.urgentContractsCompleted === 2, 'urgent retention ikinci +1 (tek event)');

retention = applyRetentionEvent(retention, {
  type: 'contract_completed',
  originCityId: 'izmir',
  destinationCityId: 'ankara',
  onTime: true,
  contractType: 'urgent',
});
assert(
  retention.lifetimeStats.urgentContractsCompleted === 2,
  'contract_completed contractType çift saymıyor',
);

retention = applyRetentionEvent(retention, { type: 'driver_level_up', driverId: 'd1', newLevel: 3 });
assert(retention.lifetimeStats.maxDriverLevel === 3, 'driver_level_up retention');

assert(HIGH_REPUTATION_SUCCESS_BONUS === 1, 'prestij rep bonus = 1');

// Duplicate guard — static check
const storeSrc = readFileSync('src/store/gameStore.ts', 'utf8');
assert(
  storeSrc.includes('completedDeliveryNotificationIds.has(deliveryId)'),
  'duplicate completion guard var',
);
assert(
  storeSrc.includes('hasDeliveryCompletionLedgerEntry'),
  'ledger duplicate guard var',
);

// ---------------------------------------------------------------------------
// 6. Truck upgrade / bakım
// ---------------------------------------------------------------------------
console.log('\n6. Truck upgrade / bakım');

let upgradeTruck = normalizeTruckUpgrades({ ...STARTER_TRUCK });
const engineCost = getTruckUpgradeCost(upgradeTruck, 'engine');
assert(engineCost > 0, 'upgrade maliyeti > 0');
assert(canUpgradeTruck(upgradeTruck, 'engine'), 'engine upgrade mümkün');

const upgraded = applyTruckUpgrade(upgradeTruck, 'engine');
assert((upgraded.upgrades?.engine ?? 0) === 1, 'engine level +1');
assert(getEngineDurationReduction(upgraded) > 0, 'engine süre azaltma > 0');

upgraded.upgrades = { engine: 3, fuelEfficiency: 3, cargo: 3, durability: 3 };
assert(!canUpgradeTruck(upgraded, 'engine'), 'max level 3 üstüne çıkmaz');

const fuelTruck = applyTruckUpgrade(normalizeTruckUpgrades({ ...STARTER_TRUCK }), 'fuelEfficiency');
assert(getFuelEfficiencyReduction(fuelTruck) > 0, 'fuel efficiency bonus > 0');

const cargoTruck = applyTruckUpgrade(normalizeTruckUpgrades({ ...STARTER_TRUCK }), 'cargo');
assert(getCargoCapacityBonus(cargoTruck) > 0, 'cargo kapasite bonus > 0');

const durTruck = applyTruckUpgrade(normalizeTruckUpgrades({ ...STARTER_TRUCK }), 'durability');
assert(getDurabilityConditionLossReduction(durTruck) > 0, 'durability kayıp azaltma > 0');

assert(storeSrc.includes('truck_maintained'), 'repair retention event wired');
assert(storeSrc.includes('upgradeTruck'), 'upgradeTruck action var');

// ---------------------------------------------------------------------------
// 7–8. UI static checks
// ---------------------------------------------------------------------------
console.log('\n7. Fleet UI (static)');

const fleetSrc = readFileSync('src/screens/FleetScreen.tsx', 'utf8');
assert(fleetSrc.includes('Kondisyon'), 'truck kondisyon gösterimi');
assert(fleetSrc.includes('Bakım Yap'), 'Bakım Yap butonu');
assert(fleetSrc.includes('Geliştirmeleri Yönet'), 'Geliştirmeleri Yönet butonu');
assert(fleetSrc.includes('UpgradesScreen'), 'Filo UpgradesScreen yönlendirmesi');
assert(readFileSync('src/screens/UpgradesScreen.tsx', 'utf8').includes('upgradeTruck'), 'UpgradesScreen mevcut upgrade action');
assert(readFileSync('src/screens/UpgradesScreen.tsx', 'utf8').includes('Kamyon Değiştir'), 'UpgradesScreen kamyon değiştir strip');
assert(readFileSync('src/screens/MoreScreen.tsx', 'utf8').includes("key: 'upgrades'"), 'More Geliştirmeler modülü aktif');
assert(fleetSrc.includes('getDriverXpProgress'), 'driver XP progress');
assert(fleetSrc.includes('onTimeRate'), 'on-time oranı');

console.log('\n8. Contract UI (static)');

const contractsSrc = readFileSync('src/screens/ContractsScreen.tsx', 'utf8');
const detailSrc = readFileSync('src/components/contracts/ContractDetailModal.tsx', 'utf8');
const badgesSrc = readFileSync('src/utils/contractBadges.ts', 'utf8');

assert(contractsSrc.includes('contractTypeLabel'), 'kart tip badge');
assert(badgesSrc.includes('.slice(0, 2)'), 'max 2 badge kuralı');
assert(detailSrc.includes('Sözleşme tipi'), 'detay tip açıklaması');
assert(detailSrc.includes('contractTypeWarning'), 'detay warning');
assert(detailSrc.includes('Gerekli itibar'), 'detay itibar');

const badgeSample = buildContractCardBadges({
  availability: { canStart: true, reason: 'OK', buttonLabel: 'Ekibi Seç' },
  playerLevel: 3,
  urgent: false,
  riskLevel: 'medium',
  riskLabel: 'Orta Risk',
  contractType: 'fragile',
  contractTypeLabel: 'Hassas Yük',
});
assert(badgeSample.length <= 2, 'badge max 2');
assert(badgeSample.some((b) => b.label === 'Hassas Yük'), 'fragile badge label');

// ---------------------------------------------------------------------------
// 9. Balance simulation
// ---------------------------------------------------------------------------
console.log('\n9. Denge simülasyonu (30 batch)');

let balanceTotals: Record<string, number> = {};
let totalPayment = 0;
let totalProfit = 0;
let profitCount = 0;

for (let day = 0; day < 30; day += 1) {
  const batch = generateContracts(
    cityRecord,
    ROUTES,
    PRODUCTS,
    DEFAULT_GLOBAL_ECONOMY,
    [],
    {
      currentTime: day * 24,
      maxNewContracts: 8,
      playerLevel: 3,
      playerReputation: 55,
      idleTruckOriginCityIds: ['izmir'],
      ownedMaxTruckCapacity: 25,
    },
  );
  balanceTotals = mergeCounts(balanceTotals, countTypes(batch));
  for (const c of batch) {
    const p = buildContractPreview({
      contract: c,
      globalEconomy: DEFAULT_GLOBAL_ECONOMY,
      trucks: [truckAtOrigin],
      drivers: [previewDriver],
      companyLevel: 3,
      currentTime: day * 24,
      playerReputation: 55,
    });
    totalPayment += p.estimatedGrossPayment;
    totalProfit += p.estimatedOperationalProfit;
    profitCount += 1;
  }
}

const balanceTotal = Object.values(balanceTotals).reduce((s, v) => s + v, 0);
const urgentShare = (balanceTotals.urgent ?? 0) / Math.max(1, balanceTotal);
const avgProfit = totalProfit / Math.max(1, profitCount);
assert(balanceTotal > 50, '30 batch yeterli sözleşme', `total=${balanceTotal}`);
assert(urgentShare <= 0.45, 'urgent aşırı sık değil (harness)', `share=${urgentShare.toFixed(2)}`);
assert(avgProfit > -5000 && avgProfit < 50000, 'ortalama net kâr mantıklı', `avg=${avgProfit.toFixed(0)}`);

const fastLevel = computeDriverLevelFromXp(900);
assert(fastLevel === 4, '900 XP → level 4');
assert(computeDriverLevelFromXp(1150) === 5, '1150 XP → level 5 cap');
assert(getTruckUpgradeCost(STARTER_TRUCK, 'engine') >= 3000, 'upgrade pahalı (>=3000)');

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log('\n=== Summary ===');
console.log(`PASS: ${passed}`);
console.log(`FAIL: ${failed}`);
console.log(failed === 0 ? '\n✅ ALL PASS\n' : '\n❌ FAILURES DETECTED\n');

process.exit(failed === 0 ? 0 : 1);

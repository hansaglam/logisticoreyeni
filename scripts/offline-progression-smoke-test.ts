/**
 * Offline Progression V1 smoke test.
 * Run: npx tsx scripts/offline-progression-smoke-test.ts
 */

import './test-globals';

import { readFileSync } from 'node:fs';

import { CITIES } from '../src/data/cities';
import { PRODUCTS } from '../src/data/products';
import { ROUTES } from '../src/data/routes';
import { getMsPerGameHour, GAME_LOOP_TICK_MS, getEffectiveOfflineGameSpeed, getGameHoursPerTick, getGameHoursPerRealMinute, realMsToGameHours } from '../src/config/balance';
import { createDefaultGlobalEconomy, updateAllCitiesEconomy } from '../src/simulation/economy';
import {
  calculateDeliverySettlement,
  calculateLatePenalty,
  isDeliveryProgressComplete,
  safeCompleteDelivery,
  updateDeliveryProgress,
} from '../src/simulation/delivery';
import { maybeRollDeliveryIncident } from '../src/simulation/deliveryIncidents';
import { applyDriverXp } from '../src/simulation/driverProgress';
import {
  applyOfflineDeliveries,
  buildOfflineProgressSummary,
  calculateOfflineElapsed,
  createOfflineProgressSnapshot,
  MAX_OFFLINE_PROGRESS_HOURS,
  MIN_OFFLINE_PROGRESS_MS,
  MIN_OFFLINE_PROGRESS_MINUTES,
  normalizeOfflineProgressFields,
  resolveOfflineBaselineMs,
  shouldShowOfflineSummary,
  shouldSkipDuplicateOfflineApply,
  validateOfflineSummaryConsistency,
} from '../src/simulation/offlineProgression';
import type { FinanceLedgerEntry } from '../src/types/game';
import { processWorldEventsForDayRange } from '../src/simulation/worldEvents';
import { payloadToStoreState, type SaveGamePayload } from '../src/storage/saveGame';
import type { Contract, Delivery, Driver, Player, SimulationGameState } from '../src/types/game';

function countCompletedDeliveries(deliveries: Delivery[]): number {
  return deliveries.filter((delivery) => isDeliveryProgressComplete(delivery.progress)).length;
}

function runOnlineDeliveryTicks(
  deliveries: Delivery[],
  gameSpeed: number,
  realMs: number,
): Delivery[] {
  const tickCount = Math.floor(realMs / GAME_LOOP_TICK_MS);
  const hoursPerTick = getGameHoursPerTick(gameSpeed);
  let current = deliveries.map((delivery) => ({ ...delivery }));
  for (let i = 0; i < tickCount; i += 1) {
    current = current.map((delivery) => updateDeliveryProgress(delivery, hoursPerTick));
  }
  return current;
}

function runOfflineDeliveryCatchUp(
  deliveries: Delivery[],
  gameSpeed: number,
  realMs: number,
): Delivery[] {
  const gameHours = realMsToGameHours(realMs, gameSpeed);
  return deliveries.map((delivery) => updateDeliveryProgress({ ...delivery }, gameHours));
}

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

const MS_MIN = 60_000;
const MS_HOUR = 60 * MS_MIN;

function basePlayer(overrides: Partial<Player> = {}): Player {
  return {
    companyName: 'Test Co',
    money: 50_000,
    homeCityId: 'izmir',
    completedContracts: 5,
    trucks: [],
    drivers: [],
    warehouses: [],
    level: 5,
    companyLevel: 5,
    ...overrides,
  } as Player;
}

function baseDelivery(overrides: Partial<Delivery> = {}): Delivery {
  return {
    id: 'delivery_offline_1',
    contractId: 'contract_offline_1',
    truckId: 'truck_1',
    driverId: 'driver_1',
    originCityId: 'izmir',
    destinationCityId: 'istanbul',
    productId: 'machinery',
    amount: 10,
    distanceKm: 480,
    progress: 0.5,
    status: 'on_route',
    startedAt: 120,
    estimatedArrivalTime: 140,
    deadlineTime: 168,
    fuelCost: 400,
    maintenanceCost: 120,
    estimatedProfit: 900,
    travelHours: 20,
    breakdownChance: 0.02,
    accidentChance: 0.01,
    conditionLoss: 3,
    ...overrides,
  };
}

function minimalLegacyPayload(): SaveGamePayload {
  const globalEconomy = createDefaultGlobalEconomy();
  const player = basePlayer({
    trucks: [
      {
        id: 'truck_1',
        name: 'Starter',
        capacity: 25,
        status: 'idle',
        currentCityId: 'izmir',
        condition: 100,
        fuelConsumptionPerKm: 0.3,
      },
    ],
    drivers: [
      {
        id: 'driver_1',
        name: 'Ali',
        status: 'idle',
        level: 1,
        xp: 0,
      } as Driver,
    ],
    warehouses: [
      {
        id: 'wh_1',
        cityId: 'izmir',
        capacityTons: 100,
        capacityTon: 100,
        dailyOperatingCost: 50,
        upgradeTier: 1,
        warehouseType: 'standard',
        qualityProtection: 0.5,
        inventory: [],
        usedCapacityTon: 0,
      },
    ],
  });

  return {
    version: 3,
    meta: { savedAt: Date.now() - 86_400_000, companyName: 'Legacy Co' },
    currentTime: 48,
    player,
    cities: structuredClone(CITIES),
    products: structuredClone(PRODUCTS),
    routes: structuredClone(ROUTES),
    contracts: [],
    activeDeliveries: [],
    globalEconomy,
    marketNews: [],
    eventLog: [],
    gameSpeed: 1,
    isPaused: false,
  };
}

console.log('\nOffline Progression V1 smoke tests\n');

console.log('1. Elapsed guards');
{
  const now = Date.now();
  const missing = calculateOfflineElapsed(undefined, now);
  assert(!missing.shouldApply, 'lastSeen yoksa offline progress uygulanmaz');
  assert(missing.reason === 'missing_last_seen', 'missing_last_seen reason');
}

{
  const now = Date.now();
  const negative = calculateOfflineElapsed(now + 60_000, now);
  assert(!negative.shouldApply, 'elapsed negatifse uygulanmaz');
  assert(negative.reason === 'non_positive', 'non_positive reason');
}

{
  const now = Date.now();
  const lastSeen = now - Math.max(1, MIN_OFFLINE_PROGRESS_MS - 1);
  const short = calculateOfflineElapsed(lastSeen, now);
  assert(!short.shouldApply, 'elapsed < 5dk ise uygulanmaz');
  assert(short.reason === 'below_minimum', 'below_minimum reason');
}

{
  const now = Date.now();
  const lastSeen = now - (MAX_OFFLINE_PROGRESS_HOURS + 2) * MS_HOUR;
  const capped = calculateOfflineElapsed(lastSeen, now);
  assert(capped.shouldApply, 'elapsed > 12 saat ise uygulanır (cap ile)');
  assert(capped.capped, 'capped flag true');
  assert(
    capped.appliedMs === MAX_OFFLINE_PROGRESS_HOURS * MS_HOUR,
    '12 saat cap uygulanır',
    `appliedMs=${capped.appliedMs}`,
  );
}

console.log('\n2. Delivery simulation');
{
  const delivery = baseDelivery({ progress: 0.5, travelHours: 10 });
  const result = applyOfflineDeliveries([delivery], 6);
  assert(result.completedIds.length === 1, 'aktif teslimat elapsed içinde tamamlanır');
  assert(isDeliveryProgressComplete(result.deliveries[0]?.progress ?? 0), 'progress tamamlandı');
}

{
  const settlement = calculateDeliverySettlement({
    contractPayment: 5000,
    fuelCost: 400,
    maintenanceCost: 120,
    penaltyCost: 0,
    fuelAlreadyPaid: true,
  });
  assert(settlement.grossRevenue === 5000, 'tamamlanan teslimatta ödeme uygulanır');
  assert(settlement.cashDeltaOnCompletion > 0, 'cash delta pozitif');
}

{
  const contract = {
    payment: 5000,
    deadlineHours: 10,
  } as Contract;
  const penalty = calculateLatePenalty(contract, 8, 14, PRODUCTS[0]!);
  assert(penalty > 0, 'geç teslimatta penalty uygulanır');
}

{
  const delivery = baseDelivery({ progress: 1, travelHours: 20 });
  const contract = {
    id: delivery.contractId,
    originCityId: delivery.originCityId,
    destinationCityId: delivery.destinationCityId,
    productId: delivery.productId,
    payment: 5000,
    deadlineHours: 48,
    status: 'active',
  } as Contract;
  const sim: SimulationGameState = {
    currentTime: 140,
    currentDay: 1,
    contracts: [contract],
    deliveries: [delivery],
    trucks: [
      {
        id: delivery.truckId,
        name: 'T1',
        capacity: 25,
        status: 'on_route',
        currentCityId: delivery.originCityId,
        condition: 90,
      },
    ],
    drivers: [{ id: delivery.driverId, name: 'Ali', status: 'driving' }],
    cities: {},
    player: basePlayer(),
  };
  const result = safeCompleteDelivery(sim, delivery.id);
  assert(result.success === true, 'safeCompleteDelivery başarılı');
  const truck = result.updatedState?.trucks.find((t) => t.id === delivery.truckId);
  assert(truck?.status === 'idle', 'truck destination city\'de idle kalır');
  assert(
    truck?.currentCityId === delivery.destinationCityId,
    'truck varış şehrinde',
    `city=${truck?.currentCityId}`,
  );
}

{
  const driver: Driver = {
    id: 'd1',
    name: 'Veli',
    status: 'idle',
    level: 1,
    xp: 95,
    completedDeliveries: 0,
    onTimeDeliveries: 0,
  };
  const contract = { payment: 4000, distanceKm: 300 } as Contract;
  const xpResult = applyDriverXp(driver, 20, contract);
  assert((xpResult.driver.xp ?? 0) > (driver.xp ?? 0), 'driver XP uygulanır');
}

{
  const delivery = baseDelivery({ progress: 0.2, travelHours: 40 });
  const result = applyOfflineDeliveries([delivery], 4);
  assert(result.completedIds.length === 0, 'henüz tamamlanmayan teslimat tamamlanmaz');
  assert((result.deliveries[0]?.progress ?? 0) > 0.2, 'progress artar');
}

console.log('\n3. Delivery incidents offline');
{
  const gameStoreSource = readFileSync('src/store/gameStore.ts', 'utf8');
  assert(
    gameStoreSource.includes('!offlineProgressionActive') &&
      gameStoreSource.includes('maybeRollDeliveryIncident'),
    'gameStore offline sırasında maybeRollDeliveryIncident guard içerir',
  );

  const player = basePlayer();
  const contract = {
    id: 'c1',
    payment: 5000,
    deadlineHours: 48,
    originCityId: 'izmir',
    destinationCityId: 'istanbul',
    productId: 'machinery',
  } as Contract;
  const withIncident = baseDelivery({
    progress: 0.45,
    incidentGenerated: false,
    incident: undefined,
  });
  const rolled = maybeRollDeliveryIncident(withIncident, contract, player, 100);
  const hadPending = rolled.incident?.status === 'pending';

  const offlineResult = applyOfflineDeliveries(
    [
      {
        ...withIncident,
        incident: hadPending
          ? rolled.incident
          : {
              id: 'inc_1',
              type: 'traffic',
              status: 'pending',
              generatedAt: 100,
              choices: [],
            },
        incidentGenerated: false,
      },
    ],
    2,
  );
  assert(
    offlineResult.deliveries[0]?.incident == null,
    'offline sırasında pending incident temizlenir',
  );
  assert(
    offlineResult.deliveries[0]?.incidentResolved === true,
    'pending incident otomatik resolved sayılır',
  );
}

console.log('\n4. World events & market');
{
  const result = processWorldEventsForDayRange({
    worldEvents: [
      {
        id: 'evt_1',
        type: 'fuel_spike',
        title: 'Test',
        description: 'Test event',
        startDay: 1,
        durationDays: 2,
        severity: 'medium',
        impacts: {},
      },
    ],
    fromDay: 1,
    toDay: 5,
    seedKey: 'offline-test',
  });
  assert(Array.isArray(result.worldEvents), 'world event süreleri ilerler');
}

{
  const citiesRecord = Object.fromEntries(CITIES.map((city) => [city.id, structuredClone(city)]));
  const economy = createDefaultGlobalEconomy();
  let crashed = false;
  try {
    for (let step = 0; step < 24; step += 1) {
      updateAllCitiesEconomy(citiesRecord, economy);
    }
  } catch {
    crashed = true;
  }
  assert(!crashed, 'market update crash vermez');
}

console.log('\n5. Duplicate apply & summary');
{
  const now = Date.now();
  const lastSeen = now - 30 * MS_MIN;
  const lastApplied = now - Math.max(1, Math.floor(MIN_OFFLINE_PROGRESS_MS / 2));
  assert(
    shouldSkipDuplicateOfflineApply(lastSeen, lastApplied, now),
    'aynı offline süre iki kez uygulanmaz (yakın apply)',
  );
}

{
  const before = createOfflineProgressSnapshot({
    player: basePlayer({ money: 10_000, completedContracts: 2, lateDeliveries: 0, drivers: [] }),
    activeDeliveries: [],
    currentTime: 100,
    worldEvents: [],
    lastWorldEventGeneratedDay: 1,
    cities: CITIES,
    financeLedger: [],
  });
  const afterPlayer = basePlayer({
    money: 12_500,
    completedContracts: 4,
    lateDeliveries: 1,
    drivers: [],
  });
  const elapsed = calculateOfflineElapsed(Date.now() - 60 * MS_MIN, Date.now());
  const summary = buildOfflineProgressSummary(
    before,
    {
      player: afterPlayer,
      activeDeliveries: [],
      currentTime: 130,
      worldEvents: [{ id: 'e', type: 'fuel_spike', title: 'T', description: 'D', startDay: 2, durationDays: 1, severity: 'low', impacts: {} }],
      lastWorldEventGeneratedDay: 2,
      cities: CITIES,
      financeLedger: [],
    },
    elapsed,
    {
      earnings: 6000,
      expenses: 1500,
      completedDeliveries: 2,
      lateDeliveries: 1,
      worldEventsUpdated: true,
      marketUpdated: true,
    },
  );
  assert(summary.completedDeliveries === 2, 'summary tamamlanan sayısı');
  assert(summary.lateDeliveries === 1, 'summary geciken sayısı');
  assert(summary.netChange === 2500, 'summary net değişim', `net=${summary.netChange}`);
  assert(summary.otherNetChange === -2000, 'summary other net', `other=${summary.otherNetChange}`);
  assert(shouldShowOfflineSummary(summary), 'anlamlı değişiklikte summary gösterilir');
  assert(validateOfflineSummaryConsistency(summary), 'summary tutarlı');
}

console.log('\n6. Save migration');
{
  const payload = minimalLegacyPayload();
  let crashed = false;
  let state: ReturnType<typeof payloadToStoreState> | null = null;
  try {
    state = payloadToStoreState(payload);
  } catch {
    crashed = true;
  }
  assert(!crashed, 'save/load eski kayıtla crash vermez');
  assert(
    state?.lastSeenRealTimeMs == null || Number.isFinite(state.lastSeenRealTimeMs),
    'legacy save lastSeenRealTimeMs güvenli',
  );
  assert(state?.offlineProgressVersion === 1, 'offlineProgressVersion default 1');
}

console.log('\n7. Config sanity');
{
  assert(
    MIN_OFFLINE_PROGRESS_MINUTES === GAME_LOOP_TICK_MS / MS_MIN,
    'minimum offline pencere bir normal game tick ile aynÄ±',
  );
  assert(MAX_OFFLINE_PROGRESS_HOURS === 24, 'MAX_OFFLINE_PROGRESS_HOURS = 24 saat');
  assert(
    MAX_OFFLINE_PROGRESS_HOURS * 3_600_000 === 86_400_000,
    '24h progress = 86_400_000 ms (saniye/dakika değil)',
  );
  const gameHours = realMsToGameHours(60 * MS_MIN, 1);
  assert(gameHours > 0, 'realMsToGameHours pozitif döner');
  const fields = normalizeOfflineProgressFields({});
  assert(Number.isFinite(fields.lastSeenRealTimeMs), 'normalizeOfflineProgressFields güvenli');
}

console.log('\n8. Online/offline time parity');
{
  const gameSpeed = 1;
  const tenMinMs = 10 * MS_MIN;
  const manualHours = tenMinMs / getMsPerGameHour(gameSpeed);
  const helperHours = realMsToGameHours(tenMinMs, gameSpeed);
  assert(
    Math.abs(manualHours - helperHours) < 0.0001,
    'realMsToGameHours online helper ile aynı sonucu veriyor',
    `manual=${manualHours} helper=${helperHours}`,
  );
}

{
  const gameSpeed = 1.5;
  const tenMinMs = 10 * MS_MIN;
  const tickCount = tenMinMs / GAME_LOOP_TICK_MS;
  let onlineDelivery = baseDelivery({ progress: 0, travelHours: 10 });
  for (let i = 0; i < tickCount; i += 1) {
    onlineDelivery = updateDeliveryProgress(onlineDelivery, getGameHoursPerTick(gameSpeed));
  }
  const offlineHours = realMsToGameHours(tenMinMs, gameSpeed);
  const offlineDelivery = updateDeliveryProgress(
    baseDelivery({ progress: 0, travelHours: 10 }),
    offlineHours,
  );
  const progressDiff = Math.abs((onlineDelivery.progress ?? 0) - (offlineDelivery.progress ?? 0));
  assert(
    progressDiff < 0.001,
    '10 gerçek dakika online tick vs offline catch-up aynı progress',
    `online=${onlineDelivery.progress} offline=${offlineDelivery.progress} diff=${progressDiff}`,
  );
}

{
  const appSource = readFileSync('App.tsx', 'utf8');
  const activeLineIdx = appSource.indexOf('!wasActive && isActive');
  assert(activeLineIdx >= 0, 'AppState active handler bulundu');
  const activeBlock = appSource.slice(activeLineIdx, activeLineIdx + 180);
  assert(
    activeBlock.includes('applyOfflineProgressionIfNeeded'),
    'active olunca applyOfflineProgressionIfNeeded çağrılır',
  );
  assert(
    !activeBlock.includes('recordLastSeenRealTimeMs'),
    'active olurken lastSeen önce sıfırlanmıyor',
  );
}

{
  const tenMinMs = 10 * MS_MIN;
  const gameSpeed = 2;
  const once = realMsToGameHours(tenMinMs, gameSpeed);
  const wronglyDouble = (tenMinMs / getMsPerGameHour(gameSpeed)) * gameSpeed;
  assert(
    Math.abs(once - wronglyDouble) > 0.01,
    'offline elapsed double speed uygulanmıyor',
    `once=${once} wronglyDouble=${wronglyDouble}`,
  );
  assert(
    Math.abs(once - tenMinMs / getMsPerGameHour(gameSpeed)) < 0.0001,
    'offline elapsed tek dönüşümle hesaplanır',
  );
}

{
  const gameSpeed = 1;
  const oneMinMs = MS_MIN;
  const expected = oneMinMs / getMsPerGameHour(gameSpeed);
  const actual = realMsToGameHours(oneMinMs, gameSpeed);
  assert(
    Math.abs(actual - expected) < 0.0001,
    'offline elapsed aşırı yavaş uygulanmıyor',
    `expected=${expected} actual=${actual}`,
  );
}

{
  const now = Date.now();
  const lastSeen = now - (MAX_OFFLINE_PROGRESS_HOURS + 3) * MS_HOUR;
  const capped = calculateOfflineElapsed(lastSeen, now);
  const hoursFromApplied = realMsToGameHours(capped.appliedMs, 1);
  const hoursFromRaw = realMsToGameHours(capped.elapsedMs, 1);
  assert(capped.capped, 'cap flag aktif');
  assert(hoursFromApplied < hoursFromRaw, 'capped elapsed önce real ms cap sonra gameHours');
  assert(
    capped.appliedMs === MAX_OFFLINE_PROGRESS_HOURS * MS_HOUR,
    'cap 12 saat real ms olarak uygulanır',
  );
}

{
  const gameStoreSource = readFileSync('src/store/gameStore.ts', 'utf8');
  const saveGameBlock = gameStoreSource.match(/saveGame: async \(\) => \{[\s\S]*?\n  \},/);
  assert(Boolean(saveGameBlock), 'saveGame bloğu bulundu');
  assert(
    saveGameBlock != null && !saveGameBlock[0].includes('recordLastSeenRealTimeMs'),
    'saveGame öncesi lastSeen güncellemesi offline apply\'i sıfırlamıyor',
  );
}

{
  const appSource = readFileSync('App.tsx', 'utf8');
  assert(
    appSource.includes('wasActive && !isActive') &&
      appSource.includes('recordLastSeenRealTimeMs'),
    'lastSeen yalnızca background\'da kaydedilir (inactive değil)',
  );
}

console.log('\n9. Realistic 7-minute parity');
{
  const actualGameSpeed = 1;
  const sevenMinMs = 7 * MS_MIN;
  const onlineRate = getGameHoursPerRealMinute(actualGameSpeed);
  const offlineRate = realMsToGameHours(sevenMinMs, actualGameSpeed) / 7;
  assert(
    Math.abs(onlineRate - offlineRate) < 0.0001,
    'online/offline gameHoursPerRealMinute eşit',
    `online=${onlineRate} offline=${offlineRate}`,
  );
}

{
  const actualGameSpeed = 1;
  const sevenMinMs = 7 * MS_MIN;
  const seed = baseDelivery({ progress: 0, travelHours: 10 });
  const onlineResult = runOnlineDeliveryTicks([seed], actualGameSpeed, sevenMinMs)[0];
  const offlineResult = runOfflineDeliveryCatchUp([seed], actualGameSpeed, sevenMinMs)[0];
  const progressDiff = Math.abs((onlineResult?.progress ?? 0) - (offlineResult?.progress ?? 0));
  assert(
    progressDiff < 0.001,
    '7 gerçek dakika online vs offline aynı progress',
    `online=${onlineResult?.progress} offline=${offlineResult?.progress}`,
  );
}

{
  const actualGameSpeed = 1;
  const sevenMinMs = 7 * MS_MIN;
  const deliveries = [0, 1, 2].map((index) =>
    baseDelivery({
      id: `delivery_batch_${index}`,
      progress: 0.75,
      travelHours: 10,
    }),
  );
  const onlineCompleted = countCompletedDeliveries(
    runOnlineDeliveryTicks(deliveries, actualGameSpeed, sevenMinMs),
  );
  const offlineCompleted = countCompletedDeliveries(
    runOfflineDeliveryCatchUp(deliveries, actualGameSpeed, sevenMinMs),
  );
  assert(onlineCompleted === 3, 'online 7dk: 3 teslimat tamamlanır', `count=${onlineCompleted}`);
  assert(
    offlineCompleted === onlineCompleted,
    'offline 7dk: online ile aynı teslimat tamamlama sayısı',
    `online=${onlineCompleted} offline=${offlineCompleted}`,
  );
}

{
  const speed = getEffectiveOfflineGameSpeed({ gameSpeed: 0, lastSimulationGameSpeed: 2 });
  assert(speed === 2, 'pause/0 speed durumunda lastSimulationGameSpeed kullanılır');
}

console.log('\n10. Offline meta & summary accuracy');
{
  const now = Date.now();
  const baseline = resolveOfflineBaselineMs({
    stateLastSimulated: now - 60 * MS_MIN,
    metaLastSimulated: now - 30 * MS_MIN,
    stateLastSeen: now - 45 * MS_MIN,
    nowMs: now,
  });
  assert(baseline === now - 30 * MS_MIN, 'meta timestamp state\'ten yeniyse meta kullanılır');
}

{
  const now = Date.now();
  const metaBaseline = now - 40 * MS_MIN;
  const stateBaseline = now - 10 * MS_MIN;
  const chosen = resolveOfflineBaselineMs({
    stateLastSimulated: stateBaseline,
    metaLastSimulated: metaBaseline,
    stateLastSeen: now - 50 * MS_MIN,
    nowMs: now,
  });
  assert(chosen === stateBaseline, 'state timestamp daha yeniyse state kullanılır');
}

{
  const before = createOfflineProgressSnapshot({
    player: basePlayer({ money: 20_000, completedContracts: 3, drivers: [] }),
    activeDeliveries: [
      baseDelivery({ id: 'd1', progress: 0.8 }),
      baseDelivery({ id: 'd2', progress: 0.8 }),
    ],
    currentTime: 100,
    worldEvents: [],
    lastWorldEventGeneratedDay: 1,
    cities: CITIES,
    financeLedger: [{ id: 'old1', time: 90, type: 'expense', category: 'fuel', amount: 100 }],
  });
  const afterLedger: FinanceLedgerEntry[] = [
    { id: 'old1', time: 90, type: 'expense', category: 'fuel', amount: 100 },
    {
      id: 'new1',
      time: 110,
      type: 'income',
      category: 'contract_income',
      amount: 3750,
      relatedDeliveryId: 'd1',
    },
    {
      id: 'new2',
      time: 110,
      type: 'income',
      category: 'contract_income',
      amount: 3750,
      relatedDeliveryId: 'd2',
    },
    { id: 'new3', time: 110, type: 'expense', category: 'maintenance', amount: 200, relatedDeliveryId: 'd1' },
    { id: 'new4', time: 110, type: 'expense', category: 'daily_operating_cost', amount: 500 },
  ];
  const elapsed = calculateOfflineElapsed(Date.now() - 30 * MS_MIN, Date.now());
  const summary = buildOfflineProgressSummary(
    before,
    {
      player: basePlayer({ money: 26_700, completedContracts: 5, drivers: [] }),
      activeDeliveries: [],
      currentTime: 130,
      worldEvents: [],
      lastWorldEventGeneratedDay: 1,
      cities: CITIES,
      financeLedger: afterLedger,
    },
    elapsed,
  );
  assert(summary.completedDeliveries === 2, '2 teslimat offline summary completed=2');
  assert(summary.earnings === 7500, 'delivery payment summary earnings', `earnings=${summary.earnings}`);
  assert(summary.expenses === 700, 'fuel/maintenance/daily summary expenses', `expenses=${summary.expenses}`);
  assert(summary.netChange === 6700, 'netChange afterMoney-beforeMoney', `net=${summary.netChange}`);
  assert(validateOfflineSummaryConsistency(summary), 'ledger tabanlı summary tutarlı');
}

{
  const badSummary = {
    elapsedMs: 1000,
    appliedMs: 1000,
    capped: false,
    completedDeliveries: 1,
    lateDeliveries: 0,
    earnings: 0,
    expenses: 2570,
    otherNetChange: -5820,
    netChange: -8390,
    driverLevelUps: [],
    worldEventsUpdated: false,
    marketUpdated: false,
    dailyCostsApplied: true,
    hasMeaningfulChanges: true,
    ledgerEntryCount: 1,
  };
  assert(!validateOfflineSummaryConsistency(badSummary), 'kazanç 0 masraf 2570 net -8390 tutarsız summary fail');
}

{
  const earnings = 7500;
  const expenses = 2570;
  const net = earnings - expenses;
  const goodSummary = buildOfflineProgressSummary(
    createOfflineProgressSnapshot({
      player: basePlayer({ money: 10_000, completedContracts: 1, drivers: [] }),
      activeDeliveries: [baseDelivery({ id: 'd1' })],
      currentTime: 100,
      worldEvents: [],
      lastWorldEventGeneratedDay: 1,
      cities: CITIES,
      financeLedger: [],
    }),
    {
      player: basePlayer({ money: 10_000 + net, completedContracts: 2, drivers: [] }),
      activeDeliveries: [],
      currentTime: 120,
      worldEvents: [],
      lastWorldEventGeneratedDay: 1,
      cities: CITIES,
      financeLedger: [
        {
          id: 'inc1',
          time: 110,
          type: 'income',
          category: 'contract_income',
          amount: earnings,
          relatedDeliveryId: 'd1',
        },
        { id: 'exp1', time: 110, type: 'expense', category: 'daily_operating_cost', amount: expenses },
      ],
    },
    calculateOfflineElapsed(Date.now() - 30 * MS_MIN, Date.now()),
  );
  assert(goodSummary.netChange === net, 'kazanç-masraf=net tutarlı', `net=${goodSummary.netChange}`);
  assert(validateOfflineSummaryConsistency(goodSummary), 'tutarlı summary geçer');
}

console.log(`\n${'='.repeat(48)}`);
console.log(`Passed: ${passed}, Failed: ${failed}`);
if (failed > 0) {
  process.exit(1);
}

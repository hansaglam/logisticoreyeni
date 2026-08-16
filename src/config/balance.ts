/**
 * LogistiCore - Merkezi oyun dengeleme ayarları
 *
 * Yakıt, sözleşme, teslimat, kamyon, depo ve finans sabitleri burada toplanır.
 * Seviye kilitleri levelConfig.ts üzerinden türetilir.
 */

import {
  getMinLevelForWarehouseCount,
  levelConfig,
} from './levelConfig';
import { contractLevelBalance } from './contractLevelBalance';

export { contractLevelBalance } from './contractLevelBalance';
export type { ContractLevelBalance } from './contractLevelBalance';

/** Simulation zaman ölçeğinin tek kaynağı — gerçek ms / simulation saati. */
export const simulationTimeScale = {
  normalMsPerGameHour: 15_000,
  fastMsPerGameHour: 7_500,
  debugMsPerGameHour: 1_000,
  tickMs: 1_000,
  maxGameSpeed: 8,
} as const;

/** Bir operasyon saatinin oyuncunun beklediği gerçek zaman karşılığı. */
export const SIMULATION_MS_PER_TRAVEL_HOUR =
  simulationTimeScale.normalMsPerGameHour;

/** Ağır taşıt seyir hızı — bütün simulation ve ETA tüketicilerinin balance kaynağı. */
export const vehicleSpeedBalance = {
  baseAverageSpeedKmh: {
    'light-truck': 80,
    'medium-truck': 70,
    'heavy-truck': 62,
    tractor: 65,
    'special-heavy': 55,
  },
  trailerMultiplier: {
    standard: 0.94,
    refrigerated: 0.93,
    heavy: 0.88,
    container: 0.94,
  },
  /** Route roadType metadata henüz yok; V1 bütün rotalarda aynı ortalama kullanır. */
  routeAverageMultiplier: 0.93,
  roadTypeMultiplier: {
    motorway: 1,
    'divided-road': 0.94,
    'standard-road': 0.88,
    'mountain-road': 0.78,
    'urban-entry': 0.65,
  },
  driverTierMultiplier: {
    rookie: 0.96,
    standard: 1,
    experienced: 1.03,
    expert: 1.05,
    international: 1.05,
  },
  minMovingSpeedKmh: 35,
  maxOperationSpeedKmh: 90,
  minCatalogPerformanceMultiplier: 0.94,
  maxCatalogPerformanceMultiplier: 1.06,
  minExternalModifier: 0.75,
  maxExternalModifier: 1.1,
} as const;

/** @deprecated Zaman sabitleri için simulationTimeScale kullanın. */
export const timeBalance = {
  ...simulationTimeScale,
  hoursPerDay: 24,
  daysPerWeek: 7,
  daysPerMonth: 30,
} as const;

/** Günlük operasyon giderleri */
export const operatingCostBalance = {
  /** Eski kayıtlar için şoför günlük maaş fallback ($) */
  fallbackDriverDailySalary: 120,
  /** Eski kayıtlar için depo günlük işletme fallback ($) */
  fallbackWarehouseDailyCost: 250,
  /** Genel operasyon tabanı ($/gün) */
  dailyOperationsBase: 80,
  /** Kamyon başına ek operasyon ($/gün) */
  operationsPerOwnedTruck: 25,
  /** Şoför başına ek operasyon ($/gün) */
  operationsPerDriver: 15,
  /** Haftalık kira süresi (oyun saati) */
  leaseDurationHours: 7 * 24,
  /**
   * Offline sabit işletme gideri kapalı (0 = cold start / background dönüşünde kesim yok).
   * Uygulama açıkken günlük gider advanceTime üzerinden çalışmaya devam eder.
   * Catch-up uses OFFLINE_CATCHUP_MAX_COST_PERIODS (= 0) in periodicCosts.ts.
   */
  maxOfflineChargeDays: 0,
  /** advanceTime başına en fazla ledger kaydı */
  maxDailyCostEntriesPerAdvance: 1,
  /** Çok günlük kesimde bildirim — offline gider sistemi kaldırıldığı için kapalı */
  notifyWhenMultipleDaysCharged: false,
  /**
   * Offline operasyon progress tavanı (simulation saati).
   * Gerçek elapsed penceresi de aynı sayısal saatle ayrıca sınırlandırılır;
   * gider period cap'i bundan bağımsızdır.
   */
  maxOfflineProgressHours: 24,
  /** Soft-lock kurtarma: nakit bu eşiğin altındayken acil işler */
  softLockCashThreshold: 0,
  /** Acil operasyon sözleşmesi cooldown (gerçek ms) */
  emergencyContractCooldownMs: 30 * 60 * 1000,
  /** Aynı anda en fazla acil sözleşme */
  maxEmergencyContracts: 2,
  /** Development offline/contract audit logları */
  economyAuditLogsEnabled: false,
} as const;

export function getMsPerGameHour(gameSpeed: number): number {
  if (gameSpeed >= 6) {
    return timeBalance.debugMsPerGameHour;
  }
  if (gameSpeed >= 1.5) {
    return timeBalance.fastMsPerGameHour;
  }
  return timeBalance.normalMsPerGameHour;
}

/** Gerçek zaman (ms) → oyun saati — online tick ve offline catch-up için tek kaynak */
export function realMsToGameHours(realElapsedMs: number, gameSpeed = 1): number {
  if (realElapsedMs <= 0) {
    return 0;
  }
  return realElapsedMs / getMsPerGameHour(gameSpeed);
}

/** Aktif oyun döngüsü tick aralığı (ms) */
export const GAME_LOOP_TICK_MS = simulationTimeScale.tickMs;

export function getGameHoursPerTick(gameSpeed: number): number {
  return realMsToGameHours(GAME_LOOP_TICK_MS, gameSpeed);
}

export function getGameHoursPerRealMinute(gameSpeed: number): number {
  return realMsToGameHours(60_000, gameSpeed);
}

export function getEffectiveOfflineGameSpeed(state: {
  gameSpeed?: number;
  lastSimulationGameSpeed?: number;
}): number {
  const current =
    typeof state.gameSpeed === 'number' && Number.isFinite(state.gameSpeed) && state.gameSpeed > 0
      ? state.gameSpeed
      : undefined;
  const lastActive =
    typeof state.lastSimulationGameSpeed === 'number' &&
    Number.isFinite(state.lastSimulationGameSpeed) &&
    state.lastSimulationGameSpeed > 0
      ? state.lastSimulationGameSpeed
      : undefined;
  return Math.max(
    0.25,
    Math.min(current ?? lastActive ?? 1, simulationTimeScale.maxGameSpeed),
  );
}

export interface TimeScaleDebugSnapshot {
  gameSpeed: number;
  msPerGameHour: number;
  gameHoursPerTick: number;
  tickMs: number;
  gameHoursPerRealMinute: number;
}

export function buildTimeScaleDebugSnapshot(
  gameSpeed: number,
  tickMs = GAME_LOOP_TICK_MS,
): TimeScaleDebugSnapshot {
  const msPerGameHour = getMsPerGameHour(gameSpeed);
  return {
    gameSpeed,
    msPerGameHour,
    gameHoursPerTick: realMsToGameHours(tickMs, gameSpeed),
    tickMs,
    gameHoursPerRealMinute: realMsToGameHours(60_000, gameSpeed),
  };
}

export const economyBalance = {
  /** Varsayılan yakıt fiyatı ($/L) */
  baseFuelPrice: 1.72,
  /** Günlük piyasa dalgalanması — createRandomFactor için */
  fuelVolatility: 0.08,
  /** Tek seferde maksimum yakıt fiyat değişim oranı (refuelOrUpdateFuelPrice) */
  maxDailyFuelChange: 0.04,
  /** Yol kenarı tedarik litre fiyatı; istasyon fiyatına göre sınırlı premium. */
  roadsideFuelPriceMultiplier: 1.2,
  /** Yol yardım aracının sabit servis bedeli ($). */
  roadsideFuelServiceBaseFee: 75,
  /** Soft-lock yardımı ve acil dolum için minimum anlamlı yakıt miktarı. */
  minimumEmergencyFuelLiters: 15,
  /** Ücretsiz sınırlı yardımın global oyun zamanı cooldown'ı. */
  roadsideAssistanceCooldownHours: 24,
  /** Oyun başlangıcı küresel talep çarpanı */
  globalDemandDefault: 1,
  /** Oyun başlangıcı küresel üretim çarpanı */
  globalProductionDefault: 1,
  /** Şehir fiyat güncellemelerinde piyasa oynaklığı */
  marketVolatility: 0.08,
} as const;

export const contractBalance = {
  /** Temel taşıma ödemesi: amount × referencePrice × oran */
  baseTransportRate: 0.15,
  /** Mesafe ödemesi: distanceKm × amount × oran */
  distancePaymentRate: 0.35,
  /** Aciliyet bonusu: basePayment × urgency × oran */
  urgencyBonusMultiplier: 0.35,
  /** Zorluk bonusu: basePayment × route.difficulty × oran */
  difficultyBonusMultiplier: 0.2,
  /** Yakıt ayarı: fuelPrice × distanceKm × oran */
  fuelAdjustmentMultiplier: 0.05,
  /** Ekonomi tick başına maksimum yeni sözleşme */
  maxContractsPerTick: 10,
  /** Müsait sözleşme sayısı bu değerin altına düşerse otomatik üretim tetiklenir */
  minAvailableContracts: 10,
  /** Müsait sözleşme üst sınırı */
  maxAvailableContracts: 24,
  /** Otomatik üretim hedefi — alt sınır */
  targetAvailableContractsMin: 15,
  /** Otomatik üretim hedefi — üst sınır */
  targetAvailableContractsMax: 20,
  /** Piyasa yenileme aralığı (gerçek ms) — Contracts ekranı */
  contractRefreshIntervalMs: 30_000,
  /** Her piyasa yenilemesinde eklenebilecek maksimum yeni sözleşme */
  contractsPerMarketRefresh: 2,
  /** Yeni oyun başlangıcı sözleşme sayısı — alt sınır */
  initialContractsMin: 12,
  /** Yeni oyun başlangıcı sözleşme sayısı — üst sınır */
  initialContractsMax: 20,
  /** Aynı rota + ürün için izin verilen available sözleşme sayısı */
  maxDuplicateContractsPerRouteProduct: 1,
  /** expiresAt = createdAt + deadlineHours × çarpan */
  contractExpiryHours: 1.5,
  /** Minimum ödeme tabanı: amount × referencePrice × oran */
  minContractPayment: 0.08,
  /** Maksimum ödeme tavanı: amount × referencePrice × oran */
  maxContractPaymentMultiplier: 2.5,
  /** Deadline hesabında ortalama hız (km/saat) */
  averageSpeedKmh: 60,
  /** Yükleme + boşaltma sabit operasyon süresi (saat) */
  baseHandlingHours: 1.25,
  /** Ton başına ek yükleme/boşaltma süresi (saat) */
  handlingHoursPerTon: 0.025,
  /** Her kesintisiz sürüş bloğu (saat) */
  drivingBlockHours: 4.5,
  /** Sürüş bloğu başına dinlenme/operasyon payı (saat) */
  restHoursPerDrivingBlock: 0.5,
  /** Minimum teslim süresi (saat) */
  minDeadlineHours: 4,
  /** Maksimum teslim süresi (saat) */
  maxDeadlineHours: 168,
  /** Sözleşme maliyet tahmininde varsayılan yakıt tüketimi (L/km) */
  estimateFuelPerKm: 0.32,
  /** Sözleşme maliyet tahmininde varsayılan bakım ($/km) */
  estimateMaintenancePerKm: 0.4,
  /** Operasyon payı: distanceKm × oran */
  operationsCostPerKm: 0.12,
  /** Ürün değeri risk payı: amount × referencePrice × oran */
  cargoValueRiskRate: 0.015,
  /** Kolay/kısa iş hedef net kâr marjı */
  profitMarginEasyMin: 0.12,
  profitMarginEasyMax: 0.22,
  /** Orta iş hedef net kâr marjı */
  profitMarginMediumMin: 0.18,
  profitMarginMediumMax: 0.32,
  /** Riskli/acil iş hedef net kâr marjı */
  profitMarginRiskyMin: 0.12,
  profitMarginRiskyMax: 0.28,
  /** Büyük seviye işi hedef net kâr marjı */
  profitMarginLargeMin: 0.22,
  profitMarginLargeMax: 0.38,
  /** Büyük iş tonaj eşiği */
  largeContractTonnage: 22,
} as const;

/** Teslimat maliyet çarpanları — yakıt, bakım, elleçleme */
export const deliveryCostBalance = {
  fuelCostMultiplier: 1.25,
  maintenanceCostMultiplier: 1.35,
  cargoHandlingCostPerTon: 18,
  routeDifficultyCostPerKm: 0.07,
  routeDifficultyCostMultiplier: 1.15,
  riskReserveLow: 0.04,
  riskReserveMedium: 0.08,
  riskReserveHigh: 0.14,
  urgentMarginBonusMin: 0.05,
  urgentMarginBonusMax: 0.12,
  marketOpportunityMarginBonusMin: 0.08,
  marketOpportunityMarginBonusMax: 0.18,
} as const;

/** Seviye bazlı ödeme tavanları ve minimum net kâr tabanları */
export const contractPaymentBalance = {
  minProfitMargin: 0.1,
  maxProfitMargin: 0.5,
  absolutePaymentMax: 65_000,
  highPaymentThreshold: 20_000,
  highPaymentMinRequiredLevel: 3,
  highPaymentMinTonnage: 40,
  highLevelCapScalePerLevel: 0.12,
  levelCaps: {
    1: {
      paymentMin: 2_000,
      paymentMax: 8_000,
      urgentPaymentMax: 12_000,
      minNetProfit: 350,
      maxTypicalNetProfit: 3_000,
    },
    2: {
      paymentMin: 3_000,
      paymentMax: 12_000,
      urgentPaymentMax: 16_000,
      minNetProfit: 500,
      maxTypicalNetProfit: 4_500,
    },
    3: {
      paymentMin: 5_000,
      paymentMax: 18_000,
      urgentPaymentMax: 24_000,
      minNetProfit: 750,
      maxTypicalNetProfit: 6_500,
    },
    4: {
      paymentMin: 8_000,
      paymentMax: 28_000,
      urgentPaymentMax: 35_000,
      minNetProfit: 1_000,
      maxTypicalNetProfit: 9_000,
    },
    5: {
      paymentMin: 12_000,
      paymentMax: 40_000,
      urgentPaymentMax: 50_000,
      minNetProfit: 1_400,
      maxTypicalNetProfit: 12_000,
    },
  },
} as const;

/** Kademeli sözleşme üretim zamanlaması */
export const contractGenerationBalance = {
  minAvailableContracts: 10,
  targetAvailableContracts: 16,
  maxAvailableContracts: 24,

  smallGenerationIntervalHours: 3,
  mediumGenerationIntervalHours: 6,
  dailyCleanupIntervalHours: 24,

  minContractsPerSmallTick: 1,
  maxContractsPerSmallTick: 3,

  minContractsPerMediumTick: 3,
  maxContractsPerMediumTick: 6,

  maxContractsGeneratedAtOnce: 6,

  /** Tek advanceTime çağrısında işlenecek maksimum küçük tick (3s) */
  maxSmallTicksProcessedAtOnce: 4,
  /** Tek advanceTime çağrısında işlenecek maksimum orta tick (6s) */
  maxMediumTicksProcessedAtOnce: 3,
  /** Günlük cleanup — elapsed ne olursa olsun tek sefer */
  maxDailyCleanupTicksProcessedAtOnce: 1,

  /** Yeni oyun başlangıcı sözleşme sayısı — alt sınır */
  initialContractsMin: 12,
  /** Yeni oyun başlangıcı sözleşme sayısı — üst sınır */
  initialContractsMax: 15,

  /** Manuel piyasa yenilemede eklenebilecek maksimum (düşük stokta) */
  manualRefreshMaxContracts: 3,

  /** Çıkış şehri seçim ağırlıkları — skor bonusu olarak uygulanır */
  originCityWeights: {
    idleTruckCity: 45,
    activeDeliveryDestinationCity: 30,
    busyTruckCity: 15,
    marketOpportunityCity: 20,
    otherCity: 5,
  },

  /** Boşta kamyon bulunan her şehirden minimum alınabilir iş sayısı */
  minAvailableContractsPerIdleTruckCity: 2,
  /** Toplam minimum alınabilir (playable) sözleşme sayısı */
  minTotalPlayableContracts: 4,
  /** Global minimum müsait iş ilanı (eligible olmasa da listede görünür) */
  minGlobalEligibleContracts: 6,
  /** Oyuncu seviyesine uygun minimum müsait iş */
  minPlayerLevelEligibleContracts: 2,
  /** Bootstrap / acil yenilemede tek geçişte üretilebilecek üst sınır */
  bootstrapMaxContractsPerPass: 8,
  /** Uzun bekleme sonrası zorunlu playable üretim eşiği (oyun saati) */
  playableContractFallbackHours: 1,
  /** Tek seferde üretilebilecek maksimum playable sözleşme */
  maxPlayableContractsGeneratedAtOnce: 2,
  /** Manuel yenileme cooldown (oyun saati) — playable varken */
  manualRefreshCooldownHours: 3,
  /** Playable yokken manuel yenilemede üretilecek iş sayısı üst sınırı */
  manualRefreshPlayableContractCount: 2,

  /** Standard işlerde canonical minimum net marj (kâr / ödeme) */
  standardMinimumMargin: 0.12,
  /** Özel/riskli işlerde izin verilen kontrollü minimum marj */
  specialMinimumMargin: -0.05,
  /** Üretilen havuzda riskli/negatif özel işlerin üst sınırı */
  maxRiskyNegativeShare: 0.1,
} as const;

/** Sözleşme teklif süresi (oyun saati) — iş tipine göre */
export const contractExpiryBalance = {
  urgentMinHours: 6,
  urgentMaxHours: 10,
  normalMinHours: 12,
  normalMaxHours: 20,
  longMinHours: 18,
  longMaxHours: 30,
} as const;

export const deliveryBalance = {
  /** Sözleşme/tahmin ekranlarında varsayılan ortalama hız (km/saat) */
  defaultAverageSpeed: 60,
  /** UI yakıt tahmini: distanceKm × fuelPrice × oran */
  fuelCostEstimateMultiplier: 0.42,
  /**
   * Şoför allocated maliyet çarpanı (saatlik = maaş/24).
   * Model A: yalnız bilgilendirici; nakit kesinti periodic salary ile yapılır.
   */
  driverCostMultiplier: 1,
  /** UI bakım tahmini: distanceKm × oran × routeDifficulty */
  maintenanceCostPerKm: 0.35,
  /** Düşük risk rezervi: payment × oran */
  riskReserveLow: 0.02,
  /** Orta risk rezervi: payment × oran */
  riskReserveMedium: 0.05,
  /** Yüksek risk rezervi: payment × oran */
  riskReserveHigh: 0.1,
  /** Şoför yoksa kullanılan günlük maaş fallback ($) */
  fallbackDriverSalaryPerDay: 240,
} as const;

export const fleetManagementBalance = {
  /** Galeriden çıkar çıkmaz oluşan amortisman; anlık al-sat kârını engeller. */
  truckBaseResaleRate: 0.68,
  minTruckResaleRate: 0.18,
  maxTruckResaleRate: 0.78,
  mileageDepreciationReferenceKm: 200_000,
  maxMileageDepreciationRate: 0.38,
  maxAgeDepreciationRate: 0.12,
  upgradeRecoveryRate: 0.35,
  minMarketResaleModifier: 0.85,
  maxMarketResaleModifier: 1.1,
  trailerBaseResaleRate: 0.62,
  minTrailerResaleRate: 0.15,
  maxTrailerResaleRate: 0.7,
  driverSeveranceDays: 2,
} as const;

/** Oyuncular arası araç pazarı V1 ücret ve fiyat korumaları. */
export const vehicleMarketplaceBalance = {
  /** İlan açılırken bir kez alınan sabit ücret. */
  vehicleMarketplaceListingFee: 150,
  /** Satış bedelinden satıcıya ödeme yapılmadan önce kesilen komisyon. */
  vehicleMarketplaceSaleFeeRate: 0.06,
  /** Aktif ilanın ömrü. */
  vehicleMarketplaceListingDurationHours: 72,
  /** İlan fiyatının canonical ikinci el değerine göre alt sınırı. */
  vehicleMarketplaceMinPriceRatio: 0.7,
  /** İlan fiyatının canonical ikinci el değerine göre üst sınırı. */
  vehicleMarketplaceMaxPriceRatio: 1.35,
  /** Backend action receipt/idempotency kayıtlarının TTL süresi. */
  vehicleMarketplaceIdempotencyRetentionDays: 30,
  /** V1 canonical marketplace fleet slot sınırı. */
  vehicleMarketplaceDefaultFleetLimit: 20,
} as const;

export const truckBalance = {
  /** Temel kondisyon aşınması (baseWear) */
  baseConditionWear: 1.2,
  /** Normal teslimat maksimum kondisyon kaybı */
  maxNormalConditionLoss: 18,
  /** Ağır yük / zor rota maksimum kondisyon kaybı */
  maxHardConditionLoss: 20,
  /** Düşük maintenanceCost kamyonlarda tamir: missingCondition × oran */
  repairFallbackCostPerCondition: 35,
  /** maintenanceCost yoksa tamir: missingCondition × oran */
  repairFallbackCostPerConditionAlt: 40,
  /** Minimum tamir ücreti ($) */
  minRepairCost: 100,
  /** delivery.conditionLoss yoksa fallback kayıp */
  conditionLossFallback: 5,
  /** Ağır yük eşiği (yük/kapasite) */
  heavyLoadRatio: 0.85,
  /** Zor rota eşiği (route.difficulty) */
  hardRouteDifficulty: 0.85,
} as const;

export const warehouseBalance = {
  /** Tahmini depo açılış maliyeti tabanı ($) */
  baseOpenCost: 8000,
  /** Tahmini günlük kira tabanı ($) */
  baseDailyRent: 180,
  /** Finans ekranında depo değeri: capacityTons × oran */
  capacityValueMultiplier: 20,
  /** Şehir warehouseCostModifier çarpanı (taban 1) */
  dailyCostMultiplier: 1,
  /** Günlük kira: capacityTons × oran × modifier */
  rentPerTon: 1.8,
  /** Günlük elektrik: capacityTons × oran × modifier */
  electricityPerTon: 0.25,
  /** Günlük personel maliyeti (seviye başına) */
  staffCostPerLevel: 140,
  /** Soğuk depo açılış maliyeti çarpanı */
  coldOpenCostMultiplier: 1.6,
  /** Soğuk depo günlük elektrik çarpanı */
  coldElectricityMultiplier: 2.5,
  /** Depo yükseltme maliyeti: baseOpenCost × oran × şehir modifier */
  upgradeCostRatio: 0.5,
} as const;

export const warehouseStorageBalance = {
  standardProtection: 0.5,
  coldProtection: 1,
  secureProtection: 0.9,
  heavyProtection: 0.8,
  minQuality: 0,
  maxQuality: 100,
  lowQualityWarningThreshold: 70,
  criticalQualityWarningThreshold: 40,
  /** Aynı ürün için kalite uyarısı tekrar aralığı (oyun saati) */
  qualityWarningCooldownHours: 24,
} as const;

export const tradingBalance = {
  minTradeQuantity: 5,
  defaultTradeQuantity: 10,
  maxTradeQuantity: 50,
  /** Depo alım işlem gideri (piyasa arbitrajını törpüler) */
  warehouseBuyFeeRate: 0.03,
  /** Depo satım işlem gideri */
  warehouseSellFeeRate: 0.03,
  minProfitHintPercent: 8,
  highProfitHintPercent: 20,
  /** Yeni depo varsayılan kapasitesi (ton) */
  defaultWarehouseCapacityTons: 80,
} as const;

export const marketAlertBalance = {
  /** Aynı anda aktif alarm üst sınırı */
  maxActiveAlerts: 10,
  /** Varsayılan hatırlatma bildirimi gecikmesi (dakika) */
  defaultReminderDelayMinutes: 45,
  /** Minimum hatırlatma gecikmesi (dakika) */
  minReminderDelayMinutes: 30,
  /** Maksimum hatırlatma gecikmesi (dakika) */
  maxReminderDelayMinutes: 60,
  /** Alarm süresi — oyun saati (30 gün) */
  defaultExpiryGameHours: 30 * 24,
} as const;

export const financeBalance = {
  /**
   * Zorunlu giderler sonrası izin verilen minimum nakit ($).
   * Bu tabana düşmek soft-lock riski yaratır — acil operasyon sözleşmeleri ile kurtarılır.
   */
  minCashBalance: -5_000,
  /** Soft-lock kurtarma eşiği — bu nakit altında acil işler açılır */
  softLockRecoveryThreshold: 0,
  /** Hard floor'da tek seferlik yardım sonrası hedef pozitif nakit ($). */
  softLockRecoveryCashTarget: 500,
  /** Kritik nakit eşiği ($) */
  lowCashThreshold: 5000,
  /** Net kâr negatifken sağlık cezası */
  healthPenaltyNegativeProfit: 10,
  /** Düşük nakitte sağlık cezası */
  healthPenaltyLowCash: 25,
  /** Sabit giderler nakite göre yüksekken sağlık cezası (her eşik) */
  healthPenaltyHighFixedCosts: 10,
  /** Düşük ortalama kamyon kondisyonunda sağlık cezası */
  healthPenaltyLowTruckCondition: 15,
  /** Kamyon kondisyonu uyarı eşiği */
  truckConditionThreshold: 60,
  /** Sabit gider / nakit uyarı oranı */
  fixedCostWarnRatio: 0.05,
  /** Sabit gider / nakit yüksek uyarı oranı */
  fixedCostHighRatio: 0.1,
  /** Yakıt fiyat artış uyarısı: baseFuelPrice × oran */
  fuelPriceSpikeRatio: 1.1,
  /** Bakım maruziyeti risk faktörü */
  maintenanceRiskFactor: 0.05,
  /** İtibar puanı şirket değeri çarpanı ($/puan) */
  reputationValuePerPoint: 100,
} as const;

/**
 * İtibar puanı — teslimat sonuçlarına göre kazanım/kayıp.
 * Canonical kurallar: src/config/reputationRules.ts
 */
import {
  INITIAL_REPUTATION,
  REPUTATION_MAX,
  REPUTATION_MIN,
  REPUTATION_RULES,
} from './reputationRules';

export const reputationBalance = {
  /** Yeni oyunda başlangıç itibarı */
  initial: INITIAL_REPUTATION,
  /** Zamanında tamamlanan teslimat kazancı */
  onTimeDeliveryGain: REPUTATION_RULES.deliveryOnTime,
  /** Başarısız teslimat kaybı */
  failedDeliveryLoss: Math.abs(REPUTATION_RULES.deliveryFailed),
  /** Alt sınır */
  min: REPUTATION_MIN,
  /** Üst sınır */
  max: REPUTATION_MAX,
} as const;

/** Şirket puanı (Company Score) v2 — leaderboard ile aynı ölçek. */
export const companyScoreBalance = {
  scoreVersion: 2,
  minCompletedDeliveriesToRank: 3,
  reputationBaseline: 50,
  truckValueWeight: 0,
  warehouseValueWeight: 0,
  inventoryValueWeight: 0,
  completedContractBonus: 380,
  reputationBonusPerPoint: 0,
  levelBonusPerLevel: 720,
  weeklyTradeProfitWeight: 0,
  failedDeliveryPenalty: 320,
  lateDeliveryPenalty: 110,
  weeklyHours: 168,
  warehouseTierBonusRate: 0.15,
} as const;

export const levelBalance = {
  maxLevel: levelConfig.maxLevel,
  contractTonnageByLevel: levelConfig.contractUnlocks.map(({ level, maxTonnage }) => ({
    level,
    maxTonnage,
  })),
  truckUnlockLevels: { ...levelConfig.truckUnlocks },
  warehouseUnlockLevels: {
    openSecondWarehouse: getMinLevelForWarehouseCount(1),
    openThirdWarehouse: getMinLevelForWarehouseCount(2),
    largeWarehouse: levelConfig.warehouseUnlocks.largeWarehouseLevel,
  },
  xpRewards: {
    truckPurchase: levelConfig.xpRewards.truckPurchase,
    driverHire: levelConfig.xpRewards.driverHire,
    warehouseOpen: levelConfig.xpRewards.warehouseOpen,
    warehouseUpgrade: levelConfig.xpRewards.warehouseUpgrade,
  },
} as const;

/** Tüm denge grupları — tek import noktası */
export const balanceConfig = {
  time: timeBalance,
  operatingCost: operatingCostBalance,
  economy: economyBalance,
  contract: contractBalance,
  contractGeneration: contractGenerationBalance,
  contractExpiry: contractExpiryBalance,
  contractLevel: contractLevelBalance,
  contractPayment: contractPaymentBalance,
  delivery: deliveryBalance,
  deliveryCost: deliveryCostBalance,
  fleetManagement: fleetManagementBalance,
  truck: truckBalance,
  warehouse: warehouseBalance,
  finance: financeBalance,
  trading: tradingBalance,
  marketAlert: marketAlertBalance,
  level: levelBalance,
} as const;

export type TimeBalance = typeof timeBalance;
export type OperatingCostBalance = typeof operatingCostBalance;
export type EconomyBalance = typeof economyBalance;
export type ContractBalance = typeof contractBalance;
export type ContractGenerationBalance = typeof contractGenerationBalance;
export type ContractExpiryBalance = typeof contractExpiryBalance;
export type DeliveryBalance = typeof deliveryBalance;
export type FleetManagementBalance = typeof fleetManagementBalance;
export type TruckBalance = typeof truckBalance;
export type WarehouseBalance = typeof warehouseBalance;
export type FinanceBalance = typeof financeBalance;
export type TradingBalance = typeof tradingBalance;
export type MarketAlertBalance = typeof marketAlertBalance;
export type LevelBalance = typeof levelBalance;
export type BalanceConfig = typeof balanceConfig;

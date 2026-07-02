/**
 * LogistiCore - Merkezi oyun dengeleme ayarları
 *
 * Yakıt, sözleşme, teslimat, kamyon, depo ve finans sabitleri burada toplanır.
 * Davranış değişikliği yapmadan mevcut magic number değerleri korunmuştur.
 */

export const economyBalance = {
  /** Varsayılan yakıt fiyatı ($/L) */
  baseFuelPrice: 1.72,
  /** Günlük piyasa dalgalanması — createRandomFactor için */
  fuelVolatility: 0.08,
  /** Tek seferde maksimum yakıt fiyat değişim oranı (refuelOrUpdateFuelPrice) */
  maxDailyFuelChange: 0.04,
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
  /** Minimum teslim süresi (saat) */
  minDeadlineHours: 4,
  /** Maksimum teslim süresi (saat) */
  maxDeadlineHours: 168,
} as const;

export const deliveryBalance = {
  /** Sözleşme/tahmin ekranlarında varsayılan ortalama hız (km/saat) */
  defaultAverageSpeed: 60,
  /** UI yakıt tahmini: distanceKm × fuelPrice × oran */
  fuelCostEstimateMultiplier: 0.35,
  /** Şoför maliyeti hesabında günlük maaş çarpanı (saatlik = maaş/24) */
  driverCostMultiplier: 1,
  /** UI bakım tahmini: distanceKm × oran × routeDifficulty */
  maintenanceCostPerKm: 0.08,
  /** Düşük risk rezervi: payment × oran */
  riskReserveLow: 0.02,
  /** Orta risk rezervi: payment × oran */
  riskReserveMedium: 0.05,
  /** Yüksek risk rezervi: payment × oran */
  riskReserveHigh: 0.1,
  /** Şoför yoksa kullanılan günlük maaş fallback ($) */
  fallbackDriverSalaryPerDay: 240,
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
} as const;

export const financeBalance = {
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

/** Tüm denge grupları — tek import noktası */
export const balanceConfig = {
  economy: economyBalance,
  contract: contractBalance,
  delivery: deliveryBalance,
  truck: truckBalance,
  warehouse: warehouseBalance,
  finance: financeBalance,
} as const;

export type EconomyBalance = typeof economyBalance;
export type ContractBalance = typeof contractBalance;
export type DeliveryBalance = typeof deliveryBalance;
export type TruckBalance = typeof truckBalance;
export type WarehouseBalance = typeof warehouseBalance;
export type FinanceBalance = typeof financeBalance;
export type BalanceConfig = typeof balanceConfig;

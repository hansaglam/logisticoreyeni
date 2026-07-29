/**
 * LogistiCore - Temel oyun tipleri
 *
 * Bu dosya oyunun veri modelini tanımlar. UI ve simülasyon mantığı
 * bu tipler üzerine inşa edilecektir.
 */

// ---------------------------------------------------------------------------
// Ürün kimlikleri
// ---------------------------------------------------------------------------

/** Oyundaki tüm ürün türlerinin benzersiz kimlikleri */
export type ProductId =
  | 'fruit' // Meyve
  | 'steel' // Çelik
  | 'electronics' // Elektronik
  | 'machinery' // Makine
  | 'textile' // Tekstil
  | 'furniture' // Mobilya
  | 'beverage'; // İçecek

/** Şehir kimliği — kayıt ve piyasa verisinde string id */
export type CityId = string;

/** Depo türleri — ürün saklama uyumluluğu için */
export type WarehouseType =
  | 'standard'
  | 'cold'
  | 'secure'
  | 'heavy'
  | 'port'
  | 'airport';

/** Ürünün depo türü gereksinimleri */
export interface ProductStorageRequirement {
  preferredWarehouseTypes: WarehouseType[];
  allowedWarehouseTypes: WarehouseType[];
  spoilageSensitive?: boolean;
  spoilageRatePerDay?: number;
  valueLossRatePerDay?: number;
}

/** Statik ürün tanımı — piyasa verisinden bağımsız meta bilgiler */
export interface Product {
  id: ProductId;
  /** Oyuncuya gösterilen Türkçe isim */
  name: string;
  /** Birim başına ağırlık (ton) — kamyon kapasitesi hesabında kullanılır */
  weightPerUnit: number;
  /** Kısa açıklama */
  description: string;
  /**
   * Bozulma / aciliyet riski (0–1).
   * Yüksek değer daha kısa teslim süresi gerektirir (meyve, içecek vb.).
   */
  perishability: number;
  /** Depo türü uyumluluğu ve bozulma/kalite kuralları */
  storageRequirement?: ProductStorageRequirement;
}

// ---------------------------------------------------------------------------
// Şehir ekonomisi
// ---------------------------------------------------------------------------

/** Bir şehirde belirli bir ürüne ait anlık piyasa verisi */
export interface CityProductState {
  /** Mevcut stok miktarı (ton) */
  stock: number;
  /** Hedef stok seviyesi — fiyat algoritması bu değere göre sapma ölçer */
  targetStock: number;
  /** Günlük üretim miktarı (ton/gün) — şehir profilinin taban üretim hızı */
  productionPerDay: number;
  /** Günlük tüketim miktarı (ton/gün) — şehir profilinin taban tüketim hızı */
  consumptionPerDay: number;
  /** Referans birim fiyatı ($) — dinamik fiyat hesabının tabanı */
  basePrice: number;
  /**
   * Güncel piyasa fiyatı ($).
   * Başlangıç verisinde yoksa simülasyon basePrice değerini kullanır.
   */
  currentPrice?: number;
  /**
   * Son fiyat güncellemeleri — mini trend grafikleri için (en fazla 12 nokta).
   */
  priceHistory?: number[];
}

/**
 * Simülasyon sırasında kullanılan ürün piyasa durumu.
 * currentPrice alanı her zaman tanımlıdır.
 */
export interface ProductMarket extends CityProductState {
  currentPrice: number;
}

/** Küresel ekonomi parametreleri — tüm şehirleri etkileyen dış faktörler */
export interface GlobalEconomy {
  /** Yakıt birim fiyatı ($/L) — ileride nakliye maliyetine bağlanacak */
  fuelPrice: number;
  /** Küresel talep çarpanı */
  globalDemandMultiplier: number;
  /** Küresel üretim çarpanı */
  globalProductionMultiplier: number;
  /** Aktif olay çarpanı (doğal afet, bayram, vb.) */
  eventMultiplier: number;
  /** Günlük rastgele dalgalanma genliği (0–1 arası, örn. 0.08 = ±%8) */
  marketVolatility: number;
  /**
   * Fiyat yumuşatma katsayısı (0–1).
   * Düşük değer = daha yavaş fiyat değişimi. Varsayılan: 0.2
   */
  priceSmoothing?: number;
}

export type GlobalMarketWorldStatus = 'stable' | 'volatile' | 'crisis';
export type GlobalSupplyDemandStatus = 'shortage' | 'balanced' | 'surplus';

export interface GlobalSupplyDemandEntry {
  supply: number;
  demand: number;
  status: GlobalSupplyDemandStatus;
}

export interface GlobalMarketMovement {
  cityId: CityId;
  productId: ProductId;
  price: number;
  previousPrice: number;
  movementPercent: number;
  direction: 'up' | 'down' | 'flat';
}

export interface GlobalMarketOpportunity {
  id: string;
  fromCityId: CityId;
  toCityId: CityId;
  productId: ProductId;
  buyPrice: number;
  sellPrice: number;
  marginPercent: number;
}

/** Backend tarafından epoch başına yalnız bir kez üretilen canonical dünya piyasası. */
export interface GlobalEconomySnapshot {
  version: number;
  configVersion: number;
  /** @deprecated configVersion kullanın. */
  economyConfigVersion: number;
  epoch: number;
  generatedAt: number;
  validUntil: number;
  fuelPricePerLiter: number;
  cityMarketPrices: Record<CityId, Partial<Record<ProductId, number>>>;
  supplyDemandState: Record<
    CityId,
    Partial<Record<ProductId, GlobalSupplyDemandEntry>>
  >;
  marketMovements: GlobalMarketMovement[];
  opportunities: GlobalMarketOpportunity[];
  marketMovementCount: number;
  globalOpportunityCount: number;
  worldStatus: GlobalMarketWorldStatus;
  activeEvents: WorldEvent[];
  modifiers: {
    fuelMultiplier: number;
    maintenanceMultiplier: number;
    demandMultiplier: number;
  };
}

export interface GlobalMarketHistoryEntry {
  epoch: number;
  generatedAt: number;
  cityId: CityId;
  productId: ProductId;
  price: number;
  supply: number;
  demand: number;
  movementPercent: number;
  activeEventIds: string[];
  configVersion: number;
}

export type GlobalMarketSyncStatus =
  | 'idle'
  | 'syncing'
  | 'online'
  | 'offline-cache'
  | 'error';

/**
 * Günlük ekonomi güncellemesinde kullanılan rastgele çarpanlar.
 * Testlerde sabit değer verilerek deterministik sonuç üretilebilir.
 */
export interface EconomyRandomFactors {
  production: number;
  consumption: number;
  price: number;
}

/** Şehir tanımı — demografik, sektörel ve ürün bazlı ekonomi verileri */
export interface City {
  id: string;
  name: string;
  population: number;
  /** 0–1 arası sanayi gelişmişlik seviyesi */
  industryLevel: number;
  /** 0–1 arası turizm yoğunluğu */
  tourismLevel: number;
  /** 0–1 arası tarım potansiyeli */
  agricultureLevel: number;
  /** Genel üretim katsayısı — tüm productionPerDay değerlerini ölçekler */
  productionMultiplier: number;
  /** Genel tüketim katsayısı — tüm consumptionPerDay değerlerini ölçekler */
  demandMultiplier: number;
  /** Yakıt fiyatına uygulanan bölgesel çarpan */
  fuelPriceModifier: number;
  /** Trafik zorluğu — teslim süresi hesabını etkiler (0–1) */
  trafficDifficulty: number;
  /** Depo kira maliyetine uygulanan bölgesel çarpan */
  warehouseCostModifier: number;
  /** Ürün bazlı stok, üretim, tüketim ve fiyat verileri */
  products: Record<ProductId, CityProductState>;
}

// ---------------------------------------------------------------------------
// Rota
// ---------------------------------------------------------------------------

/** İki şehir arasındaki nakliye hattı */
export interface Route {
  id: string;
  fromCityId: string;
  toCityId: string;
  /** Mesafe (km) — yakıt ve süre hesabının temel girdisi */
  distanceKm: number;
  /** Rota zorluğu (0–1) — yüksek değer daha yavaş teslimat ve daha fazla risk */
  difficulty: number;
  /** Geçiş / köprü / otoyol ücreti ($) */
  tollCost: number;
}

// ---------------------------------------------------------------------------
// Filo ve personel
// ---------------------------------------------------------------------------

/** Kamyon durumu */
export type TruckStatus =
  | 'idle'
  | 'on_route'
  | 'maintenance'
  | 'transferring'
  | 'out_of_fuel';

/** Kamyon sahiplik türü */
export type TruckOwnershipType = 'owned' | 'leased';

/** Kamyon kira dönemi */
export type TruckLeasePeriod = 'daily' | 'weekly' | 'monthly';

/** Oyuncuya ait bir kamyon */
export interface Truck {
  id: string;
  name: string;
  /** Maksimum yük kapasitesi (ton) */
  capacity: number;
  /** km başına yakıt tüketimi (L/km) */
  fuelConsumptionPerKm: number;
  /** Yakıt tank kapasitesi (L) — eski kayıtlarda otomatik atanır */
  fuelTankCapacityL?: number;
  /** Mevcut yakıt (L) */
  currentFuelL?: number;
  /** Kümülatif kilometre */
  totalMileageKm?: number;
  /** Temel sürüş hızı (km/saat) */
  speed: number;
  /** Güvenilirlik (0–100) — düşük değer arıza riskini artırır */
  reliability: number;
  /** km başına bakım maliyeti ($/km) — tamir hesabında düşük değerler için sabit çarpan kullanılır */
  maintenanceCost: number;
  /** Kabin konforu (0–100) */
  comfort: number;
  /** Araç kondisyonu (0–100) */
  condition: number;
  /** Satın alma fiyatı ($) */
  purchasePrice: number;
  /** Sahiplik türü — eski kayıtlarda owned kabul edilir */
  ownershipType?: TruckOwnershipType;
  /** Günlük kira ($) — kiralık kamyonlarda; yalnızca UI tahmini, cash'ten günlük kesilmez */
  leaseDailyCost?: number;
  /** Haftalık peşin kira ($) — kiralama anında tahsil edilir */
  leaseWeeklyCost?: number;
  /** Kira başlangıç zamanı (oyun saati) */
  leaseStartedAt?: number;
  /** Kira dönemi */
  leasePeriod?: TruckLeasePeriod;
  /** Kira bitiş zamanı (oyun saati) */
  leaseExpiresAt?: number | null;
  /** Kira süresi doldu — pasif */
  leaseExpired?: boolean;
  /** Mağaza katalog kimliği — aynı modelden birden fazla alımda instance id'den ayrılır */
  catalogId?: string;
  /** Kamyonun bulunduğu şehir */
  currentCityId: string;
  /** Ana üs / satın alındığı şehir — eski kayıtlarda yoksa currentCityId kullanılır */
  homeCityId?: string;
  status: TruckStatus;
  /** Toplam geliştirme seviyesi (0–3) */
  upgradeLevel?: number;
  /** Parça bazlı geliştirme seviyeleri (0–3) */
  upgrades?: TruckUpgrades;
}

/** Kamyon geliştirme parçaları */
export interface TruckUpgrades {
  engine: number;
  fuelEfficiency: number;
  cargo: number;
  durability: number;
}

/** Dorse türü */
export type TrailerType = 'standard' | 'heavy' | 'refrigerated' | 'container';

/** Dorse durumu */
export type TrailerStatus = 'idle' | 'attached' | 'in_use';

/** Oyuncuya ait dorse */
export interface Trailer {
  id: string;
  name: string;
  type: TrailerType;
  /** Taşıma kapasitesi bonusu (ton) */
  capacityBonusTons: number;
  /** Mağaza katalog kimliği */
  catalogId?: string;
  /** Uyumlu kargo ürün kimlikleri — V1 bilgi amaçlı */
  compatibleCargoTypes?: ProductId[];
  /** Uyumlu sözleşme türleri — V1 bilgi amaçlı */
  compatibleContractTypes?: ContractType[];
  /** Satın alma fiyatı ($) */
  purchasePrice: number;
  /** Kondisyon (0–100) */
  condition: number;
  /** Dorse bulunduğu şehir */
  city: string;
  status: TrailerStatus;
  /** Bağlı olduğu kamyon — boşta ise null */
  attachedTruckId?: string | null;
  /** Oyuncuya ait mi */
  isOwned: boolean;
  /** Satın alındığı oyun zamanı (saat) */
  createdAtGameTime: number;
}

/** Şoför kalite kademesi — levelConfig.driverUnlocks ile eşleşir */
export type DriverTier = 'rookie' | 'standard' | 'experienced' | 'expert' | 'international';

/** Gelecek özellik önizleme durumu */
export type FutureUnlockStatus = 'coming_soon' | 'available';

/** Şoför durumu */
export type DriverStatus = 'idle' | 'driving' | 'resting';

/** Oyuncuya ait bir şoför */
export interface Driver {
  id: string;
  name: string;
  /** Kalite kademesi — eski kayıtlarda yoksa rookie kabul edilir */
  tier?: DriverTier;
  /** İşe alım / havuz kilidi için gereken şirket seviyesi */
  requiredLevel?: number;
  /** Havuz katalog kimliği — işe alındığı şablon */
  poolId?: string;
  /** Deneyim seviyesi (0–100) */
  experience: number;
  /** Dikkat seviyesi (0–100) — düşük değer kaza/arıza riskini artırır */
  attention: number;
  /** Yakıt tasarrufu becerisi (0–100) — yüksek değer yakıt maliyetini düşürür */
  fuelSaving: number;
  /**
   * Hız eğilimi (-100 – +100).
   * Pozitif değer hızı artırır ve kaza riskini yükseltir; negatif değer yavaşlatır.
   */
  speed: number;
  /** Moral seviyesi (0–100) */
  morale: number;
  /** Günlük maaş ($) — salaryPerDay ile eş anlamlı */
  salaryPerDay: number;
  /** Günlük maaş ($) — yeni alan adı */
  dailySalary?: number;
  /** Haftalık maaş ($) — opsiyonel */
  weeklySalary?: number;
  /** Maaş ödeme periyodu */
  salaryPeriod?: 'daily' | 'weekly';
  /** İşe alım ücreti ($) — tek seferlik; eski kayıtlarda yoksa 0 */
  hireCost: number;
  /** Atandığı kamyon; boştaysa null */
  assignedTruckId: string | null;
  status: DriverStatus;
  /** Kalıcı şehir konumu — teslimat/transfer sonrası güncellenir */
  currentCityId?: string;
  /** Şoför XP — teslimatlarla kazanılır */
  xp?: number;
  /** Şoför seviyesi (1–5) */
  level?: number;
  /** Tamamlanan teslimat sayısı */
  completedDeliveries?: number;
  /** Zamanında teslim sayısı */
  onTimeDeliveries?: number;
  /** Uzmanlık alanı — seviye 5'te atanabilir */
  specialty?: DriverSpecialty;
}

/** Şoför uzmanlık alanları */
export type DriverSpecialty =
  | 'urgent'
  | 'fragile'
  | 'bulk'
  | 'long_route'
  | 'fuel_saver';

// ---------------------------------------------------------------------------
// Sözleşme
// ---------------------------------------------------------------------------

/** Sözleşme yaşam döngüsü durumları */
export type ContractStatus =
  | 'available'
  | 'active'
  | 'completed'
  | 'expired'
  | 'failed';

/** Sözleşme tipi — risk/ödül çeşitliliği */
export type ContractType =
  | 'standard'
  | 'urgent'
  | 'fragile'
  | 'high_reputation'
  | 'bulk'
  | 'refrigerated';

/** Sözleşme risk seviyesi */
export type ContractRiskTier = 'low' | 'medium' | 'high';

/**
 * Dinamik olarak oluşan taşıma sözleşmesi.
 * GDD'ye göre sabit görev listesi yok; ekonomi verilerinden otomatik üretilir.
 */
export interface Contract {
  id: string;
  originCityId: string;
  destinationCityId: string;
  productId: ProductId;
  /** Taşınacak miktar (ton) — stok hareketinde kullanılır */
  amount: number;
  /**
   * Kamyon kapasitesi kontrolünde kullanılan toplam yük ağırlığı (ton).
   * UI ve kapasite kontrollerinde tek kaynak budur.
   */
  cargoWeight: number;
  /** Tamamlama ödülü ($) */
  payment: number;
  /** Teslim süresi limiti (saat) */
  deadlineHours: number;
  /** Rota mesafesi (km) */
  distanceKm: number;
  /** Aciliyet skoru (0–1) — yüksek değer daha kısa deadline ve bonus ödeme */
  urgency: number;
  status: ContractStatus;
  /** Sözleşmenin oluşturulduğu oyun zamanı (saat) */
  createdAt: number;
  /** Geçerlilik süresi sonu (saat) — available iken expire kontrolü */
  expiresAt: number;
  /** Bu sözleşmeyi almak için gereken şirket seviyesi */
  requiredLevel?: number;
  /** Sözleşme tipi — eski kayıtlarda standard kabul edilir */
  contractType?: ContractType;
  /** Risk seviyesi */
  riskLevel?: ContractRiskTier;
  /** Gerekli itibar (prestijli işler) */
  requiredReputation?: number;
  /** Önerilen minimum kamyon kondisyonu */
  recommendedTruckCondition?: number;
  /** Gerekli şoför seviyesi */
  requiredDriverLevel?: number;
  /** Ödeme bonus çarpanı (tip etkisi) */
  bonusMultiplier?: number;
  /** Ceza çarpanı (gecikme/hasar) */
  penaltyMultiplier?: number;
  /** Özel kurallar — UI açıklaması */
  specialRules?: string[];
  /** Aday seçim skoru için baz ekonomi — tip bonusu/tonaj şişmesi yansıtılmaz */
  selectionScoreBasis?: {
    payment: number;
    amount: number;
    urgency: number;
  };
}

// ---------------------------------------------------------------------------
// Teslimat
// ---------------------------------------------------------------------------

/** Teslimat yaşam döngüsü durumları */
export type DeliveryStatus =
  | 'preparing'
  | 'on_route'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type JobPausedReason = 'out-of-fuel';
export type FuelWarningKey =
  | 'low-fuel'
  | 'critical-fuel'
  | 'insufficient-range'
  | 'out-of-fuel';

/** Teslimat başarısızlık nedenleri */
export type DeliveryFailureReason =
  | 'breakdown'
  | 'accident'
  | 'too_late'
  | 'cancelled'
  | 'capacity_exceeded';

/** Teslimat sırasında nadir operasyon olayı tipi */
export type DeliveryIncidentType =
  | 'traffic'
  | 'driver_break'
  | 'tire_pressure'
  | 'fuel_deviation'
  | 'checkpoint';

export type DeliveryIncidentStatus = 'pending' | 'resolved' | 'expired';

export interface DeliveryIncidentEffects {
  cashDelta?: number;
  deliveryTimeDeltaHours?: number;
  progressDelta?: number;
  truckConditionDelta?: number;
  driverXpDelta?: number;
  fuelCostDelta?: number;
  riskDelta?: number;
}

export interface DeliveryIncidentChoice {
  id: string;
  label: string;
  description: string;
  effects: DeliveryIncidentEffects;
  /** UI kısa etki özeti */
  effectSummary?: string;
}

export interface DeliveryIncident {
  id: string;
  deliveryId: string;
  type: DeliveryIncidentType;
  title: string;
  description: string;
  createdAtGameTime: number;
  triggerProgress: number;
  status: DeliveryIncidentStatus;
  choices: DeliveryIncidentChoice[];
  resolvedChoiceId?: string;
  resolvedAtGameTime?: number;
}

/** Aktif veya tamamlanmış bir taşıma görevi */
export interface Delivery {
  id: string;
  contractId: string;
  truckId: string;
  driverId: string;
  originCityId: string;
  destinationCityId: string;
  productId: ProductId;
  /** Taşınan miktar (ton) */
  amount: number;
  /** Toplam rota mesafesi (km) */
  distanceKm: number;
  /** İlerleme (0–1) */
  progress: number;
  status: DeliveryStatus;
  /** Göreve başlangıç zamanı (saat) */
  startedAt: number;
  /** Tahmini varış zamanı (saat) */
  estimatedArrivalTime: number;
  /** Son teslim zamanı (saat) — aşılırsa ceza uygulanır */
  deadlineTime: number;
  /** Toplam yakıt maliyeti ($) */
  fuelCost: number;
  /** Teslimat başında tanktaki yakıt (L) */
  fuelLitersAtStart?: number;
  /** Bu teslimat için tahmini toplam yakıt (L) */
  fuelLitersTotal?: number;
  /** Tick'lerde gerçekten tüketilmiş yakıt (L) */
  fuelConsumedL?: number;
  /** Yakıt hesabının işlendiği son progress */
  lastFuelProcessedProgress?: number;
  /** Aynı oyun tick'inin ikinci kez işlenmesini önleyen zaman anahtarı */
  lastFuelProcessedAt?: number;
  /** Mileage'a işlenmiş gerçek mesafe (km) */
  distanceTraveledKm?: number;
  /** Son işlenen tick'teki gerçek hız (km/saat); UI bunun üzerinden okunur. */
  currentSpeedKmh?: number;
  pausedReason?: JobPausedReason;
  fuelWarningsEmitted?: FuelWarningKey[];
  roadsideAssistanceGrantedAt?: number;
  /** Toplam bakım maliyeti ($) */
  maintenanceCost: number;
  /** Tahmini net kâr ($) — ceza hariç */
  estimatedProfit: number;
  /** Tahmini seyahat süresi (saat) — progress hesabında kullanılır */
  travelHours: number;
  /** Arıza olasılığı (0–1) */
  breakdownChance: number;
  /** Kaza olasılığı (0–1) */
  accidentChance: number;
  /** Tamamlanınca kamyon kondisyonundan düşülecek miktar */
  conditionLoss: number;
  /** Başarısızlık nedeni — yalnızca failed durumunda */
  failureReason?: DeliveryFailureReason;
  /** Finansal settlement uygulandı (çift ödeme koruması) */
  settledAt?: number;
  /** Aktif operasyon olayı */
  incident?: DeliveryIncident;
  /** Bu teslimat için olay roll'ü yapıldı mı (max 1) */
  incidentGenerated?: boolean;
  /** Olay kararı verildi mi */
  incidentResolved?: boolean;
}

// ---------------------------------------------------------------------------
// Boş kamyon transferi
// ---------------------------------------------------------------------------

export type TruckTransferStatus = 'active' | 'paused' | 'completed' | 'cancelled';

/** Boş kamyon yönlendirme / geri çağırma görevi */
export interface TruckTransfer {
  id: string;
  truckId: string;
  driverId?: string;
  fromCityId: string;
  toCityId: string;
  distanceKm: number;
  startedAt: number;
  estimatedArrivalAt: number;
  progress: number;
  fuelCost: number;
  /** Transfer başında tanktaki yakıt (L) */
  fuelLitersAtStart?: number;
  /** Transfer için tahmini toplam yakıt (L) */
  fuelLitersTotal?: number;
  fuelConsumedL?: number;
  lastFuelProcessedProgress?: number;
  lastFuelProcessedAt?: number;
  distanceTraveledKm?: number;
  /** Son işlenen tick'teki gerçek hız (km/saat). */
  currentSpeedKmh?: number;
  pausedReason?: JobPausedReason;
  fuelWarningsEmitted?: FuelWarningKey[];
  roadsideAssistanceGrantedAt?: number;
  driverCost: number;
  totalCost: number;
  status: TruckTransferStatus;
}

// ---------------------------------------------------------------------------
// Depolar arası stok transferi (oyuncu kendi stoğu)
// ---------------------------------------------------------------------------

export type WarehouseStockTransferStatus =
  | 'pending'
  | 'active'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** Oyuncunun kendi deposundaki ürünü başka şehre taşıma görevi */
export interface WarehouseStockTransfer {
  id: string;
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  sourceCityId: string;
  destinationCityId: string;
  productId: ProductId;
  quantityTons: number;
  averagePurchasePriceAtStart: number;
  /** Rezerve edilen maliyet tabanı (qty × avg) — muhasebe/rapor */
  reservedInventoryCost: number;
  /** Kaynak stok kalitesi (completion merge) */
  qualityAtStart?: number;
  truckId: string;
  trailerId?: string;
  driverId: string;
  routeDistanceKm: number;
  progress: number;
  status: WarehouseStockTransferStatus;
  startedAt: number;
  estimatedCompletionAt: number;
  completedAt?: number;
  fuelLitersAtStart: number;
  fuelLitersTotal: number;
  fuelConsumedL?: number;
  lastFuelProcessedProgress?: number;
  lastFuelProcessedAt?: number;
  distanceTraveledKm?: number;
  /** Son işlenen tick'teki gerçek hız (km/saat). */
  currentSpeedKmh?: number;
  pausedReason?: JobPausedReason;
  fuelWarningsEmitted?: FuelWarningKey[];
  roadsideAssistanceGrantedAt?: number;
  fuelCost: number;
  driverCost: number;
  totalCost: number;
  failureReason?: WarehouseActionReason | string;
  /** Çift completion / rollback koruması */
  settledAt?: number;
}

// ---------------------------------------------------------------------------
// Depo
// ---------------------------------------------------------------------------

/** Oyuncuya ait depo — belirli bir şehirde stok tutar */
export interface WarehouseInventoryItem {
  productId: ProductId;
  /** Depodaki miktar (ton) */
  quantity: number;
  /** Ağırlıklı ortalama alış fiyatı ($/ton) */
  averageBuyPrice: number;
  /** Ürün kalitesi (0–100) */
  quality?: number;
  /** Depoya konulduğu oyun zamanı (saat) */
  storedAt?: number;
  /** Son kalite güncellemesi (saat) */
  lastQualityUpdateAt?: number;
  /** Saklandığı depo türü */
  warehouseType?: WarehouseType;
  /** Uyumsuz depo uyarısı */
  storageWarning?: string;
}

/** Oyuncuya ait depo — belirli bir şehirde stok tutar */
export interface Warehouse {
  id: string;
  cityId: string;
  /** Toplam depolama kapasitesi (ton) */
  capacityTons: number;
  /**
   * Depodaki ürün envanteri.
   * Eski save kayıtlarındaki legacy `storedProducts` migration sırasında inventory'ye dönüştürülür.
   */
  inventory?: WarehouseInventoryItem[];
  /** Önbellek — yoksa inventory toplamından hesaplanır */
  usedCapacityTon?: number;
  /** Depo yükseltme kademesi: 1=küçük, 2=orta, 3=büyük */
  upgradeTier?: number;
  /** Depo türü — eski kayıtlarda yoksa standard kabul edilir */
  warehouseType?: WarehouseType;
  /** Depo açılış maliyeti ($) — kayıt uyumluluğu */
  openCost?: number;
  /** Günlük işletme gideri ($) */
  dailyOperatingCost?: number;
  /** Kapasite (ton) — capacityTons ile eş anlamlı */
  capacityTon?: number;
  /** Kalite koruma katsayısı (0–1) */
  qualityProtection?: number;
}

/** Finans defteri kategorileri — yeni kayıtlar standart isimleri kullanır; eski save uyumluluğu için legacy değerler de geçerlidir */
export type FinanceLedgerCategory =
  | 'contract_revenue'
  | 'contract_income'
  | 'fuel_purchase'
  | 'roadside_fuel'
  | 'trade_sale'
  | 'market_sale'
  | 'bonus'
  | 'reward'
  | 'recovery_assistance'
  | 'mission_reward'
  | 'ad_reward_daily_ops'
  | 'other_income'
  | 'fuel'
  | 'maintenance'
  | 'penalty'
  | 'trade_purchase'
  | 'market_purchase'
  | 'driver_salary'
  | 'warehouse_cost'
  | 'warehouse_operating'
  | 'truck_lease'
  | 'daily_operating_cost'
  | 'vehicle_purchase'
  | 'vehicle_sale'
  | 'truck_purchase'
  | 'truck_sale'
  | 'driver_hire'
  | 'driver_severance'
  | 'warehouse_open'
  | 'other_expense'
  | 'delivery_income'
  | 'delivery_expense'
  | 'fleet_purchase'
  | 'truck_transfer'
  | 'warehouse_rent'
  | 'truck_rental'
  | 'operations'
  | 'other';

/** Günlük işletme gideri özet kaydı için isteğe bağlı kırılım */
export interface FinanceLedgerBreakdown {
  driverSalary: number;
  warehouseOperating: number;
  generalOperations: number;
  chargedTruckLease: number;
}

/** Kümülatif finans toplamları — ledger kırpılsa bile korunur */
export interface FinanceTotals {
  totalIncome: number;
  totalExpense: number;
  netProfit: number;
  incomeByCategory: Record<string, number>;
  expenseByCategory: Record<string, number>;
}

/** Gelir/gider kaydı — save'e yazılır */
export interface FinanceLedgerEntry {
  id: string;
  time: number;
  type: 'income' | 'expense';
  category: FinanceLedgerCategory;
  amount: number;
  title?: string;
  description?: string;
  source?: 'roadside-emergency' | string;
  /** Cash mutation idempotency anahtarı. */
  transactionId?: string;
  /** Domain nesnesi/işlemi ile deterministik ilişki. */
  referenceId?: string;
  breakdown?: FinanceLedgerBreakdown;
  /** Teslimat tamamlama gibi ilişkili kayıtların çift yazılmasını önlemek için */
  relatedDeliveryId?: string;
  /** Ticaret vb. ilişkili meta — retention milestone hesapları için */
  meta?: {
    productId?: string;
    profit?: number;
  };
}

/**
 * Depo işlemleri için structured failure reason — UI string karşılaştırması yapmamalı.
 * Transfer reason’ları V2 stok transferi için rezerve.
 */
export type WarehouseActionReason =
  | 'insufficient-funds'
  | 'warehouse-full'
  | 'warehouse-required'
  | 'cold-storage-required'
  | 'warehouse-limit-reached'
  | 'duplicate-warehouse'
  | 'invalid-city'
  | 'invalid-quantity'
  | 'destination-full'
  | 'transfer-in-progress'
  | 'product-not-found'
  | 'insufficient-market-stock'
  | 'insufficient-inventory'
  | 'insufficient-stock'
  | 'source-destination-same'
  | 'incompatible-trailer'
  | 'no-available-truck'
  | 'no-available-driver'
  | 'insufficient-capacity'
  | 'insufficient-fuel'
  | 'route-not-found'
  | 'incompatible-warehouse'
  | 'upgrade-maxed'
  | 'level-required'
  | 'market-offline';

/** Ticaret / depo işlemi sonucu */
export interface TradeActionResult {
  success: boolean;
  message?: string;
  /** Kullanıcı dostu structured reason — tercihen bunu kullan */
  reason?: WarehouseActionReason;
  details?: Record<string, unknown>;
  transferId?: string;
  errorCode?:
    | 'INVALID_QUANTITY'
    | 'WAREHOUSE_NOT_FOUND'
    | 'PRODUCT_NOT_FOUND'
    | 'INSUFFICIENT_STOCK'
    | 'INSUFFICIENT_CAPACITY'
    | 'INSUFFICIENT_FUNDS'
    | 'INSUFFICIENT_INVENTORY'
    | 'INCOMPATIBLE_WAREHOUSE'
    | 'MARKET_OFFLINE'
    | 'CITY_NOT_FOUND';
}

// ---------------------------------------------------------------------------
// Oyuncu ve oyun durumu
// ---------------------------------------------------------------------------

/** XP / seviye alanları — eski kayıtlarda eksik olabilir */
export type PlayerProgressFields = {
  /** Şirket seviyesi — filo limiti ve kilit açmalar için kullanılır */
  companyLevel?: number;
  /** Şirket seviyesi (XP tabanlı) */
  level?: number;
  /** Mevcut seviye içindeki XP */
  xp?: number;
  /** Sonraki seviyeye kalan XP eşiği */
  xpToNextLevel?: number;
  /** Kariyer boyu kazanılan toplam XP */
  totalXp?: number;
};

/** Oyuncu / şirket profili */
export interface Player extends PlayerProgressFields {
  companyName: string;
  /** Nakit ($) */
  money: number;
  /** Şirket seviyesi — filo limiti ve kilit açmalar için kullanılır */
  companyLevel: number;
  /** Şirket seviyesi (XP tabanlı) */
  level: number;
  /** Mevcut seviye içindeki XP */
  xp: number;
  /** Sonraki seviyeye kalan XP eşiği */
  xpToNextLevel: number;
  /** Kariyer boyu kazanılan toplam XP */
  totalXp: number;
  /** Ana merkez şehri */
  homeCityId: string;
  /** İtibar (0–100) */
  reputation: number;
  /** Tamamlanan sözleşme sayısı */
  completedContracts: number;
  /** Başarısız teslimat sayısı — company score cezası */
  failedDeliveries?: number;
  /** Gecikmeli teslimat sayısı — company score cezası */
  lateDeliveries?: number;
  /** Premium para birimi — haftalık leaderboard ödülleri için */
  diamonds?: number;
  /** Oyuncunun sahip olduğu kamyonlar */
  trucks: Truck[];
  /** Oyuncunun sahip olduğu dorseler */
  trailers?: Trailer[];
  /** Oyuncunun işe aldığı şoförler */
  drivers: Driver[];
  /** Oyuncunun depoları */
  warehouses: Warehouse[];
}

/** Piyasa haberi önem seviyesi */
export type MarketNewsImportance = 'low' | 'medium' | 'high';

/** Piyasa haberi türü */
export type MarketNewsType = 'economy' | 'fuel' | 'contract' | 'delivery' | 'warning';

/** Oyun olayı türü */
export type GameEventType =
  | 'delivery'
  | 'finance'
  | 'market'
  | 'fleet'
  | 'warehouse'
  | 'system';

/** Oyun olayı önem seviyesi */
export type GameEventImportance = 'low' | 'medium' | 'high';

/** Oyuncu ve geliştirici için oyun olay kaydı */
export interface GameEvent {
  id: string;
  /** Olayın oluştuğu oyun zamanı (saat) */
  time: number;
  type: GameEventType;
  title: string;
  message: string;
  importance: GameEventImportance;
  /** Dahili meta — kalite uyarısı tekrar kontrolü vb. */
  meta?: Record<string, unknown>;
}

/** Geçici oyuncu bildirimi — save'e yazılmaz */
export type GameNotificationType = 'success' | 'warning' | 'error' | 'info';

export type GameNotificationActionTarget =
  | 'dashboard'
  | 'contracts'
  | 'fleet'
  | 'finance'
  | 'map'
  | 'market';

export interface GameNotification {
  id: string;
  time: number;
  type: GameNotificationType;
  title: string;
  message: string;
  actionLabel?: string;
  actionTarget?: GameNotificationActionTarget;
  marketFocus?: MarketFocusRequest;
  autoDismissMs?: number;
}

/** Toast otomatik kapanma süreleri (ms) — type bazlı varsayılanlar */
export const DEFAULT_TOAST_DURATION: Record<GameNotificationType, number> = {
  success: 3000,
  info: 2500,
  warning: 4000,
  error: 5000,
};

export function resolveNotificationDismissMs(
  type: GameNotificationType,
  autoDismissMs?: number,
): number {
  if (autoDismissMs != null && autoDismissMs > 0) {
    return autoDismissMs;
  }
  return DEFAULT_TOAST_DURATION[type] ?? 3000;
}

/** Piyasa fiyat alarmı — oyuncu tanımlı hedef fiyat takibi */
export type MarketPriceAlertCondition =
  | 'price_below'
  | 'price_above'
  | 'change_up_percent'
  | 'change_down_percent';

export interface MarketPriceAlert {
  id: string;
  cityId: CityId;
  productId: ProductId;
  condition: MarketPriceAlertCondition;
  targetPrice?: number;
  targetPercent?: number;
  isActive: boolean;
  createdAt: number;
  triggeredAt?: number;
  /** Aynı global epoch içinde tekrar bildirim üretmesini engeller. */
  lastTriggeredMarketEpoch?: number;
  expiresAt?: number;
  notificationId?: string;
}

/** Bildirimden Piyasa ekranına odaklanma — save'e yazılmaz */
export interface MarketFocusRequest {
  cityId: CityId;
  productId: ProductId;
}

export interface MarketAlertActionResult {
  success: boolean;
  message?: string;
  alertId?: string;
  errorCode?:
    | 'DUPLICATE_ALERT'
    | 'MAX_ALERTS_REACHED'
    | 'INVALID_TARGET'
    | 'ALERT_NOT_FOUND'
    | 'CITY_NOT_FOUND'
    | 'PRODUCT_NOT_FOUND';
}

/** Piyasa ekranından İşler sekmesine aktarılan filtre — save'e yazılmaz */
export interface MarketContractFilter {
  fromCityId: string;
  toCityId: string;
  productId: ProductId;
  fromCityName: string;
  toCityName: string;
  productName: string;
  opportunityId?: string;
  /** Harita önerisinden gelen belirli sözleşme — liste sıralamasında en üstte */
  contractId?: string;
  source: 'market' | 'map';
  createdAt: number;
}

/** Piyasa fırsat tarayıcısı sonucu */
export interface MarketOpportunity {
  id: string;
  fromCityId: string;
  toCityId: string;
  productId: ProductId;
  fromCityName: string;
  toCityName: string;
  productName: string;
  priceGap: number;
  distanceKm: number;
  score: number;
  demandLevel: 'high' | 'medium' | 'low';
}

/** Harita alt kartında gösterilen şirket durumuna göre öneri */
export type RecommendedMapAction =
  | {
      type: 'contract';
      contractId: string;
      title: 'Önerilen İş';
      reason: string;
      estimatedProfit: number;
      riskLabel: string;
      buttonLabel: 'İşi Gör';
    }
  | {
      type: 'active_delivery';
      deliveryId: string;
      title: 'Aktif Teslimat';
      reason: string;
      buttonLabel: "Dashboard'a Git" | "Filo'yu Aç";
    }
  | {
      type: 'fleet_upgrade';
      title: 'Teslimatlar Yolda' | 'Şoför Gerekli' | 'Daha Büyük Kamyon Gerekli' | 'Filo Geliştir';
      reason: string;
      buttonLabel: "Filo'yu Aç" | 'Şoför Havuzu' | 'Kamyon Mağazası';
      fleetTarget: 'trucks' | 'shop' | 'hire_drivers';
    }
  | {
      type: 'warehouse_trade';
      title: 'Ticaret Fırsatı';
      reason: string;
      buttonLabel: 'Depoları Aç';
      warehouseId?: string;
      productId?: ProductId;
    }
  | {
      type: 'none';
      title: 'Fırsat Bekleniyor';
      reason: string;
      buttonLabel: 'Piyasayı Gör';
    };

/** Şirket puanı dağılımı — runtime hesaplanır, save'e yazılmaz */
export interface CompanyScoreBreakdown {
  cashScore: number;
  truckValueScore: number;
  warehouseValueScore: number;
  inventoryValueScore: number;
  completedContractsScore: number;
  reputationScore: number;
  levelScore: number;
  weeklyTradeProfitScore: number;
  /** totalScore'a eklenen negatif ceza katkısı (ör. -9000) */
  penaltyScore: number;
  /** Pozitif ceza büyüklüğü — yalnızca bilgi amaçlı */
  penaltyCostScore: number;
  totalScore: number;
  truckValue: number;
  warehouseValue: number;
  inventoryValue: number;
  weeklyTradeProfit: number;
  failedDeliveries: number;
  lateDeliveries: number;
}

/** Dinamik piyasa haberi */
export interface MarketNews {
  id: string;
  /** Haberin oluştuğu oyun zamanı (saat) */
  time: number;
  type: MarketNewsType;
  title: string;
  message: string;
  cityId?: string;
  productId?: ProductId;
  importance: MarketNewsImportance;
}

/** Piyasa olayı türleri — Retention Pack V1 Phase 2 */
export type WorldEventType =
  | 'fuel_crisis'
  | 'city_demand_boom'
  | 'city_supply_shortage'
  | 'port_congestion'
  | 'road_work'
  | 'industrial_support'
  | 'cold_chain_demand'
  | 'electronics_boom'
  | 'harvest_surplus'
  | 'maintenance_campaign';

export type WorldEventSeverity = 'low' | 'medium' | 'high';

/** Piyasa olayı çarpan etkileri */
export interface WorldEventImpact {
  fuelPriceMultiplier?: number;
  contractPaymentMultiplier?: number;
  deliveryDurationMultiplier?: number;
  productPriceMultiplier?: number;
  productDemandMultiplier?: number;
  maintenanceCostMultiplier?: number;
  contractSpawnWeightMultiplier?: number;
}

/** Aktif veya geçmiş dünya/piyasa olayı */
export interface WorldEvent {
  id: string;
  type: WorldEventType;
  title: string;
  description: string;
  cityId?: string;
  productId?: ProductId;
  /**
   * @deprecated Kişisel oyun günü — ekonomi source of truth değil.
   * Eski save uyumluluğu için tutulur; aktiflik startsAt/endsAt tercih edilir.
   */
  startsAtDay: number;
  /** @deprecated Eski save uyumluluğu */
  endsAtDay: number;
  durationDays: number;
  /** Global gerçek zaman başlangıç (ms) — ortak olaylar */
  startsAt?: number;
  /** Global gerçek zaman bitiş (ms) */
  endsAt?: number;
  /** Olayın üretildiği market epoch */
  globalEpoch?: number;
  economyConfigVersion?: number;
  impact: WorldEventImpact;
  severity: WorldEventSeverity;
  isActive: boolean;
}

export type TutorialStepId =
  | 'open_contracts'
  | 'select_contract'
  | 'assign_team'
  | 'track_delivery'
  | 'complete_delivery'
  | 'open_market';

export interface TutorialState {
  isEnabled: boolean;
  isCompleted: boolean;
  currentStepId: TutorialStepId;
  completedStepIds: string[];
  dismissedStepIds: string[];
}

export type SpotlightTutorialId = 'first_contract' | 'track_delivery' | 'market_basics';

export interface SpotlightTutorialPersistence {
  completedIds: SpotlightTutorialId[];
  skippedIds: SpotlightTutorialId[];
}

export interface MissionsState {
  activeMissionIds: string[];
  completedMissionIds: string[];
  claimedMissionRewardIds: string[];
  /** Görev ilk kez tamamlandığında kaydedilen oyun saati; yalnız sunum amaçlıdır. */
  completedAtByMissionId: Record<string, number>;
  flags: {
    marketOpened: boolean;
    deliveryStarted: boolean;
    tradePurchased: boolean;
  };
}

/** Retention Pack V1 — ödül tanımı */
export interface RetentionReward {
  cash?: number;
  xp?: number;
  reputation?: number;
  diamonds?: number;
  badgeId?: string;
}

export type RetentionMilestoneCategory =
  | 'contracts'
  | 'trading'
  | 'fleet'
  | 'warehouse'
  | 'reputation'
  | 'city'
  | 'economy'
  | 'season';

export type RetentionWeeklyCategory =
  | 'contracts'
  | 'trading'
  | 'warehouse'
  | 'reputation'
  | 'season';

/** Milestone ilerleme kaydı (save) */
export interface RetentionMilestoneProgress {
  progress: number;
  isClaimed: boolean;
  completedAt?: number;
}

/** Haftalık sezon görevi ilerleme kaydı (save) */
export interface WeeklySeasonObjectiveProgress {
  progress: number;
  isClaimed: boolean;
  completedAt?: number;
}

/** Haftalık sayaçlar — season değişince sıfırlanır */
export interface RetentionWeeklyStats {
  deliveriesCompleted: number;
  tradeProfit: number;
  stockStoredTons: number;
  onTimeDeliveries: number;
  citiesOperated: string[];
  tradeBuyCount: number;
  tradeSellCount: number;
}

/** Kariyer boyu retention sayaçları */
export interface RetentionLifetimeStats {
  cityDeliveryCounts: Record<string, number>;
  /** Phase 3 — özel sözleşme tamamlama sayaçları */
  urgentContractsCompleted?: number;
  fragileContractsCompleted?: number;
  highReputationContractsCompleted?: number;
  maintenanceCount?: number;
  truckUpgradeCount?: number;
  maxDriverLevel?: number;
}

/** Retention Pack V1 — save state */
export interface RetentionState {
  retentionVersion: number;
  milestones: Record<string, RetentionMilestoneProgress>;
  weeklyObjectives: Record<string, WeeklySeasonObjectiveProgress>;
  claimedBadges: string[];
  currentWeeklySeasonKey: string;
  weeklyStats: RetentionWeeklyStats;
  lifetimeStats: RetentionLifetimeStats;
}

export type OnboardingStepId =
  | 'choose_first_contract'
  | 'assign_team'
  | 'track_delivery'
  | 'complete_first_delivery'
  | 'claim_first_reward';

export type OnboardingLegacyStepId =
  | 'welcome'
  | 'first_contract'
  | 'market_intro'
  | 'first_trade'
  | 'warehouse_intro'
  | 'claim_rewards'
  | 'finish';

export type OnboardingScreenId =
  | 'Dashboard'
  | 'Contracts'
  | 'Map'
  | 'Market'
  | 'Warehouse'
  | 'Missions';

export type OnboardingRoute =
  | 'Dashboard'
  | 'Contracts'
  | 'Map'
  | 'Market'
  | 'Warehouse'
  | 'Missions'
  | null;

export interface OnboardingState {
  version?: number;
  enabled: boolean;
  completed: boolean;
  currentStepId: OnboardingStepId | null;
  completedStepIds: string[];
  dismissedHintIds: string[];
  visitedScreens: string[];
  /** Sözleşme atama ekranı açıldı — assign_team adımı */
  assignmentOpened?: boolean;
  /** claim_first_reward adımında en az bir görev ödülü alındı */
  missionRewardClaimed?: boolean;
  startedAtGameTime?: number;
  completedAtGameTime?: number;
}

/**
 * Zustand store'un yönettiği ana oyun durumu.
 * Simülasyon modülleri için ayrı SimulationGameState tipi kullanılır.
 */
export interface StoreGameState {
  currentTime: number;
  isPaused: boolean;
  /** Zaman akış hızı çarpanı (1 = normal) */
  gameSpeed: number;
  /** Son ekonomi tick'inin yapıldığı oyun saati */
  lastEconomyTickTime: number;
  /** Son günlük gider işleminin yapıldığı oyun saati */
  lastDailyOperatingCostTime: number;
  /** Son küçük sözleşme üretim kontrolü (oyun saati) */
  lastContractGenerationTime: number;
  /** Son orta ölçekli piyasa sözleşme yenilemesi (oyun saati) */
  lastMarketRefreshTime: number;
  /** Son günlük sözleşme temizliği (oyun saati) */
  lastDailyCleanupTime: number;
  /** Son zorunlu alınabilir sözleşme üretimi (oyun saati) */
  lastPlayableContractGeneratedTime: number;
  /** Son manuel sözleşme yenilemesi (oyun saati) */
  lastManualContractRefreshTime: number;
  player: Player;
  cities: City[];
  products: Product[];
  routes: Route[];
  contracts: Contract[];
  /** Aktif ve geçmiş teslimatlar */
  activeDeliveries: Delivery[];
  /** Aktif boş kamyon transferleri */
  activeTransfers: TruckTransfer[];
  /** Tamamlanan boş kamyon transferleri */
  completedTransfers?: TruckTransfer[];
  /** Aktif depolar arası stok transferleri */
  activeWarehouseStockTransfers: WarehouseStockTransfer[];
  /** Tamamlanan / iptal / failed stok transferleri (sınırlı) */
  completedWarehouseStockTransfers?: WarehouseStockTransfer[];
  globalEconomy: GlobalEconomy;
  /** Küçük, doğrulanmış current snapshot cache'i; global geçmiş save'e yazılmaz. */
  cachedGlobalEconomySnapshot?: GlobalEconomySnapshot;
  /** Yalnız backend source sonucunda true olur; eski/local cache production'da trusted sayılmaz. */
  cachedGlobalEconomySnapshotTrusted?: boolean;
  /** Runtime-only backend history. serializeGameState bu alanı kaydetmez. */
  globalMarketHistory?: GlobalMarketHistoryEntry[];
  globalMarketSyncStatus?: GlobalMarketSyncStatus;
  globalMarketLastSyncedAtMs?: number;
  marketNews: MarketNews[];
  /** Oyuncu ve geliştirici olay günlüğü */
  eventLog: GameEvent[];
  /** Gelir/gider defteri — son finans hareketleri (sınırlı liste) */
  financeLedger: FinanceLedgerEntry[];
  /** Kümülatif gelir/gider toplamları — ledger kırpılsa bile korunur */
  financeTotals?: FinanceTotals;
  /** V1 başlangıç rehberi */
  tutorial: TutorialState;
  spotlightTutorial: SpotlightTutorialPersistence;
  /** Başlangıç görevleri */
  missions: MissionsState;
  /** Retention Pack V1 — milestone ve haftalık sezon görevleri */
  retention: RetentionState;
  /** Başlangıç rehberi (Onboarding Guide V1) */
  onboarding: OnboardingState;
  /** Oyuncu tanımlı piyasa fiyat alarmları */
  marketAlerts: MarketPriceAlert[];
  /** Aktif piyasa/şehir olayları — Retention Pack V1 Phase 2 */
  worldEvents: WorldEvent[];
  worldEventsVersion: number;
  /** Son olay üretiminin yapıldığı oyun günü (1-indexed) */
  lastWorldEventGeneratedDay?: number;
  /** Monetization M0/M1 — ödüllü reklam kullanımı ve token'lar */
  monetization: import('./monetization').MonetizationState;
  /** Son gerçek dünya görülme zamanı (ms) — offline progression */
  lastSeenRealTimeMs?: number;
  /** Son simüle edilen gerçek zaman (ms) — online tick + offline baseline */
  lastSimulatedRealTimeMs?: number;
  /** Son offline catch-up uygulama zamanı (ms) */
  lastOfflineProgressAppliedAt?: number;
  /** Offline progression şema sürümü */
  offlineProgressVersion?: number;
  /** Son aktif simülasyon hızı — pause/offline catch-up için */
  lastSimulationGameSpeed?: number;
  /**
   * Son işlenen periyodik ekonomi zamanı (trusted ms).
   * Kişisel oyun gününden bağımsız; idempotent offline gider için.
   */
  lastProcessedEconomyAt?: number;
  /** Son görülen global market epoch */
  lastSeenMarketEpoch?: number;
  /** Cache'lenen global snapshot sürümü */
  cachedSnapshotVersion?: number;
  cachedSnapshotGeneratedAt?: number;
  /** Uygulanmış 24s period key'leri (idempotency) — sınırlı */
  appliedEconomyPeriodKeys?: string[];
  /** Son acil operasyon sözleşmesi üretim zamanı (ms) */
  lastEmergencyContractAtMs?: number;
  /** Hard-floor soft-lock için tek seferlik nakit yardım zamanı (trusted ms). */
  cashRecoveryAssistanceGrantedAtMs?: number;
  /** Son ücretsiz yol yardımı zamanı (oyun saati). */
  lastRoadsideFuelAssistanceAt?: number;
  /** Başarılı yakıt transaction retry anahtarları; save sırasında son N kayıt tutulur. */
  fuelTransactionKeys?: string[];
}

/**
 * Teslimat simülasyon modülünün beklediği oyun durumu.
 * Store state'inden adaptör ile dönüştürülür.
 */
export interface SimulationGameState {
  currentDay: number;
  currentTime: number;
  player: Pick<Player, 'companyName' | 'money' | 'companyLevel' | 'homeCityId'>;
  trucks: Truck[];
  drivers: Driver[];
  warehouses: Warehouse[];
  cities: Record<string, City>;
  contracts: Contract[];
  deliveries: Delivery[];
}

/** Teslimat başlatma sonucu */
export type StartDeliveryErrorCode =
  | 'CONTRACT_EXPIRED'
  | 'LEASE_EXPIRED'
  | 'CONTRACT_NOT_FOUND'
  | 'TRUCK_NOT_FOUND'
  | 'DRIVER_NOT_FOUND'
  | 'TRUCK_BUSY'
  | 'DRIVER_BUSY'
  | 'CAPACITY_INSUFFICIENT'
  | 'TRUCK_CONDITION_TOO_LOW'
  | 'ROUTE_NOT_FOUND'
  | 'INSUFFICIENT_FUEL'
  | 'INSUFFICIENT_FUNDS'
  | 'DELIVERY_CREATE_FAILED'
  | 'TRUCK_NOT_AT_ORIGIN'
  | 'NO_TRUCK_AT_ORIGIN'
  | 'PRODUCT_NOT_FOUND';

export type ContractAvailabilityReason =
  | 'LEVEL_INSUFFICIENT'
  | 'NO_TRUCKS'
  | 'NO_IDLE_TRUCKS'
  | 'NO_DRIVERS'
  | 'NO_IDLE_DRIVERS'
  | 'INVALID_ORIGIN_CITY'
  | 'NO_TRUCK_IN_ORIGIN_CITY'
  | 'NO_IDLE_TRUCK_IN_ORIGIN_CITY'
  | 'NO_TRUCK_AT_ORIGIN'
  | 'NO_TRUCK_WITH_CAPACITY'
  | 'CAPACITY_INSUFFICIENT'
  | 'TRUCK_CONDITION_TOO_LOW'
  | 'REPUTATION_TOO_LOW'
  | 'DRIVER_LEVEL_TOO_LOW'
  | 'CONTRACT_EXPIRED'
  | 'LEASE_EXPIRED'
  | 'INSUFFICIENT_FUNDS'
  | 'OK';

export interface ContractAvailabilityDebug {
  fromCityId: string;
  requiredCargoWeight: number;
  trucksAtOriginCount: number;
  idleTrucksAtOriginCount: number;
  bestIdleTruckCapacity: number;
  ownedTrucksAtOriginCount: number;
  leasedTrucksAtOriginCount: number;
  reason: ContractAvailabilityReason;
}

export interface ContractAvailability {
  canStart: boolean;
  reason: ContractAvailabilityReason;
  buttonLabel: string;
  title?: string;
  message?: string;
  maxIdleTruckCapacity?: number;
  requiredCapacity?: number;
  requiredLevel?: number;
  playerLevel?: number;
  /** Capacity sub-reason when reason is NO_TRUCK_WITH_CAPACITY */
  capacityDisabledReasonKind?:
    | 'beyond_system'
    | 'trailer_required'
    | 'refrigerated_trailer_required'
    | 'trailer_type_mismatch'
    | 'heavy_haul_required'
    | 'wrong_city'
    | 'upgrade_possible'
    | 'insufficient';
  bestAvailableTruckCapacity?: number;
  maxFleetCapacityTons?: number;
  debug?: ContractAvailabilityDebug;
}

export interface StartDeliveryResult {
  success: boolean;
  errorCode?: StartDeliveryErrorCode;
  message?: string;
}

export type StartTruckTransferErrorCode =
  | 'TRUCK_NOT_FOUND'
  | 'TRUCK_BUSY'
  | 'SAME_CITY'
  | 'CITY_NOT_FOUND'
  | 'ROUTE_NOT_FOUND'
  | 'NO_IDLE_DRIVER'
  | 'INSUFFICIENT_FUEL'
  | 'INSUFFICIENT_FUNDS'
  | 'TRANSFER_CREATE_FAILED';

export interface StartTruckTransferResult {
  success: boolean;
  errorCode?: StartTruckTransferErrorCode;
  message?: string;
  transferId?: string;
}

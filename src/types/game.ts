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
export type TruckStatus = 'idle' | 'on_route' | 'maintenance' | 'transferring';

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
  /** İşe alım ücreti ($) — tek seferlik */
  hireCost?: number;
  /** Atandığı kamyon; boştaysa null */
  assignedTruckId: string | null;
  status: DriverStatus;
}

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
}

// ---------------------------------------------------------------------------
// Teslimat
// ---------------------------------------------------------------------------

/** Teslimat yaşam döngüsü durumları */
export type DeliveryStatus =
  | 'preparing'
  | 'on_route'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** Teslimat başarısızlık nedenleri */
export type DeliveryFailureReason =
  | 'breakdown'
  | 'accident'
  | 'too_late'
  | 'cancelled'
  | 'capacity_exceeded';

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
}

// ---------------------------------------------------------------------------
// Boş kamyon transferi
// ---------------------------------------------------------------------------

export type TruckTransferStatus = 'active' | 'completed' | 'cancelled';

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
  driverCost: number;
  totalCost: number;
  status: TruckTransferStatus;
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
   * Eski kayıtlar için storedProducts fallback olarak kullanılır.
   */
  inventory?: WarehouseInventoryItem[];
  /** @deprecated inventory kullanın — eski kayıt uyumluluğu */
  storedProducts?: Partial<Record<ProductId, number>>;
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
  | 'contract_income'
  | 'trade_sale'
  | 'bonus'
  | 'other_income'
  | 'fuel'
  | 'maintenance'
  | 'penalty'
  | 'trade_purchase'
  | 'driver_salary'
  | 'warehouse_operating'
  | 'truck_lease'
  | 'daily_operating_cost'
  | 'truck_purchase'
  | 'driver_hire'
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
  breakdown?: FinanceLedgerBreakdown;
  /** Teslimat tamamlama gibi ilişkili kayıtların çift yazılmasını önlemek için */
  relatedDeliveryId?: string;
}

/** Ticaret işlemi sonucu */
export interface TradeActionResult {
  success: boolean;
  message?: string;
  errorCode?:
    | 'INVALID_QUANTITY'
    | 'WAREHOUSE_NOT_FOUND'
    | 'PRODUCT_NOT_FOUND'
    | 'INSUFFICIENT_STOCK'
    | 'INSUFFICIENT_CAPACITY'
    | 'INSUFFICIENT_FUNDS'
    | 'INSUFFICIENT_INVENTORY'
    | 'INCOMPATIBLE_WAREHOUSE'
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
  | 'map';

export interface GameNotification {
  id: string;
  time: number;
  type: GameNotificationType;
  title: string;
  message: string;
  actionLabel?: string;
  actionTarget?: GameNotificationActionTarget;
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
  /**
   * @deprecated Negatif ceza katkısı. `penaltyScore` kullanın.
   */
  penaltiesScore: number;
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
  globalEconomy: GlobalEconomy;
  marketNews: MarketNews[];
  /** Oyuncu ve geliştirici olay günlüğü */
  eventLog: GameEvent[];
  /** Gelir/gider defteri — son finans hareketleri (sınırlı liste) */
  financeLedger: FinanceLedgerEntry[];
  /** Kümülatif gelir/gider toplamları — ledger kırpılsa bile korunur */
  financeTotals?: FinanceTotals;
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

/** @deprecated SimulationGameState kullanın */
export type GameState = SimulationGameState;

/** Teslimat başlatma sonucu */
export type StartDeliveryErrorCode =
  | 'CONTRACT_NOT_FOUND'
  | 'TRUCK_NOT_FOUND'
  | 'DRIVER_NOT_FOUND'
  | 'TRUCK_BUSY'
  | 'DRIVER_BUSY'
  | 'CAPACITY_INSUFFICIENT'
  | 'TRUCK_CONDITION_TOO_LOW'
  | 'ROUTE_NOT_FOUND'
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
  | 'CAPACITY_INSUFFICIENT'
  | 'TRUCK_CONDITION_TOO_LOW'
  | 'OK';

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
  | 'INSUFFICIENT_FUNDS'
  | 'TRANSFER_CREATE_FAILED';

export interface StartTruckTransferResult {
  success: boolean;
  errorCode?: StartTruckTransferErrorCode;
  message?: string;
  transferId?: string;
}

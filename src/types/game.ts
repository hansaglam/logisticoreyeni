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
export type TruckStatus = 'idle' | 'on_route' | 'maintenance';

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
  /** Kamyonun bulunduğu şehir */
  currentCityId: string;
  status: TruckStatus;
}

/** Şoför durumu */
export type DriverStatus = 'idle' | 'driving' | 'resting';

/** Oyuncuya ait bir şoför */
export interface Driver {
  id: string;
  name: string;
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
  /** Günlük maaş ($) */
  salaryPerDay: number;
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
  /** Taşınacak miktar (ton) */
  amount: number;
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
  /** Teklifin geçerlilik süresi sonu (saat) — available iken expire kontrolü */
  expiresAt: number;
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
// Depo
// ---------------------------------------------------------------------------

/** Oyuncuya ait depo — belirli bir şehirde stok tutar */
export interface Warehouse {
  id: string;
  cityId: string;
  /** Toplam depolama kapasitesi (ton) */
  capacityTons: number;
  /** Depodaki ürün miktarları (ton) — tanımsız ürün = 0 kabul edilir */
  storedProducts: Partial<Record<ProductId, number>>;
}

// ---------------------------------------------------------------------------
// Oyuncu ve oyun durumu
// ---------------------------------------------------------------------------

/** Oyuncu / şirket profili */
export interface Player {
  companyName: string;
  /** Nakit ($) */
  money: number;
  /** Şirket seviyesi — filo limiti ve kilit açmalar için kullanılır */
  companyLevel: number;
  /** Ana merkez şehri */
  homeCityId: string;
  /** İtibar (0–100) */
  reputation: number;
  /** Tamamlanan sözleşme sayısı */
  completedContracts: number;
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
  player: Player;
  cities: City[];
  products: Product[];
  routes: Route[];
  contracts: Contract[];
  /** Aktif ve geçmiş teslimatlar */
  activeDeliveries: Delivery[];
  globalEconomy: GlobalEconomy;
  marketNews: MarketNews[];
  /** Oyuncu ve geliştirici olay günlüğü */
  eventLog: GameEvent[];
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

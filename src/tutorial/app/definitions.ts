import type { AppTutorialId, AppTutorialStep } from './types';

export const DASHBOARD_TUTORIAL_STEPS: AppTutorialStep[] = [
  {
    id: 'resource-bar',
    title: 'Kaynak barı',
    description: 'Nakit, şirket seviyen ve deneyim ilerlemen burada görünür.',
    targetId: 'resource-bar',
  },
  {
    id: 'company-summary',
    title: 'Şirket özeti',
    description:
      'Şirket puanın, operasyon durumun ve temel kaynakların burada özetlenir.',
    targetId: 'company-summary',
  },
  {
    id: 'management-tools',
    title: 'Yönetim araçları',
    description: 'Filo, depo, finans ve diğer yönetim alanlarına buradan ulaşabilirsin.',
    targetId: 'management-tools',
  },
  {
    id: 'reputation-card',
    title: 'İtibar',
    description: 'Teslimat performansın ve operasyon kararların şirket itibarını etkiler.',
    targetId: 'reputation-card',
    finalCtaLabel: 'Başlayalım',
  },
];

export const REPUTATION_TUTORIAL_STEPS: AppTutorialStep[] = [
  {
    id: 'reputation-score',
    title: 'İtibarın',
    description: 'Şirketinin güvenilirliğini 0–100 arasında gösterir.',
    targetId: 'reputation-score',
  },
  {
    id: 'reputation-how',
    title: 'Nasıl yükselir?',
    description:
      'Teslimatları zamanında tamamla, sözleşmeleri başarıyla bitir ve operasyonları doğru yönet.',
    targetId: 'reputation-how',
  },
  {
    id: 'reputation-why',
    title: 'Neden önemli?',
    description:
      'Yüksek itibar daha güçlü sözleşmelere ve şirket prestijine katkı sağlar.',
    targetId: 'reputation-why',
    finalCtaLabel: 'Anladım',
  },
];

export const MAP_TUTORIAL_STEPS: AppTutorialStep[] = [
  {
    id: 'cities-warehouses',
    title: 'Şehirler ve depolar',
    description: 'Haritada şehirlerini, depolarını ve operasyon merkezlerini görebilirsin.',
    targetId: 'cities-warehouses',
  },
  {
    id: 'active-routes',
    title: 'Aktif rotalar',
    description: 'Yoldaki kamyonların güzergâhlarını buradan takip edebilirsin.',
    targetId: 'active-routes',
  },
  {
    id: 'truck-tracking',
    title: 'Kamyon takibi',
    description: 'Seçili kamyonun konumunu ve teslimat durumunu izleyebilirsin.',
    targetId: 'truck-tracking',
  },
  {
    id: 'map-filters',
    title: 'Filtreler ve yakınlaştırma',
    description: 'Haritayı filtreleyerek yalnız ihtiyacın olan bilgileri göster.',
    targetId: 'map-filters',
    finalCtaLabel: 'Anladım',
  },
];

export const CONTRACTS_TUTORIAL_STEPS: AppTutorialStep[] = [
  {
    id: 'available-jobs',
    title: 'Müsait işler',
    description: 'Burada alabileceğin sözleşmeleri ve ödül bilgilerini görürsün.',
    targetId: 'available-jobs',
  },
  {
    id: 'city-truck-requirement',
    title: 'Şehirde kamyon şartı',
    description:
      'Bir şehirden sözleşme almak için o şehirde en az bir kamyonun olmalı. Şehirde kamyon yoksa o şehirden iş alınamaz.',
    targetId: 'city-truck-requirement',
  },
  {
    id: 'payment-risk',
    title: 'Ödeme, süre ve risk',
    description: 'Her işin ödeme tutarı, teslim süresi ve risk seviyesini karşılaştır.',
    targetId: 'payment-risk',
  },
  {
    id: 'assignment',
    title: 'Kamyon/şoför atama',
    description: 'Uygun kamyon ve şoförü seçerek teslimatı başlatabilirsin.',
    targetId: 'assignment',
  },
  {
    id: 'active-delivery',
    title: 'Aktif teslimat ve operasyon kararları',
    description: 'Yoldaki teslimatlarda operasyon kararlarını buradan yönetebilirsin.',
    targetId: 'active-delivery',
    finalCtaLabel: 'Anladım',
  },
];

export const CONTRACTS_TUTORIAL_EMPTY_STEPS: AppTutorialStep[] = [
  {
    id: 'contracts-purpose',
    title: 'İşler ekranı',
    description: 'Burada müsait sözleşmeleri görür ve şirketine iş alırsın.',
    targetId: 'contracts-header',
  },
  {
    id: 'contracts-when-ready',
    title: 'Veri geldiğinde',
    description: 'Yeni işler oluştuğunda ödeme, süre ve risk bilgileri burada listelenir.',
  },
  {
    id: 'contracts-city-rule',
    title: 'Şehir kuralı',
    description:
      'Bir şehirden iş almak için o şehirde kamyon bulundurman gerekir.',
    finalCtaLabel: 'Anladım',
  },
];

export const FLEET_TUTORIAL_STEPS: AppTutorialStep[] = [
  {
    id: 'truck-status',
    title: 'Araç durumu',
    description: 'Kamyonlarının konum, durum ve kullanılabilirlik bilgilerini burada görürsün.',
    targetId: 'truck-status',
  },
  {
    id: 'driver-assignment',
    title: 'Şoför ataması',
    description: 'Her kamyona şoför atayarak teslimatları başlatabilirsin.',
    targetId: 'driver-assignment',
  },
  {
    id: 'fuel-maintenance',
    title: 'Yakıt/bakım durumu',
    description: 'Yakıt ve bakım seviyelerini takip ederek arızaları önle.',
    targetId: 'fuel-maintenance',
  },
  {
    id: 'rental-return',
    title: 'Kiralık araç süresi',
    description: 'Kiralık kamyonların süresi ve dönüş durumunu buradan kontrol et.',
    targetId: 'rental-return',
    finalCtaLabel: 'Anladım',
  },
];

export const FLEET_TUTORIAL_EMPTY_STEPS: AppTutorialStep[] = [
  {
    id: 'fleet-purpose',
    title: 'Filo yönetimi',
    description: 'Kamyonlarını, şoförlerini ve araç durumunu buradan yönetirsin.',
    targetId: 'fleet-header',
  },
  {
    id: 'fleet-when-ready',
    title: 'Araç eklediğinde',
    description: 'Mağazadan veya pazardan araç aldığında filo listesi burada görünür.',
  },
  {
    id: 'fleet-next',
    title: 'Sonraki adım',
    description: 'İlk kamyonunu aldıktan sonra şoför atayıp işlere başlayabilirsin.',
    finalCtaLabel: 'Anladım',
  },
];

export const WAREHOUSES_TUTORIAL_STEPS: AppTutorialStep[] = [
  {
    id: 'city-warehouse-link',
    title: 'Şehir ve depo bağlantısı',
    description: 'Her depo belirli bir şehre bağlıdır; stok o şehirde tutulur.',
    targetId: 'city-warehouse-link',
  },
  {
    id: 'capacity',
    title: 'Kapasite',
    description: 'Depo kapasitesini aşmamak için stok seviyelerini takip et.',
    targetId: 'capacity',
  },
  {
    id: 'stock-management',
    title: 'Stok yönetimi',
    description: 'Ürünleri depolar arasında transfer ederek satış fırsatları oluştur.',
    targetId: 'stock-management',
  },
  {
    id: 'special-products',
    title: 'Özel ürün gereksinimleri',
    description: 'Soğuk zincir veya özel ürünler uygun depo tipi gerektirebilir.',
    targetId: 'special-products',
    finalCtaLabel: 'Anladım',
  },
];

export const WAREHOUSES_TUTORIAL_EMPTY_STEPS: AppTutorialStep[] = [
  {
    id: 'warehouse-purpose',
    title: 'Depolar',
    description: 'Satın aldığın ürünleri depolayıp şehirler arası taşıyabilirsin.',
    targetId: 'warehouse-header',
  },
  {
    id: 'warehouse-when-ready',
    title: 'Depo açtığında',
    description: 'İlk deponu kurduğunda kapasite ve stok bilgileri burada görünür.',
  },
  {
    id: 'warehouse-next',
    title: 'Sonraki adım',
    description: 'Piyasadan ürün alıp depoda bekletebilir veya transfer edebilirsin.',
    finalCtaLabel: 'Anladım',
  },
];

export const FINANCE_TUTORIAL_STEPS: AppTutorialStep[] = [
  {
    id: 'cash-flow',
    title: 'Nakit akışı',
    description: 'Şirketinin güncel nakit durumunu ve genel finans özetini burada görürsün.',
    targetId: 'cash-flow',
  },
  {
    id: 'income',
    title: 'Gelirler',
    description: 'Sözleşme, ticaret ve diğer gelir kaynaklarını takip et.',
    targetId: 'income',
  },
  {
    id: 'expenses',
    title: 'Giderler',
    description: 'Yakıt, bakım, maaş ve periyodik işletme giderlerini izle.',
    targetId: 'expenses',
  },
  {
    id: 'net-profit',
    title: 'Net kâr',
    description: 'Gelir ve gider farkından gerçek kârını değerlendir.',
    targetId: 'net-profit',
    finalCtaLabel: 'Anladım',
  },
];

export const VEHICLE_MARKETPLACE_TUTORIAL_STEPS: AppTutorialStep[] = [
  {
    id: 'listings',
    title: 'Satılık araçlar',
    description: 'Oyuncuların satışa çıkardığı araçları burada görebilirsin.',
    targetId: 'listings',
  },
  {
    id: 'filters',
    title: 'Filtreler',
    description: 'Filtrelerle aradığın modeli ve fiyat aralığını bul.',
    targetId: 'filters',
  },
  {
    id: 'create-listing',
    title: 'İlan oluşturma',
    description: 'Kendi uygun aracını satışa çıkararak nakit kazanabilirsin.',
    targetId: 'create-listing-button',
  },
  {
    id: 'my-listings',
    title: 'İlanlarım ve geçmiş',
    description: 'Aktif ilanlarını ve satış geçmişini buradan yönet.',
    targetId: 'my-listings',
    finalCtaLabel: 'Anladım',
  },
];

export const VEHICLE_MARKETPLACE_TUTORIAL_EMPTY_STEPS: AppTutorialStep[] = [
  {
    id: 'marketplace-purpose',
    title: 'Araç Pazarı',
    description: 'Oyuncuların satışa çıkardığı araçları burada görebilirsin.',
    targetId: 'marketplace-header',
  },
  {
    id: 'marketplace-sell',
    title: 'Satışa çıkar',
    description: 'Kendi uygun aracını satışa çıkarabilirsin.',
  },
  {
    id: 'marketplace-filters',
    title: 'Filtreler',
    description: 'Filtrelerle aradığın modeli bulabilirsin.',
    finalCtaLabel: 'Anladım',
  },
];

export const LEADERBOARD_TUTORIAL_STEPS: AppTutorialStep[] = [
  {
    id: 'weekly-season',
    title: 'Haftalık sezon',
    description: 'Liderlik tablosu haftalık sezonlara göre sıralanır.',
    targetId: 'weekly-season',
  },
  {
    id: 'company-ranking',
    title: 'Şirket puanı sıralaması',
    description: 'Şirket puanına göre diğer oyuncularla yarışırsın.',
    targetId: 'company-ranking',
  },
  {
    id: 'my-rank',
    title: 'Kendi sıran',
    description: 'Haftalık sıralamadaki konumunu buradan takip edebilirsin.',
    targetId: 'my-rank',
    finalCtaLabel: 'Anladım',
  },
];

export const LEADERBOARD_TUTORIAL_EMPTY_STEPS: AppTutorialStep[] = [
  {
    id: 'leaderboard-purpose',
    title: 'Liderlik tablosu',
    description: 'Haftalık sezonda şirket puanına göre sıralanırsın.',
    targetId: 'leaderboard-header',
  },
  {
    id: 'leaderboard-when-ready',
    title: 'Veri geldiğinde',
    description: 'Sıralama verileri yüklendiğinde kendi sıranı görebilirsin.',
  },
  {
    id: 'leaderboard-next',
    title: 'Yarış',
    description: 'Sözleşmeleri tamamlayarak şirket puanını artır.',
    finalCtaLabel: 'Anladım',
  },
];

export const ACCOUNT_TUTORIAL_STEPS: AppTutorialStep[] = [
  {
    id: 'profile',
    title: 'Profil ve oyuncu kimliği',
    description: 'Şirket adın ve oyuncu kimliğin burada görünür.',
    targetId: 'profile',
  },
  {
    id: 'cloud-save',
    title: 'Hesap ve bulut kaydı',
    description: 'Hesabını bağlayarak ilerlemeni bulutta güvenle saklayabilirsin.',
    targetId: 'cloud-save',
  },
  {
    id: 'preferences',
    title: 'Tercihler ve destek',
    description: 'Gizlilik, bildirim ve destek seçeneklerine buradan ulaş.',
    targetId: 'preferences',
    finalCtaLabel: 'Anladım',
  },
];

export function getContractsTutorialSteps(hasContracts: boolean): AppTutorialStep[] {
  return hasContracts ? CONTRACTS_TUTORIAL_STEPS : CONTRACTS_TUTORIAL_EMPTY_STEPS;
}

export function getFleetTutorialSteps(hasTrucks: boolean): AppTutorialStep[] {
  return hasTrucks ? FLEET_TUTORIAL_STEPS : FLEET_TUTORIAL_EMPTY_STEPS;
}

export function getWarehousesTutorialSteps(hasWarehouses: boolean): AppTutorialStep[] {
  return hasWarehouses ? WAREHOUSES_TUTORIAL_STEPS : WAREHOUSES_TUTORIAL_EMPTY_STEPS;
}

export function getVehicleMarketplaceTutorialSteps(hasListings: boolean): AppTutorialStep[] {
  return hasListings
    ? VEHICLE_MARKETPLACE_TUTORIAL_STEPS
    : VEHICLE_MARKETPLACE_TUTORIAL_EMPTY_STEPS;
}

export function getLeaderboardTutorialSteps(hasEntries: boolean): AppTutorialStep[] {
  return hasEntries ? LEADERBOARD_TUTORIAL_STEPS : LEADERBOARD_TUTORIAL_EMPTY_STEPS;
}

export function getAppTutorialSteps(
  tutorialId: AppTutorialId,
  options?: {
    hasContracts?: boolean;
    hasTrucks?: boolean;
    hasWarehouses?: boolean;
    hasListings?: boolean;
    hasLeaderboardEntries?: boolean;
  },
): AppTutorialStep[] {
  switch (tutorialId) {
    case 'dashboard':
      return DASHBOARD_TUTORIAL_STEPS;
    case 'reputation':
      return REPUTATION_TUTORIAL_STEPS;
    case 'map':
      return MAP_TUTORIAL_STEPS;
    case 'contracts':
      return getContractsTutorialSteps(options?.hasContracts ?? true);
    case 'fleet':
      return getFleetTutorialSteps(options?.hasTrucks ?? true);
    case 'warehouses':
      return getWarehousesTutorialSteps(options?.hasWarehouses ?? true);
    case 'finance':
      return FINANCE_TUTORIAL_STEPS;
    case 'vehicle-marketplace':
      return getVehicleMarketplaceTutorialSteps(options?.hasListings ?? true);
    case 'leaderboard':
      return getLeaderboardTutorialSteps(options?.hasLeaderboardEntries ?? true);
    case 'account':
      return ACCOUNT_TUTORIAL_STEPS;
    case 'market':
      return [];
    default:
      return [];
  }
}

export const TUTORIAL_HELP_LABELS: Record<AppTutorialId, string> = {
  dashboard: 'Dashboard rehberi',
  map: 'Harita rehberi',
  contracts: 'Sözleşmeler rehberi',
  market: 'Piyasa eğitimi',
  fleet: 'Filo rehberi',
  warehouses: 'Depolar rehberi',
  finance: 'Finans rehberi',
  'vehicle-marketplace': 'Araç Pazarı rehberi',
  leaderboard: 'Liderlik rehberi',
  account: 'Hesap Merkezi rehberi',
  reputation: 'İtibar rehberi',
};

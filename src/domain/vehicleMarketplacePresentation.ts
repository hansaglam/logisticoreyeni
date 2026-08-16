import {
  getMarketplaceKindMessage,
  mapFailureReasonToMarketplaceKind,
} from './marketplaceErrorModel';
import type {
  VehicleMarketplaceListing,
  VehicleMarketplacePage,
} from '../types/vehicleMarketplace';

export type MarketplaceTab = 'available' | 'mine' | 'history';
export type MarketplaceSort =
  | 'newest'
  | 'price-asc'
  | 'price-desc'
  | 'condition-desc'
  | 'mileage-asc';

export interface MarketplaceFilters {
  query: string;
  minPrice?: number;
  maxPrice?: number;
  minCondition?: number;
  maxMileage?: number;
  cityId?: string;
  minUpgradeLevel?: number;
  sort: MarketplaceSort;
}

export const DEFAULT_MARKETPLACE_FILTERS: MarketplaceFilters = {
  query: '',
  sort: 'newest',
};

export type MarketplacePriceAssessment = 'good' | 'fair' | 'high';

export function getMarketplacePriceAssessment(
  askingPrice: number,
  recommendedPrice: number,
): MarketplacePriceAssessment {
  if (!Number.isFinite(recommendedPrice) || recommendedPrice <= 0) return 'fair';
  const ratio = askingPrice / recommendedPrice;
  if (ratio <= 0.94) return 'good';
  if (ratio <= 1.08) return 'fair';
  return 'high';
}

export function getMarketplacePriceLabel(value: MarketplacePriceAssessment): string {
  if (value === 'good') return 'Uygun Fiyat';
  if (value === 'high') return 'Yüksek Fiyat';
  return 'Piyasa Değeri';
}

export function getUpgradeLevel(listing: VehicleMarketplaceListing): number {
  const upgrades = listing.truckSnapshot.upgrades;
  if (!upgrades) return 0;
  return Math.max(upgrades.engine, upgrades.fuelEfficiency, upgrades.cargo, upgrades.durability);
}

export function filterAndSortMarketplaceListings(
  listings: VehicleMarketplaceListing[],
  filters: MarketplaceFilters,
  modelName: (templateId: string) => string,
): VehicleMarketplaceListing[] {
  const query = filters.query.trim().toLocaleLowerCase('tr-TR');
  return listings
    .filter((listing) => {
      const searchable = `${modelName(listing.truckSnapshot.templateId)} ${listing.truckSnapshot.customName ?? ''}`
        .toLocaleLowerCase('tr-TR');
      return (
        (!query || searchable.includes(query)) &&
        (filters.minPrice == null || listing.askingPrice >= filters.minPrice) &&
        (filters.maxPrice == null || listing.askingPrice <= filters.maxPrice) &&
        (filters.minCondition == null || listing.truckSnapshot.condition >= filters.minCondition) &&
        (filters.maxMileage == null || listing.truckSnapshot.totalMileageKm <= filters.maxMileage) &&
        (!filters.cityId || listing.truckSnapshot.currentCityId === filters.cityId) &&
        (filters.minUpgradeLevel == null || getUpgradeLevel(listing) >= filters.minUpgradeLevel)
      );
    })
    .sort((a, b) => {
      if (filters.sort === 'price-asc') return a.askingPrice - b.askingPrice;
      if (filters.sort === 'price-desc') return b.askingPrice - a.askingPrice;
      if (filters.sort === 'condition-desc') {
        return b.truckSnapshot.condition - a.truckSnapshot.condition;
      }
      if (filters.sort === 'mileage-asc') {
        return a.truckSnapshot.totalMileageKm - b.truckSnapshot.totalMileageKm;
      }
      return b.createdAt - a.createdAt;
    });
}

export function mergeMarketplacePage(
  current: VehicleMarketplaceListing[],
  page: Pick<VehicleMarketplacePage, 'listings'>,
): VehicleMarketplaceListing[] {
  const byId = new Map(current.map((listing) => [listing.id, listing]));
  page.listings.forEach((listing) => byId.set(listing.id, listing));
  return [...byId.values()];
}

export function hasActiveMarketplaceFilters(filters: MarketplaceFilters): boolean {
  return (
    filters.query.trim().length > 0 ||
    filters.minPrice != null ||
    filters.maxPrice != null ||
    filters.minCondition != null ||
    filters.maxMileage != null ||
    Boolean(filters.cityId) ||
    filters.minUpgradeLevel != null ||
    filters.sort !== DEFAULT_MARKETPLACE_FILTERS.sort
  );
}

export function getMarketplaceScreenErrorMessage(reason?: string): string {
  return getMarketplaceKindMessage(mapFailureReasonToMarketplaceKind(
    reason as Parameters<typeof mapFailureReasonToMarketplaceKind>[0],
  ));
}

export function getMarketplaceErrorMessage(reason?: string): string {
  switch (reason) {
    case 'auth-required':
    case 'unauthenticated':
      return 'Araç Pazarı’nı kullanmak için hesabını bağla.';
    case 'username-required':
      return 'Araç Pazarı’nı kullanmadan önce kullanıcı adını belirlemelisin.';
    case 'marketplace-state-missing':
      return 'Araç Pazarı hesabın henüz hazırlanmadı. Hesabını senkronize edip tekrar dene.';
    case 'save-conflict':
      return 'Kayıt senkronizasyonu tamamlanmadan araç ilanı oluşturamazsın.';
    case 'truck-not-found':
      return 'Seçilen araç authoritative filo kaydında bulunamadı. Hesabını senkronize edip tekrar dene.';
    case 'not-owner':
      return 'Bu araç seçili hesaba ait değil.';
    case 'network-error':
      return 'İnternet bağlantısı bulunamadı.';
    case 'timeout':
      return 'Araç Pazarı yanıt vermedi. Tekrar deneyin.';
    case 'invalid-request':
      return 'İlanlar şu anda yüklenemiyor. Tekrar dene.';
    case 'function-not-found':
      return 'Araç Pazarı servisi bu sürüm için deploy edilmemiş.';
    case 'permission-denied':
      return 'Araç Pazarı işlemine izin verilmedi. Oturumu yenileyip tekrar dene.';
    case 'service-unavailable':
    case 'marketplace-unavailable':
      return 'Araç Pazarı şu anda kullanılamıyor.';
    case 'listing-sold':
    case 'listing-not-active':
      return 'Bu araç kısa süre önce satıldı.';
    case 'stale-version':
    case 'stale-listing-version':
      return 'İlan bilgileri güncellendi. Tekrar kontrol et.';
    case 'insufficient-funds':
      return 'Bu aracı satın almak için yeterli nakdin yok.';
    case 'fleet-limit':
      return 'Filo kapasiten dolu.';
    case 'self-purchase':
      return 'Kendi ilanını satın alamazsın.';
    case 'truck-busy':
    case 'active-job':
      return 'Aktif görevdeki araç satışa çıkarılamaz.';
    case 'driver-attached':
      return 'Önce araca bağlı şoförü ayırmalısın.';
    case 'trailer-attached':
      return 'Önce araca bağlı dorseyi ayırmalısın.';
    case 'already-listed':
      return 'Bu araç zaten aktif bir ilanda.';
    case 'leased-truck':
      return 'Kiralık araçlar Araç Pazarı’nda satışa çıkarılamaz.';
    case 'invalid-price':
      return 'Satış fiyatı izin verilen aralığın dışında.';
    case 'starter-protection':
      return 'Tek zorunlu aracını satışa çıkaramazsın.';
    case 'rate-limited':
      return 'Çok fazla istek gönderdin. Kısa bir süre sonra tekrar dene.';
    default:
      return 'Araç Pazarı işlemi tamamlanamadı.';
  }
}

export function getMarketplaceCardWidth(screenWidth: number): number {
  return Math.max(0, Math.min(398, screenWidth - 32));
}

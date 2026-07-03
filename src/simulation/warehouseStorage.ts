/**
 * LogistiCore - Depo türü uyumluluğu ve ürün kalite simülasyonu
 */

import { warehouseStorageBalance } from '../config/balance';
import { PRODUCT_BY_ID } from '../data/products';
import type {
  GameEvent,
  Product,
  ProductId,
  ProductStorageRequirement,
  Warehouse,
  WarehouseInventoryItem,
  WarehouseType,
} from '../types/game';

export type StorageSuitability = 'recommended' | 'usable' | 'risky' | 'blocked';

export function resolveWarehouseType(warehouseType?: WarehouseType): WarehouseType {
  return warehouseType ?? 'standard';
}

export function getWarehouseTypeLabel(type: WarehouseType): string {
  switch (type) {
    case 'standard':
      return 'Normal Depo';
    case 'cold':
      return 'Soğuk Depo';
    case 'secure':
      return 'Güvenli Depo';
    case 'heavy':
      return 'Ağır Yük Deposu';
    case 'port':
      return 'Liman Deposu';
    case 'airport':
      return 'Havalimanı Deposu';
    default:
      return 'Depo';
  }
}

export function getDefaultStorageRequirement(): ProductStorageRequirement {
  return {
    preferredWarehouseTypes: ['standard'],
    allowedWarehouseTypes: ['standard', 'cold'],
    spoilageSensitive: false,
    valueLossRatePerDay: 0,
  };
}

export function getProductStorageRequirement(product: Product): ProductStorageRequirement {
  return product.storageRequirement ?? getDefaultStorageRequirement();
}

export function evaluateStorageSuitability(
  product: Product,
  warehouseType: WarehouseType,
): StorageSuitability {
  const requirement = getProductStorageRequirement(product);
  if (!requirement.allowedWarehouseTypes.includes(warehouseType)) {
    return 'blocked';
  }
  if (requirement.preferredWarehouseTypes.includes(warehouseType)) {
    return 'recommended';
  }
  if (requirement.spoilageSensitive) {
    return 'risky';
  }
  return 'usable';
}

export function getSuitabilityLabel(suitability: StorageSuitability): string {
  switch (suitability) {
    case 'recommended':
      return 'Önerilen';
    case 'usable':
      return 'Kullanılabilir';
    case 'risky':
      return 'Riskli';
    case 'blocked':
      return 'Uygun değil';
    default:
      return 'Bilinmiyor';
  }
}

export function getStorageRiskWarning(
  product: Product,
  warehouseType: WarehouseType,
): string | undefined {
  const requirement = getProductStorageRequirement(product);
  const suitability = evaluateStorageSuitability(product, warehouseType);

  if (suitability === 'risky' && requirement.preferredWarehouseTypes.includes('cold')) {
    return 'Bu ürün soğuk depoda saklanmalı. Normal depoda bekletilirse kalite ve satış değeri düşer.';
  }

  if (suitability === 'usable') {
    const preferredLabels = requirement.preferredWarehouseTypes
      .map((type) => getWarehouseTypeLabel(type))
      .join(', ');
    return `Önerilen depo tipi: ${preferredLabels}. Seçtiğin depo uygun ama ideal değil.`;
  }

  return undefined;
}

export function buildStorageWarningForPurchase(
  product: Product,
  warehouseType: WarehouseType,
): string | undefined {
  const suitability = evaluateStorageSuitability(product, warehouseType);
  if (suitability === 'recommended' || suitability === 'blocked') {
    return undefined;
  }
  return (
    getStorageRiskWarning(product, warehouseType) ??
    'Depo tipi ideal değil; ürün zamanla kalite kaybedebilir.'
  );
}

export function clampQuality(value: number): number {
  return Math.max(
    warehouseStorageBalance.minQuality,
    Math.min(warehouseStorageBalance.maxQuality, value),
  );
}

export function getInventoryQuality(item: WarehouseInventoryItem | undefined): number {
  return clampQuality(item?.quality ?? warehouseStorageBalance.maxQuality);
}

export function getEffectiveSellPrice(marketPrice: number, quality: number): number {
  const safeQuality = clampQuality(quality);
  return marketPrice * (safeQuality / 100);
}

export function getWarehouseProtection(
  warehouseType: WarehouseType,
  qualityProtection?: number,
): number {
  if (qualityProtection != null) {
    return qualityProtection;
  }
  switch (warehouseType) {
    case 'cold':
      return warehouseStorageBalance.coldProtection;
    case 'secure':
      return warehouseStorageBalance.secureProtection;
    case 'heavy':
      return warehouseStorageBalance.heavyProtection;
    case 'standard':
    default:
      return warehouseStorageBalance.standardProtection;
  }
}

export function calculateQualityLossForPeriod(
  product: Product,
  warehouseType: WarehouseType,
  warehouseQualityProtection: number | undefined,
  hoursPassed: number,
): number {
  const requirement = getProductStorageRequirement(product);
  const days = hoursPassed / 24;
  if (days <= 0) {
    return 0;
  }

  const protection = getWarehouseProtection(warehouseType, warehouseQualityProtection);
  const isPreferred = requirement.preferredWarehouseTypes.includes(warehouseType);

  if (isPreferred) {
    const baseLoss = (requirement.valueLossRatePerDay ?? 0) * days * 100;
    return baseLoss * (1 - protection) * 0.05;
  }

  if (!requirement.allowedWarehouseTypes.includes(warehouseType)) {
    return 0;
  }

  let rate = requirement.valueLossRatePerDay ?? 0.01;
  if (requirement.spoilageSensitive) {
    rate += requirement.spoilageRatePerDay ?? 0.05;
  }

  return rate * days * 100 * (1 - protection);
}

export function normalizeInventoryItem(
  item: WarehouseInventoryItem,
  warehouse: Warehouse,
  currentTime: number,
): WarehouseInventoryItem {
  const warehouseType = resolveWarehouseType(item.warehouseType ?? warehouse.warehouseType);
  return {
    productId: item.productId,
    quantity: Math.max(0, item.quantity ?? 0),
    averageBuyPrice: Math.max(0, item.averageBuyPrice ?? 0),
    quality: clampQuality(item.quality ?? warehouseStorageBalance.maxQuality),
    storedAt: item.storedAt ?? currentTime,
    lastQualityUpdateAt: item.lastQualityUpdateAt ?? currentTime,
    warehouseType,
    storageWarning: item.storageWarning,
  };
}

export function createInventoryItemOnBuy(
  productId: ProductId,
  quantity: number,
  unitPrice: number,
  warehouse: Warehouse,
  currentTime: number,
  storageWarning?: string,
): WarehouseInventoryItem {
  return {
    productId,
    quantity,
    averageBuyPrice: unitPrice,
    quality: warehouseStorageBalance.maxQuality,
    storedAt: currentTime,
    lastQualityUpdateAt: currentTime,
    warehouseType: resolveWarehouseType(warehouse.warehouseType),
    storageWarning,
  };
}

export function mergeInventoryOnBuyWithQuality(
  inventory: WarehouseInventoryItem[],
  productId: ProductId,
  quantity: number,
  unitPrice: number,
  warehouse: Warehouse,
  currentTime: number,
  storageWarning?: string,
): WarehouseInventoryItem[] {
  const next = inventory.map((item) => normalizeInventoryItem(item, warehouse, currentTime));
  const index = next.findIndex((item) => item.productId === productId);

  if (index < 0) {
    next.push(createInventoryItemOnBuy(productId, quantity, unitPrice, warehouse, currentTime, storageWarning));
    return next;
  }

  const existing = next[index];
  const totalQuantity = existing.quantity + quantity;
  const weightedAverage =
    totalQuantity > 0
      ? (existing.quantity * existing.averageBuyPrice + quantity * unitPrice) / totalQuantity
      : unitPrice;
  const weightedQuality =
    totalQuantity > 0
      ? (existing.quantity * getInventoryQuality(existing) +
          quantity * warehouseStorageBalance.maxQuality) /
        totalQuantity
      : warehouseStorageBalance.maxQuality;

  next[index] = {
    ...existing,
    quantity: totalQuantity,
    averageBuyPrice: weightedAverage,
    quality: clampQuality(weightedQuality),
    lastQualityUpdateAt: currentTime,
    storageWarning: storageWarning ?? existing.storageWarning,
  };
  return next;
}

export function getQualityColorHint(quality: number): 'normal' | 'warning' | 'critical' {
  if (quality < warehouseStorageBalance.criticalQualityWarningThreshold) {
    return 'critical';
  }
  if (quality < warehouseStorageBalance.lowQualityWarningThreshold) {
    return 'warning';
  }
  return 'normal';
}

function hasRecentQualityWarning(
  eventLog: GameEvent[],
  warehouseId: string,
  productId: ProductId,
  currentTime: number,
): boolean {
  const cooldown = warehouseStorageBalance.qualityWarningCooldownHours;
  return (eventLog ?? []).some((event) => {
    if (event.type !== 'warehouse') return false;
    if (currentTime - event.time > cooldown) return false;
    const meta = event.meta as { warehouseId?: string; productId?: ProductId; kind?: string } | undefined;
    return (
      meta?.kind === 'quality_warning' &&
      meta.warehouseId === warehouseId &&
      meta.productId === productId
    );
  });
}

export function processWarehouseQualityDegradation(
  warehouses: Warehouse[],
  currentTime: number,
  hoursPassed: number,
  eventLog: GameEvent[] = [],
): { warehouses: Warehouse[]; newEvents: Array<Omit<GameEvent, 'id'>> } {
  if (hoursPassed <= 0) {
    return { warehouses, newEvents: [] };
  }

  const newEvents: Array<Omit<GameEvent, 'id'>> = [];

  const updatedWarehouses = warehouses.map((warehouse) => {
    const warehouseType = resolveWarehouseType(warehouse.warehouseType);
    const inventory = (warehouse.inventory ?? []).map((rawItem) => {
      const item = normalizeInventoryItem(rawItem, warehouse, currentTime);
      if (item.quantity <= 0) {
        return item;
      }

      const product = PRODUCT_BY_ID[item.productId];
      if (!product) {
        return item;
      }

      const itemWarehouseType = resolveWarehouseType(item.warehouseType ?? warehouseType);
      const qualityLoss = calculateQualityLossForPeriod(
        product,
        itemWarehouseType,
        warehouse.qualityProtection,
        hoursPassed,
      );

      const nextQuality = clampQuality(getInventoryQuality(item) - qualityLoss);
      const updatedItem: WarehouseInventoryItem = {
        ...item,
        quality: nextQuality,
        lastQualityUpdateAt: currentTime,
      };

      if (
        nextQuality < warehouseStorageBalance.criticalQualityWarningThreshold &&
        !hasRecentQualityWarning(eventLog, warehouse.id, item.productId, currentTime) &&
        !newEvents.some(
          (event) =>
            (event.meta as { warehouseId?: string; productId?: ProductId })?.warehouseId ===
              warehouse.id &&
            (event.meta as { productId?: ProductId })?.productId === item.productId,
        )
      ) {
        const productName = product.name;
        newEvents.push({
          time: currentTime,
          type: 'warehouse',
          title: `${productName} kalitesi düşüyor`,
          message: `${getWarehouseDisplayName(warehouse)} deposundaki ${productName} kalitesi %${Math.round(nextQuality)} seviyesine düştü.`,
          importance: 'high',
          meta: {
            kind: 'quality_warning',
            warehouseId: warehouse.id,
            productId: item.productId,
          },
        });
      }

      return updatedItem;
    });

    return {
      ...warehouse,
      inventory,
    };
  });

  return { warehouses: updatedWarehouses, newEvents };
}

export function getWarehouseDisplayName(warehouse: Warehouse): string {
  const type = resolveWarehouseType(warehouse.warehouseType);
  if (type === 'cold') {
    return 'Soğuk depo';
  }
  return 'Depo';
}

export function productNeedsColdStorage(product: Product): boolean {
  const requirement = getProductStorageRequirement(product);
  return requirement.preferredWarehouseTypes.includes('cold');
}

export function cityHasWarehouseType(
  warehouses: Warehouse[],
  cityId: string,
  warehouseType: WarehouseType,
): boolean {
  return warehouses.some(
    (warehouse) =>
      warehouse.cityId === cityId && resolveWarehouseType(warehouse.warehouseType) === warehouseType,
  );
}

export function getRiskConfirmationMessage(
  product: Product,
  selectedWarehouseType: WarehouseType,
): string {
  const requirement = getProductStorageRequirement(product);
  const preferredLabel = requirement.preferredWarehouseTypes
    .map((type) => getWarehouseTypeLabel(type))
    .join(', ');
  const selectedLabel = getWarehouseTypeLabel(selectedWarehouseType);
  return `${product.name} için önerilen depo tipi ${preferredLabel.toLowerCase()}dır. Seçtiğin depo ${selectedLabel.toLowerCase()}. Ürün zamanla kalite kaybedebilir. Yine de satın almak istiyor musun?`;
}

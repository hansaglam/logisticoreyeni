/**
 * Depo işlemleri — structured reason ve kullanıcı mesajları.
 */

import type { Product, TradeActionResult, WarehouseActionReason, WarehouseType } from '../types/game';
import {
  evaluateStorageSuitability,
  getProductStorageRequirement,
  resolveWarehouseType,
} from './warehouseStorage';

export const COLD_STORAGE_REQUIRED_MESSAGE =
  'Bu ürün soğuk zincir gerektiriyor. Bu şehirde Soğuk Depo açmalısın.';

export function tradeFail(
  reason: WarehouseActionReason,
  message: string,
  errorCode?: TradeActionResult['errorCode'],
): TradeActionResult {
  return {
    success: false,
    reason,
    message,
    ...(errorCode ? { errorCode } : {}),
  };
}

export function tradeOk(message: string): TradeActionResult {
  return { success: true, message };
}

export function requiresColdStorage(product: Product): boolean {
  const requirement = getProductStorageRequirement(product);
  return (
    requirement.preferredWarehouseTypes.includes('cold') &&
    !requirement.allowedWarehouseTypes.some((type) => type !== 'cold')
  );
}

/** Satın alma / depolama için depo tipi engeli sonucu */
export function resolveStorageBlockResult(
  product: Product,
  warehouseType: WarehouseType | undefined,
): TradeActionResult | null {
  const resolved = resolveWarehouseType(warehouseType);
  const suitability = evaluateStorageSuitability(product, resolved);
  if (suitability !== 'blocked') {
    return null;
  }

  if (requiresColdStorage(product) || getProductStorageRequirement(product).preferredWarehouseTypes.includes('cold')) {
    if (resolved !== 'cold') {
      return tradeFail('cold-storage-required', COLD_STORAGE_REQUIRED_MESSAGE, 'INCOMPATIBLE_WAREHOUSE');
    }
  }

  return tradeFail(
    'incompatible-warehouse',
    'Bu ürün bu depo tipinde saklanamaz.',
    'INCOMPATIBLE_WAREHOUSE',
  );
}

export function formatWarehouseLimitReachedMessage(currentCount: number, maxCount: number): string {
  return `Depo limitin dolu: ${currentCount}/${maxCount}. Yeni depo açmak için şirket seviyeni yükselt.`;
}

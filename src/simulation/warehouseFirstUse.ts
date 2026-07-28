/**
 * İlk depo kullanımı — büyük onboarding motoru yazmadan UI’ya rehber state.
 */

import type { Warehouse } from '../types/game';
import { normalizeWarehouseInventory } from './trading';

export interface WarehouseFirstUseGuidance {
  isEmpty: boolean;
  steps: Array<{
    id: 'go-to-market' | 'buy-product' | 'watch-stock' | 'sell-or-transfer';
    label: string;
  }>;
}

export function getWarehouseFirstUseGuidance(
  warehouse: Warehouse | null | undefined,
): WarehouseFirstUseGuidance | null {
  if (!warehouse) {
    return null;
  }

  const inventory = normalizeWarehouseInventory(warehouse);
  const hasStock = inventory.some((item) => item.quantity > 0);
  if (hasStock) {
    return null;
  }

  return {
    isEmpty: true,
    steps: [
      { id: 'go-to-market', label: 'Markete git' },
      { id: 'buy-product', label: 'Ürün satın al' },
      { id: 'watch-stock', label: 'Stokları izle' },
      { id: 'sell-or-transfer', label: 'Uygun zamanda sat veya taşı' },
    ],
  };
}

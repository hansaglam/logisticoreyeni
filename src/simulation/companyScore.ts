/**
 * Şirket puanı (Company Score) — haftalık leaderboard sıralamasının temeli.
 *
 * Sıralama yalnızca nakit paraya göre değil; filo, depo, stok, teslimat ve
 * itibar bileşenlerinin birleşimiyle hesaplanır.
 */

import { companyScoreBalance, warehouseBalance } from '../config/balance';
import { CITIES_BY_ID } from '../data/cities';
import { PRODUCT_BY_ID } from '../data/products';
import type {
  City,
  CompanyScoreBreakdown,
  FinanceLedgerEntry,
  Product,
  StoreGameState,
  Truck,
  Warehouse,
} from '../types/game';
import { getCityProductMarketPrice, normalizeWarehouse } from './trading';

export type { CompanyScoreBreakdown } from '../types/game';

export type CompanyScoreGameState = Pick<
  StoreGameState,
  'player' | 'cities' | 'products' | 'financeLedger' | 'currentTime'
>;

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value);
}

export function formatCompanyScore(value: number): string {
  const rounded = clampScore(value);
  const sign = rounded < 0 ? '-' : '';
  return `${sign}${Math.abs(rounded).toLocaleString('en-US')}`;
}

export function calculateTruckValue(trucks: Truck[] | undefined): number {
  return (trucks ?? []).reduce((sum, truck) => {
    if (truck.leaseExpired) return sum;
    const ownershipMultiplier = (truck.ownershipType ?? 'owned') === 'leased' ? 0.35 : 1;
    const purchasePrice = truck.purchasePrice ?? 0;
    const condition = Math.max(0, Math.min(100, truck.condition ?? 100));
    return sum + purchasePrice * (condition / 100) * ownershipMultiplier;
  }, 0);
}

export function calculateWarehouseValue(warehouses: Warehouse[] | undefined): number {
  return (warehouses ?? []).reduce((sum, warehouse) => {
    const capacity = warehouse.capacityTons ?? 0;
    const tier = Math.max(1, warehouse.upgradeTier ?? 1);
    const tierBonus = 1 + (tier - 1) * companyScoreBalance.warehouseTierBonusRate;
    return sum + capacity * warehouseBalance.capacityValueMultiplier * tierBonus;
  }, 0);
}

export function calculateInventoryValue(
  warehouses: Warehouse[] | undefined,
  cities: City[] | undefined,
  _products: Product[] | undefined,
): number {
  const cityById = new Map((cities ?? []).map((city) => [city.id, city]));

  let total = 0;
  for (const warehouse of warehouses ?? []) {
    const city = cityById.get(warehouse.cityId) ?? CITIES_BY_ID[warehouse.cityId];
    const inventory = normalizeWarehouse(warehouse).inventory ?? [];

    for (const item of inventory) {
      const quantity = item.quantity ?? 0;
      if (quantity <= 0) continue;

      const product = PRODUCT_BY_ID[item.productId];
      if (!product) continue;

      const unitPrice = city ? getCityProductMarketPrice(city, item.productId) : 0;
      const safePrice = Number.isFinite(unitPrice) ? unitPrice : 0;
      total += quantity * safePrice;
    }
  }

  return Number.isFinite(total) ? total : 0;
}

export function calculateWeeklyTradeProfit(
  financeLedger: FinanceLedgerEntry[] | undefined,
  currentTime: number,
): number {
  const windowStart = currentTime - companyScoreBalance.weeklyHours;
  let purchases = 0;
  let sales = 0;

  for (const entry of financeLedger ?? []) {
    if (entry.time < windowStart) continue;
    if (entry.category === 'trade_purchase' && entry.type === 'expense') {
      purchases += entry.amount ?? 0;
    }
    if (entry.category === 'trade_sale' && entry.type === 'income') {
      sales += entry.amount ?? 0;
    }
  }

  return sales - purchases;
}

export function getCompanyScoreBreakdown(state: CompanyScoreGameState): CompanyScoreBreakdown {
  const player = state.player;
  const trucks = player?.trucks ?? [];
  const warehouses = player?.warehouses ?? [];
  const cash = player?.money ?? 0;
  const completedContracts = player?.completedContracts ?? 0;
  const reputation = player?.reputation ?? 0;
  const level = Math.max(1, player?.level ?? player?.companyLevel ?? 1);
  const failedDeliveries = player?.failedDeliveries ?? 0;
  const lateDeliveries = player?.lateDeliveries ?? 0;

  const truckValue = calculateTruckValue(trucks);
  const warehouseValue = calculateWarehouseValue(warehouses);
  const inventoryValue = calculateInventoryValue(warehouses, state.cities, state.products);
  const weeklyTradeProfit = calculateWeeklyTradeProfit(state.financeLedger, state.currentTime);

  const cashScore = cash;
  const truckValueScore = truckValue * companyScoreBalance.truckValueWeight;
  const warehouseValueScore = warehouseValue * companyScoreBalance.warehouseValueWeight;
  const inventoryValueScore = inventoryValue * companyScoreBalance.inventoryValueWeight;
  const completedContractsScore = completedContracts * companyScoreBalance.completedContractBonus;
  const reputationScore = reputation * companyScoreBalance.reputationBonusPerPoint;
  const levelScore = level * companyScoreBalance.levelBonusPerLevel;
  const weeklyTradeProfitScore = weeklyTradeProfit * companyScoreBalance.weeklyTradeProfitWeight;

  const penaltiesScore =
    failedDeliveries * companyScoreBalance.failedDeliveryPenalty +
    lateDeliveries * companyScoreBalance.lateDeliveryPenalty;

  const totalScore = clampScore(
    cashScore +
      truckValueScore +
      warehouseValueScore +
      inventoryValueScore +
      completedContractsScore +
      reputationScore +
      levelScore +
      weeklyTradeProfitScore -
      penaltiesScore,
  );

  return {
    cashScore: clampScore(cashScore),
    truckValueScore: clampScore(truckValueScore),
    warehouseValueScore: clampScore(warehouseValueScore),
    inventoryValueScore: clampScore(inventoryValueScore),
    completedContractsScore: clampScore(completedContractsScore),
    reputationScore: clampScore(reputationScore),
    levelScore: clampScore(levelScore),
    weeklyTradeProfitScore: clampScore(weeklyTradeProfitScore),
    penaltiesScore: clampScore(-penaltiesScore),
    totalScore,
    truckValue: clampScore(truckValue),
    warehouseValue: clampScore(warehouseValue),
    inventoryValue: clampScore(inventoryValue),
    weeklyTradeProfit: clampScore(weeklyTradeProfit),
    failedDeliveries,
    lateDeliveries,
  };
}

export function calculateCompanyScore(state: CompanyScoreGameState): number {
  return getCompanyScoreBreakdown(state).totalScore;
}

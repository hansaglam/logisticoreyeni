/**
 * Soft-lock kurtarma — -$5,000 tabanında alınabilir acil operasyon sözleşmeleri.
 * Bedava para vermez; düşük maliyetli, kısa rota, pozitif net kârlı işler üretir.
 */

import { economyBalance, financeBalance, operatingCostBalance } from '../config/balance';
import type {
  Contract,
  GlobalEconomy,
  Product,
  Route,
  Truck,
} from '../types/game';
import { sanitizeFuelPricePerLiter } from './economy';
import { estimateContractTripCostBreakdown } from './contractEconomics';
import { calculateRoadsideFuelQuote } from './roadsideFuel';
import { applyCashTransaction, type CashTransactionResult } from '../utils/cashPolicy';

export type ContractAcceptanceBlockReason =
  | 'insufficient-cash'
  | 'insufficient-fuel'
  | 'no-truck'
  | 'no-driver'
  | 'no-trailer'
  | 'wrong-city'
  | 'insufficient-capacity'
  | 'route-not-found'
  | 'event-restriction'
  | 'contract-expired'
  | 'negative-profit-warning';

export const EMERGENCY_CONTRACT_PREFIX = 'emergency_op_';
export const CASH_RECOVERY_TRANSACTION_ID = 'recovery-assistance:v1';

export function isSoftLockedCash(money: number): boolean {
  const threshold =
    financeBalance.softLockRecoveryThreshold ??
    operatingCostBalance.softLockCashThreshold ??
    0;
  return Number.isFinite(money) && money < threshold;
}

export function evaluateSoftLockCashRecovery(params: {
  money: number;
  trucks: Truck[];
  alreadyGrantedAtMs?: number | null;
}): {
  allowed: boolean;
  reason?: 'not-at-floor' | 'already-used' | 'no-eligible-truck';
  transaction?: CashTransactionResult;
} {
  if (params.alreadyGrantedAtMs != null) {
    return { allowed: false, reason: 'already-used' };
  }
  if (
    !Number.isFinite(params.money) ||
    params.money > financeBalance.minCashBalance
  ) {
    return { allowed: false, reason: 'not-at-floor' };
  }
  const eligibleTruck = (params.trucks ?? []).find(
    (truck) =>
      truck.status === 'idle' &&
      !truck.leaseExpired &&
      (truck.currentFuelL ?? 0) <= 1e-6,
  );
  if (!eligibleTruck) {
    return { allowed: false, reason: 'no-eligible-truck' };
  }
  const targetCash = Math.max(
    0,
    financeBalance.softLockRecoveryCashTarget,
  );
  const amount = targetCash - params.money;
  const transaction = applyCashTransaction({
    currentCash: params.money,
    amount,
    kind: 'income',
    referenceId: CASH_RECOVERY_TRANSACTION_ID,
    transactionId: CASH_RECOVERY_TRANSACTION_ID,
  });
  return transaction.ok
    ? { allowed: true, transaction }
    : { allowed: false, reason: 'already-used' };
}

export function isEmergencyContract(contract: Pick<Contract, 'id' | 'contractType'>): boolean {
  return (
    contract.contractType === 'urgent' &&
    typeof contract.id === 'string' &&
    contract.id.startsWith(EMERGENCY_CONTRACT_PREFIX)
  );
}

export function countEmergencyContracts(contracts: Contract[]): number {
  return contracts.filter(
    (c) => c.status === 'available' && isEmergencyContract(c),
  ).length;
}

/**
 * Acil operasyon sözleşmesi — düşük tonaj, kısa mesafe, garantili pozitif kâr.
 */
export function buildEmergencyOperationContract(params: {
  originCityId: string;
  destinationCityId: string;
  product: Product;
  route: Route;
  globalEconomy: GlobalEconomy;
  currentTime: number;
  truckCapacity: number;
  sequence: number;
  nowMs?: number;
}): Contract | null {
  const distanceKm = Math.max(1, params.route.distanceKm ?? 80);
  // Kısa rota tercihi; ağda yoksa en kısa mevcut rota kullanılır (üst sınır ~600km)
  if (distanceKm > 600) {
    return null;
  }

  const amount = Math.max(
    3,
    Math.min(8, Math.floor(Math.max(3, params.truckCapacity * 0.35))),
  );
  const fuelPrice = sanitizeFuelPricePerLiter(params.globalEconomy.fuelPrice);
  const breakdown = estimateContractTripCostBreakdown({
    amount,
    route: {
      ...params.route,
      distanceKm,
      difficulty: Math.min(0.35, params.route.difficulty ?? 0.3),
    },
    urgency: 0.55,
    globalEconomy: { ...params.globalEconomy, fuelPrice },
  });

  const minProfit = Math.max(400, Math.round(breakdown.baseTripCost * 0.12));
  const payment = Math.max(
    breakdown.baseTripCost + minProfit,
    Math.round(breakdown.baseTripCost * 1.2),
  );

  // Düşük nakit — peşin yakıt yükü makul olmalı
  if (breakdown.fuelCost > 2500) {
    return null;
  }

  const nowMs = params.nowMs ?? Date.now();
  const id = `${EMERGENCY_CONTRACT_PREFIX}${params.originCityId}_${params.sequence}_${Math.floor(nowMs / 60_000)}`;

  return {
    id,
    originCityId: params.originCityId,
    destinationCityId: params.destinationCityId,
    productId: params.product.id,
    amount,
    cargoWeight: amount,
    payment,
    deadlineHours: Math.max(4, Math.ceil(distanceKm / 55) + 2),
    distanceKm,
    urgency: 0.7,
    status: 'available',
    createdAt: params.currentTime,
    expiresAt: params.currentTime + 8,
    requiredLevel: 1,
    contractType: 'urgent',
    riskLevel: 'low',
  };
}

export function ensureEmergencyContractsForSoftLock(params: {
  money: number;
  contracts: Contract[];
  trucks: Truck[];
  products: Product[];
  routes: Route[];
  globalEconomy: GlobalEconomy;
  currentTime: number;
  homeCityId?: string;
  lastEmergencyContractAtMs?: number | null;
  nowMs: number;
}): { contracts: Contract[]; added: Contract[] } {
  if (!isSoftLockedCash(params.money)) {
    return { contracts: params.contracts, added: [] };
  }

  const cooldown =
    operatingCostBalance.emergencyContractCooldownMs ?? 30 * 60 * 1000;
  const lastAt = params.lastEmergencyContractAtMs ?? 0;
  if (params.nowMs - lastAt < cooldown && countEmergencyContracts(params.contracts) > 0) {
    return { contracts: params.contracts, added: [] };
  }

  const maxEmergency = operatingCostBalance.maxEmergencyContracts ?? 2;
  const existing = countEmergencyContracts(params.contracts);
  if (existing >= maxEmergency) {
    return { contracts: params.contracts, added: [] };
  }

  const idleTruck = (params.trucks ?? []).find(
    (t) => t.status === 'idle' && !t.leaseExpired && (t.capacity ?? 0) > 0,
  );
  if (!idleTruck) {
    return { contracts: params.contracts, added: [] };
  }

  const originCityId =
    idleTruck.currentCityId ?? params.homeCityId ?? 'izmir';
  const product = params.products[0];
  if (!product) {
    return { contracts: params.contracts, added: [] };
  }

  const candidateRoutes = (params.routes ?? [])
    .filter((r) => r.fromCityId === originCityId)
    .sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));

  const added: Contract[] = [];
  let sequence = 1;
  for (const route of candidateRoutes) {
    if (existing + added.length >= maxEmergency) break;
    const dest = route.toCityId;
    if (!dest || dest === originCityId) continue;

    const contract = buildEmergencyOperationContract({
      originCityId,
      destinationCityId: dest,
      product,
      route,
      globalEconomy: params.globalEconomy,
      currentTime: params.currentTime,
      truckCapacity: idleTruck.capacity ?? 10,
      sequence,
      nowMs: params.nowMs,
    });
    sequence += 1;
    if (!contract) continue;
    if (params.contracts.some((c) => c.id === contract.id)) continue;
    added.push(contract);
  }

  if (added.length === 0) {
    return { contracts: params.contracts, added: [] };
  }

  return {
    contracts: [...params.contracts, ...added],
    added,
  };
}

export type RoadsideAssistanceBlockReason =
  | 'not-needed'
  | 'can-afford'
  | 'already-used'
  | 'cooldown';

export function evaluateRoadsideFuelAssistance(params: {
  truck: Truck;
  money: number;
  fuelPrice: number;
  currentTime: number;
  lastAssistanceAt?: number | null;
  jobAssistanceGrantedAt?: number | null;
}): {
  allowed: boolean;
  reason?: RoadsideAssistanceBlockReason;
  liters: number;
  avoidedCost: number;
} {
  const liters = economyBalance.minimumEmergencyFuelLiters;
  const quote = calculateRoadsideFuelQuote(params.truck, liters, params.fuelPrice);
  if ((params.truck.currentFuelL ?? 0) > 1e-6) {
    return { allowed: false, reason: 'not-needed', liters, avoidedCost: quote.totalCost };
  }
  if (params.money + 1e-6 >= quote.totalCost) {
    return { allowed: false, reason: 'can-afford', liters, avoidedCost: quote.totalCost };
  }
  if (params.jobAssistanceGrantedAt != null) {
    return { allowed: false, reason: 'already-used', liters, avoidedCost: quote.totalCost };
  }
  const lastAt = params.lastAssistanceAt;
  if (
    lastAt != null &&
    params.currentTime - lastAt < economyBalance.roadsideAssistanceCooldownHours
  ) {
    return { allowed: false, reason: 'cooldown', liters, avoidedCost: quote.totalCost };
  }
  return { allowed: true, liters, avoidedCost: quote.totalCost };
}

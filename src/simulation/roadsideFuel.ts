import { economyBalance } from '../config/balance';
import type {
  Delivery,
  Truck,
  TruckTransfer,
  WarehouseStockTransfer,
} from '../types/game';
import { calculateTruckRefuelQuote, normalizeTruckFuel } from '../utils/truckFuel';
import { getJobRemainingFuelRequiredL } from './fuelWarnings';

export type RoadsideFuelJobType = 'delivery' | 'truck-transfer' | 'warehouse-transfer';
export type RoadsideFuelJob = Delivery | TruckTransfer | WarehouseStockTransfer;
export type RoadsideFuelReason =
  | 'job-not-found'
  | 'job-not-out-of-fuel'
  | 'truck-not-found'
  | 'invalid-quantity'
  | 'tank-full'
  | 'insufficient-funds'
  | 'price-changed'
  | 'market-unavailable'
  | 'assistance-cooldown'
  | 'assistance-already-used';

export interface RoadsideFuelResult {
  success: boolean;
  reason?: RoadsideFuelReason;
  message: string;
  litersAdded?: number;
  fuelCost?: number;
  serviceFee?: number;
  totalCost?: number;
  newFuelL?: number;
  routeFuelWarning?: string;
  source?: 'roadside-emergency';
}

export interface RoadsideFuelQuote {
  litersToAdd: number;
  newFuelL: number;
  fuelTankCapacityL: number;
  normalUnitPrice: number;
  roadsideUnitPrice: number;
  fuelCost: number;
  serviceFee: number;
  totalCost: number;
  source: 'roadside-emergency';
}

export function isOutOfFuelRoadsideJob(job: RoadsideFuelJob | undefined): boolean {
  return !!job && job.status === 'paused' && job.pausedReason === 'out-of-fuel';
}

export function getRoadsideFuelLitersToDestination(job: RoadsideFuelJob): number {
  return Math.max(0, getJobRemainingFuelRequiredL(job));
}

export function resumeRoadsideJob<T extends RoadsideFuelJob>(
  job: T,
  jobType: RoadsideFuelJobType,
  options: {
    litersAdded: number;
    roadsideAssistanceGrantedAt?: number;
  },
): T {
  return {
    ...job,
    status: (jobType === 'delivery' ? 'on_route' : 'active') as T['status'],
    pausedReason: undefined,
    fuelWarningsEmitted: (job.fuelWarningsEmitted ?? []).filter((key) => key !== 'out-of-fuel'),
    fuelLitersAtStart: Math.max(0, job.fuelLitersAtStart ?? 0) + Math.max(0, options.litersAdded),
    ...(options.roadsideAssistanceGrantedAt != null
      ? { roadsideAssistanceGrantedAt: options.roadsideAssistanceGrantedAt }
      : {}),
  };
}

export function calculateRoadsideFuelQuote(
  truck: Truck,
  requestedLiters: number,
  normalUnitPrice: number,
): RoadsideFuelQuote {
  const safeNormalPrice = Math.max(0, Number(normalUnitPrice) || 0);
  const roadsideUnitPrice =
    safeNormalPrice * economyBalance.roadsideFuelPriceMultiplier;
  const tankQuote = calculateTruckRefuelQuote(truck, requestedLiters, roadsideUnitPrice);
  const fuelCost = Number((tankQuote.litersToAdd * roadsideUnitPrice).toFixed(2));
  const serviceFee = economyBalance.roadsideFuelServiceBaseFee;
  return {
    litersToAdd: tankQuote.litersToAdd,
    newFuelL: tankQuote.newFuelL,
    fuelTankCapacityL: tankQuote.fuelTankCapacityL,
    normalUnitPrice: safeNormalPrice,
    roadsideUnitPrice,
    fuelCost,
    serviceFee,
    totalCost: Number((fuelCost + serviceFee).toFixed(2)),
    source: 'roadside-emergency',
  };
}

export function validateRoadsideFuelPurchase(input: {
  job: RoadsideFuelJob | undefined;
  truck: Truck | undefined;
  requestedLiters: number;
  currentMoney: number;
  currentUnitPrice: number;
  expectedUnitPrice: number;
}): { result: RoadsideFuelResult; quote?: RoadsideFuelQuote } {
  if (!input.job) {
    return { result: { success: false, reason: 'job-not-found', message: 'Aktif iş bulunamadı.' } };
  }
  if (!isOutOfFuelRoadsideJob(input.job)) {
    return {
      result: {
        success: false,
        reason: 'job-not-out-of-fuel',
        message: 'Acil yakıt yalnız rota üzerinde yakıtsız kalan araç için kullanılabilir.',
      },
    };
  }
  if (!input.truck) {
    return { result: { success: false, reason: 'truck-not-found', message: 'Kamyon bulunamadı.' } };
  }
  if (
    !Number.isFinite(input.expectedUnitPrice) ||
    Math.abs(input.expectedUnitPrice - input.currentUnitPrice) >= 0.005
  ) {
    return {
      result: {
        success: false,
        reason: 'price-changed',
        message: 'Yakıt fiyatı güncellendi. Yeni toplamı kontrol et.',
      },
    };
  }
  const normalized = normalizeTruckFuel(input.truck);
  if (
    (normalized.currentFuelL ?? 0) >=
    (normalized.fuelTankCapacityL ?? 0) - 1e-6
  ) {
    return {
      result: { success: false, reason: 'tank-full', message: 'Yakıt deposu zaten dolu.' },
    };
  }
  if (!Number.isFinite(input.requestedLiters) || input.requestedLiters <= 0) {
    return {
      result: { success: false, reason: 'invalid-quantity', message: 'Geçerli bir miktar seç.' },
    };
  }
  const quote = calculateRoadsideFuelQuote(
    normalized,
    input.requestedLiters,
    input.currentUnitPrice,
  );
  if (quote.litersToAdd <= 0) {
    return {
      result: { success: false, reason: 'invalid-quantity', message: 'Geçerli bir miktar seç.' },
    };
  }
  if (input.currentMoney + 1e-6 < quote.totalCost) {
    return {
      result: {
        success: false,
        reason: 'insufficient-funds',
        message: 'Acil yakıt için yeterli nakdin yok.',
        fuelCost: quote.fuelCost,
        serviceFee: quote.serviceFee,
        totalCost: quote.totalCost,
        source: quote.source,
      },
    };
  }
  return {
    quote,
    result: {
      success: true,
      message: `${quote.litersToAdd.toFixed(1)} L acil yakıt teslim edildi.`,
      litersAdded: quote.litersToAdd,
      fuelCost: quote.fuelCost,
      serviceFee: quote.serviceFee,
      totalCost: quote.totalCost,
      source: quote.source,
    },
  };
}

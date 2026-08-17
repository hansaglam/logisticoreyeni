import type { FuelWarningKey, JobPausedReason, Truck } from '../types/game';
import { getTruckFuelPercent, getTruckRangeKm, normalizeTruckFuel } from '../utils/truckFuel';
import { clamp } from '../utils/math';

export interface FuelWarningJob {
  id: string;
  status: string;
  pausedReason?: JobPausedReason;
  progress: number;
  fuelLitersTotal?: number;
  distanceKm?: number;
  routeDistanceKm?: number;
  fuelWarningsEmitted?: FuelWarningKey[];
}

export interface FuelWarning {
  key: FuelWarningKey;
  title: string;
  message: string;
  priority: number;
  fuelPercent: number;
  remainingRangeKm: number;
}

export interface FuelWarningEvaluation {
  warning: FuelWarning | null;
  fuelWarningsEmitted: FuelWarningKey[];
}

const FUEL_EPSILON_L = 1e-6;

export function getJobRemainingDistanceKm(job: FuelWarningJob): number {
  const totalDistance = Math.max(0, job.distanceKm ?? job.routeDistanceKm ?? 0);
  return totalDistance * (1 - clamp(job.progress, 0, 1));
}

export function getJobRemainingFuelRequiredL(job: FuelWarningJob): number {
  return Math.max(0, job.fuelLitersTotal ?? 0) * (1 - clamp(job.progress, 0, 1));
}

export function getFuelWarningForJob(
  job: FuelWarningJob | null | undefined,
  truck: Truck | null | undefined,
): FuelWarning | null {
  if (!job || !truck || clamp(job.progress, 0, 1) >= 1) return null;

  const normalized = normalizeTruckFuel(truck);
  const currentFuelL = normalized.currentFuelL ?? 0;
  const fuelPercent = getTruckFuelPercent(normalized);
  const remainingDistanceKm = getJobRemainingDistanceKm(job);
  const remainingFuelRequiredL = getJobRemainingFuelRequiredL(job);
  const rangeFromJob =
    remainingFuelRequiredL > FUEL_EPSILON_L
      ? remainingDistanceKm * (currentFuelL / remainingFuelRequiredL)
      : getTruckRangeKm(normalized);
  const remainingRangeKm = Math.max(
    0,
    Number.isFinite(rangeFromJob) ? Math.floor(rangeFromJob) : 0,
  );

  if (currentFuelL <= FUEL_EPSILON_L) {
    return {
      key: 'out-of-fuel',
      title: 'ARAÇ YAKITSIZ KALDI',
      message:
        'Teslimat ilerlemiyor ancak son teslim süresi işlemeye devam ediyor. Gecikme cezası almamak için araca yakıt ekle.',
      priority: 1,
      fuelPercent,
      remainingRangeKm: 0,
    };
  }
  if (
    remainingFuelRequiredL > FUEL_EPSILON_L &&
    currentFuelL + FUEL_EPSILON_L < remainingFuelRequiredL
  ) {
    return {
      key: 'insufficient-range',
      title: 'Rota için yakıt yetersiz',
      message: 'Mevcut yakıt hedefe ulaşmak için yeterli değil.',
      priority: 2,
      fuelPercent,
      remainingRangeKm,
    };
  }
  if (fuelPercent <= 10) {
    return {
      key: 'critical-fuel',
      title: 'Kritik yakıt',
      message: `Kritik yakıt: %${fuelPercent}.`,
      priority: 3,
      fuelPercent,
      remainingRangeKm,
    };
  }
  if (fuelPercent <= 25) {
    return {
      key: 'low-fuel',
      title: 'Yakıt azalıyor',
      message: `Yakıt azalıyor. Yaklaşık ${remainingRangeKm} km menzil kaldı.`,
      priority: 4,
      fuelPercent,
      remainingRangeKm,
    };
  }
  return null;
}

function getApplicableWarningKeys(job: FuelWarningJob, truck: Truck): FuelWarningKey[] {
  const warning = getFuelWarningForJob(job, truck);
  if (!warning) return [];
  const keys: FuelWarningKey[] = [warning.key];
  const percent = getTruckFuelPercent(normalizeTruckFuel(truck));
  if (percent <= 25) keys.push('low-fuel');
  if (percent <= 10) keys.push('critical-fuel');
  if (warning.key === 'out-of-fuel') {
    keys.push('insufficient-range');
  }
  return [...new Set(keys)];
}

/**
 * En yüksek öncelikli görünür uyarıyı döndürür ve aynı anda aşılmış alt
 * eşikleri de işaretler; böylece sonraki tick'te ardışık toast spam'i oluşmaz.
 */
export function evaluateFuelWarning(
  job: FuelWarningJob,
  truck: Truck,
): FuelWarningEvaluation {
  const existing = job.fuelWarningsEmitted ?? [];
  const warning = getFuelWarningForJob(job, truck);
  if (!warning) {
    return { warning: null, fuelWarningsEmitted: existing };
  }
  const applicable = getApplicableWarningKeys(job, truck);
  const fuelWarningsEmitted = [...new Set([...existing, ...applicable])];
  return {
    warning: existing.includes(warning.key) ? null : warning,
    fuelWarningsEmitted,
  };
}

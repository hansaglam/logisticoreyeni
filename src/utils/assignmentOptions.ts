/**
 * Kamyon / şoför uygunluk değerlendirmesi — ekip seçimi ekranları için ortak kaynak.
 */

import { resolveTruckCityId } from '../simulation/delivery';
import {
  canTruckCarryCargo,
  getTruckEffectiveCapacityTons,
} from '../simulation/capacity';
import { getCityName } from './entityLookup';
import type { Driver, Truck } from '../types/game';

export const MIN_TRUCK_CONDITION = 30;
export const LOW_CONDITION_WARNING = 50;

export type TruckIssue =
  | 'eligible'
  | 'on_route'
  | 'maintenance'
  | 'wrong_city'
  | 'capacity'
  | 'condition_blocked'
  | 'condition_warning';

export type DriverIssue = 'eligible' | 'on_route' | 'resting';

export interface TruckOption {
  truck: Truck;
  issue: TruckIssue;
  label: string;
  selectable: boolean;
}

export interface DriverOption {
  driver: Driver;
  issue: DriverIssue;
  label: string;
  selectable: boolean;
}

export function evaluateTruckOption(
  truck: Truck,
  cargoWeight: number,
  originCityId: string,
  trailers?: import('../types/game').Trailer[],
): TruckOption {
  const capacity = getTruckEffectiveCapacityTons(truck, trailers);
  const condition = truck.condition ?? 100;

  if (truck.status === 'on_route') {
    return { truck, issue: 'on_route', label: 'Teslimatta', selectable: false };
  }
  if (truck.status === 'transferring') {
    return { truck, issue: 'on_route', label: 'Yönlendiriliyor', selectable: false };
  }
  if (truck.status === 'maintenance') {
    return { truck, issue: 'maintenance', label: 'Bakım gerekli', selectable: false };
  }
  if (truck.status !== 'idle') {
    return { truck, issue: 'on_route', label: 'Müsait değil', selectable: false };
  }

  const truckCityId = resolveTruckCityId(truck);
  if (originCityId && truckCityId !== originCityId) {
    const cityName = getCityName(truckCityId);
    return {
      truck,
      issue: 'wrong_city',
      label: `${cityName}'da · çıkış şehrinde değil`,
      selectable: false,
    };
  }

  if (!canTruckCarryCargo(truck, cargoWeight, trailers)) {
    return {
      truck,
      issue: 'capacity',
      label: `${cargoWeight.toFixed(1)}t gerekli / ${capacity.toFixed(1)}t mevcut`,
      selectable: false,
    };
  }
  if (condition < MIN_TRUCK_CONDITION) {
    return {
      truck,
      issue: 'condition_blocked',
      label: 'Kondisyon çok düşük',
      selectable: false,
    };
  }
  if (condition < LOW_CONDITION_WARNING) {
    return {
      truck,
      issue: 'condition_warning',
      label: 'Kondisyon düşük, risk artar',
      selectable: true,
    };
  }
  return { truck, issue: 'eligible', label: 'Uygun', selectable: true };
}

export function evaluateDriverOption(driver: Driver): DriverOption {
  if (driver.status === 'driving') {
    return { driver, issue: 'on_route', label: 'Şu anda teslimatta', selectable: false };
  }
  if (driver.status === 'resting') {
    return { driver, issue: 'resting', label: 'Dinleniyor', selectable: false };
  }
  if (driver.status !== 'idle') {
    return { driver, issue: 'on_route', label: 'Müsait değil', selectable: false };
  }
  return { driver, issue: 'eligible', label: 'Uygun', selectable: true };
}

export function buildTruckOptions(
  trucks: Truck[],
  cargoWeight: number,
  originCityId: string,
  trailers?: import('../types/game').Trailer[],
): TruckOption[] {
  return trucks.map((truck) => evaluateTruckOption(truck, cargoWeight, originCityId, trailers));
}

export function buildDriverOptions(drivers: Driver[]): DriverOption[] {
  return drivers.map((driver) => evaluateDriverOption(driver));
}

export function pickBestTruckOption(options: TruckOption[]): TruckOption | null {
  const eligible = options.filter((option) => option.selectable);
  if (eligible.length === 0) {
    return null;
  }

  return [...eligible].sort((a, b) => {
    const conditionDiff = (b.truck.condition ?? 0) - (a.truck.condition ?? 0);
    if (conditionDiff !== 0) return conditionDiff;

    const speedDiff = (b.truck.speed ?? 0) - (a.truck.speed ?? 0);
    if (speedDiff !== 0) return speedDiff;

    return getTruckEffectiveCapacityTons(a.truck, undefined) - getTruckEffectiveCapacityTons(b.truck, undefined);
  })[0];
}

export function pickBestDriverOption(options: DriverOption[]): DriverOption | null {
  const eligible = options.filter((option) => option.selectable);
  if (eligible.length === 0) {
    return null;
  }

  return [...eligible].sort((a, b) => {
    const experienceDiff = (b.driver.experience ?? 0) - (a.driver.experience ?? 0);
    if (experienceDiff !== 0) return experienceDiff;

    const attentionDiff = (b.driver.attention ?? 0) - (a.driver.attention ?? 0);
    if (attentionDiff !== 0) return attentionDiff;

    return (a.driver.salaryPerDay ?? 0) - (b.driver.salaryPerDay ?? 0);
  })[0];
}

export function getTruckBadge(option: TruckOption): {
  label: string;
  variant: 'success' | 'warning' | 'danger' | 'amber' | 'muted';
} {
  switch (option.issue) {
    case 'eligible':
      return { label: 'UYGUN', variant: 'success' };
    case 'condition_warning':
      return { label: 'KONDİSYON DÜŞÜK', variant: 'warning' };
    case 'capacity':
      return { label: 'KAPASİTE YETERSİZ', variant: 'danger' };
    case 'condition_blocked':
      return { label: 'KONDİSYON DÜŞÜK', variant: 'danger' };
    case 'on_route':
      return { label: 'YOLDA', variant: 'amber' };
    case 'wrong_city':
      return { label: 'KONUM UYGUN DEĞİL', variant: 'warning' };
    case 'maintenance':
      return { label: 'BAKIM', variant: 'danger' };
    default:
      return { label: 'MÜSAİT DEĞİL', variant: 'muted' };
  }
}

export function getDriverBadge(option: DriverOption): {
  label: string;
  variant: 'success' | 'warning' | 'danger' | 'amber' | 'muted';
} {
  if (option.issue === 'eligible') {
    return { label: 'UYGUN', variant: 'success' };
  }
  if (option.issue === 'resting') {
    return { label: 'DİNLENİYOR', variant: 'amber' };
  }
  return { label: 'YOLDA', variant: 'amber' };
}

export function summarizeNoTruckMessage(options: TruckOption[], cargoWeight: number): string {
  if (options.length === 0) {
    return 'Filonda kamyon bulunmuyor.';
  }

  const eligible = options.filter((option) => option.selectable);
  if (eligible.length > 0) {
    return '';
  }

  const atOrigin = options.filter((option) => option.issue !== 'wrong_city');
  if (atOrigin.length === 0) {
    return 'Çıkış şehrinde kamyon yok.';
  }

  const idleAtOrigin = atOrigin.filter(
    (option) =>
      option.issue !== 'on_route' &&
      option.issue !== 'maintenance' &&
      option.issue !== 'wrong_city',
  );
  if (idleAtOrigin.length === 0) {
    return 'Şehirdeki kamyonlar meşgul.';
  }

  const withCapacity = idleAtOrigin.filter(
    (option) => option.issue !== 'capacity' && option.issue !== 'condition_blocked',
  );
  if (withCapacity.length === 0) {
    return `Tonaj yetersiz. Bu iş ${cargoWeight.toFixed(1)} ton gerektiriyor.`;
  }

  return 'Uygun kamyon bulunamadı.';
}

export function summarizeNoDriverMessage(options: DriverOption[]): string {
  if (options.length === 0) {
    return 'Filonda şoför bulunmuyor.';
  }

  const eligible = options.filter((option) => option.selectable);
  if (eligible.length > 0) {
    return '';
  }

  return 'Boşta şoför yok.';
}

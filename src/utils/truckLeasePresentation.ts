/**
 * Kiralık kamyon fiyat ve süre sunumu — mağaza, onay ve filo UI.
 */

import { operatingCostBalance, timeBalance } from '../config/balance';
import type { Truck, TruckLeasePeriod } from '../types/game';
import { formatMoney } from '../theme/format';

export type TruckLeaseOfferPeriod = 'weekly' | 'monthly';

const MONTHLY_LEASE_COST_MULTIPLIER = 3.5;

export function resolveMonthlyLeaseCost(weeklyLeaseCost: number): number {
  return Math.round(weeklyLeaseCost * MONTHLY_LEASE_COST_MULTIPLIER);
}

export function getLeaseDurationHours(period: TruckLeaseOfferPeriod): number {
  if (period === 'monthly') {
    return timeBalance.daysPerMonth * timeBalance.hoursPerDay;
  }
  return operatingCostBalance.leaseDurationHours;
}

export function getLeaseDurationDays(period: TruckLeaseOfferPeriod): number {
  if (period === 'monthly') {
    return timeBalance.daysPerMonth;
  }
  return timeBalance.daysPerWeek;
}

export function getLeasePeriodLabel(period: TruckLeaseOfferPeriod): string {
  return period === 'monthly' ? 'Aylık' : 'Haftalık';
}

export function getLeasePeriodDurationLabel(period: TruckLeaseOfferPeriod): string {
  return period === 'monthly' ? '30 gün' : '7 gün';
}

export function resolveLeaseOfferCost(
  weeklyLeaseCost: number,
  period: TruckLeaseOfferPeriod,
): number {
  if (period === 'monthly') {
    return resolveMonthlyLeaseCost(weeklyLeaseCost);
  }
  return weeklyLeaseCost;
}

export function resolveLeaseDailyCost(
  prepaidAmount: number,
  period: TruckLeaseOfferPeriod,
): number {
  const days = getLeaseDurationDays(period);
  return Math.round(prepaidAmount / days);
}

export function formatLeaseOfferCost(weeklyLeaseCost: number, period: TruckLeaseOfferPeriod): string {
  const cost = resolveLeaseOfferCost(weeklyLeaseCost, period);
  return period === 'monthly'
    ? `${formatMoney(cost)}/ay`
    : `${formatMoney(cost)}/hafta`;
}

export function formatLeaseDailyEquivalent(weeklyLeaseCost: number, period: TruckLeaseOfferPeriod): string {
  const prepaid = resolveLeaseOfferCost(weeklyLeaseCost, period);
  const daily = resolveLeaseDailyCost(prepaid, period);
  return `${formatMoney(daily)}/gün`;
}

export function formatTruckLeaseCostLabel(truck: Pick<Truck, 'leasePeriod' | 'leaseWeeklyCost'>): string {
  const prepaid = truck.leaseWeeklyCost ?? 0;
  if (prepaid <= 0) {
    return '—';
  }
  if (truck.leasePeriod === 'monthly') {
    return `${formatMoney(prepaid)}/ay`;
  }
  return `${formatMoney(prepaid)}/hafta`;
}

export function formatLeaseRemainingDays(currentTime: number, leaseExpiresAt?: number | null): string {
  if (leaseExpiresAt == null) {
    return '—';
  }
  const hoursLeft = Math.max(0, leaseExpiresAt - currentTime);
  const days = Math.ceil(hoursLeft / timeBalance.hoursPerDay);
  return `${days} gün`;
}

export function formatTruckLeaseFleetSummary(
  truck: Pick<Truck, 'leasePeriod' | 'leaseWeeklyCost' | 'leaseExpiresAt'>,
  currentTime: number,
): string {
  const costLabel = formatTruckLeaseCostLabel(truck);
  const remaining = formatLeaseRemainingDays(currentTime, truck.leaseExpiresAt);
  return `${costLabel} · ${remaining}`;
}

export function normalizeTruckLeasePeriod(value: unknown): TruckLeasePeriod {
  if (value === 'monthly' || value === 'weekly' || value === 'daily') {
    return value;
  }
  return 'weekly';
}

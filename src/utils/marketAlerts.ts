import { marketAlertBalance } from '../config/balance';
import { formatMoney } from '../theme/format';
import type {
  City,
  CityProductState,
  MarketPriceAlert,
  MarketPriceAlertCondition,
  ProductId,
} from '../types/game';

export function normalizeMarketAlerts(
  alerts: MarketPriceAlert[] | undefined | null,
): MarketPriceAlert[] {
  if (!Array.isArray(alerts)) return [];
  return alerts.filter(
    (alert) =>
      alert &&
      typeof alert.id === 'string' &&
      typeof alert.cityId === 'string' &&
      typeof alert.productId === 'string' &&
      typeof alert.condition === 'string',
  );
}

export function buildMarketAlertKey(
  alert: Pick<
    MarketPriceAlert,
    'cityId' | 'productId' | 'condition' | 'targetPrice' | 'targetPercent'
  >,
): string {
  return [
    alert.cityId,
    alert.productId,
    alert.condition,
    alert.targetPrice ?? '',
    alert.targetPercent ?? '',
  ].join(':');
}

export function isDuplicateMarketAlert(
  existing: MarketPriceAlert[],
  input: Pick<
    MarketPriceAlert,
    'cityId' | 'productId' | 'condition' | 'targetPrice' | 'targetPercent'
  >,
): boolean {
  const key = buildMarketAlertKey(input);
  return existing.some((alert) => alert.isActive && buildMarketAlertKey(alert) === key);
}

export function countActiveMarketAlerts(alerts: MarketPriceAlert[]): number {
  return alerts.filter((alert) => alert.isActive && !alert.triggeredAt).length;
}

export function getCityProductMarketState(
  city: City | null | undefined,
  productId: ProductId,
): (CityProductState & { currentPrice: number }) | null {
  if (!city?.products) return null;
  const raw = city.products[productId] as (CityProductState & { price?: number }) | undefined;
  if (!raw) return null;

  const basePrice = raw.basePrice ?? 0;
  const currentPrice = raw.currentPrice ?? raw.price ?? basePrice;
  return {
    ...raw,
    basePrice,
    currentPrice,
    stock: raw.stock ?? 0,
    targetStock: raw.targetStock ?? Math.max(raw.stock ?? 0, 1),
    productionPerDay: raw.productionPerDay ?? 0,
    consumptionPerDay: raw.consumptionPerDay ?? 0,
  };
}

export function evaluateMarketAlertCondition(
  alert: MarketPriceAlert,
  currentPrice: number,
  basePrice: number,
): boolean {
  switch (alert.condition) {
    case 'price_below':
      return alert.targetPrice != null && currentPrice <= alert.targetPrice;
    case 'price_above':
      return alert.targetPrice != null && currentPrice >= alert.targetPrice;
    case 'change_up_percent': {
      if (alert.targetPercent == null || basePrice <= 0) return false;
      const changePercent = ((currentPrice - basePrice) / basePrice) * 100;
      return changePercent >= alert.targetPercent;
    }
    case 'change_down_percent': {
      if (alert.targetPercent == null || basePrice <= 0) return false;
      const changePercent = ((basePrice - currentPrice) / basePrice) * 100;
      return changePercent >= alert.targetPercent;
    }
    default:
      return false;
  }
}

export function formatMarketAlertCondition(alert: MarketPriceAlert): string {
  switch (alert.condition) {
    case 'price_below':
      return alert.targetPrice != null ? `${formatMoney(alert.targetPrice)} altı` : 'Fiyat altı';
    case 'price_above':
      return alert.targetPrice != null ? `${formatMoney(alert.targetPrice)} üstü` : 'Fiyat üstü';
    case 'change_up_percent':
      return alert.targetPercent != null ? `%${alert.targetPercent} yükselirse` : 'Yükselirse';
    case 'change_down_percent':
      return alert.targetPercent != null ? `%${alert.targetPercent} düşerse` : 'Düşerse';
    default:
      return 'Alarm';
  }
}

export function formatMarketAlertConditionLabel(condition: MarketPriceAlertCondition): string {
  switch (condition) {
    case 'price_below':
      return 'Fiyat altına düşünce';
    case 'price_above':
      return 'Fiyat üstüne çıkınca';
    case 'change_up_percent':
      return 'Yüzde yükselince';
    case 'change_down_percent':
      return 'Yüzde düşünce';
    default:
      return 'Alarm';
  }
}

export function formatMarketAlertSummary(
  alert: MarketPriceAlert,
  cityName: string,
  productName: string,
): string {
  if (alert.condition === 'price_below' && alert.targetPrice != null) {
    return `${cityName} · ${productName} < ${formatMoney(alert.targetPrice)}`;
  }
  if (alert.condition === 'price_above' && alert.targetPrice != null) {
    return `${cityName} · ${productName} > ${formatMoney(alert.targetPrice)}`;
  }
  if (alert.condition === 'change_up_percent' && alert.targetPercent != null) {
    return `${cityName} · ${productName} +${alert.targetPercent}%`;
  }
  if (alert.condition === 'change_down_percent' && alert.targetPercent != null) {
    return `${cityName} · ${productName} -${alert.targetPercent}%`;
  }
  return `${cityName} · ${productName}`;
}

export function buildTriggeredAlertMessage(
  alert: MarketPriceAlert,
  cityName: string,
  productName: string,
  currentPrice: number,
): string {
  if (alert.condition === 'price_below') {
    return `${cityName} şehrinde ${productName} ${formatMoney(currentPrice)} seviyesine düştü.`;
  }
  if (alert.condition === 'price_above') {
    return `${cityName} şehrinde ${productName} ${formatMoney(currentPrice)} seviyesine çıktı.`;
  }
  return `${cityName} şehrinde ${productName} hedef fiyatına ulaştı.`;
}

export function buildReminderNotificationMessage(
  alert: MarketPriceAlert,
  cityName: string,
  productName: string,
): { title: string; body: string } {
  return {
    title: 'Piyasa alarmını kontrol et',
    body: `${cityName} şehrinde ${productName} hedef fiyatına yaklaşmış olabilir. Piyasayı kontrol et.`,
  };
}

export function estimateReminderDelayMinutes(
  alert: MarketPriceAlert,
  currentPrice: number,
): number {
  const { minReminderDelayMinutes, maxReminderDelayMinutes, defaultReminderDelayMinutes } =
    marketAlertBalance;

  if (
    (alert.condition === 'price_below' || alert.condition === 'price_above') &&
    alert.targetPrice != null &&
    currentPrice > 0
  ) {
    const gapRatio = Math.abs(currentPrice - alert.targetPrice) / currentPrice;
    if (gapRatio < 0.05) return minReminderDelayMinutes;
    if (gapRatio < 0.15) return defaultReminderDelayMinutes;
    return maxReminderDelayMinutes;
  }

  return defaultReminderDelayMinutes;
}

export function cleanExpiredMarketAlerts(
  alerts: MarketPriceAlert[],
  currentTime: number,
): MarketPriceAlert[] {
  return alerts.map((alert) => {
    if (alert.expiresAt != null && alert.expiresAt <= currentTime && alert.isActive) {
      return { ...alert, isActive: false };
    }
    return alert;
  });
}

export function createMarketAlertId(seed: string): string {
  return `market-alert-${seed}-${Date.now().toString(36)}`;
}

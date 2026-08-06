/**
 * LogistiCore — UI display formatters (store/simulation logic değiştirmez).
 */

export const PRICE_CHANGE_MIN_PERCENT = -99;
export const PRICE_CHANGE_MAX_PERCENT = 150;
export const FUEL_EXPENSIVE_UI_THRESHOLD = 12;

export function safeNumber(value: number | undefined | null, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function formatMoney(value: number | undefined | null): string {
  const rounded = Math.round(safeNumber(value));
  const sign = rounded < 0 ? '-' : '';
  return `${sign}$${Math.abs(rounded)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

export function formatMoneyDecimal(value: number | undefined | null, decimals = 2): string {
  const safe = safeNumber(value);
  const sign = safe < 0 ? '-' : '';
  const fixed = Math.abs(safe).toFixed(decimals);
  const [intPart, decPart] = fixed.split('.');
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}$${decPart !== undefined ? `${withCommas}.${decPart}` : withCommas}`;
}

export function formatUnitPrice(
  value: number | undefined | null,
  unit: string,
  decimals = 2,
): string {
  return `${formatMoneyDecimal(value, decimals)}${unit}`;
}

export function formatTons(value: number | undefined | null): string {
  return `${safeNumber(value).toFixed(1)} ton`;
}

function formatCompactNumber(value: number): string {
  const safe = safeNumber(value);
  if (safe >= 10_000) return `${(safe / 1000).toFixed(0)}k`;
  if (safe >= 1000) return `${(safe / 1000).toFixed(1)}k`;
  return safe.toFixed(1);
}

export function formatStockDisplay(
  stock: number | undefined | null,
  targetStock: number | undefined | null,
): { primary: string; detail?: string } {
  const safeStock = safeNumber(stock);
  const safeTarget = Math.max(safeNumber(targetStock), 0.1);
  const ratio = safeStock / safeTarget;

  if (ratio > 10 || safeStock >= 10_000) {
    return {
      primary: 'Stok: Çok yüksek',
      detail: `${formatCompactNumber(safeStock)} / ${formatCompactNumber(safeTarget)} ton`,
    };
  }

  if (safeStock >= 1000 || safeTarget >= 1000) {
    return {
      primary: `${formatCompactNumber(safeStock)} / ${formatCompactNumber(safeTarget)} ton`,
    };
  }

  return {
    primary: `${safeStock.toFixed(1)} / ${safeTarget.toFixed(1)} ton`,
  };
}

/** 0–1 oranı → yüzde (0–100%) */
export function formatRatioPercent(ratio: number | undefined | null): string {
  const pct = Math.round(Math.max(0, Math.min(1, safeNumber(ratio))) * 100);
  return `${pct}%`;
}

/** Ham yüzde değeri — UI clamp */
export function formatDisplayPercent(value: number | undefined | null, max = 999): string {
  const pct = Math.round(safeNumber(value));
  const clamped = Math.max(0, Math.min(max, pct));
  return `${clamped}%`;
}

export function formatXpProgress(current: number | undefined | null, max: number | undefined | null): string {
  const safeCurrent = Math.max(0, Math.round(safeNumber(current)));
  const safeMax = Math.max(1, Math.round(safeNumber(max)));
  return `${safeCurrent} / ${safeMax} XP`;
}

export function formatGameTimeCompact(hours: number | undefined | null): string {
  // Kişisel "G123" kaldırıldı — canlı ekonomi bağlamı
  return formatLiveEconomyCompact();
}

export function formatRelativeMinutes(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) {
    return `${minutes} dk`;
  }
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (rem === 0) {
    return `${hours} sa`;
  }
  return `${hours} sa ${rem} dk`;
}

/** Ana ekran / piyasa — canlı ekonomi özeti */
export function formatLiveEconomyCompact(options?: {
  lastSyncAtMs?: number | null;
  nextMarketAtMs?: number | null;
  nowMs?: number;
  hasActiveEvent?: boolean;
}): string {
  const now = options?.nowMs ?? Date.now();
  if (options?.hasActiveEvent) {
    return 'Global olay aktif';
  }
  if (options?.nextMarketAtMs != null && Number.isFinite(options.nextMarketAtMs)) {
    const until = Math.max(0, options.nextMarketAtMs - now);
    return `Sonraki piyasa: ${formatRelativeMinutes(until)}`;
  }
  if (options?.lastSyncAtMs != null && Number.isFinite(options.lastSyncAtMs)) {
    const ago = Math.max(0, now - options.lastSyncAtMs);
    return `Son sync: ${formatRelativeMinutes(ago)}`;
  }
  return 'Piyasa güncel';
}

export function formatEventRemaining(endsAtMs: number, nowMs: number = Date.now()): string {
  const remaining = Math.max(0, endsAtMs - nowMs);
  if (remaining <= 0) {
    return 'Sona erdi';
  }
  return `${formatRelativeMinutes(remaining)} kaldı`;
}

/** Piyasa ekranı — düşük vurgulu sync caption */
export function formatMarketSyncCaption(options?: {
  lastSyncAtMs?: number | null;
  syncStatus?: string | null;
  nowMs?: number;
}): string | null {
  const lastSyncAtMs = options?.lastSyncAtMs;
  if (lastSyncAtMs == null || !Number.isFinite(lastSyncAtMs)) {
    return null;
  }
  const now = options?.nowMs ?? Date.now();
  const ago = formatRelativeMinutes(Math.max(0, now - lastSyncAtMs));
  const syncStatus = options?.syncStatus ?? null;
  if (syncStatus === 'syncing') {
    return 'Senkronize ediliyor…';
  }
  if (syncStatus === 'online') {
    return `Canlı · ${ago} önce`;
  }
  if (syncStatus === 'offline-cache') {
    return `Son kayıtlı veri · ${ago} önce`;
  }
  if (syncStatus === 'error') {
    return `Bağlantı yok · ${ago} önce`;
  }
  return `Son güncelleme: ${ago} önce`;
}

export function clampPriceChangePercent(changeRatio: number | undefined | null): number | null {
  if (!Number.isFinite(changeRatio)) return null;
  const pct = safeNumber(changeRatio) * 100;
  if (!Number.isFinite(pct)) return null;
  return Math.max(PRICE_CHANGE_MIN_PERCENT, Math.min(PRICE_CHANGE_MAX_PERCENT, pct));
}

export function formatPriceChangeDisplay(changeRatio: number | undefined | null): string | null {
  const clamped = clampPriceChangePercent(changeRatio);
  if (clamped === null) return null;
  if (clamped === 0) return '0%';
  if (clamped >= PRICE_CHANGE_MAX_PERCENT) return '150+%';
  if (clamped <= PRICE_CHANGE_MIN_PERCENT) return `${PRICE_CHANGE_MIN_PERCENT}%`;
  if (clamped > 0) return `+${Math.round(clamped)}%`;
  return `${Math.round(clamped)}%`;
}

export function isFuelExpensiveForDisplay(fuelPrice: number | undefined | null): boolean {
  return safeNumber(fuelPrice) >= FUEL_EXPENSIVE_UI_THRESHOLD;
}

/** Türkçe lokatif ek — şehir id veya adı ile */
const CITY_LOCATION_BY_ID: Record<string, string> = {
  izmir: 'İzmir’de',
  istanbul: 'İstanbul’da',
  ankara: 'Ankara’da',
  bursa: 'Bursa’da',
  antalya: 'Antalya’da',
};

export function formatCityLocative(cityId: string, cityName?: string): string {
  const normalized = (cityId ?? '').toLowerCase().trim();
  if (CITY_LOCATION_BY_ID[normalized]) {
    return CITY_LOCATION_BY_ID[normalized];
  }

  const label = (cityName ?? cityId ?? 'Bilinmeyen şehir').trim() || 'Bilinmeyen şehir';
  return `${label} konumunda`;
}

/** Boşta kamyon kartı — "İzmir’de yeni iş için hazır" veya bilinmeyen şehir için fallback */
export function formatIdleTruckReadyHint(cityId: string, cityName?: string): string {
  const normalized = (cityId ?? '').toLowerCase().trim();
  const locative = CITY_LOCATION_BY_ID[normalized];
  if (locative) {
    return `${locative} yeni iş için hazır`;
  }
  return 'Yeni iş için hazır';
}

/** @deprecated formatCityLocative kullanın */
export function formatCityLocation(cityIdOrName: string, cityName?: string): string {
  return formatCityLocative(cityIdOrName, cityName);
}

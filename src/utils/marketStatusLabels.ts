/**
 * Piyasa stok durumu — kullanıcıya görünen etiket ve açıklamalar.
 * Kod tarafındaki status anahtarları (Kritik Kıtlık, Kıtlık, …) değişmez.
 */

export type MarketStatusColorVariant =
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'muted'
  | 'amber';

export type MarketStatusInput =
  | 'Kritik Kıtlık'
  | 'Kıtlık'
  | 'Dengeli'
  | 'Fazla'
  | 'Yüksek Fazla'
  | 'critical'
  | 'CRITICAL'
  | 'kritık'
  | 'kritik'
  | 'shortage'
  | 'SHORTAGE'
  | 'kıtlık'
  | 'kitlik'
  | 'surplus'
  | 'SURPLUS'
  | 'fazla'
  | 'balanced'
  | 'BALANCED'
  | 'dengeli'
  | string;

type MarketStatusKey = 'critical' | 'shortage' | 'surplus' | 'balanced';

function normalizeMarketStatusKey(status: MarketStatusInput): MarketStatusKey {
  const raw = String(status ?? '').trim();
  const lower = raw.toLocaleLowerCase('tr-TR');

  if (
    raw === 'Kritik Kıtlık' ||
    lower === 'critical' ||
    lower === 'kritik' ||
    lower === 'kritık'
  ) {
    return 'critical';
  }

  if (
    raw === 'Kıtlık' ||
    lower === 'shortage' ||
    lower === 'kıtlık' ||
    lower === 'kitlik'
  ) {
    return 'shortage';
  }

  if (
    raw === 'Fazla' ||
    raw === 'Yüksek Fazla' ||
    lower === 'surplus' ||
    lower === 'fazla' ||
    lower === 'yüksek fazla'
  ) {
    return 'surplus';
  }

  if (
    raw === 'Dengeli' ||
    lower === 'balanced' ||
    lower === 'dengeli' ||
    lower === 'normal'
  ) {
    return 'balanced';
  }

  return 'balanced';
}

/** Ürün kartı ve detay modalı için tam etiket */
export function getMarketStatusLabel(status: MarketStatusInput): string {
  switch (normalizeMarketStatusKey(status)) {
    case 'critical':
      return 'Kritik stok';
    case 'shortage':
      return 'Düşük stok';
    case 'surplus':
      return 'Stok Fazla';
    default:
      return 'Normal';
  }
}

/** Küçük özet metrikleri için kısa etiket */
export function getMarketStatusShortLabel(status: MarketStatusInput): string {
  switch (normalizeMarketStatusKey(status)) {
    case 'critical':
      return 'Kritik stok';
    case 'shortage':
      return 'Düşük stok';
    case 'surplus':
      return 'Fazla';
    default:
      return 'Normal';
  }
}

export function getMarketStatusDescription(status: MarketStatusInput): string {
  switch (normalizeMarketStatusKey(status)) {
    case 'critical':
      return 'Stok seviyesi kritik düzeyde.';
    case 'shortage':
      return 'Arz yetersiz. Fiyat güçlü seyredebilir; satış için takip edilebilir.';
    case 'surplus':
      return 'Şehirde stok yüksek. Alım için iyi olabilir; düşük fiyattan stok yapılabilir.';
    default:
      return 'Piyasa sakin. Fiyat hareketleri normal seviyede.';
  }
}

/** Dünya Durumu özetinde kritik stok sayacı — criticalCount ile kullanılır. */
export function formatMarketStockRiskCounter(count: number): string {
  return `${count} stok riski`;
}

export function getMarketStatusColorVariant(
  status: MarketStatusInput,
): MarketStatusColorVariant {
  switch (normalizeMarketStatusKey(status)) {
    case 'critical':
      return 'danger';
    case 'shortage':
      return 'warning';
    case 'surplus':
      return 'success';
    default:
      return 'info';
  }
}

/** Kart ipucu / kısa cümle — description ile aynı kaynak */
export function getMarketStatusHint(status: MarketStatusInput): string {
  return getMarketStatusDescription(status);
}

/** @deprecated Alias — eski import yolları için */
export function getCompactMarketStatusLabel(status: MarketStatusInput): string {
  return getMarketStatusLabel(status);
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (min > max) return max;
  return Math.min(max, Math.max(min, value));
}

export function randomBetween(min: number, max: number): number {
  const safeMin = Number.isFinite(min) ? min : 0;
  const safeMax = Number.isFinite(max) ? max : safeMin;

  if (safeMin === safeMax) return safeMin;

  const low = Math.min(safeMin, safeMax);
  const high = Math.max(safeMin, safeMax);

  return low + Math.random() * (high - low);
}

export function randomIntBetween(min: number, max: number): number {
  const low = Math.ceil(Math.min(min, max));
  const high = Math.floor(Math.max(min, max));

  if (!Number.isFinite(low) || !Number.isFinite(high)) return 0;
  if (low === high) return low;

  return Math.floor(Math.random() * (high - low + 1)) + low;
}

export function safeNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Canonical haftalık liderlik sezon anahtarı — UTC ISO-8601 hafta.
 * Örnek: 2026-W31
 */

const MS_PER_DAY = 86_400_000;

export function getIsoWeekParts(date: Date): { isoYear: number; isoWeek: number } {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const isoYear = utc.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const isoWeek = Math.ceil(((utc.getTime() - yearStart.getTime()) / MS_PER_DAY + 1) / 7);
  return { isoYear, isoWeek };
}

export function getLeaderboardSeasonKey(nowMs: number = Date.now()): string {
  const { isoYear, isoWeek } = getIsoWeekParts(new Date(nowMs));
  return `${isoYear}-W${String(isoWeek).padStart(2, '0')}`;
}

export function getLeaderboardSeasonStartMs(nowMs: number = Date.now()): number {
  const utc = new Date(nowMs);
  const day = utc.getUTCDay() || 7;
  const start = new Date(Date.UTC(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - (day - 1));
  start.setUTCHours(0, 0, 0, 0);
  return start.getTime();
}

export function getLeaderboardSeasonEndMs(nowMs: number = Date.now()): number {
  return getLeaderboardSeasonStartMs(nowMs) + 7 * MS_PER_DAY - 1;
}

export function isValidLeaderboardSeasonKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-W\d{2}$/.test(value);
}

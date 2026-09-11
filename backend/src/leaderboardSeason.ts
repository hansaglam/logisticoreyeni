/**
 * Canonical haftalık liderlik sezon anahtarı — UTC ISO-8601 hafta.
 * Örnek: 2026-W31
 */

const MS_PER_DAY = 86_400_000;

export function getIsoWeekParts(date: Date): { isoYear: number; isoWeek: number } {
  const utc = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
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

/** Previous ISO week key relative to `nowMs` (the week that ended at current week's start). */
export function getPreviousLeaderboardSeasonKey(nowMs: number = Date.now()): string {
  return getLeaderboardSeasonKey(getLeaderboardSeasonStartMs(nowMs) - 1);
}

/**
 * Deterministic UTC Monday-start / next-Monday-end bounds for a season key.
 * Window is half-open [startsAt, endsAt) matching seasonPeriods weekly semantics.
 */
export function getLeaderboardSeasonBoundsFromKey(
  seasonKey: string,
): { startsAt: number; endsAt: number } | null {
  if (!isValidLeaderboardSeasonKey(seasonKey)) {
    return null;
  }
  const match = /^(\d{4})-W(\d{2})$/.exec(seasonKey);
  if (!match) {
    return null;
  }
  const isoYear = Number(match[1]);
  const week = Number(match[2]);
  if (!Number.isInteger(isoYear) || !Number.isInteger(week) || week < 1 || week > 53) {
    return null;
  }
  const jan4 = Date.UTC(isoYear, 0, 4);
  const jan4Day = new Date(jan4).getUTCDay() || 7;
  const week1Monday = jan4 - (jan4Day - 1) * MS_PER_DAY;
  const startsAt = week1Monday + (week - 1) * MS_PER_DAY * 7;
  const endsAt = startsAt + 7 * MS_PER_DAY;
  if (getLeaderboardSeasonKey(startsAt) !== seasonKey) {
    return null;
  }
  return { startsAt, endsAt };
}

export function isValidLeaderboardSeasonKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-W\d{2}$/.test(value);
}

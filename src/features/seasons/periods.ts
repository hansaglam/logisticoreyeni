import type { PeriodDefinition, SeasonDefinition } from './types';

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

function utcDayStart(nowMs: number): number {
  const date = new Date(nowMs);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function getDailyPeriod(nowMs = Date.now()): PeriodDefinition {
  const startsAt = utcDayStart(nowMs);
  return {
    key: new Date(startsAt).toISOString().slice(0, 10),
    startsAt,
    endsAt: startsAt + DAY_MS,
  };
}

export function getWeeklyPeriod(nowMs = Date.now()): PeriodDefinition {
  const dayStart = utcDayStart(nowMs);
  const day = new Date(dayStart).getUTCDay() || 7;
  const startsAt = dayStart - (day - 1) * DAY_MS;
  const thursday = new Date(startsAt + 3 * DAY_MS);
  const isoYear = thursday.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 1));
  firstThursday.setUTCDate(firstThursday.getUTCDate() + ((4 - (firstThursday.getUTCDay() || 7) + 7) % 7));
  const week = 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / WEEK_MS);
  return {
    key: `${isoYear}-W${String(week).padStart(2, '0')}`,
    startsAt,
    endsAt: startsAt + WEEK_MS,
  };
}

export function getSeasonDefinition(nowMs = Date.now(), referenceMs = nowMs): SeasonDefinition {
  const period = getWeeklyPeriod(referenceMs);
  return {
    ...period,
    displayName: `${period.key} Haftalık Sezon`,
    sequence: Math.floor(period.startsAt / WEEK_MS),
    status: nowMs < period.startsAt ? 'upcoming' : nowMs >= period.endsAt ? 'ended' : 'active',
  };
}

/** Deterministic ISO-week boundaries; never uses device time as season authority. */
export function getSeasonDefinitionFromKey(seasonKey: string): SeasonDefinition | null {
  const match = /^(\d{4})-W(\d{2})$/.exec(seasonKey);
  if (!match) return null;
  const isoYear = Number(match[1]);
  const week = Number(match[2]);
  if (!Number.isInteger(isoYear) || week < 1 || week > 53) return null;
  const januaryFourth = Date.UTC(isoYear, 0, 4);
  const januaryFourthDay = new Date(januaryFourth).getUTCDay() || 7;
  const firstMonday = januaryFourth - (januaryFourthDay - 1) * DAY_MS;
  const startsAt = firstMonday + (week - 1) * WEEK_MS;
  const canonical = getWeeklyPeriod(startsAt + 3 * DAY_MS);
  if (canonical.key !== seasonKey) return null;
  return {
    key: seasonKey,
    startsAt,
    endsAt: startsAt + WEEK_MS,
    displayName: `${seasonKey} Haftalık Sezon`,
    sequence: Math.floor(startsAt / WEEK_MS),
    status: 'ended',
  };
}

export function getRemainingPeriodMs(period: PeriodDefinition, nowMs = Date.now()): number {
  return Math.max(0, period.endsAt - nowMs);
}

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

export type SeasonStatus = 'upcoming' | 'active' | 'ended';

export interface SeasonDefinition {
  key: string;
  startsAt: number;
  endsAt: number;
  displayName: string;
  sequence: number;
  status: SeasonStatus;
}

export interface PeriodDefinition {
  key: string;
  startsAt: number;
  endsAt: number;
}

function utcDayStart(nowMs: number): number {
  const date = new Date(nowMs);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function getDailyPeriod(nowMs: number = Date.now()): PeriodDefinition {
  const startsAt = utcDayStart(nowMs);
  return {
    key: new Date(startsAt).toISOString().slice(0, 10),
    startsAt,
    endsAt: startsAt + DAY_MS,
  };
}

export function getWeeklyPeriod(nowMs: number = Date.now()): PeriodDefinition {
  const dayStart = utcDayStart(nowMs);
  const day = new Date(dayStart).getUTCDay() || 7;
  const startsAt = dayStart - (day - 1) * DAY_MS;
  const thursday = new Date(startsAt + 3 * DAY_MS);
  const isoYear = thursday.getUTCFullYear();
  const yearStart = Date.UTC(isoYear, 0, 1);
  const firstThursday = new Date(yearStart);
  firstThursday.setUTCDate(firstThursday.getUTCDate() + ((4 - (firstThursday.getUTCDay() || 7) + 7) % 7));
  const week = 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / WEEK_MS);
  return {
    key: `${isoYear}-W${String(week).padStart(2, '0')}`,
    startsAt,
    endsAt: startsAt + WEEK_MS,
  };
}

export function getSeasonDefinition(
  nowMs: number = Date.now(),
  referenceMs: number = nowMs,
): SeasonDefinition {
  const period = getWeeklyPeriod(referenceMs);
  const status: SeasonStatus =
    nowMs < period.startsAt ? 'upcoming' : nowMs >= period.endsAt ? 'ended' : 'active';
  return {
    ...period,
    displayName: `${period.key} Haftalık Sezon`,
    sequence: Math.floor(period.startsAt / WEEK_MS),
    status,
  };
}

export function getPeriodForCadence(
  cadence: 'daily' | 'weekly',
  nowMs: number = Date.now(),
): PeriodDefinition {
  return cadence === 'daily' ? getDailyPeriod(nowMs) : getWeeklyPeriod(nowMs);
}

export function getRemainingPeriodMs(period: PeriodDefinition, nowMs = Date.now()): number {
  return Math.max(0, period.endsAt - nowMs);
}

/**
 * Haftalık sezon anahtarları.
 *
 * - Leaderboard: `2026-W31` (ISO-8601, UTC)
 * - Missions/retention: `weekly_2026-W31` (mevcut ilerleme anahtarlarıyla uyumlu)
 */

const MS_PER_DAY = 86_400_000;

function getIsoWeekParts(date: Date): { isoYear: number; isoWeek: number } {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const isoYear = utc.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const isoWeek = Math.ceil(((utc.getTime() - yearStart.getTime()) / MS_PER_DAY + 1) / 7);
  return { isoYear, isoWeek };
}

/** Canonical liderlik sezon anahtarı: 2026-W31 */
export function getLeaderboardSeasonKey(date: Date = new Date()): string {
  const { isoYear, isoWeek } = getIsoWeekParts(date);
  return `${isoYear}-W${String(isoWeek).padStart(2, '0')}`;
}

/** Missions / retention haftalık anahtarı (prefix korunur). */
export function getWeeklySeasonKey(date: Date = new Date()): string {
  return `weekly_${getLeaderboardSeasonKey(date)}`;
}

/** @deprecated Use getLeaderboardSeasonKey */
export function getWeeklySeasonDocId(seasonKey?: string): string {
  return seasonKey ?? getLeaderboardSeasonKey();
}

function getIsoWeekStart(date: Date): Date {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() - (day - 1));
  utc.setUTCHours(0, 0, 0, 0);
  return utc;
}

export function getWeeklySeasonLabel(date: Date = new Date()): string {
  const start = getIsoWeekStart(date);
  const end = new Date(start.getTime() + 6 * MS_PER_DAY);
  const formatter = new Intl.DateTimeFormat('tr-TR', {
    day: 'numeric',
    month: 'short',
  });
  return `${formatter.format(start)} – ${formatter.format(end)}`;
}

export function getLeaderboardSeasonEndMs(date: Date = new Date()): number {
  const start = getIsoWeekStart(date);
  return start.getTime() + 7 * MS_PER_DAY - 1;
}

/**
 * Shared game-hour duration labels for deadline / ETA UX.
 */

export function formatGameDuration(hours: number, options?: { compact?: boolean }): string {
  const safe = Number.isFinite(hours) ? Math.max(0, hours) : 0;
  const totalMinutes = Math.round(safe * 60);
  const wholeHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (wholeHours <= 0) {
    return `${minutes}dk`;
  }
  if (minutes === 0) {
    return options?.compact ? `${wholeHours}s` : `${wholeHours}s 00dk`;
  }
  return `${wholeHours}s ${String(minutes).padStart(2, '0')}dk`;
}

export function formatSignedGameDuration(hours: number): string {
  const safe = Number.isFinite(hours) ? hours : 0;
  const abs = formatGameDuration(Math.abs(safe));
  if (Math.abs(safe) < 1 / 120) {
    return '0dk';
  }
  return safe < 0 ? `-${abs}` : abs;
}

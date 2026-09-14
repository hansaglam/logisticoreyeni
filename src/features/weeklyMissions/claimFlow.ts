/**
 * Weekly Missions claim attempt helpers + UI copy (client).
 * No reward/target/progress authority fields.
 */

export type WeeklyMissionDifficulty = 'easy' | 'medium' | 'hard';

export type WeeklyMissionClaimAttempt = {
  weekKey: string;
  missionId: string;
  idempotencyKey: string;
};

export function weeklyMissionClaimAttemptKey(weekKey: string, missionId: string): string {
  return `${weekKey}:${missionId}`;
}

export function createWeeklyMissionClaimAttempt(
  weekKey: string,
  missionId: string,
  createIdempotencyKey: (weekKey: string, missionId: string) => string,
): WeeklyMissionClaimAttempt {
  return {
    weekKey,
    missionId,
    idempotencyKey: createIdempotencyKey(weekKey, missionId),
  };
}

export function canClaimBackendWeeklyMission(input: {
  completed: boolean;
  claimed: boolean;
  claimAvailable: boolean;
  linkedAccount: boolean;
  featuresEnabled: boolean;
  requestPending: boolean;
}): boolean {
  return (
    input.featuresEnabled &&
    input.linkedAccount &&
    input.completed &&
    !input.claimed &&
    input.claimAvailable &&
    !input.requestPending
  );
}

export function getWeeklyMissionDifficultyLabel(
  difficulty: WeeklyMissionDifficulty,
): string {
  switch (difficulty) {
    case 'easy':
      return 'Kolay';
    case 'medium':
      return 'Orta';
    case 'hard':
      return 'Zor';
    default:
      return '';
  }
}

export function getWeeklyMissionClaimErrorMessage(reason: string): string {
  switch (reason) {
    case 'auth-required':
    case 'anonymous-not-supported':
      return 'Hesabını bağlayarak ödül alabilirsin.';
    case 'already-claimed':
      return 'Bu ödül daha önce alındı.';
    case 'not-complete':
      return 'Bu görev henüz tamamlanmadı.';
    case 'week-not-current':
      return 'Haftalık görevler yenileniyor.';
    case 'feature-disabled':
      return 'Haftalık görevler şu anda kullanılamıyor.';
    case 'weekly-cap-exceeded':
      return 'Bu haftanın ödül limiti doldu.';
    case 'server-state-not-initialized':
      return 'Hesap verilerin hazırlanıyor. Biraz sonra tekrar dene.';
    case 'invalid-mission-id':
    case 'rotation-unavailable':
      return 'Görev listesi yenileniyor.';
    case 'rate-limited':
      return 'Çok fazla deneme yapıldı. Biraz sonra tekrar dene.';
    default:
      return 'Sunucuya ulaşılamadı. Bağlantını kontrol edip tekrar dene.';
  }
}

export function shouldRetainWeeklyMissionClaimAttempt(reason: string): boolean {
  return (
    reason === 'service-unavailable' ||
    reason === 'timeout' ||
    reason === 'rate-limited'
  );
}

export function formatWeeklyRemainingLabel(remainingMs: number): string {
  const safe = Math.max(0, Math.floor(remainingMs));
  const totalMinutes = Math.floor(safe / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) {
    return `${days}g ${hours}s kaldı`;
  }
  if (hours > 0) {
    return `${hours}s ${minutes}dk kaldı`;
  }
  return `${minutes}dk kaldı`;
}

/** Dual-mode safety: backend Weekly UI never uses local weekly cash mint. */
export function isLocalWeeklyCashMintAllowed(backendWeeklyEnabled: boolean): boolean {
  return !backendWeeklyEnabled;
}

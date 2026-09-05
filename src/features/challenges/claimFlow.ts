export interface ChallengeClaimAttempt {
  challengeId: string;
  periodKey: string;
  transactionId: string;
  idempotencyKey: string;
}

export function canClaimChallenge(input: {
  completed: boolean;
  claimed: boolean;
  linkedAccount: boolean;
  featuresEnabled: boolean;
  requestPending: boolean;
}): boolean {
  return (
    input.completed &&
    !input.claimed &&
    input.linkedAccount &&
    input.featuresEnabled &&
    !input.requestPending
  );
}

export type ChallengeClaimFailureReason =
  | 'feature-disabled'
  | 'auth-required'
  | 'invalid-request'
  | 'invalid-challenge-id'
  | 'challenge-disabled'
  | 'period-closed'
  | 'not-complete'
  | 'already-claimed'
  | 'server-state-not-initialized'
  | 'service-unavailable'
  | 'reconciliation-failed'
  | 'timeout';

export function createChallengeClaimAttempt(
  challengeId: string,
  periodKey: string,
  createId: () => string,
): ChallengeClaimAttempt {
  return {
    challengeId,
    periodKey,
    transactionId: `challenge-${createId()}`,
    idempotencyKey: `challenge-${createId()}`,
  };
}

export function challengeAttemptKey(challengeId: string, periodKey: string): string {
  return `${periodKey}:${challengeId}`;
}

export function shouldRetainClaimAttempt(reason: ChallengeClaimFailureReason): boolean {
  return reason === 'service-unavailable' || reason === 'timeout';
}

export function getChallengeErrorMessage(reason: ChallengeClaimFailureReason): string {
  switch (reason) {
    case 'auth-required':
      return 'Ödül almak için hesabını bağlamalısın.';
    case 'not-complete':
      return 'Bu görev henüz tamamlanmadı.';
    case 'period-closed':
      return 'Görev dönemi yenilendi. Liste güncelleniyor.';
    case 'already-claimed':
      return 'Bu ödül daha önce alındı. Durum yenileniyor.';
    case 'server-state-not-initialized':
      return 'Hesap verilerin hazırlanıyor. Biraz sonra tekrar dene.';
    case 'reconciliation-failed':
      return 'Ödül kaydedildi ancak hesap bilgisi yenilenemedi. Tekrar dene.';
    case 'timeout':
      return 'İstek zaman aşımına uğradı. Aynı güvenli işlemle tekrar deneyebilirsin.';
    case 'feature-disabled':
      return 'Sezon görevleri bu sürümde kullanılamıyor.';
    case 'invalid-request':
    case 'invalid-challenge-id':
    case 'challenge-disabled':
      return 'Bu görev artık kullanılamıyor. Listeyi yenile.';
    default:
      return 'Sunucuya ulaşılamadı. Bağlantını kontrol edip tekrar dene.';
  }
}

export function hasChallengePeriodRolledOver(
  nowMs: number,
  dailyEndsAt?: number,
  weeklyEndsAt?: number,
): boolean {
  return (
    (Number.isFinite(dailyEndsAt) && nowMs >= Number(dailyEndsAt)) ||
    (Number.isFinite(weeklyEndsAt) && nowMs >= Number(weeklyEndsAt))
  );
}

export async function withChallengeClaimTimeout<T>(
  operation: Promise<T>,
  timeoutMs = 15_000,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('challenge-claim-timeout')), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

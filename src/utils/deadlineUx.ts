/**
 * Teslim süresi / deadline UX metinleri — kart ve detay ekranlarında paylaşılır.
 */

export const DEADLINE_COMFORTABLE_RATIO = 0.7;
export const DEADLINE_RISK_SLACK = 0.85;

export type DeadlineRiskLevel = 'comfortable' | 'normal' | 'risky' | 'impossible';

export function classifyDeadlineRisk(
  estimatedTravelHours: number,
  deadlineHours: number,
): DeadlineRiskLevel {
  if (deadlineHours <= 0 || estimatedTravelHours <= 0) {
    return 'normal';
  }
  const ratio = estimatedTravelHours / deadlineHours;
  if (ratio > 1) {
    return 'impossible';
  }
  if (ratio >= DEADLINE_RISK_SLACK) {
    return 'risky';
  }
  if (ratio >= DEADLINE_COMFORTABLE_RATIO) {
    return 'normal';
  }
  return 'comfortable';
}

export function hasDeadlineRisk(deadlineHours: number, estimatedTravelHours: number): boolean {
  const level = classifyDeadlineRisk(estimatedTravelHours, deadlineHours);
  return level === 'risky' || level === 'impossible';
}

export function isDeliveryLateRisk(
  estimatedArrivalTime: number,
  deadlineTime: number,
): boolean {
  return estimatedArrivalTime > deadlineTime;
}

export function getDeadlineRiskBadgeLabel(level: DeadlineRiskLevel): string {
  switch (level) {
    case 'comfortable':
      return 'RAHAT';
    case 'normal':
      return 'NORMAL';
    case 'risky':
      return 'RİSKLİ';
    case 'impossible':
      return 'YETİŞEMEZ';
    default:
      return 'NORMAL';
  }
}

export function formatDeadlineRiskNote(isUrgent: boolean, deadlineRisk: boolean): string | null {
  if (isUrgent) {
    return 'Acil: süre kısa, geç kalma cezası yüksek';
  }
  if (deadlineRisk) {
    return 'Deadline riski — tahmini yol süresi teslim süresine yakın';
  }
  return null;
}

export function formatLatePenaltyHint(isUrgent: boolean, penaltyMultiplier?: number): string | null {
  if (isUrgent || (penaltyMultiplier ?? 1) > 1) {
    return 'Geç kalırsan ceza artar';
  }
  return null;
}

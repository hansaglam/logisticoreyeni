/**
 * Teslim süresi / deadline UX metinleri — kart ve detay ekranlarında paylaşılır.
 */

const DEADLINE_RISK_SLACK = 0.85;

export function hasDeadlineRisk(deadlineHours: number, estimatedTravelHours: number): boolean {
  if (deadlineHours <= 0 || estimatedTravelHours <= 0) {
    return false;
  }
  return estimatedTravelHours >= deadlineHours * DEADLINE_RISK_SLACK;
}

export function isDeliveryLateRisk(
  estimatedArrivalTime: number,
  deadlineTime: number,
): boolean {
  return estimatedArrivalTime > deadlineTime;
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

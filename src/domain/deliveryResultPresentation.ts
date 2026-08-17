/**
 * Player-facing copy for delivery settlement, reputation details, and readiness.
 */

import type { DeliveryFailureReason } from '../types/game';
import type { DeadlineRiskLevel } from '../utils/deadlineUx';
import { formatGameDuration } from '../utils/formatGameDuration';
import type {
  DeliveryDelayCause,
  DeliverySettlementRecord,
} from './deliveryDelayDiagnostics';
import { computePausedHours } from './deliveryDelayDiagnostics';
import type { DeliveryReadinessResult } from './deliveryReadiness';
import type { DeliveryPunctuality } from '../simulation/reputationSettlement';

export interface DeliveryResultPresentation {
  title: string;
  headline: string;
  reputationLine: string;
  causeTitle: string | null;
  causes: string[];
  tips: string[];
  failureDetail: string | null;
}

export function formatReadinessSummary(readiness: DeliveryReadinessResult): {
  tone: 'safe' | 'warning' | 'impossible' | 'fuel';
  title: string;
  body: string;
} {
  if (readiness.reasons.includes('INSUFFICIENT_FUEL')) {
    return {
      tone: 'fuel',
      title: 'Yakıt yetersiz',
      body: `Bu rota için yaklaşık ${Math.ceil(readiness.requiredFuel)} L yakıt gerekiyor.\nAracında ${Math.floor(readiness.currentFuel)} L var.`,
    };
  }
  if (readiness.deadlineRisk === 'impossible') {
    return {
      tone: 'impossible',
      title: 'Bu araç bu işe zamanında yetişemez.',
      body: `Tahmini süre: ${formatGameDuration(readiness.etaHours)}\nSon teslim: ${formatGameDuration(readiness.deadlineHours)}`,
    };
  }
  if (readiness.deadlineRisk === 'risky') {
    return {
      tone: 'warning',
      title: 'Geç kalma riski',
      body: `Bu araçla tahmini teslim süresi ${formatGameDuration(readiness.etaHours)}.\nSon teslim süresi ${formatGameDuration(readiness.deadlineHours)}.\nSadece ${formatGameDuration(Math.max(0, readiness.timeMarginHours))} zaman payın var.`,
    };
  }
  return {
    tone: 'safe',
    title: 'Bu araç bu işi zamanında tamamlayabilir.',
    body: `Yaklaşık varış: ${formatGameDuration(readiness.etaHours)}\nSon teslim: ${formatGameDuration(readiness.deadlineHours)}\nZaman payı: ${formatGameDuration(Math.max(0, readiness.timeMarginHours))}`,
  };
}

export function punctualityTitle(
  punctuality: DeliveryPunctuality | 'cancelled',
  failureReason?: DeliveryFailureReason,
): string {
  if (failureReason === 'breakdown') {
    return 'Teslimat başarısız — Araç arızası';
  }
  if (failureReason === 'accident') {
    return 'Teslimat başarısız — Kaza';
  }
  if (failureReason === 'too_late' || punctuality === 'failed') {
    return 'Teslimat başarısız — Çok geç kaldı';
  }
  if (punctuality === 'cancelled') {
    return 'Sözleşme iptal edildi';
  }
  switch (punctuality) {
    case 'early':
      return 'Erken teslimat';
    case 'on-time':
      return 'Zamanında teslimat';
    case 'late-minor':
      return 'Hafif gecikme';
    case 'late-major':
      return 'Ciddi gecikme';
    default:
      return 'Teslimat tamamlandı';
  }
}

export function buildDeliveryResultPresentation(
  record: DeliverySettlementRecord,
): DeliveryResultPresentation {
  const title = punctualityTitle(record.punctualityResult, record.failureReason);
  const late = record.latenessHours > 1 / 60;
  const headline = late
    ? `Teslimat ${formatGameDuration(record.latenessHours)} geç tamamlandı.`
    : record.punctualityResult === 'early'
      ? `Teslimat tahmini süreden erken tamamlandı.`
      : 'Teslimat zamanında tamamlandı.';
  const reputationLine = `İtibar: ${record.reputationDelta > 0 ? '+' : ''}${record.reputationDelta}`;
  const causes = buildCauseLines(record);
  const tips = buildNextDeliveryTips(record);
  const failureDetail =
    record.failureReason === 'too_late'
      ? buildTooLateFailureDetail(record)
      : record.failureReason === 'breakdown'
        ? 'Araç arızası teslimatı sonlandırdı.'
        : record.failureReason === 'accident'
          ? 'Kaza teslimatı sonlandırdı.'
          : null;

  return {
    title,
    headline: failureDetail ?? headline,
    reputationLine,
    causeTitle: causes.length > 0 ? (causes.length > 1 ? 'Başlıca nedenler' : 'Neden gecikti?') : null,
    causes,
    tips,
    failureDetail,
  };
}

function buildTooLateFailureDetail(record: DeliverySettlementRecord): string {
  const wallClock =
    record.wallClockTravelHours != null &&
    Math.abs(record.wallClockTravelHours - record.actualTravelHours) >= 0.08
      ? `\nToplam geçen süre: ${formatGameDuration(record.wallClockTravelHours)}`
      : '';
  const paused = computePausedHours({
    outOfFuelHours: record.timePausedOutOfFuel,
    incidentPendingHours: record.timePausedIncident,
    otherPausedHours: 0,
    fuelOutCount: record.fuelOutEventCount,
    incidentChoiceDelayHours: record.incidentChoiceDelayHours,
  });
  const pauseLine =
    paused >= 0.08
      ? `\nBeklenmeyen duraklama: ${formatGameDuration(paused)} (son teslime sayılmaz)`
      : '';
  return `Son teslim süresi ${formatGameDuration(record.deadlineHours)} idi.\nEfektif teslim süresi ${formatGameDuration(record.actualTravelHours)} olduğu için başarısız sayıldı.${wallClock}${pauseLine}`;
}

export function buildCauseLines(record: DeliverySettlementRecord): string[] {
  const lines: string[] = [];
  if (record.timePausedOutOfFuel >= 0.08) {
    lines.push(`Araç ${formatGameDuration(record.timePausedOutOfFuel)} yakıtsız kaldı.`);
  }
  if (record.timePausedIncident >= 0.08) {
    lines.push(`Olay kararı ${formatGameDuration(record.timePausedIncident)} bekledi.`);
  }
  if ((record.incidentChoiceDelayHours ?? 0) >= 0.08) {
    lines.push(
      `Olay kararı teslimata ${formatGameDuration(record.incidentChoiceDelayHours)} gecikme ekledi.`,
    );
  }
  const startMargin =
    record.deadlineHours - record.vehicleEstimatedDurationAtStart;
  if (
    record.deadlineRiskAtStart === 'risky' ||
    record.deadlineRiskAtStart === 'impossible' ||
    startMargin < 0.5
  ) {
    if (startMargin < 0) {
      lines.push('Başlangıçta araç tahmini süresi son teslimi aşıyordu.');
    } else {
      lines.push(`Başlangıçta yalnızca ${formatGameDuration(startMargin)} zaman payı vardı.`);
    }
  }
  const allCauses = [record.primaryCause, ...record.contributingCauses];
  if (
    lines.length === 0 &&
    allCauses.includes('GENERAL_LATENESS') &&
    record.latenessHours > 0
  ) {
    lines.push('Teslimat son teslim süresini aştı.');
  }
  return lines;
}

export function buildNextDeliveryTips(record: DeliverySettlementRecord): string[] {
  const tips: string[] = [];
  const causes = new Set([record.primaryCause, ...record.contributingCauses]);
  if (causes.has('OUT_OF_FUEL') || record.timePausedOutOfFuel >= 0.08) {
    tips.push('Yola çıkmadan önce yakıtı kontrol et.');
  }
  if (causes.has('VEHICLE_TOO_SLOW') || record.deadlineRiskAtStart === 'risky' || record.deadlineRiskAtStart === 'impossible') {
    tips.push('Daha hızlı araç kullan.');
  }
  if (causes.has('INCIDENT_WAIT') || record.timePausedIncident >= 0.08) {
    tips.push('Olay kararlarını geciktirme.');
  }
  return tips.slice(0, 3);
}

export function delayCauseLabel(cause: DeliveryDelayCause): string {
  switch (cause) {
    case 'BREAKDOWN':
      return 'Araç arızası';
    case 'ACCIDENT':
      return 'Kaza';
    case 'TOO_LATE':
      return 'Çok geç kaldı';
    case 'CANCELLED':
      return 'İptal';
    case 'OUT_OF_FUEL':
      return 'Yakıtsız bekleme';
    case 'INCIDENT_WAIT':
      return 'Olay bekleme';
    case 'VEHICLE_TOO_SLOW':
      return 'Araç yavaş kaldı';
    case 'GENERAL_LATENESS':
      return 'Genel gecikme';
    case 'ON_TIME':
      return 'Zamanında';
    default:
      return 'Gecikme';
  }
}

export function deadlineRiskTone(level: DeadlineRiskLevel): 'success' | 'info' | 'warning' | 'danger' {
  switch (level) {
    case 'comfortable':
      return 'success';
    case 'normal':
      return 'info';
    case 'risky':
      return 'warning';
    case 'impossible':
      return 'danger';
    default:
      return 'info';
  }
}

export const LEGACY_SETTLEMENT_UNAVAILABLE =
  'Bu eski teslimat için ayrıntılı gecikme verisi kaydedilmemiş.';

export interface ReputationHistoryDetailPresentation {
  title: string;
  routeLabel: string | null;
  plannedLine: string | null;
  actualLine: string | null;
  latenessLine: string | null;
  causes: string[];
  reputationLine: string;
  unavailable: boolean;
}

export function buildReputationHistoryDetail(record: DeliverySettlementRecord | null): ReputationHistoryDetailPresentation {
  if (!record) {
    return {
      title: 'Teslimat ayrıntısı',
      routeLabel: null,
      plannedLine: null,
      actualLine: null,
      latenessLine: null,
      causes: [],
      reputationLine: '',
      unavailable: true,
    };
  }

  const presentation = buildDeliveryResultPresentation(record);
  const wallClockDiffers =
    record.wallClockTravelHours != null &&
    Math.abs(record.wallClockTravelHours - record.actualTravelHours) >= 0.08;
  return {
    title: presentation.title,
    routeLabel: null,
    plannedLine: `Planlanan teslim: ${formatGameDuration(record.deadlineHours)}`,
    actualLine: wallClockDiffers
      ? `Efektif teslim: ${formatGameDuration(record.actualTravelHours)} (toplam ${formatGameDuration(record.wallClockTravelHours!)})`
      : `Gerçek teslim: ${formatGameDuration(record.actualTravelHours)}`,
    latenessLine:
      record.latenessHours >= 1 / 60
        ? `Gecikme: ${formatGameDuration(record.latenessHours)}`
        : 'Gecikme: yok',
    causes: presentation.causes,
    reputationLine: `${record.reputationDelta > 0 ? '+' : ''}${record.reputationDelta}`,
    unavailable: false,
  };
}

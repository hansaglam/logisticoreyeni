/**
 * Delivery Incident V1 — nadir operasyon kararları.
 * Her teslimatta max 1 olay; düşük ihtimal; deterministik seed.
 */

import type {
  Contract,
  ContractType,
  Delivery,
  DeliveryIncident,
  DeliveryIncidentChoice,
  DeliveryIncidentEffects,
  DeliveryIncidentStatus,
  DeliveryIncidentType,
  Player,
} from '../types/game';

const INCIDENT_PROGRESS_MIN = 0.2;
const INCIDENT_PROGRESS_MAX = 0.85;
const MIN_TRAVEL_HOURS_FOR_INCIDENT = 4;
const MIN_COMPLETED_CONTRACTS_FOR_INCIDENT = 2;

const INCIDENT_CHANCE_BY_TYPE: Record<ContractType, number> = {
  standard: 0.2,
  urgent: 0.25,
  fragile: 0.3,
  high_reputation: 0.25,
  bulk: 0.2,
  refrigerated: 0.25,
};

const INCIDENT_TYPES: DeliveryIncidentType[] = [
  'traffic',
  'driver_break',
  'tire_pressure',
  'fuel_deviation',
  'checkpoint',
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hashStringToUnit(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

export function getIncidentChanceForContractType(contractType?: ContractType | string): number {
  const type = (contractType as ContractType | undefined) ?? 'standard';
  return INCIDENT_CHANCE_BY_TYPE[type] ?? INCIDENT_CHANCE_BY_TYPE.standard;
}

export function getIncidentTriggerProgress(delivery: Delivery): number {
  const seed = `${delivery.id}:${delivery.contractId}:trigger`;
  const roll = hashStringToUnit(seed);
  return INCIDENT_PROGRESS_MIN + 0.05 + roll * (INCIDENT_PROGRESS_MAX - INCIDENT_PROGRESS_MIN - 0.1);
}

export function shouldGenerateDeliveryIncident(
  delivery: Delivery,
  player: Player,
  contract?: Contract,
): boolean {
  if (delivery.incidentGenerated) {
    return false;
  }
  if (delivery.status !== 'on_route' && delivery.status !== 'preparing') {
    return false;
  }
  if ((player.completedContracts ?? 0) < MIN_COMPLETED_CONTRACTS_FOR_INCIDENT) {
    return false;
  }
  if (delivery.travelHours < MIN_TRAVEL_HOURS_FOR_INCIDENT) {
    return false;
  }
  if (delivery.progress < INCIDENT_PROGRESS_MIN || delivery.progress > INCIDENT_PROGRESS_MAX) {
    return false;
  }
  if (!contract) {
    return false;
  }
  return true;
}

function formatMoneyAmount(amount: number): string {
  return `$${Math.abs(Math.round(amount))}`;
}

function formatTimeDeltaLabel(hours: number): string {
  const absHours = Math.abs(hours);
  if (absHours >= 1) {
    const value = absHours % 1 === 0 ? `${absHours}` : absHours.toFixed(1).replace(/\.0$/, '');
    return hours > 0 ? `${value} saat gecikme` : `${value} saat kazan`;
  }

  const minutes = Math.round(absHours * 60);
  return hours > 0 ? `${minutes} dk gecikme` : `${minutes} dk kazan`;
}

export function formatIncidentChoiceEffectSummary(effects: DeliveryIncidentEffects): string {
  const parts: string[] = [];
  const hasMonetaryCost =
    (effects.cashDelta ?? 0) < 0 || (effects.fuelCostDelta ?? 0) > 0;
  const hasMonetaryGain =
    (effects.cashDelta ?? 0) > 0 || (effects.fuelCostDelta ?? 0) < 0;

  if (effects.cashDelta != null && effects.cashDelta !== 0) {
    if (effects.cashDelta < 0) {
      parts.push(`${formatMoneyAmount(effects.cashDelta)} maliyet`);
    } else {
      parts.push(`${formatMoneyAmount(effects.cashDelta)} gelir`);
    }
  }

  if (effects.fuelCostDelta != null && effects.fuelCostDelta !== 0) {
    if (effects.fuelCostDelta > 0) {
      parts.push(`${formatMoneyAmount(effects.fuelCostDelta)} ek yakıt`);
    } else {
      parts.push(`${formatMoneyAmount(effects.fuelCostDelta)} tasarruf`);
    }
  }

  if (effects.deliveryTimeDeltaHours != null && effects.deliveryTimeDeltaHours !== 0) {
    parts.push(formatTimeDeltaLabel(effects.deliveryTimeDeltaHours));
  }

  if (effects.progressDelta != null && effects.progressDelta !== 0) {
    const pct = Math.round(Math.abs(effects.progressDelta) * 100);
    parts.push(
      effects.progressDelta > 0 ? `%${pct} ilerleme` : `%${pct} gerileme`,
    );
  }

  if (effects.truckConditionDelta != null && effects.truckConditionDelta !== 0) {
    if (effects.truckConditionDelta > 0) {
      parts.push(`Kondisyon +${effects.truckConditionDelta}`);
    } else {
      parts.push(`Kondisyon ${effects.truckConditionDelta}`);
    }
  }

  if (effects.driverXpDelta != null && effects.driverXpDelta > 0) {
    parts.push(`Şoför XP +${effects.driverXpDelta}`);
  }

  if (parts.length === 0) {
    return 'Ücretsiz';
  }

  const hasTimeEffect = (effects.deliveryTimeDeltaHours ?? 0) !== 0;
  if (!hasMonetaryCost && !hasMonetaryGain && !hasTimeEffect) {
    return `Ücretsiz · ${parts.join(' · ')}`;
  }

  return parts.join(' · ');
}

function withChoiceSummaries(choices: DeliveryIncidentChoice[]): DeliveryIncidentChoice[] {
  return choices.map((choice) => ({
    ...choice,
    effectSummary: choice.effectSummary ?? formatIncidentChoiceEffectSummary(choice.effects),
  }));
}

function buildIncidentTemplate(
  type: DeliveryIncidentType,
): Pick<DeliveryIncident, 'type' | 'title' | 'description' | 'choices'> {
  switch (type) {
    case 'traffic':
      return {
        type,
        title: 'Yoğun Trafik',
        description: 'Kamyon yoğun trafiğe girdi. Operasyonu nasıl yöneteceksin?',
        choices: withChoiceSummaries([
          {
            id: 'alt_route',
            label: 'Alternatif rota kullan',
            description: 'Ek yakıt maliyeti, daha hızlı varış.',
            effects: {
              cashDelta: -250,
              deliveryTimeDeltaHours: -1,
            },
          },
          {
            id: 'wait',
            label: 'Bekle',
            description: 'Ücretsiz, fakat teslimat gecikir.',
            effects: {
              deliveryTimeDeltaHours: 2,
            },
          },
        ]),
      };
    case 'driver_break':
      return {
        type,
        title: 'Şoför Mola İstiyor',
        description: 'Şoför kısa bir mola talep ediyor.',
        choices: withChoiceSummaries([
          {
            id: 'break',
            label: 'Mola ver',
            description: 'Kısa gecikme, şoför dinlenir.',
            effects: {
              deliveryTimeDeltaHours: 1,
              driverXpDelta: 5,
            },
          },
          {
            id: 'continue',
            label: 'Devam et',
            description: 'Zaman kazanırsın ama kamyon yorulur.',
            effects: {
              truckConditionDelta: -2,
              riskDelta: 0.05,
            },
          },
        ]),
      };
    case 'tire_pressure':
      return {
        type,
        title: 'Lastik Basıncı Uyarısı',
        description: 'Lastik basıncı düşük görünüyor.',
        choices: withChoiceSummaries([
          {
            id: 'check',
            label: 'Kontrol ettir',
            description: 'Küçük maliyet, risk azalır.',
            effects: {
              cashDelta: -180,
              deliveryTimeDeltaHours: 0.5,
              truckConditionDelta: 1,
            },
          },
          {
            id: 'keep_going',
            label: 'Yola devam et',
            description: 'Maliyet yok, kondisyon riski var.',
            effects: {
              truckConditionDelta: -3,
            },
          },
        ]),
      };
    case 'fuel_deviation':
      return {
        type,
        title: 'Yakıt Sapması',
        description: 'Yakıt tüketimi beklenenden farklı seyrediyor.',
        choices: withChoiceSummaries([
          {
            id: 'optimize',
            label: 'Yakıtı optimize et',
            description: 'Kısa gecikme, yakıt tasarrufu.',
            effects: {
              deliveryTimeDeltaHours: 0.75,
              fuelCostDelta: -120,
            },
          },
          {
            id: 'speed_up',
            label: 'Hızlı devam et',
            description: 'Zaman kazanırsın, ek yakıt harcanır.',
            effects: {
              deliveryTimeDeltaHours: -0.5,
              fuelCostDelta: 180,
            },
          },
        ]),
      };
    case 'checkpoint':
    default:
      return {
        type: 'checkpoint',
        title: 'Kontrol Noktası',
        description: 'Yolda rutin bir kontrol noktası var.',
        choices: withChoiceSummaries([
          {
            id: 'complete_docs',
            label: 'Evrak kontrolünü tamamla',
            description: 'Standart prosedür, kısa gecikme.',
            effects: {
              deliveryTimeDeltaHours: 0.75,
            },
          },
          {
            id: 'alt_checkpoint',
            label: 'Alternatif geçiş noktası',
            description: 'Ücretli ama biraz zaman kazandırır.',
            effects: {
              cashDelta: -220,
              deliveryTimeDeltaHours: -0.25,
              truckConditionDelta: -1,
            },
          },
        ]),
      };
  }
}

export function generateDeliveryIncident(
  delivery: Delivery,
  player: Player,
  seed: string,
  currentGameTime: number,
  triggerProgress: number,
): DeliveryIncident {
  const typeRoll = hashStringToUnit(`${seed}:type`);
  const type = INCIDENT_TYPES[Math.floor(typeRoll * INCIDENT_TYPES.length)] ?? 'traffic';
  const template = buildIncidentTemplate(type);

  return {
    id: `incident_${delivery.id}_${type}`,
    deliveryId: delivery.id,
    type: template.type,
    title: template.title,
    description: template.description,
    createdAtGameTime: currentGameTime,
    triggerProgress,
    status: 'pending',
    choices: template.choices,
  };
}

/** __DEV__ manuel test — production incident algoritmasını etkilemez. */
export function createDebugDeliveryIncident(
  delivery: Delivery,
  currentGameTime: number,
  incidentType?: DeliveryIncidentType,
): DeliveryIncident {
  const type =
    incidentType ??
    INCIDENT_TYPES[Math.floor(Math.random() * INCIDENT_TYPES.length)] ??
    'traffic';
  const triggerProgress =
    delivery.progress >= INCIDENT_PROGRESS_MIN && delivery.progress <= INCIDENT_PROGRESS_MAX
      ? delivery.progress
      : getIncidentTriggerProgress(delivery);
  const template = buildIncidentTemplate(type);

  return {
    id: `incident_debug_${delivery.id}_${type}_${Math.floor(currentGameTime)}`,
    deliveryId: delivery.id,
    type: template.type,
    title: template.title,
    description: template.description,
    createdAtGameTime: currentGameTime,
    triggerProgress,
    status: 'pending',
    choices: template.choices,
  };
}

export function tryGenerateDeliveryIncident(
  delivery: Delivery,
  contract: Contract,
  player: Player,
  seed: string,
  currentGameTime: number,
  triggerProgress: number,
): DeliveryIncident | null {
  const chance = getIncidentChanceForContractType(contract.contractType);
  const roll = hashStringToUnit(`${seed}:roll`);
  if (roll >= chance) {
    return null;
  }
  return generateDeliveryIncident(delivery, player, seed, currentGameTime, triggerProgress);
}

export function maybeRollDeliveryIncident(
  delivery: Delivery,
  contract: Contract | undefined,
  player: Player,
  currentGameTime: number,
): Delivery {
  if (delivery.incidentGenerated) {
    return delivery;
  }

  const triggerProgress = getIncidentTriggerProgress(delivery);
  if (delivery.progress < triggerProgress) {
    return delivery;
  }

  const rolledDelivery: Delivery = { ...delivery, incidentGenerated: true };

  if (!shouldGenerateDeliveryIncident(rolledDelivery, player, contract)) {
    return rolledDelivery;
  }

  const seed = `${delivery.id}:${delivery.contractId}:${Math.floor(delivery.startedAt / 24)}`;
  const incident = tryGenerateDeliveryIncident(
    rolledDelivery,
    contract!,
    player,
    seed,
    currentGameTime,
    triggerProgress,
  );

  if (!incident) {
    return rolledDelivery;
  }

  return {
    ...rolledDelivery,
    incident,
  };
}

function normalizeIncidentStatus(value: unknown): DeliveryIncidentStatus {
  if (value === 'pending' || value === 'resolved' || value === 'expired') {
    return value;
  }
  return 'pending';
}

function normalizeIncidentType(value: unknown): DeliveryIncidentType {
  if (
    value === 'traffic' ||
    value === 'driver_break' ||
    value === 'tire_pressure' ||
    value === 'fuel_deviation' ||
    value === 'checkpoint'
  ) {
    return value;
  }
  return 'traffic';
}

function normalizeIncidentChoice(raw: unknown): DeliveryIncidentChoice | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (typeof record.id !== 'string' || typeof record.label !== 'string') {
    return null;
  }
  const effectsRaw = record.effects;
  const effects: DeliveryIncidentEffects =
    effectsRaw && typeof effectsRaw === 'object'
      ? (effectsRaw as DeliveryIncidentEffects)
      : {};

  return {
    id: record.id,
    label: record.label,
    description: typeof record.description === 'string' ? record.description : '',
    effects,
    effectSummary:
      typeof record.effectSummary === 'string'
        ? record.effectSummary
        : formatIncidentChoiceEffectSummary(effects),
  };
}

export function normalizeDeliveryIncident(raw: unknown): DeliveryIncident | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }

  const record = raw as Record<string, unknown>;
  if (typeof record.id !== 'string' || typeof record.deliveryId !== 'string') {
    return undefined;
  }

  const choices = Array.isArray(record.choices)
    ? record.choices
        .map(normalizeIncidentChoice)
        .filter((choice): choice is DeliveryIncidentChoice => choice != null)
    : [];

  if (choices.length < 2) {
    return undefined;
  }

  const status = normalizeIncidentStatus(record.status);
  const incident: DeliveryIncident = {
    id: record.id,
    deliveryId: record.deliveryId,
    type: normalizeIncidentType(record.type),
    title: typeof record.title === 'string' ? record.title : 'Operasyon Olayı',
    description: typeof record.description === 'string' ? record.description : '',
    createdAtGameTime:
      typeof record.createdAtGameTime === 'number' ? record.createdAtGameTime : 0,
    triggerProgress:
      typeof record.triggerProgress === 'number'
        ? clamp(record.triggerProgress, 0, 1)
        : 0.5,
    status,
    choices,
  };

  if (typeof record.resolvedChoiceId === 'string') {
    incident.resolvedChoiceId = record.resolvedChoiceId;
  }
  if (typeof record.resolvedAtGameTime === 'number') {
    incident.resolvedAtGameTime = record.resolvedAtGameTime;
  }

  return incident;
}

export function normalizeDelivery(delivery: Delivery): Delivery {
  const incident = delivery.incident
    ? normalizeDeliveryIncident(delivery.incident)
    : undefined;
  const incidentResolved =
    delivery.incidentResolved === true ||
    incident?.status === 'resolved' ||
    Boolean(incident?.resolvedChoiceId);

  return {
    ...delivery,
    progress: clamp(Number(delivery.progress) || 0, 0, 1),
    incidentGenerated: delivery.incidentGenerated === true || Boolean(incident),
    incidentResolved,
    incident:
      incident && incident.status === 'pending' && !incidentResolved
        ? incident
        : incident
          ? { ...incident, status: incidentResolved ? 'resolved' : incident.status }
          : undefined,
  };
}

export interface ResolveDeliveryIncidentEffects {
  cashDelta: number;
  fuelCostDelta: number;
  truckConditionDelta: number;
  driverXpDelta: number;
}

export interface ResolveDeliveryIncidentResult {
  ok: boolean;
  reason?: string;
  delivery?: Delivery;
  effects?: ResolveDeliveryIncidentEffects;
}

export function resolveDeliveryIncident(
  delivery: Delivery,
  choiceId: string,
  currentGameTime: number,
): ResolveDeliveryIncidentResult {
  if (delivery.status !== 'on_route' && delivery.status !== 'preparing') {
    return { ok: false, reason: 'Teslimat artık aktif değil.' };
  }

  const incident = delivery.incident;
  if (!incident || incident.status !== 'pending') {
    return { ok: false, reason: 'Bekleyen operasyon olayı yok.' };
  }

  if (delivery.incidentResolved || incident.resolvedChoiceId) {
    return { ok: false, reason: 'Bu olay zaten çözüldü.' };
  }

  const choice = incident.choices.find((item) => item.id === choiceId);
  if (!choice) {
    return { ok: false, reason: 'Geçersiz seçim.' };
  }

  const effects = choice.effects;
  let nextDelivery: Delivery = {
    ...delivery,
    incidentResolved: true,
    incident: {
      ...incident,
      status: 'resolved',
      resolvedChoiceId: choice.id,
      resolvedAtGameTime: currentGameTime,
    },
  };

  if (effects.deliveryTimeDeltaHours) {
    nextDelivery = {
      ...nextDelivery,
      estimatedArrivalTime:
        nextDelivery.estimatedArrivalTime + effects.deliveryTimeDeltaHours,
    };
  }

  if (effects.progressDelta) {
    nextDelivery = {
      ...nextDelivery,
      progress: clamp(nextDelivery.progress + effects.progressDelta, 0, 1),
    };
  }

  return {
    ok: true,
    delivery: nextDelivery,
    effects: {
      cashDelta: effects.cashDelta ?? 0,
      fuelCostDelta: effects.fuelCostDelta ?? 0,
      truckConditionDelta: effects.truckConditionDelta ?? 0,
      driverXpDelta: effects.driverXpDelta ?? 0,
    },
  };
}

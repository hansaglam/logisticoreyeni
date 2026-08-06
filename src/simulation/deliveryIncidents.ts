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

import { normalizeDeliveryAdBoostFields } from './deliveryAdBoost';

const INCIDENT_PROGRESS_MIN = 0.2;
const INCIDENT_PROGRESS_MAX = 0.85;
const MIN_TRAVEL_HOURS_FOR_INCIDENT = 4;
const MIN_COMPLETED_CONTRACTS_FOR_INCIDENT = 2;
export const DELIVERY_INCIDENT_COOLDOWN_HOURS = 8;

const INCIDENT_CHANCE_BY_TYPE: Record<ContractType, number> = {
  standard: 0.2,
  urgent: 0.25,
  fragile: 0.3,
  high_reputation: 0.25,
  bulk: 0.2,
  refrigerated: 0.25,
};

export const DELIVERY_INCIDENT_TYPES: readonly DeliveryIncidentType[] = [
  'traffic',
  'driver_break',
  'tire_pressure',
  'fuel_deviation',
  'checkpoint',
  'truck_failure',
  'customer_request',
  'warehouse_issue',
  'market_opportunity',
  'insurance_penalty',
  'staff_motivation',
  'emergency_delivery',
  'unexpected_cost',
  'company_reputation',
  'local_operation',
] as const;

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

  if (effects.playerXpDelta != null && effects.playerXpDelta > 0) {
    parts.push(`XP +${effects.playerXpDelta}`);
  }

  if (effects.reputationDelta != null && effects.reputationDelta !== 0) {
    parts.push(
      effects.reputationDelta > 0
        ? `İtibar +${effects.reputationDelta}`
        : `İtibar ${effects.reputationDelta}`,
    );
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
    case 'truck_failure':
      return {
        type,
        title: 'Kamyon Arızası Riski',
        description: 'Araçtan olağan dışı bir mekanik ses geliyor.',
        choices: withChoiceSummaries([
          { id: 'roadside_check', label: 'Yol kontrolü yaptır', description: 'Güvenli fakat maliyetli.', effects: { cashDelta: -320, deliveryTimeDeltaHours: 0.75, truckConditionDelta: 2 } },
          { id: 'continue_carefully', label: 'Temkinli devam et', description: 'Masrafsız; kondisyon kaybı riski.', effects: { deliveryTimeDeltaHours: 0.5, truckConditionDelta: -4 } },
        ]),
      };
    case 'customer_request':
      return {
        type,
        title: 'Müşteri Talebi',
        description: 'Müşteri teslimat için ek operasyon desteği istiyor.',
        choices: withChoiceSummaries([
          { id: 'accept_request', label: 'Talebi kabul et', description: 'Ek gelir ve itibar; kısa gecikme.', effects: { cashDelta: 280, reputationDelta: 1, deliveryTimeDeltaHours: 0.5 } },
          { id: 'keep_scope', label: 'Planı koru', description: 'Teslimat takvimi değişmez.', effects: {} },
        ]),
      };
    case 'warehouse_issue':
      return {
        type,
        title: 'Depo Operasyon Sorunu',
        description: 'Varış deposunda boşaltma sırası uzadı.',
        choices: withChoiceSummaries([
          { id: 'priority_slot', label: 'Öncelikli alan kirala', description: 'Maliyetli fakat hızlı.', effects: { cashDelta: -260, deliveryTimeDeltaHours: -0.5 } },
          { id: 'wait_slot', label: 'Sırayı bekle', description: 'Ücretsiz; operasyon gecikir.', effects: { deliveryTimeDeltaHours: 1.25 } },
        ]),
      };
    case 'market_opportunity':
      return {
        type,
        title: 'Piyasa Fırsatı',
        description: 'Rota üzerindeki bir işletme küçük bir ek yük teklif etti.',
        choices: withChoiceSummaries([
          { id: 'take_load', label: 'Ek yükü kabul et', description: 'Kontrollü ek gelir ve gecikme.', effects: { cashDelta: 350, deliveryTimeDeltaHours: 0.75 } },
          { id: 'decline_load', label: 'Mevcut işe odaklan', description: 'Risk ve gecikme yok.', effects: {} },
        ]),
      };
    case 'insurance_penalty':
      return {
        type,
        title: 'Sigorta Kontrolü',
        description: 'Operasyon belgesi için ek doğrulama istendi.',
        choices: withChoiceSummaries([
          { id: 'pay_processing', label: 'Hızlı işlem ücretini öde', description: 'Masraf karşılığı zaman kazan.', effects: { cashDelta: -210, deliveryTimeDeltaHours: -0.25 } },
          { id: 'standard_review', label: 'Standart incelemeyi bekle', description: 'Ücretsiz; kısa gecikme.', effects: { deliveryTimeDeltaHours: 1 } },
        ]),
      };
    case 'staff_motivation':
      return {
        type,
        title: 'Personel Motivasyonu',
        description: 'Şoför zorlu rota sonrası destek bekliyor.',
        choices: withChoiceSummaries([
          { id: 'support_driver', label: 'Prim ve mola ver', description: 'Maliyet karşılığı deneyim.', effects: { cashDelta: -180, driverXpDelta: 12, deliveryTimeDeltaHours: 0.5 } },
          { id: 'thank_driver', label: 'Ekibi takdir et', description: 'Küçük deneyim artışı.', effects: { driverXpDelta: 4 } },
        ]),
      };
    case 'emergency_delivery':
      return {
        type,
        title: 'Acil Teslimat Talebi',
        description: 'Müşteri planlanandan erken teslimat için prim önerdi.',
        choices: withChoiceSummaries([
          { id: 'push_schedule', label: 'Takvimi hızlandır', description: 'Prim; yakıt ve kondisyon maliyeti.', effects: { cashDelta: 300, fuelCostDelta: 100, deliveryTimeDeltaHours: -0.75, truckConditionDelta: -1 } },
          { id: 'keep_schedule', label: 'Güvenli takvimi koru', description: 'Ek risk alma.', effects: {} },
        ]),
      };
    case 'unexpected_cost':
      return {
        type,
        title: 'Beklenmedik Maliyet',
        description: 'Rota üzerinde geçici operasyon ücreti uygulanıyor.',
        choices: withChoiceSummaries([
          { id: 'pay_fee', label: 'Ücreti öde', description: 'Hızlı ve öngörülebilir.', effects: { cashDelta: -190 } },
          { id: 'detour', label: 'Alternatif yola sap', description: 'Masrafsız; gecikme ve yıpranma.', effects: { deliveryTimeDeltaHours: 1, truckConditionDelta: -1 } },
        ]),
      };
    case 'company_reputation':
      return {
        type,
        title: 'Şirket İtibarı',
        description: 'Yerel müşteri teslimat süreci için destek bekliyor.',
        choices: withChoiceSummaries([
          { id: 'premium_support', label: 'Ek destek sağla', description: 'Maliyet karşılığı itibar.', effects: { cashDelta: -240, reputationDelta: 2 } },
          { id: 'standard_service', label: 'Standart hizmet ver', description: 'Ek maliyet oluşmaz.', effects: {} },
        ]),
      };
    case 'local_operation':
      return {
        type,
        title: 'Yerel Operasyon Olayı',
        description: 'Şehir girişinde geçici trafik düzenlemesi başladı.',
        choices: withChoiceSummaries([
          { id: 'local_guide', label: 'Yerel rehber kullan', description: 'Küçük maliyet; zaman kazanımı.', effects: { cashDelta: -140, deliveryTimeDeltaHours: -0.25 } },
          { id: 'follow_queue', label: 'Mevcut sırayı takip et', description: 'Ücretsiz; kısa gecikme.', effects: { deliveryTimeDeltaHours: 0.75 } },
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
  excludedType?: DeliveryIncidentType,
): DeliveryIncident {
  const truck = player.trucks.find((item) => item.id === delivery.truckId);
  const contextualTypes: DeliveryIncidentType[] = [...DELIVERY_INCIDENT_TYPES];
  if ((truck?.condition ?? 100) < 60) contextualTypes.push('truck_failure', 'tire_pressure');
  if (
    truck &&
    (truck.currentFuelL ?? truck.fuelTankCapacityL ?? 1) /
      Math.max(1, truck.fuelTankCapacityL ?? 1) < 0.3
  ) contextualTypes.push('fuel_deviation', 'fuel_deviation');
  if ((player.warehouses?.length ?? 0) > 0) contextualTypes.push('warehouse_issue');
  if ((player.money ?? 0) > 25_000) contextualTypes.push('market_opportunity');
  if ((player.reputation ?? 0) < 45) contextualTypes.push('company_reputation');
  const eligibleTypes = contextualTypes.filter((type) => type !== excludedType);
  const typeRoll = hashStringToUnit(`${seed}:type`);
  const type = eligibleTypes[Math.floor(typeRoll * eligibleTypes.length)] ?? 'traffic';
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
    DELIVERY_INCIDENT_TYPES[
      Math.floor(Math.random() * DELIVERY_INCIDENT_TYPES.length)
    ] ??
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
  excludedType?: DeliveryIncidentType,
): DeliveryIncident | null {
  const chance = getIncidentChanceForContractType(contract.contractType);
  const roll = hashStringToUnit(`${seed}:roll`);
  if (roll >= chance) {
    return null;
  }
  return generateDeliveryIncident(
    delivery,
    player,
    seed,
    currentGameTime,
    triggerProgress,
    excludedType,
  );
}

export function maybeRollDeliveryIncident(
  delivery: Delivery,
  contract: Contract | undefined,
  player: Player,
  currentGameTime: number,
  excludedType?: DeliveryIncidentType,
): Delivery {
  if (delivery.incidentGenerated) {
    return delivery;
  }

  const triggerProgress = getIncidentTriggerProgress(delivery);
  if (delivery.progress < triggerProgress) {
    return delivery;
  }

  const rolledDelivery: Delivery = { ...delivery, incidentGenerated: true };

  // Eligibility must inspect the original delivery. Passing rolledDelivery here
  // caused every production event to reject itself because incidentGenerated
  // had already been set to true.
  if (!shouldGenerateDeliveryIncident(delivery, player, contract)) {
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
    excludedType,
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
    typeof value === 'string' &&
    DELIVERY_INCIDENT_TYPES.includes(value as DeliveryIncidentType)
  ) {
    return value as DeliveryIncidentType;
  }
  return 'traffic';
}

export function getLatestDeliveryIncident(deliveries: Delivery[]): DeliveryIncident | undefined {
  return deliveries
    .map((delivery) => delivery.incident)
    .filter((incident): incident is DeliveryIncident => incident != null)
    .sort((left, right) => right.createdAtGameTime - left.createdAtGameTime)[0];
}

export function isDeliveryIncidentCooldownActive(
  deliveries: Delivery[],
  currentGameTime: number,
): boolean {
  const latest = getLatestDeliveryIncident(deliveries);
  return Boolean(
    latest && currentGameTime - latest.createdAtGameTime < DELIVERY_INCIDENT_COOLDOWN_HOURS,
  );
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

  return normalizeDeliveryAdBoostFields({
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
  });
}

export interface ResolveDeliveryIncidentEffects {
  cashDelta: number;
  fuelCostDelta: number;
  truckConditionDelta: number;
  driverXpDelta: number;
  playerXpDelta: number;
  reputationDelta: number;
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
      playerXpDelta: effects.playerXpDelta ?? 0,
      reputationDelta: effects.reputationDelta ?? 0,
    },
  };
}

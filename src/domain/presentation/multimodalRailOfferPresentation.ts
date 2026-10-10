/**
 * Player-facing presentation adapter for Step 27 RAIL offers (Map V2 Step 28).
 * Formats snapshots only. Does not recompute tariff, duration, payment, or deadline.
 */

import { formatCityLocative, formatMoney, formatTons } from '../../theme/format';
import { getCityName, getProductName, isProductId } from '../../utils/entityLookup';
import type {
  RailMultimodalOffer,
  RailMultimodalOfferAcceptancePreview,
  RailOfferFleetFeasibility,
} from '../multimodalRailOffer';
import { RAIL_MULTIMODAL_OFFER_SCHEMA_VERSION, RAIL_MULTIMODAL_TRANSPORT_PATTERN } from '../multimodalRailOffer';

export const MULTIMODAL_RAIL_PLAYER_MODE_LABEL = 'Demiryolu Taşımacılığı';

export type RailOfferVisualState =
  | 'READY_PREVIEW'
  | 'FLEET_PREPARATION_REQUIRED'
  | 'UNAVAILABLE'
  | 'COMING_SOON';

export type RailOfferModeStage = {
  key: 'first-mile' | 'rail' | 'last-mile';
  mode: 'ROAD' | 'RAIL' | 'ROAD';
  label: string;
};

export type RailOfferCardViewModel = {
  offerId: string;
  originName: string;
  destinationName: string;
  cargoName: string;
  cargoProductId: string;
  cargoAmountText: string;
  paymentText: string;
  durationText: string;
  deadlineText: string;
  firstMileLabel: string;
  railLegLabel: string;
  lastMileLabel: string;
  firstMileKmText: string | null;
  railKmText: string | null;
  lastMileKmText: string | null;
  modeStages: readonly RailOfferModeStage[];
  modeSequenceAccessible: string;
  readinessLabel: string;
  visualState: RailOfferVisualState;
  canInspect: true;
  accessibilityLabel: string;
  originReadinessText: string;
  destinationReadinessText: string;
  extraReadinessText: string | null;
  explanation: string;
  ctaLabel: string;
  ctaDisabled: boolean;
  ctaAccessibilityLabel: string;
  ctaBlockReason: string | null;
};

export const RAIL_OFFER_MODE_STAGES: readonly RailOfferModeStage[] = [
  { key: 'first-mile', mode: 'ROAD', label: 'Kamyon' },
  { key: 'rail', mode: 'RAIL', label: 'Tren' },
  { key: 'last-mile', mode: 'ROAD', label: 'Kamyon' },
];

export function formatMultimodalDurationGameSeconds(totalSeconds: unknown): string | null {
  if (typeof totalSeconds !== 'number' || !Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return null;
  }
  const totalMinutes = Math.max(1, Math.round(totalSeconds / 60));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) {
    if (hours === 0) return `${days} gün`;
    return `${days} gün ${hours} sa`;
  }
  if (hours > 0) {
    if (minutes === 0) return `${hours}s`;
    return `${hours}s ${minutes}dk`;
  }
  return `${minutes}dk`;
}

export function mapFleetFeasibilityToVisualState(
  feasibility: RailOfferFleetFeasibility | null | undefined,
): RailOfferVisualState {
  if (feasibility === 'READY_NOW' || feasibility === 'NOT_EVALUATED') {
    return 'READY_PREVIEW';
  }
  if (
    feasibility === 'REQUIRES_FLEET_CHANGE' ||
    feasibility === 'ORIGIN_FLEET_UNAVAILABLE' ||
    feasibility === 'DESTINATION_FLEET_UNAVAILABLE' ||
    feasibility === 'DRIVER_UNAVAILABLE' ||
    feasibility === 'CARGO_INCOMPATIBLE'
  ) {
    return 'FLEET_PREPARATION_REQUIRED';
  }
  return 'UNAVAILABLE';
}

export function playerReadinessCopy(input: {
  originCityId: string;
  destinationCityId: string;
  feasibility: RailOfferFleetFeasibility | null | undefined;
  assignmentReasons?: readonly string[];
}): { summary: string; origin: string; destination: string; extra: string | null } {
  const feasibility = input.feasibility ?? 'NOT_EVALUATED';
  const reasons = input.assignmentReasons ?? [];
  const originLoc = formatCityLocative(input.originCityId, getCityName(input.originCityId));
  const destLoc = formatCityLocative(input.destinationCityId, getCityName(input.destinationCityId));
  if (feasibility === 'READY_NOW') {
    return {
      summary: 'Filo şu anda uygun görünüyor',
      origin: `${originLoc} uygun kamyon mevcut`,
      destination: `${destLoc} uygun kamyon mevcut`,
      extra: 'Kabul henüz açık değil.',
    };
  }
  if (feasibility === 'ORIGIN_FLEET_UNAVAILABLE') {
    return {
      summary: 'Filo hazırlığı gerekli',
      origin: `${originLoc} uygun kamyon gerekli`,
      destination: `${destLoc} son mil için kamyon ayrıca gerekir`,
      extra: null,
    };
  }
  if (feasibility === 'DESTINATION_FLEET_UNAVAILABLE') {
    return {
      summary: 'Filo hazırlığı gerekli',
      origin: `${originLoc} ilk mil için kamyon ayrıca gerekir`,
      destination: `${destLoc} uygun kamyon gerekli`,
      extra: null,
    };
  }
  if (feasibility === 'DRIVER_UNAVAILABLE' || reasons.includes('NO_ELIGIBLE_DRIVER')) {
    return {
      summary: 'Filo hazırlığı gerekli',
      origin: `${originLoc} kamyon/sürücü kontrolü`,
      destination: `${destLoc} kamyon/sürücü kontrolü`,
      extra: 'Uygun sürücü gerekli',
    };
  }
  if (reasons.includes('NO_ELIGIBLE_TRAILER')) {
    return {
      summary: 'Filo hazırlığı gerekli',
      origin: `${originLoc} ekipman kontrolü`,
      destination: `${destLoc} ekipman kontrolü`,
      extra: 'Uygun dorse gerekli',
    };
  }
  if (feasibility === 'CARGO_INCOMPATIBLE') {
    return {
      summary: 'Filo hazırlığı gerekli',
      origin: `${originLoc} yük bu kamyonla taşınamayabilir`,
      destination: `${destLoc} yük bu kamyonla taşınamayabilir`,
      extra: null,
    };
  }
  if (feasibility === 'REQUIRES_FLEET_CHANGE') {
    return {
      summary: 'Filo hazırlığı gerekli',
      origin: `${originLoc} uygun kamyon gerekli`,
      destination: `${destLoc} uygun kamyon gerekli`,
      extra: null,
    };
  }
  return {
    summary: 'Filo durumu önizlemede',
    origin: `${originLoc} ilk mil kamyonu`,
    destination: `${destLoc} son mil kamyonu`,
    extra: 'Kabul henüz açık değil.',
  };
}

function formatKmFromMeters(meters: unknown): string | null {
  if (typeof meters !== 'number' || !Number.isFinite(meters) || meters <= 0) return null;
  return `${Math.max(1, Math.round(meters / 1000))} km`;
}

function isSafeMoney(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isSafeInteger(value) && value > 0;
}

/**
 * Fail-closed. Unknown schema / invalid snapshots → null (do not render an actionable card).
 */
export function presentRailMultimodalOffer(
  offer: unknown,
  acceptance?: RailMultimodalOfferAcceptancePreview | null,
  options?: {
    mutationEnabled?: boolean;
    acceptReady?: boolean;
    acceptBlockReason?: string | null;
    alreadyAccepted?: boolean;
  },
): RailOfferCardViewModel | null {
  if (!offer || typeof offer !== 'object') return null;
  const row = offer as RailMultimodalOffer;
  if (row.offerSchemaVersion !== RAIL_MULTIMODAL_OFFER_SCHEMA_VERSION) return null;
  if (row.transportPattern !== RAIL_MULTIMODAL_TRANSPORT_PATTERN) return null;
  if (typeof row.offerId !== 'string' || !row.offerId.startsWith('railOffer:')) return null;
  if (!isSafeMoney(row.playerPayment)) return null;
  if (!isProductId(row.cargo?.productId)) return null;
  if (typeof row.cargo?.quantity !== 'number' || !Number.isFinite(row.cargo.quantity) || row.cargo.quantity <= 0) {
    return null;
  }
  const durationText = formatMultimodalDurationGameSeconds(row.durationSnapshot?.totalDurationGameSeconds);
  const deadlineText = formatMultimodalDurationGameSeconds(row.deadlineSnapshot?.deadlineGameSeconds);
  if (!durationText || !deadlineText) return null;
  if (
    typeof row.durationSnapshot.totalDurationGameSeconds !== 'number' ||
    typeof row.deadlineSnapshot.deadlineGameSeconds !== 'number' ||
    row.deadlineSnapshot.deadlineGameSeconds <= row.durationSnapshot.totalDurationGameSeconds
  ) {
    return null;
  }

  const originName = getCityName(row.originCityId);
  const destinationName = getCityName(row.destinationCityId);
  const cargoName = getProductName(row.cargo.productId);
  const paymentText = formatMoney(row.playerPayment);
  const cargoAmountText = formatTons(row.cargo.quantity);
  const visualState = mapFleetFeasibilityToVisualState(acceptance?.fleetFeasibility);
  const readiness = playerReadinessCopy({
    originCityId: row.originCityId,
    destinationCityId: row.destinationCityId,
    feasibility: acceptance?.fleetFeasibility,
    assignmentReasons: acceptance?.reasons,
  });
  const modeSequenceAccessible = 'Kamyon, ardından tren, ardından kamyon';

  const mutationEnabled = options?.mutationEnabled === true;
  const alreadyAccepted = options?.alreadyAccepted === true;
  let ctaLabel = 'Yakında';
  let ctaDisabled = true;
  let ctaAccessibilityLabel = 'Yakında, düğme devre dışı. Teklif kabul edilemez.';
  let ctaBlockReason: string | null = mutationEnabled ? null : 'Kabul henüz açık değil.';
  if (mutationEnabled) {
    if (alreadyAccepted) {
      ctaLabel = 'Devam ediyor';
      ctaDisabled = true;
      ctaAccessibilityLabel = 'Teklif zaten kabul edildi';
      ctaBlockReason = 'Bu teklif zaten kabul edildi.';
    } else if (options?.acceptReady) {
      ctaLabel = 'Teklifi Kabul Et';
      ctaDisabled = false;
      ctaAccessibilityLabel = 'Teklifi kabul et';
      ctaBlockReason = null;
    } else {
      ctaLabel = 'Kabul edilemez';
      ctaDisabled = true;
      ctaAccessibilityLabel = options?.acceptBlockReason ?? 'Filo veya teklif hazır değil';
      ctaBlockReason = options?.acceptBlockReason ?? 'Filo veya teklif hazır değil.';
    }
  }

  return {
    offerId: row.offerId,
    originName,
    destinationName,
    cargoName,
    cargoProductId: row.cargo.productId,
    cargoAmountText,
    paymentText,
    durationText,
    deadlineText,
    firstMileLabel: `${originName} → Demiryolu terminali`,
    railLegLabel: 'Demiryolu terminali → Demiryolu terminali',
    lastMileLabel: `Demiryolu terminali → ${destinationName}`,
    firstMileKmText: formatKmFromMeters(row.firstMileAccess?.distanceMeters),
    railKmText: formatKmFromMeters(row.railDistanceMeters),
    lastMileKmText: formatKmFromMeters(row.lastMileAccess?.distanceMeters),
    modeStages: RAIL_OFFER_MODE_STAGES,
    modeSequenceAccessible,
    readinessLabel: readiness.summary,
    visualState,
    canInspect: true,
    accessibilityLabel: `${originName} ${destinationName}, ${MULTIMODAL_RAIL_PLAYER_MODE_LABEL}, ${cargoName} ${cargoAmountText}, ödeme ${paymentText}`,
    originReadinessText: readiness.origin,
    destinationReadinessText: readiness.destination,
    extraReadinessText: readiness.extra,
    explanation:
      'Tren etabı üçüncü taraf bir lojistik taşıyıcı tarafından yapılır. Oyuncu trene sahip olmaz; ilk ve son mili kendi kamyonlarıyla yürütür.',
    ctaLabel,
    ctaDisabled,
    ctaAccessibilityLabel,
    ctaBlockReason,
  };
}

export function presentRailMultimodalOffers(
  offers: readonly unknown[],
  acceptanceByOfferId?: ReadonlyMap<string, RailMultimodalOfferAcceptancePreview>,
  options?: {
    mutationEnabled?: boolean;
    acceptReadyByOfferId?: ReadonlyMap<string, { ready: boolean; reason?: string | null; alreadyAccepted?: boolean }>;
  },
): RailOfferCardViewModel[] {
  const out: RailOfferCardViewModel[] = [];
  for (const offer of offers) {
    const id = (offer as RailMultimodalOffer | undefined)?.offerId;
    const acceptMeta = id ? options?.acceptReadyByOfferId?.get(id) : undefined;
    const vm = presentRailMultimodalOffer(offer, id ? acceptanceByOfferId?.get(id) : null, {
      mutationEnabled: options?.mutationEnabled,
      acceptReady: acceptMeta?.ready,
      acceptBlockReason: acceptMeta?.reason,
      alreadyAccepted: acceptMeta?.alreadyAccepted,
    });
    if (vm) out.push(vm);
  }
  return out;
}

export function viewModelExposesInternalDiagnostics(vm: RailOfferCardViewModel): boolean {
  const blob = JSON.stringify(vm);
  return (
    blob.includes('SOURCE_BACKED') ||
    blob.includes('policyVersion') ||
    blob.includes('domain.canonical') ||
    blob.includes('sha256:') ||
    blob.includes('FOUNDATION_ONLY') ||
    blob.includes('playerPayment') ||
    blob.includes('railCarrierCost') ||
    blob.includes('ROAD_RAIL_ROAD')
  );
}

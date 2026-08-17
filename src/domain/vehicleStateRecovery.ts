/**
 * Stuck / tutarsız araç-teslimat-harita kurtarma.
 * Gerçek simülasyon bug'larını gizlemez; oyuncunun kaydını kurtarmak için güvenlik ağıdır.
 */

import { economyBalance } from '../config/balance';
import { vehicleStateRecoveryConfig } from '../config/vehicleStateRecovery';
import { getWorldMapCityPosition, WORLD_MAP_POSITIONS } from '../data/worldMapPositions';
import { normalizeCityId } from '../data/networkPositions';
import { resumeRoadsideJob } from '../simulation/roadsideFuel';
import { isLeasedTruck, isLeaseTimeExpired, isRentalReturnPending } from '../simulation/rentalTruckLifecycle';
import { syncTrailersWithTruckLocation } from '../simulation/trailerOps';
import { getCityName } from '../utils/entityLookup';
import { normalizeTruckFuel } from '../utils/truckFuel';
import type {
  Contract,
  Delivery,
  Driver,
  Player,
  Truck,
  TruckTransfer,
  WarehouseStockTransfer,
} from '../types/game';

const ACTIVE_DELIVERY = new Set<Delivery['status']>(['preparing', 'on_route', 'paused']);
const ACTIVE_TRANSFER = new Set<TruckTransfer['status']>(['active', 'paused']);
const ACTIVE_WAREHOUSE = new Set<WarehouseStockTransfer['status']>(['pending', 'active', 'paused']);

export type VehicleStateIssueKind =
  | 'stalled_on_route'
  | 'out_of_fuel_desync'
  | 'invalid_route_or_marker'
  | 'rental_expired_stuck'
  | 'idle_vs_active_conflict'
  | 'map_fleet_desync'
  | 'arrived_but_unsettled';

export type VehicleRecoveryActionId =
  | 'tow_to_nearest_city'
  | 'cancel_delivery'
  | 'call_roadside'
  | 'return_to_depot'
  | 'sync_map_position'
  | 'repair_delivery_record';

export interface VehicleRecoveryUsage {
  freeUsed: boolean;
  paidCount: number;
  lastResolvedAt?: number;
  lastIssueKind?: VehicleStateIssueKind;
}

export interface VehicleStateIssue {
  kind: VehicleStateIssueKind;
  truckId: string;
  truckName: string;
  deliveryId?: string;
  transferId?: string;
  warehouseTransferId?: string;
  title: string;
  cause: string;
  systemCaused: boolean;
}

export interface VehicleRecoveryOption {
  id: VehicleRecoveryActionId;
  label: string;
  description: string;
  cashCost: number;
  reputationCost: number;
  free: boolean;
}

export interface DetectVehicleStateIssueInput {
  truck: Truck;
  currentTime: number;
  homeCityId?: string;
  activeDelivery?: Delivery | null;
  activeTransfer?: TruckTransfer | null;
  activeWarehouseTransfer?: WarehouseStockTransfer | null;
}

export interface VehicleRecoveryStateSlice {
  currentTime: number;
  player: Player;
  activeDeliveries: Delivery[];
  contracts: Contract[];
  activeTransfers: TruckTransfer[];
  activeWarehouseStockTransfers: WarehouseStockTransfer[];
  vehicleRecovery: VehicleRecoveryUsage;
}

export interface ResolveVehicleStateIssueResult {
  ok: boolean;
  reason?: 'truck-not-found' | 'issue-gone' | 'action-unavailable' | 'insufficient-funds';
  message: string;
  player: Player;
  activeDeliveries: Delivery[];
  contracts: Contract[];
  activeTransfers: TruckTransfer[];
  activeWarehouseStockTransfers: WarehouseStockTransfer[];
  vehicleRecovery: VehicleRecoveryUsage;
  cashDelta: number;
  reputationDelta: number;
  parkedCityId?: string;
}

function isActiveDelivery(delivery?: Delivery | null): delivery is Delivery {
  return delivery != null && ACTIVE_DELIVERY.has(delivery.status);
}

function isActiveTransfer(transfer?: TruckTransfer | null): transfer is TruckTransfer {
  return transfer != null && ACTIVE_TRANSFER.has(transfer.status);
}

function isActiveWarehouseTransfer(
  transfer?: WarehouseStockTransfer | null,
): transfer is WarehouseStockTransfer {
  return transfer != null && ACTIVE_WAREHOUSE.has(transfer.status);
}

function fuelEmpty(truck: Truck): boolean {
  return (truck.currentFuelL ?? 0) <= vehicleStateRecoveryConfig.fuelEmptyEpsilonL;
}

function hasPendingIncident(delivery?: Delivery | null): boolean {
  return delivery?.incident?.status === 'pending' && delivery.incidentResolved !== true;
}

function hasValidProgress(value: number | undefined): boolean {
  return Number.isFinite(value) && (value as number) >= 0 && (value as number) <= 1.05;
}

function hasValidCityPair(fromId?: string, toId?: string): boolean {
  if (!fromId || !toId) {
    return false;
  }
  const from = normalizeCityId(fromId);
  const to = normalizeCityId(toId);
  if (!from || !to || from === to) {
    return false;
  }
  return getWorldMapCityPosition(from) != null && getWorldMapCityPosition(to) != null;
}

function findActiveDelivery(truckId: string, deliveries: Delivery[] | undefined): Delivery | undefined {
  return (deliveries ?? []).find(
    (delivery) => delivery.truckId === truckId && isActiveDelivery(delivery),
  );
}

function findActiveTransfer(truckId: string, transfers: TruckTransfer[] | undefined): TruckTransfer | undefined {
  return (transfers ?? []).find(
    (transfer) => transfer.truckId === truckId && isActiveTransfer(transfer),
  );
}

function findActiveWarehouseTransfer(
  truckId: string,
  transfers: WarehouseStockTransfer[] | undefined,
): WarehouseStockTransfer | undefined {
  return (transfers ?? []).find(
    (transfer) => transfer.truckId === truckId && isActiveWarehouseTransfer(transfer),
  );
}

function jobIsFuelPaused(
  job: { status: string; pausedReason?: string } | null,
  truck: Truck,
): boolean {
  return job != null && job.status === 'paused' && job.pausedReason === 'out-of-fuel' && truck.status === 'out_of_fuel';
}

function jobSpeedIsExplicitlyStopped(speed: number | undefined): boolean {
  return Number.isFinite(speed) && (speed as number) <= 0;
}

function issueBase(
  truck: Truck,
  kind: VehicleStateIssueKind,
  title: string,
  cause: string,
  extra?: Partial<VehicleStateIssue>,
): VehicleStateIssue {
  return {
    kind,
    truckId: truck.id,
    truckName: truck.name,
    title,
    cause,
    systemCaused: true,
    ...extra,
  };
}

export function detectVehicleStateIssue(
  input: DetectVehicleStateIssueInput,
): VehicleStateIssue | null {
  const { truck, currentTime, activeDelivery, activeTransfer, activeWarehouseTransfer } = input;
  if (truck.status === 'marketplace_locked') {
    return null;
  }

  const delivery = isActiveDelivery(activeDelivery) ? activeDelivery : null;
  const transfer = isActiveTransfer(activeTransfer) ? activeTransfer : null;
  const warehouseTransfer = isActiveWarehouseTransfer(activeWarehouseTransfer)
    ? activeWarehouseTransfer
    : null;
  const movingJob = delivery ?? transfer ?? warehouseTransfer;
  const inTransitStatus =
    truck.status === 'on_route' || truck.status === 'out_of_fuel' || truck.status === 'transferring';
  const jobIds = {
    deliveryId: delivery?.id,
    transferId: transfer?.id,
    warehouseTransferId: warehouseTransfer?.id,
  };

  if (delivery && (!delivery.originCityId || !delivery.destinationCityId || !hasValidProgress(delivery.progress))) {
    return issueBase(
      truck,
      'invalid_route_or_marker',
      'Teslimat kaydı tutarsız durumda',
      'Teslimat kaydı eksik rota veya geçersiz ilerleme verisi taşıyor.',
      { deliveryId: delivery.id },
    );
  }

  if (delivery && !hasValidCityPair(delivery.originCityId, delivery.destinationCityId)) {
    return issueBase(
      truck,
      'invalid_route_or_marker',
      'Araç durumu ile harita verisi senkron değil',
      'Aktif teslimat var ancak harita rotası veya işaretçi konumu geçersiz.',
      { deliveryId: delivery.id },
    );
  }

  if (transfer && !hasValidCityPair(transfer.fromCityId, transfer.toCityId)) {
    return issueBase(
      truck,
      'invalid_route_or_marker',
      'Araç durumu ile harita verisi senkron değil',
      'Aktif transfer var ancak harita rotası geçersiz.',
      { transferId: transfer.id },
    );
  }

  if (
    warehouseTransfer &&
    !hasValidCityPair(warehouseTransfer.sourceCityId, warehouseTransfer.destinationCityId)
  ) {
    return issueBase(
      truck,
      'invalid_route_or_marker',
      'Araç durumu ile harita verisi senkron değil',
      'Aktif depo transferi var ancak harita rotası geçersiz.',
      { warehouseTransferId: warehouseTransfer.id },
    );
  }

  if (inTransitStatus && !movingJob) {
    return issueBase(
      truck,
      'idle_vs_active_conflict',
      'Teslimat kaydı tutarsız durumda',
      'Araç yolda görünüyor ancak bağlı aktif teslimat veya transfer yok.',
    );
  }

  if ((truck.status === 'idle' || truck.status === 'maintenance') && movingJob) {
    return issueBase(
      truck,
      'idle_vs_active_conflict',
      'Teslimat kaydı tutarsız durumda',
      'Filoda araç boşta görünüyor ancak aktif bir teslimat kaydı var.',
      jobIds,
    );
  }

  if (delivery && (delivery.progress ?? 0) >= vehicleStateRecoveryConfig.stalledProgressMax) {
    return issueBase(
      truck,
      'arrived_but_unsettled',
      'Teslimat kaydı tutarsız durumda',
      'Araç varışa ulaşmış görünüyor ancak teslimat kapanmamış.',
      { deliveryId: delivery.id },
    );
  }

  const fuelJobPaused = delivery
    ? jobIsFuelPaused(delivery, truck)
    : transfer
      ? jobIsFuelPaused(transfer, truck)
      : warehouseTransfer
        ? jobIsFuelPaused(warehouseTransfer, truck)
        : false;
  if (fuelEmpty(truck) && movingJob != null && !fuelJobPaused) {
    return issueBase(
      truck,
      'out_of_fuel_desync',
      'Araç yakıtsız kaldı',
      'Araç yakıtsız kaldı ancak duraklatma / yol yardım akışı düzgün bağlanmamış.',
      jobIds,
    );
  }

  const rentalExpired =
    isLeasedTruck(truck) &&
    (isLeaseTimeExpired(truck, currentTime) || isRentalReturnPending(truck) || truck.leaseExpired === true);
  const rentalJobStalled =
    movingJob != null &&
    (delivery
      ? delivery.status === 'on_route' &&
        !hasPendingIncident(delivery) &&
        jobSpeedIsExplicitlyStopped(delivery.currentSpeedKmh) &&
        (delivery.progress ?? 0) < vehicleStateRecoveryConfig.stalledProgressMax
      : transfer
        ? transfer.status === 'active' &&
          jobSpeedIsExplicitlyStopped(transfer.currentSpeedKmh) &&
          (transfer.progress ?? 0) < vehicleStateRecoveryConfig.stalledProgressMax
        : warehouseTransfer
          ? (warehouseTransfer.status === 'active' || warehouseTransfer.status === 'pending') &&
            jobSpeedIsExplicitlyStopped(warehouseTransfer.currentSpeedKmh) &&
            (warehouseTransfer.progress ?? 0) < vehicleStateRecoveryConfig.stalledProgressMax
          : false);
  if (rentalExpired && movingJob != null && (truck.status === 'idle' || rentalJobStalled)) {
    return issueBase(
      truck,
      'rental_expired_stuck',
      'Kiralama süresi teslimat sırasında sona erdi',
      'Kiralama süresi teslimat sırasında sona erdi ve araç ilerleyemez durumda kaldı.',
      jobIds,
    );
  }

  if (
    truck.status === 'on_route' &&
    delivery &&
    delivery.status === 'on_route' &&
    !fuelEmpty(truck) &&
    !hasPendingIncident(delivery) &&
    jobSpeedIsExplicitlyStopped(delivery.currentSpeedKmh) &&
    (delivery.progress ?? 0) < vehicleStateRecoveryConfig.stalledProgressMax
  ) {
    return issueBase(
      truck,
      'stalled_on_route',
      'Araç durumu ile harita verisi senkron değil',
      'Araç teslimatta görünüyor ancak hızı 0 ve ilerleme durmuş.',
      { deliveryId: delivery.id },
    );
  }

  if (delivery && (delivery.progress ?? 0) < 0.9) {
    const dest = normalizeCityId(delivery.destinationCityId);
    const truckCity = normalizeCityId(truck.currentCityId ?? truck.homeCityId ?? '');
    if (
      truck.status === 'idle' ||
      (truckCity === dest && truck.status !== 'on_route' && truck.status !== 'out_of_fuel')
    ) {
      return issueBase(
        truck,
        'map_fleet_desync',
        'Araç durumu ile harita verisi senkron değil',
        'Haritada araç yolda, filo ekranında ise boşta veya başka şehirde görünüyor.',
        { deliveryId: delivery.id },
      );
    }
  }

  return null;
}

export function detectFleetVehicleStateIssues(input: {
  trucks: Truck[];
  currentTime: number;
  homeCityId?: string;
  activeDeliveries: Delivery[];
  activeTransfers?: TruckTransfer[];
  activeWarehouseStockTransfers?: WarehouseStockTransfer[];
}): VehicleStateIssue[] {
  return (input.trucks ?? [])
    .map((truck) =>
      detectVehicleStateIssue({
        truck,
        currentTime: input.currentTime,
        homeCityId: input.homeCityId,
        activeDelivery: findActiveDelivery(truck.id, input.activeDeliveries),
        activeTransfer: findActiveTransfer(truck.id, input.activeTransfers),
        activeWarehouseTransfer: findActiveWarehouseTransfer(
          truck.id,
          input.activeWarehouseStockTransfers,
        ),
      }),
    )
    .filter((issue): issue is VehicleStateIssue => issue != null);
}

export function getRecoveryActionCost(
  issue: VehicleStateIssue,
  usage: VehicleRecoveryUsage | undefined,
): { free: boolean; cashCost: number; reputationCost: number } {
  if (issue.systemCaused) {
    return { free: true, cashCost: 0, reputationCost: 0 };
  }
  if (!(usage?.freeUsed)) {
    return { free: true, cashCost: 0, reputationCost: 0 };
  }
  return {
    free: false,
    cashCost: vehicleStateRecoveryConfig.subsequentCashCost,
    reputationCost: vehicleStateRecoveryConfig.subsequentReputationCost,
  };
}

export function buildRecoveryOptions(
  issue: VehicleStateIssue,
  usage?: VehicleRecoveryUsage,
): VehicleRecoveryOption[] {
  const cost = getRecoveryActionCost(issue, usage);
  const costNote = cost.free
    ? 'Ücretsiz onarım.'
    : `Bedel: $${cost.cashCost} ve ${cost.reputationCost} itibar.`;

  const option = (
    id: VehicleRecoveryActionId,
    label: string,
    description: string,
  ): VehicleRecoveryOption => ({
    id,
    label,
    description: `${description} ${costNote}`,
    cashCost: cost.cashCost,
    reputationCost: cost.reputationCost,
    free: cost.free,
  });

  const options: VehicleRecoveryOption[] = [];

  if (issue.kind === 'out_of_fuel_desync') {
    options.push(
      option(
        'call_roadside',
        'Yol yardım çağır',
        'Minimum acil yakıt yüklenir ve teslimat duraklatması onarılır.',
      ),
    );
  }

  if (
    issue.kind === 'idle_vs_active_conflict' ||
    issue.kind === 'map_fleet_desync' ||
    issue.kind === 'invalid_route_or_marker' ||
    issue.kind === 'arrived_but_unsettled'
  ) {
    options.push(
      option(
        'repair_delivery_record',
        'Aktif teslimat verisini onar',
        'Araç, teslimat ve harita kaydı yeniden hizalanır.',
      ),
    );
  }

  if (issue.kind === 'map_fleet_desync' || issue.kind === 'idle_vs_active_conflict') {
    options.push(
      option(
        'sync_map_position',
        'Harita konumunu senkronize et',
        'Filo şehri ve harita işaretçisi aynı gerçeğe çekilir.',
      ),
    );
  }

  options.push(
    option(
      'tow_to_nearest_city',
      'Aracı en yakın şehre çek',
      'Aktif iş kontrollü kapatılır, araç en yakın şehre alınır.',
    ),
    option(
      'return_to_depot',
      'Aracı depoya geri al',
      'Aktif iş kapatılır, araç şirket üssüne döner.',
    ),
  );

  if (issue.deliveryId || issue.transferId || issue.warehouseTransferId) {
    options.push(
      option(
        'cancel_delivery',
        'Teslimatı kontrollü iptal et',
        'İş kapatılır; ek teslimat cezası uygulanmaz.',
      ),
    );
  }

  const unique = new Map<VehicleRecoveryActionId, VehicleRecoveryOption>();
  for (const item of options) {
    unique.set(item.id, item);
  }
  return [...unique.values()];
}

export function resolveNearestRecoveryCityId(params: {
  truck: Truck;
  homeCityId?: string;
  delivery?: Delivery | null;
  transfer?: TruckTransfer | null;
  warehouseTransfer?: WarehouseStockTransfer | null;
}): string {
  const delivery = params.delivery;
  const transfer = params.transfer;
  const warehouseTransfer = params.warehouseTransfer;
  const fromId =
    delivery?.originCityId ??
    transfer?.fromCityId ??
    warehouseTransfer?.sourceCityId ??
    params.truck.currentCityId;
  const toId =
    delivery?.destinationCityId ??
    transfer?.toCityId ??
    warehouseTransfer?.destinationCityId ??
    params.truck.currentCityId;
  const progress = clamp01(
    delivery?.progress ?? transfer?.progress ?? warehouseTransfer?.progress ?? 0,
  );
  const from = getWorldMapCityPosition(normalizeCityId(fromId ?? ''));
  const to = getWorldMapCityPosition(normalizeCityId(toId ?? ''));
  if (from && to) {
    const point = {
      x: from.x + (to.x - from.x) * progress,
      y: from.y + (to.y - from.y) * progress,
    };
    let bestId = normalizeCityId(progress >= 0.5 ? toId : fromId);
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const city of Object.values(WORLD_MAP_POSITIONS)) {
      const dx = city.x - point.x;
      const dy = city.y - point.y;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestId = city.id;
      }
    }
    return bestId;
  }
  if (progress >= 0.5 && toId) {
    return normalizeCityId(toId);
  }
  if (fromId) {
    return normalizeCityId(fromId);
  }
  return normalizeCityId(params.truck.homeCityId ?? params.homeCityId ?? 'izmir');
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function parkTruck(truck: Truck, cityId: string, fuelLiters?: number): Truck {
  const parked: Truck = {
    ...truck,
    status: 'idle',
    currentCityId: normalizeCityId(cityId),
  };
  if (fuelLiters != null) {
    return normalizeTruckFuel({ ...parked, currentFuelL: fuelLiters });
  }
  if (fuelEmpty(parked)) {
    return normalizeTruckFuel({
      ...parked,
      currentFuelL: economyBalance.minimumEmergencyFuelLiters,
    });
  }
  return normalizeTruckFuel(parked);
}

function closeDelivery(
  deliveries: Delivery[],
  contracts: Contract[],
  deliveryId: string | undefined,
): { deliveries: Delivery[]; contracts: Contract[] } {
  if (!deliveryId) {
    return { deliveries, contracts };
  }
  return {
    deliveries: deliveries.map((delivery) =>
      delivery.id === deliveryId
        ? {
            ...delivery,
            status: 'cancelled' as const,
            failureReason: 'cancelled' as const,
            pausedReason: undefined,
          }
        : delivery,
    ),
    contracts: contracts.map((contract) => {
      const delivery = deliveries.find((item) => item.id === deliveryId);
      if (!delivery || contract.id !== delivery.contractId) {
        return contract;
      }
      return { ...contract, status: 'failed' as const };
    }),
  };
}

function closeTransfer(
  transfers: TruckTransfer[],
  transferId: string | undefined,
): TruckTransfer[] {
  if (!transferId) {
    return transfers;
  }
  return transfers.map((transfer) =>
    transfer.id === transferId
      ? { ...transfer, status: 'cancelled' as const, pausedReason: undefined }
      : transfer,
  );
}

function closeWarehouseTransfer(
  transfers: WarehouseStockTransfer[],
  transferId: string | undefined,
): WarehouseStockTransfer[] {
  if (!transferId) {
    return transfers;
  }
  return transfers.map((transfer) =>
    transfer.id === transferId
      ? { ...transfer, status: 'cancelled' as const, pausedReason: undefined }
      : transfer,
  );
}

function idleDriver(drivers: Driver[], driverId: string | undefined, cityId: string): Driver[] {
  if (!driverId) {
    return drivers;
  }
  return drivers.map((driver) =>
    driver.id === driverId
      ? { ...driver, status: 'idle' as const, currentCityId: normalizeCityId(cityId) }
      : driver,
  );
}

export function resolveVehicleStateIssue(params: {
  truckId: string;
  actionId: VehicleRecoveryActionId;
  issue: VehicleStateIssue;
  option: VehicleRecoveryOption;
  state: VehicleRecoveryStateSlice;
}): ResolveVehicleStateIssueResult {
  const { truckId, actionId, issue, option, state } = params;
  const warehouseTransfers = state.activeWarehouseStockTransfers ?? [];
  const unchanged = {
    player: state.player,
    activeDeliveries: state.activeDeliveries,
    contracts: state.contracts,
    activeTransfers: state.activeTransfers,
    activeWarehouseStockTransfers: warehouseTransfers,
    vehicleRecovery: state.vehicleRecovery,
    cashDelta: 0,
    reputationDelta: 0,
  };
  const truck = state.player.trucks.find((item) => item.id === truckId);
  if (!truck) {
    return {
      ok: false,
      reason: 'truck-not-found',
      message: 'Kamyon bulunamadı.',
      ...unchanged,
    };
  }

  const delivery = findActiveDelivery(truckId, state.activeDeliveries);
  const transfer = findActiveTransfer(truckId, state.activeTransfers);
  const warehouseTransfer = findActiveWarehouseTransfer(truckId, warehouseTransfers);
  const available = buildRecoveryOptions(issue, state.vehicleRecovery);
  if (!available.some((item) => item.id === actionId)) {
    return {
      ok: false,
      reason: 'action-unavailable',
      message: 'Bu kurtarma eylemi bu durum için kullanılamaz.',
      ...unchanged,
    };
  }

  if (!option.free && state.player.money + 1e-6 < option.cashCost) {
    return {
      ok: false,
      reason: 'insufficient-funds',
      message: `Bu kurtarma için ${option.cashCost} $ gerekir.`,
      ...unchanged,
    };
  }

  const homeCityId = normalizeCityId(truck.homeCityId ?? state.player.homeCityId ?? 'izmir');
  const nearestCityId = resolveNearestRecoveryCityId({
    truck,
    homeCityId,
    delivery,
    transfer,
    warehouseTransfer,
  });

  let nextTruck = truck;
  let nextDeliveries = state.activeDeliveries;
  let nextContracts = state.contracts;
  let nextTransfers = state.activeTransfers;
  let nextWarehouseTransfers = warehouseTransfers;
  let nextDrivers = state.player.drivers ?? [];
  let nextTrailers = state.player.trailers ?? [];
  let parkedCityId = normalizeCityId(truck.currentCityId ?? homeCityId);
  let message = 'Araç durumu onarıldı.';

  const releaseAt = (cityId: string) => {
    parkedCityId = normalizeCityId(cityId);
    nextTruck = parkTruck(truck, parkedCityId);
    const closedDelivery = closeDelivery(nextDeliveries, nextContracts, delivery?.id);
    nextDeliveries = closedDelivery.deliveries;
    nextContracts = closedDelivery.contracts;
    nextTransfers = closeTransfer(nextTransfers, transfer?.id);
    nextWarehouseTransfers = closeWarehouseTransfer(nextWarehouseTransfers, warehouseTransfer?.id);
    nextDrivers = idleDriver(
      nextDrivers,
      delivery?.driverId ?? transfer?.driverId ?? warehouseTransfer?.driverId,
      parkedCityId,
    );
    nextTrailers = syncTrailersWithTruckLocation(nextTrailers, truck.id, parkedCityId, 'idle');
  };

  switch (actionId) {
    case 'tow_to_nearest_city':
      releaseAt(nearestCityId);
      message = `${truck.name} ${getCityName(parkedCityId)} şehrine çekildi.`;
      break;
    case 'return_to_depot':
      releaseAt(homeCityId);
      message = `${truck.name} üsse (${getCityName(homeCityId)}) geri alındı.`;
      break;
    case 'cancel_delivery':
      releaseAt(
        normalizeCityId(
          truck.currentCityId ??
            delivery?.originCityId ??
            transfer?.fromCityId ??
            warehouseTransfer?.sourceCityId ??
            homeCityId,
        ),
      );
      message = 'Teslimat kontrollü olarak iptal edildi.';
      break;
    case 'call_roadside': {
      const liters = economyBalance.minimumEmergencyFuelLiters;
      const nextStatus: Truck['status'] = warehouseTransfer || transfer
        ? 'transferring'
        : delivery
          ? 'on_route'
          : 'idle';
      nextTruck = normalizeTruckFuel({
        ...truck,
        currentFuelL: Math.max(truck.currentFuelL ?? 0, 0) + liters,
        status: nextStatus,
      });
      if (delivery) {
        nextDeliveries = nextDeliveries.map((item) =>
          item.id === delivery.id ? resumeRoadsideJob(item, 'delivery', { litersAdded: liters }) : item,
        );
      }
      if (transfer) {
        nextTransfers = nextTransfers.map((item) =>
          item.id === transfer.id ? resumeRoadsideJob(item, 'truck-transfer', { litersAdded: liters }) : item,
        );
      }
      if (warehouseTransfer) {
        nextWarehouseTransfers = nextWarehouseTransfers.map((item) =>
          item.id === warehouseTransfer.id
            ? resumeRoadsideJob(item, 'warehouse-transfer', { litersAdded: liters })
            : item,
        );
      }
      nextTrailers = syncTrailersWithTruckLocation(nextTrailers, truck.id, truck.currentCityId, nextStatus);
      message = `${truck.name} için yol yardımı uygulandı.`;
      break;
    }
    case 'sync_map_position':
    case 'repair_delivery_record': {
      if (!delivery && !transfer && !warehouseTransfer) {
        releaseAt(normalizeCityId(truck.currentCityId ?? homeCityId));
        message = 'Yolda görünen araç kaydı boşta olacak şekilde onarıldı.';
        break;
      }
      if (
        delivery &&
        (!delivery.originCityId ||
          !delivery.destinationCityId ||
          !hasValidProgress(delivery.progress) ||
          !hasValidCityPair(delivery.originCityId, delivery.destinationCityId))
      ) {
        releaseAt(homeCityId);
        message = 'Bozuk teslimat kaydı kapatıldı, araç üsse alındı.';
        break;
      }
      if (delivery && (delivery.progress ?? 0) >= vehicleStateRecoveryConfig.stalledProgressMax) {
        releaseAt(normalizeCityId(delivery.destinationCityId));
        message = `${truck.name} varış şehrine yerleştirildi ve açık teslimat kapatıldı.`;
        break;
      }
      const inferredCity = normalizeCityId(
        delivery?.originCityId ??
          transfer?.fromCityId ??
          warehouseTransfer?.sourceCityId ??
          truck.currentCityId ??
          homeCityId,
      );
      parkedCityId = inferredCity;
      const nextStatus: Truck['status'] =
        transfer || warehouseTransfer ? 'transferring' : fuelEmpty(truck) ? 'out_of_fuel' : 'on_route';
      nextTruck = {
        ...truck,
        status: nextStatus,
        currentCityId: inferredCity,
      };
      if (delivery && fuelEmpty(truck)) {
        nextDeliveries = nextDeliveries.map((item) =>
          item.id === delivery.id
            ? { ...item, status: 'paused' as const, pausedReason: 'out-of-fuel' as const }
            : item,
        );
      } else if (delivery && delivery.status === 'paused' && !fuelEmpty(truck)) {
        nextDeliveries = nextDeliveries.map((item) =>
          item.id === delivery.id
            ? { ...item, status: 'on_route' as const, pausedReason: undefined }
            : item,
        );
      }
      nextTrailers = syncTrailersWithTruckLocation(nextTrailers, truck.id, inferredCity, nextStatus);
      message = 'Harita ve filo konumu senkronize edildi.';
      break;
    }
    default:
      return {
        ok: false,
        reason: 'action-unavailable',
        message: 'Bilinmeyen kurtarma eylemi.',
        ...unchanged,
      };
  }

  const cashDelta = option.free ? 0 : -option.cashCost;
  const reputationDelta = option.free ? 0 : -option.reputationCost;
  const nextUsage: VehicleRecoveryUsage = {
    freeUsed: state.vehicleRecovery.freeUsed || option.free,
    paidCount: state.vehicleRecovery.paidCount + (option.free ? 0 : 1),
    lastResolvedAt: state.currentTime,
    lastIssueKind: issue.kind,
  };

  return {
    ok: true,
    message,
    player: {
      ...state.player,
      money: state.player.money + cashDelta,
      trucks: state.player.trucks.map((item) => (item.id === truck.id ? nextTruck : item)),
      drivers: nextDrivers,
      trailers: nextTrailers,
    },
    activeDeliveries: nextDeliveries,
    contracts: nextContracts,
    activeTransfers: nextTransfers,
    activeWarehouseStockTransfers: nextWarehouseTransfers,
    vehicleRecovery: nextUsage,
    cashDelta,
    reputationDelta,
    parkedCityId,
  };
}

export function emptyVehicleRecoveryUsage(): VehicleRecoveryUsage {
  return { freeUsed: false, paidCount: 0 };
}

export function normalizeVehicleRecoveryUsage(value: unknown): VehicleRecoveryUsage {
  if (!value || typeof value !== 'object') {
    return emptyVehicleRecoveryUsage();
  }
  const record = value as Record<string, unknown>;
  const paidCount = Number(record.paidCount);
  const lastResolvedAt = Number(record.lastResolvedAt);
  const lastIssueKind =
    typeof record.lastIssueKind === 'string' ? (record.lastIssueKind as VehicleStateIssueKind) : undefined;
  return {
    freeUsed: record.freeUsed === true,
    paidCount: Number.isFinite(paidCount) ? Math.max(0, Math.floor(paidCount)) : 0,
    ...(Number.isFinite(lastResolvedAt) ? { lastResolvedAt } : {}),
    ...(lastIssueKind ? { lastIssueKind } : {}),
  };
}

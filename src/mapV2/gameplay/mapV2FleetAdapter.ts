import type { Delivery, Driver, Truck, TruckTransfer } from '../../types/game';
import { getTruckFuelSnapshot } from '../../utils/truckFuel';
import { resolveTruckDisplayName } from '../../utils/truckDisplayNames';
import { getCityName } from '../../utils/entityLookup';
import { isTruckIdle } from '../../simulation/delivery';
import { findActiveDeliveryForTruck } from '../../simulation/rentalTruckLifecycle';
import { clusterPolicyActive } from '../experience/mapClusterPolicy';
import { COUNTRY_CORRIDOR_WIDTH_CONNECTED } from '../presentation/countryCorridorPaint';
import type { MapLod } from '../presentation/mapLodPolicy';
import { lodShowsFleetAggregate, lodShowsIndividualVehicles } from '../presentation/mapLodPolicy';
import { mapVisualTokens } from '../presentation/mapVisualTokens';
import { markerStateForTruckStatus, resolveVehicleMarkerPaint } from '../presentation/vehicleMarkerVisual';
import { geoCityIdForGameplayCity, getTurkeyCityById } from '../world/countryCityLoader';
import { playerCorridorPointsForCityPair } from './fleetCorridorGeometry';
import { resolveStationaryTruckCityId } from './fleetLocation';
import { resolveTruckStatusPresentation } from './truckStatusPresentation';
import { resolveVehicleMapPosition, type MapPoint, type VehicleMapPlacement } from './vehicleMapPosition';

export type FleetMapFilter = 'all' | 'available' | 'enroute' | 'problem';

export type MapFleetEntity = {
  truckId: string;
  displayName: string;
  instanceLabel: string | null;
  statusLabel: string;
  semanticState: ReturnType<typeof resolveTruckStatusPresentation>['semanticState'];
  gameplayCityId: string | null;
  originCityId: string | null;
  destinationCityId: string | null;
  locationLabel: string;
  routeLabel: string | null;
  activeDeliveryId: string | null;
  etaAt: number | null;
  fuelPercent: number | null;
  conditionPercent: number | null;
  driverName: string | null;
  canRenderExactPosition: boolean;
  canEmphasizeRoute: boolean;
  markerState: ReturnType<typeof markerStateForTruckStatus>;
  availableForWork: boolean;
  placement: VehicleMapPlacement;
  accessibilityLabel: string;
};

export type FleetSummaryCounts = {
  total: number;
  available: number;
  enRoute: number;
  maintenance: number;
  outOfFuel: number;
  cityVehicleCount: number | null;
};

export type MapFleetMarkerDraw = {
  id: string;
  x: number;
  y: number;
  color: string;
  radius: number;
  opacity: number;
  ring: string | null;
  screenOffsetY: number;
  countLabel: string | null;
  accessibilityLabel: string;
};

export type MapFleetEmphasisLine = {
  key: string;
  points: MapPoint[];
  color: string;
  width: number;
};

const ACTIVE_TRANSFER = new Set<TruckTransfer['status']>(['active', 'paused']);

function cityPoint(gameplayCityId: string): MapPoint | null {
  const geoCityId = geoCityIdForGameplayCity(gameplayCityId);
  if (!geoCityId) return null;
  const city = getTurkeyCityById(geoCityId);
  if (!city) return null;
  return { x: city.projected.x, y: city.projected.y };
}

function instanceLabel(truckId: string): string | null {
  if (!truckId || truckId.length > 18) return null;
  return truckId;
}

export function resolveTruckFuelPercent(
  truck: Pick<Truck, 'id' | 'capacity' | 'fuelConsumptionPerKm' | 'currentFuelL' | 'fuelTankCapacityL'>,
): number | null {
  const hasFuel = typeof truck.currentFuelL === 'number' && Number.isFinite(truck.currentFuelL);
  const hasCapacity = typeof truck.fuelTankCapacityL === 'number' && Number.isFinite(truck.fuelTankCapacityL) && truck.fuelTankCapacityL > 0;
  if (!hasFuel && !hasCapacity) return null;
  const snapshot = getTruckFuelSnapshot(truck);
  return snapshot.isValid ? snapshot.percentage : null;
}

/** Truck.condition is already 0–100. Display rounding does not rescale it. */
export function resolveTruckConditionPercent(condition: number | null | undefined): number | null {
  if (typeof condition !== 'number' || !Number.isFinite(condition)) return null;
  return Math.round(Math.min(100, Math.max(0, condition)));
}

export function resolveAssignedDriverName(
  truckId: string,
  drivers: readonly Pick<Driver, 'assignedTruckId' | 'name'>[] | null | undefined,
): string | null {
  const driver = (drivers ?? []).find((candidate) => candidate.assignedTruckId === truckId);
  const name = driver?.name?.trim();
  return name ? name : null;
}

function activeTransferForTruck(
  truckId: string,
  transfers: readonly TruckTransfer[] | null | undefined,
): TruckTransfer | null {
  return (transfers ?? []).find((transfer) => transfer.truckId === truckId && ACTIVE_TRANSFER.has(transfer.status)) ?? null;
}

function locationLabelFor(placement: VehicleMapPlacement, cityName: string | null): string {
  if (placement.kind === 'city') return cityName ?? placement.gameplayCityId;
  if (placement.kind === 'route' || placement.kind === 'corridor') {
    return `${getCityName(placement.originCityId)} → ${getCityName(placement.destinationCityId)}`;
  }
  if (placement.originCityId && placement.destinationCityId) {
    return `${getCityName(placement.originCityId)} → ${getCityName(placement.destinationCityId)}`;
  }
  return 'Konum yok';
}

export function adaptTruckToFleetEntity(input: {
  truck: Truck;
  deliveries?: readonly Delivery[] | null;
  transfers?: readonly TruckTransfer[] | null;
  drivers?: readonly Pick<Driver, 'assignedTruckId' | 'name'>[] | null;
}): MapFleetEntity {
  const { truck } = input;
  const status = resolveTruckStatusPresentation(truck.status);
  const delivery = truck.status === 'on_route' ? findActiveDeliveryForTruck(truck.id, input.deliveries as Delivery[] | undefined) ?? null : null;
  const transfer = truck.status === 'transferring' ? activeTransferForTruck(truck.id, input.transfers) : null;
  const originCityId = delivery?.originCityId ?? transfer?.fromCityId ?? null;
  const destinationCityId = delivery?.destinationCityId ?? transfer?.toCityId ?? null;
  const progress = delivery?.progress ?? transfer?.progress ?? null;
  const corridorPoints = originCityId && destinationCityId ? playerCorridorPointsForCityPair(originCityId, destinationCityId) : null;
  const stationaryCityId = resolveStationaryTruckCityId(truck);
  const placement = resolveVehicleMapPosition({
    status: truck.status,
    currentCityId: truck.currentCityId,
    homeCityId: truck.homeCityId,
    originCityId,
    destinationCityId,
    progress,
    cityPoint: stationaryCityId ? cityPoint(stationaryCityId) : null,
    corridorPoints,
  });
  const gameplayCityId = placement.kind === 'city' ? placement.gameplayCityId : stationaryCityId;
  const cityName = gameplayCityId ? getCityName(gameplayCityId) : null;
  const routeLabel = originCityId && destinationCityId ? `${getCityName(originCityId)} → ${getCityName(destinationCityId)}` : null;
  const displayName = resolveTruckDisplayName(truck);
  const locationLabel = locationLabelFor(placement, cityName);
  const driverName = resolveAssignedDriverName(truck.id, input.drivers);
  return {
    truckId: truck.id,
    displayName,
    instanceLabel: instanceLabel(truck.id),
    statusLabel: status.label,
    semanticState: status.semanticState,
    gameplayCityId,
    originCityId,
    destinationCityId,
    locationLabel,
    routeLabel,
    activeDeliveryId: delivery?.id ?? transfer?.id ?? null,
    etaAt: delivery?.estimatedArrivalTime ?? transfer?.estimatedArrivalAt ?? null,
    fuelPercent: resolveTruckFuelPercent(truck),
    conditionPercent: resolveTruckConditionPercent(truck.condition),
    driverName,
    canRenderExactPosition: placement.kind === 'city' || placement.kind === 'route',
    canEmphasizeRoute: placement.kind === 'route' || placement.kind === 'corridor',
    markerState: markerStateForTruckStatus(truck.status),
    availableForWork: isTruckIdle(truck),
    placement,
    accessibilityLabel: `${displayName}, ${locationLabel}, ${status.accessibilityLabel}`,
  };
}

export function fleetEntityMatchesFilter(entity: MapFleetEntity, filter: FleetMapFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'available') return entity.availableForWork;
  if (filter === 'enroute') return entity.semanticState === 'on_route' || entity.semanticState === 'transferring';
  return entity.semanticState === 'maintenance' || entity.semanticState === 'out_of_fuel';
}

export function summarizeFleet(entities: readonly MapFleetEntity[], selectedGameplayCityId?: string | null): FleetSummaryCounts {
  let available = 0;
  let enRoute = 0;
  let maintenance = 0;
  let outOfFuel = 0;
  for (const entity of entities) {
    if (entity.availableForWork) available += 1;
    else if (entity.semanticState === 'on_route' || entity.semanticState === 'transferring') enRoute += 1;
    else if (entity.semanticState === 'maintenance') maintenance += 1;
    else if (entity.semanticState === 'out_of_fuel') outOfFuel += 1;
  }
  const cityVehicleCount = selectedGameplayCityId
    ? entities.filter((entity) => entity.placement.kind === 'city' && entity.gameplayCityId === selectedGameplayCityId).length
    : null;
  return {
    total: entities.length,
    available,
    enRoute,
    maintenance,
    outOfFuel,
    cityVehicleCount,
  };
}

function associatedWithCity(entity: MapFleetEntity, gameplayCityId: string | null | undefined): boolean {
  if (!gameplayCityId) return true;
  if (entity.gameplayCityId === gameplayCityId) return true;
  return entity.originCityId === gameplayCityId || entity.destinationCityId === gameplayCityId;
}

function clusterVisualState(entities: readonly MapFleetEntity[]): MapFleetEntity['markerState'] {
  const first = entities[0]?.markerState ?? 'AVAILABLE';
  if (entities.every((entity) => entity.markerState === first)) return first;
  if (entities.some((entity) => entity.markerState === 'OUT_OF_FUEL' || entity.markerState === 'MAINTENANCE')) return 'MAINTENANCE';
  return 'AVAILABLE';
}

export function buildFleetMarkers(input: {
  entities: readonly MapFleetEntity[];
  lod: MapLod;
  selectedTruckId?: string | null;
  selectedGameplayCityId?: string | null;
}): MapFleetMarkerDraw[] {
  const positioned = input.entities.filter((entity) => entity.canRenderExactPosition);
  if (lodShowsFleetAggregate(input.lod)) {
    const stationed = positioned.filter((entity) => entity.placement.kind === 'city');
    if (stationed.length === 0) return [];
    const x = stationed.reduce((sum, entity) => sum + (entity.placement.kind === 'city' ? entity.placement.x : 0), 0) / stationed.length;
    const y = stationed.reduce((sum, entity) => sum + (entity.placement.kind === 'city' ? entity.placement.y : 0), 0) / stationed.length;
    const paint = resolveVehicleMarkerPaint({ state: 'AVAILABLE', lod: input.lod, selected: false, muted: false });
    return [
      {
        id: 'fleet-world',
        x,
        y,
        color: paint.color,
        radius: paint.radius,
        opacity: 1,
        ring: null,
        screenOffsetY: 0,
        countLabel: String(stationed.length),
        accessibilityLabel: `Filo, ${stationed.length} araç`,
      },
    ];
  }
  if (!lodShowsIndividualVehicles(input.lod)) return [];
  const markers: MapFleetMarkerDraw[] = [];
  const groups = new Map<string, MapFleetEntity[]>();
  for (const entity of positioned) {
    if (entity.placement.kind !== 'city') continue;
    const group = groups.get(entity.placement.gameplayCityId) ?? [];
    group.push(entity);
    groups.set(entity.placement.gameplayCityId, group);
  }
  const clusteredCityIds = new Set<string>();
  if (clusterPolicyActive('VEHICLE_CLUSTER')) {
    for (const [cityId, group] of groups) {
      if (group.length < 2 || group[0]?.placement.kind !== 'city') continue;
      clusteredCityIds.add(cityId);
      const placement = group[0].placement;
      const selected = group.some((entity) => entity.truckId === input.selectedTruckId);
      const muted = Boolean(input.selectedGameplayCityId) && !group.some((entity) => associatedWithCity(entity, input.selectedGameplayCityId));
      const paint = resolveVehicleMarkerPaint({
        state: clusterVisualState(group),
        lod: input.lod,
        selected,
        muted,
      });
      markers.push({
        id: `cluster:${cityId}`,
        x: placement.x,
        y: placement.y,
        color: paint.color,
        radius: paint.radius + 1.2,
        opacity: paint.opacity,
        ring: paint.ring,
        screenOffsetY: -12,
        countLabel: String(group.length),
        accessibilityLabel: `${getCityName(cityId)}, ${group.length} araç`,
      });
    }
  }
  for (const entity of positioned) {
    if (entity.placement.kind === 'city' && clusteredCityIds.has(entity.placement.gameplayCityId)) continue;
    if (entity.placement.kind !== 'city' && entity.placement.kind !== 'route') continue;
    const paint = resolveVehicleMarkerPaint({
      state: entity.markerState,
      lod: input.lod,
      selected: entity.truckId === input.selectedTruckId,
      muted: !associatedWithCity(entity, input.selectedGameplayCityId),
    });
    markers.push({
      id: entity.truckId,
      x: entity.placement.x,
      y: entity.placement.y,
      color: paint.color,
      radius: paint.radius,
      opacity: paint.opacity,
      ring: paint.ring,
      screenOffsetY: entity.placement.kind === 'city' ? -12 : 0,
      countLabel: null,
      accessibilityLabel: entity.accessibilityLabel,
    });
  }
  return markers;
}

export function buildFleetRouteEmphasis(entity: MapFleetEntity | null | undefined): MapFleetEmphasisLine[] {
  if (!entity?.canEmphasizeRoute) return [];
  const placement = entity.placement;
  if (placement.kind === 'route') {
    return [
      {
        key: `${entity.truckId}:done`,
        points: placement.completed,
        color: mapVisualTokens.roadSecondary,
        width: COUNTRY_CORRIDOR_WIDTH_CONNECTED,
      },
      {
        key: `${entity.truckId}:left`,
        points: placement.remaining,
        color: mapVisualTokens.roadSelected,
        width: COUNTRY_CORRIDOR_WIDTH_CONNECTED,
      },
    ];
  }
  if (placement.kind === 'corridor') {
    return [
      {
        key: `${entity.truckId}:corridor`,
        points: placement.points,
        color: mapVisualTokens.roadSelected,
        width: COUNTRY_CORRIDOR_WIDTH_CONNECTED,
      },
    ];
  }
  return [];
}

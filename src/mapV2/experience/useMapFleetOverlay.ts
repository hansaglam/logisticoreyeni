import { useEffect, useMemo } from 'react';

import { getVisibleFleetTrucks } from '../../simulation/rentalTruckLifecycle';
import { useGameStore } from '../../store/gameStore';
import { selectActiveDeliveries, selectActiveTransfers } from '../../store/selectors/stableCollections';
import { selectPlayerDrivers, selectPlayerTrucks } from '../../store/selectors/playerFields';
import { resolveMapLod, type MapScope } from '../presentation/mapLodPolicy';
import {
  adaptTruckToFleetEntity,
  buildFleetMarkers,
  buildFleetRouteEmphasis,
  fleetEntityMatchesFilter,
  summarizeFleet,
  type FleetSummaryCounts,
  type MapFleetEmphasisLine,
  type MapFleetEntity,
  type MapFleetMarkerDraw,
} from '../gameplay/mapV2FleetAdapter';
import {
  clearMapFleetVehicleContext,
  openMapFleetSummary,
  selectMapFleetCluster,
  selectMapFleetTruck,
  setMapFleetFilter,
  useMapFleetSession,
  type FleetMapFilter,
} from './mapFleetSession';

export type MapFleetLayerModel = {
  enabled: boolean;
  markers: readonly MapFleetMarkerDraw[];
  emphasis: readonly MapFleetEmphasisLine[];
  onSelectMarker: (markerId: string) => void;
};

export type MapFleetPanelModel = {
  counts: FleetSummaryCounts;
  filter: FleetMapFilter;
  trucks: readonly MapFleetEntity[];
  clusterTrucks: readonly MapFleetEntity[];
  clusterCityId: string | null;
  selected: MapFleetEntity | null;
  setFilter: (filter: FleetMapFilter) => void;
  selectTruck: (truckId: string) => void;
  clearCluster: () => void;
  clearSelection: () => void;
};

const EMPTY_LAYER: MapFleetLayerModel = {
  enabled: false,
  markers: [],
  emphasis: [],
  onSelectMarker: () => undefined,
};

export function useMapFleetOverlay(input: {
  enabled: boolean;
  scope: MapScope;
  selectedGameplayCityId?: string | null;
  hasCitySelection?: boolean;
}): { layer: MapFleetLayerModel; panel: MapFleetPanelModel; selectionNonce: number } {
  const trucks = useGameStore(selectPlayerTrucks);
  const drivers = useGameStore(selectPlayerDrivers);
  const deliveries = useGameStore(selectActiveDeliveries);
  const transfers = useGameStore(selectActiveTransfers);
  const currentTime = useGameStore((state) => state.currentTime);
  const session = useMapFleetSession();
  const visibleTrucks = useMemo(
    () => getVisibleFleetTrucks(trucks, currentTime, deliveries),
    [currentTime, deliveries, trucks],
  );
  const entities = useMemo(
    () => visibleTrucks.map((truck) => adaptTruckToFleetEntity({ truck, deliveries, transfers, drivers })),
    [deliveries, drivers, transfers, visibleTrucks],
  );
  const selected = useMemo(
    () => entities.find((entity) => entity.truckId === session.selectedTruckId) ?? null,
    [entities, session.selectedTruckId],
  );
  const lod = resolveMapLod({
    scope: input.scope === 'CITY_DETAIL' ? 'CITY_DETAIL' : input.scope,
    hasCitySelection: Boolean(input.hasCitySelection),
  });
  const filtered = useMemo(
    () => entities.filter((entity) => fleetEntityMatchesFilter(entity, session.filter)),
    [entities, session.filter],
  );
  const markers = useMemo(
    () =>
      input.enabled
        ? buildFleetMarkers({
            entities: filtered,
            lod,
            selectedTruckId: selected?.truckId ?? null,
            selectedGameplayCityId: input.selectedGameplayCityId,
          })
        : [],
    [filtered, input.enabled, input.selectedGameplayCityId, lod, selected?.truckId],
  );
  const emphasis = useMemo(
    () => (input.enabled && input.scope === 'COUNTRY' ? buildFleetRouteEmphasis(selected) : []),
    [input.enabled, input.scope, selected],
  );
  const counts = useMemo(
    () => summarizeFleet(entities, input.selectedGameplayCityId),
    [entities, input.selectedGameplayCityId],
  );
  const clusterTrucks = useMemo(() => {
    if (!session.clusterCityId) return [];
    return filtered.filter((entity) => entity.placement.kind === 'city' && entity.gameplayCityId === session.clusterCityId);
  }, [filtered, session.clusterCityId]);

  useEffect(() => {
    if (!session.selectedTruckId) return;
    if (entities.some((entity) => entity.truckId === session.selectedTruckId)) return;
    clearMapFleetVehicleContext();
  }, [entities, session.selectedTruckId]);

  const layer = useMemo<MapFleetLayerModel>(() => {
    if (!input.enabled) return EMPTY_LAYER;
    return {
      enabled: true,
      markers,
      emphasis,
      onSelectMarker: (markerId: string) => {
        if (markerId === 'fleet-world') {
          openMapFleetSummary();
          return;
        }
        if (markerId.startsWith('cluster:')) {
          selectMapFleetCluster(markerId.slice('cluster:'.length));
          return;
        }
        selectMapFleetTruck(markerId);
      },
    };
  }, [emphasis, input.enabled, markers]);

  const panel: MapFleetPanelModel = {
    counts,
    filter: session.filter,
    trucks: filtered,
    clusterTrucks,
    clusterCityId: session.clusterCityId,
    selected: input.scope === 'WORLD' ? null : selected,
    setFilter: setMapFleetFilter,
    selectTruck: selectMapFleetTruck,
    clearCluster: () => selectMapFleetCluster(null),
    clearSelection: clearMapFleetVehicleContext,
  };

  return { layer, panel, selectionNonce: session.selectionNonce };
}

import React, { useEffect, useMemo, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { MIN_TOUCH_TARGET } from '../../../constants/layout';
import { getVisibleFleetTrucks } from '../../../simulation/rentalTruckLifecycle';
import { getCityOperationsSnapshot } from '../../../mapV2/gameplay/cityOperationsSelectors';
import type { CityQuickAction, MapV2CityGameplayLink } from '../../../mapV2/gameplay/mapV2CityGameplayAdapter';
import { useGameStore } from '../../../store/gameStore';
import {
  selectActiveDeliveries,
  selectContracts,
} from '../../../store/selectors/stableCollections';
import { selectPlayerHomeCityId, selectPlayerTrucks, selectPlayerWarehouses } from '../../../store/selectors/playerFields';
import { GameIcon } from '../../ui';
import MapCityInspector from './MapCityInspector';
import MapFleetSummary from './MapFleetSummary';
import MapVehicleInspector from './MapVehicleInspector';
import {
  getMapCommandModeDefinition,
  resolveCommandInspectorPanel,
  type MapCommandMode,
  type MapInspectorPanel,
} from './mapCommandMode';
import type { MapCommandTelemetry } from './mapCommandTelemetry';
import { mapUiTheme } from './mapUiTheme';
import type { MapFleetPanelModel } from '../../../mapV2/experience/useMapFleetOverlay';

interface MapContextualInspectorProps {
  mode: MapCommandMode;
  telemetry: MapCommandTelemetry;
  width: number;
  overlay: boolean;
  locationLabel?: string | null;
  cityLink?: MapV2CityGameplayLink | null;
  mapScope?: 'WORLD' | 'COUNTRY';
  /** Changes when a city is selected or the inspector reopens. Not a command-mode key. */
  inspectorFocusKey?: number;
  fleetPanel?: MapFleetPanelModel | null;
  currentTime?: number;
  onShowTruckCity?: (gameplayCityId: string) => void;
  onShowTruckRoute?: () => void;
  onCityAction?: (action: CityQuickAction) => void;
  onClearCity?: () => void;
  onClose: () => void;
}

const PANEL_TITLE: Record<MapInspectorPanel, string> = {
  NONE: '',
  OVERVIEW: 'Operasyon özeti',
  CITY: 'Şehir',
  VEHICLE: 'Filo',
  CONTRACT: 'İşler',
  WAREHOUSE: 'Depolar',
  MARKET: 'Pazar',
  ALERT: 'Uyarı',
};

function MapContextualInspector({
  mode,
  telemetry,
  width,
  overlay,
  locationLabel,
  cityLink,
  mapScope = 'WORLD',
  inspectorFocusKey = 0,
  fleetPanel = null,
  currentTime = 0,
  onShowTruckCity,
  onShowTruckRoute,
  onCityAction,
  onClearCity,
  onClose,
}: MapContextualInspectorProps) {
  const panel = resolveCommandInspectorPanel({
    mode,
    citySelected: Boolean(cityLink),
    scope: mapScope,
  });
  const scrollRef = useRef<ScrollView>(null);
  const cityIdentity = cityLink?.gameplayCityId ?? cityLink?.mapCityId ?? '';
  const scrollResetKey =
    panel === 'CITY'
      ? `${cityIdentity}:${inspectorFocusKey}`
      : panel === 'VEHICLE' && fleetPanel?.selected
        ? `vehicle:${fleetPanel.selected.truckId}:${inspectorFocusKey}`
        : null;

  useEffect(() => {
    if (scrollResetKey == null) return;
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [scrollResetKey]);

  if (panel === 'NONE') {
    return null;
  }
  const definition = getMapCommandModeDefinition(mode);
  const cityPanel = panel === 'CITY' && cityLink && onCityAction && onClearCity;
  const vehicleSelected = panel === 'VEHICLE' && fleetPanel?.selected ? fleetPanel.selected : null;
  const readOnly = panel !== 'OVERVIEW' || definition.availability === 'foundation';

  return (
    <View
      style={[styles.panel, overlay ? styles.overlay : null, { width }]}
      accessibilityRole="summary"
      accessibilityLabel={cityLink ? cityLink.displayName : PANEL_TITLE[panel]}
    >
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          {vehicleSelected ? (
            <>
              <Text style={styles.cityName} numberOfLines={1}>
                {vehicleSelected.displayName}
              </Text>
              {vehicleSelected.instanceLabel ? (
                <Text style={styles.country} numberOfLines={1}>
                  {vehicleSelected.instanceLabel}
                </Text>
              ) : (
                <Text style={styles.country} numberOfLines={1}>
                  {vehicleSelected.statusLabel}
                </Text>
              )}
            </>
          ) : cityPanel ? (
            <>
              <Text style={styles.cityName} numberOfLines={1}>
                {cityLink.displayName}
              </Text>
              {cityLink.countryName ? (
                <Text style={styles.country} numberOfLines={1}>
                  {cityLink.countryName}
                </Text>
              ) : null}
            </>
          ) : (
            <Text style={styles.title} numberOfLines={1}>
              {PANEL_TITLE[panel]}
            </Text>
          )}
        </View>
        <Pressable
          style={styles.close}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Özeti kapat"
          hitSlop={10}
        >
          <GameIcon name="close" size={14} color={mapUiTheme.textSecondary} />
        </Pressable>
      </View>
      <ScrollView
        key={scrollResetKey ?? 'overview'}
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {panel === 'CITY' && cityLink && onCityAction && onClearCity ? (
          <CityOperationsBody
            link={cityLink}
            width={width}
            onAction={onCityAction}
            onClear={onClearCity}
          />
        ) : panel === 'VEHICLE' && fleetPanel ? (
          vehicleSelected ? (
            <MapVehicleInspector
              model={{
                truck: vehicleSelected,
                currentTime,
                onShowCity: onShowTruckCity,
                onShowRoute: onShowTruckRoute,
                onClear: fleetPanel.clearSelection,
              }}
            />
          ) : (
            <MapFleetSummary
              model={{
                counts: fleetPanel.counts,
                filter: fleetPanel.filter,
                trucks: fleetPanel.trucks,
                clusterTrucks: fleetPanel.clusterTrucks,
                clusterCityId: fleetPanel.clusterCityId,
                cityName: cityLink?.displayName ?? null,
                onFilter: fleetPanel.setFilter,
                onSelectTruck: fleetPanel.selectTruck,
                onClearCluster: fleetPanel.clearCluster,
              }}
            />
          )
        ) : (
          <>
            {locationLabel ? (
              <Text style={styles.location} numberOfLines={1}>
                {locationLabel}
              </Text>
            ) : null}
            {definition.availability === 'foundation' ? (
              <Text style={styles.note}>
                Demiryolu ağı temel katmanda. Üretim sevkiyatı bu ekranda açık değil.
              </Text>
            ) : null}
            {readOnly && definition.availability !== 'foundation' && panel !== 'OVERVIEW' ? (
              <Text style={styles.note}>Okunur özet. İşlemler sonraki harita fazında.</Text>
            ) : null}
            <Metric label="Aktif teslimat" value={telemetry.activeDeliveries} />
            <Metric label="Müsait araç" value={telemetry.availableVehicles} />
            <Metric label="Yoldaki araç" value={telemetry.vehiclesOnRoad} />
            <Metric label="Depo" value={telemetry.warehouseCount} />
          </>
        )}
      </ScrollView>
    </View>
  );
}

function CityOperationsBody({
  link,
  width,
  onAction,
  onClear,
}: {
  link: MapV2CityGameplayLink;
  width: number;
  onAction: (action: CityQuickAction) => void;
  onClear: () => void;
}) {
  const contracts = useGameStore(selectContracts);
  const trucks = useGameStore(selectPlayerTrucks);
  const warehouses = useGameStore(selectPlayerWarehouses);
  const deliveries = useGameStore(selectActiveDeliveries);
  const homeCityId = useGameStore(selectPlayerHomeCityId);
  const currentTime = useGameStore((state) => state.currentTime);
  const visibleTrucks = useMemo(
    () => getVisibleFleetTrucks(trucks, currentTime, deliveries),
    [currentTime, deliveries, trucks],
  );
  const snapshot = useMemo(() => {
    if (!link.gameplayCityId) return null;
    return getCityOperationsSnapshot({
      cityId: link.gameplayCityId,
      homeCityId,
      contracts,
      trucks: visibleTrucks,
      deliveries,
      warehouses,
    });
  }, [contracts, deliveries, homeCityId, link.gameplayCityId, visibleTrucks, warehouses]);

  return (
    <MapCityInspector
      model={{ link, snapshot, onAction, onClear }}
      width={width}
    />
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

export default React.memo(MapContextualInspector);

const styles = StyleSheet.create({
  panel: {
    alignSelf: 'stretch',
    minHeight: 0,
    flexShrink: 0,
    overflow: 'hidden',
    backgroundColor: mapUiTheme.surfaceElevated,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: mapUiTheme.border,
    paddingHorizontal: mapUiTheme.space8,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    zIndex: 2,
  },
  location: {
    color: mapUiTheme.cyanPrimary,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 4,
  },
  header: {
    flexGrow: 0,
    flexShrink: 0,
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: mapUiTheme.space4,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  cityName: {
    color: mapUiTheme.textPrimary,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  country: {
    color: mapUiTheme.cyanPrimary,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 1,
  },
  title: {
    color: mapUiTheme.textPrimary,
    fontSize: 13,
    fontWeight: '800',
  },
  close: {
    minWidth: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  scrollContent: {
    paddingBottom: mapUiTheme.space8,
  },
  note: {
    color: mapUiTheme.textMuted,
    fontSize: 10,
    lineHeight: 14,
  },
  metric: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: mapUiTheme.space8,
    paddingVertical: mapUiTheme.space2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: mapUiTheme.border,
  },
  metricLabel: {
    color: mapUiTheme.textSecondary,
    fontSize: 11,
    fontWeight: '600',
    flex: 1,
  },
  metricValue: {
    color: mapUiTheme.textPrimary,
    fontSize: 13,
    fontWeight: '800',
  },
});

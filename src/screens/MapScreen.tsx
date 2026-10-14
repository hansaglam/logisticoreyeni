/**
 * LogistiCore - Harita
 *
 * Landscape operations command center around the existing geographic renderer.
 * Legacy portrait map components remain in the project and are not deleted.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { debugConfig } from '../config/debug';
import { resolveActiveMapExperience } from '../domain/mapExperienceAuthority';
import WorldMapCanvas, { type WorldMapCanvasHandle } from '../components/map/WorldMapCanvas';
import MapV2CommandCenterViewport from '../mapV2/experience/MapV2CommandCenterViewport';
import { clearMapFleetVehicleContext } from '../mapV2/experience/mapFleetSession';
import { useMapFleetOverlay } from '../mapV2/experience/useMapFleetOverlay';
import type {
  MapV2CitySelection,
  MapV2CountrySelection,
} from '../mapV2/experience/useMapV2GeographicExperience';
import MapCommandCenterShell from '../components/map/commandCenter/MapCommandCenterShell';
import {
  resolveMapCommandMode,
  type MapCommandMode,
} from '../components/map/commandCenter/mapCommandMode';
import { buildMapCommandTelemetry } from '../components/map/commandCenter/mapCommandTelemetry';
import { mapUiTheme } from '../components/map/commandCenter/mapUiTheme';
import {
  cityQuickActionMode,
  resolveMapV2CityGameplay,
  type CityQuickAction,
  type MapV2CityGameplayLink,
} from '../mapV2/gameplay/mapV2CityGameplayAdapter';
import MapHelpMenu from '../components/map/MapHelpMenu';
import { MAP_BG } from '../components/map/mapTheme';
import type { NetworkFilterKey } from '../components/map/mapTypes';
import { getVisibleFleetTrucks } from '../simulation/rentalTruckLifecycle';
import ContextualGuideHost from '../contextualGuide/components/ContextualGuideHost';
import { openHelpGuide } from '../contextualGuide/openHelpGuide';
import { useTabBarLayout } from '../hooks/useTabBarLayout';
import { useOnboardingScreenVisit } from '../hooks/useOnboardingScreenVisit';
import { useScreenRenderProfiler } from '../hooks/useScreenRenderProfiler';
import { useGameStore } from '../store/gameStore';
import {
  selectActiveDeliveries,
  selectActiveTransfers,
  selectCities,
} from '../store/selectors/stableCollections';
import {
  selectHasPlayer,
  selectPlayerTrucks,
  selectPlayerWarehouses,
} from '../store/selectors/playerFields';
import type { DeliveryStatus } from '../types/game';

function isTruckIdle(status: string): boolean {
  return status === 'idle' || status === 'available' || status === 'BOŞTA';
}

const ACTIVE_DELIVERY_STATUSES: DeliveryStatus[] = ['preparing', 'on_route', 'paused'];
const STATUS_MESSAGE_TIMEOUT_MS = 3000;

function networkFilterForMode(mode: MapCommandMode): NetworkFilterKey {
  if (mode === 'fleet') return 'trucks';
  if (mode === 'warehouses') return 'depots';
  return 'all';
}

export default function MapScreen({
  onExitHome,
}: {
  onOpenContracts?: () => void;
  onExitHome: () => void;
}) {
  useScreenRenderProfiler('Map');
  const hasPlayer = useGameStore(selectHasPlayer);
  const playerTrucks = useGameStore(selectPlayerTrucks);
  const warehouses = useGameStore(selectPlayerWarehouses);
  const cities = useGameStore(selectCities);
  const activeDeliveries = useGameStore(selectActiveDeliveries);
  const activeTransfers = useGameStore(selectActiveTransfers);
  const currentTime = useGameStore((state) => state.currentTime);
  const { contentBottomPadding, screenTopPadding } = useTabBarLayout();

  useOnboardingScreenVisit('Map');
  const [commandMode, setCommandMode] = useState<MapCommandMode>('overview');
  const [selectedDeliveryId, setSelectedDeliveryId] = useState<string | null>(null);
  const [locationLabel, setLocationLabel] = useState<string | null>(null);
  const [cityLink, setCityLink] = useState<MapV2CityGameplayLink | null>(null);
  const [inspectorFocusKey, setInspectorFocusKey] = useState(0);
  const [cityClearNonce, setCityClearNonce] = useState(0);
  const [mapScope, setMapScope] = useState<'WORLD' | 'COUNTRY'>('WORLD');
  const countryLabelRef = useRef<string | null>(null);
  const mapExperience = resolveActiveMapExperience();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const mapRef = useRef<WorldMapCanvasHandle>(null);
  const didReconcileOnOpenRef = useRef(false);
  const safeMode = resolveMapCommandMode(commandMode);
  const seenFleetNonceRef = useRef(0);
  const [fleetCityFocus, setFleetCityFocus] = useState<{ gameplayCityId: string; nonce: number } | null>(null);
  const fleet = useMapFleetOverlay({
    enabled: safeMode === 'fleet',
    scope: mapScope,
    selectedGameplayCityId: cityLink?.gameplayCityId ?? null,
    hasCitySelection: Boolean(cityLink),
  });

  useEffect(() => {
    if (fleet.selectionNonce === seenFleetNonceRef.current) return;
    seenFleetNonceRef.current = fleet.selectionNonce;
    if (fleet.selectionNonce === 0) return;
    setInspectorFocusKey((value) => value + 1);
  }, [fleet.selectionNonce]);

  useEffect(() => {
    if (!hasPlayer || didReconcileOnOpenRef.current) return;
    didReconcileOnOpenRef.current = true;
    const result = useGameStore.getState().reconcileMapTracking('map-open');
    if (result.fixedCount > 0) {
      setStatusMessage(result.toast);
    }
  }, [hasPlayer]);

  useEffect(() => {
    if (!statusMessage) return;
    const timeout = setTimeout(() => setStatusMessage(null), STATUS_MESSAGE_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [statusMessage]);

  const runningDeliveries = useMemo(
    () => activeDeliveries.filter((delivery) => ACTIVE_DELIVERY_STATUSES.includes(delivery.status)),
    [activeDeliveries],
  );

  const runningDeliveriesKey = useMemo(
    () =>
      runningDeliveries
        .map(
          (delivery) =>
            `${delivery.id}:${delivery.status}:${Math.floor(delivery.progress * 10)}:${Math.floor(delivery.estimatedArrivalTime)}`,
        )
        .join('|'),
    [runningDeliveries],
  );

  useEffect(() => {
    if (runningDeliveries.length === 0) {
      setSelectedDeliveryId((current) => (current == null ? current : null));
      return;
    }
    const firstId = runningDeliveries[0]?.id ?? null;
    setSelectedDeliveryId((current) => {
      if (current && runningDeliveries.some((delivery) => delivery.id === current)) {
        return current;
      }
      return firstId;
    });
  }, [runningDeliveriesKey, runningDeliveries.length]);

  const trucks = useMemo(
    () => getVisibleFleetTrucks(playerTrucks, currentTime, activeDeliveries),
    [playerTrucks, currentTime, activeDeliveries],
  );

  const validTruckIdsKey = useMemo(
    () => trucks.map((truck) => truck.id).sort().join('|'),
    [trucks],
  );
  const validTruckIds = useMemo(
    () => new Set(validTruckIdsKey ? validTruckIdsKey.split('|') : []),
    [validTruckIdsKey],
  );

  const vehiclesOnRoad = useMemo(
    () => trucks.filter((truck) => truck.status === 'on_route').length,
    [trucks],
  );
  const availableVehicles = useMemo(
    () => trucks.filter((truck) => isTruckIdle(truck.status)).length,
    [trucks],
  );
  const telemetry = useMemo(
    () =>
      buildMapCommandTelemetry({
        activeDeliveries: runningDeliveries.length,
        vehiclesOnRoad,
        availableVehicles,
        warehouseCount: warehouses.length,
      }),
    [availableVehicles, runningDeliveries.length, vehiclesOnRoad, warehouses.length],
  );

  const handleSyncMap = useCallback(() => {
    const result = useGameStore.getState().reconcileMapTracking('manual');
    setStatusMessage(result.toast);
  }, []);

  const handleInspectMapVehicles = useCallback(() => {
    const result = useGameStore.getState().inspectMapTracking();
    setStatusMessage(result.toast);
  }, []);

  const handleDeliveryPress = (deliveryId: string) => {
    setSelectedDeliveryId(deliveryId);
    setCommandMode('fleet');
  };

  const handleModeChange = useCallback((next: MapCommandMode) => {
    const resolved = resolveMapCommandMode(next);
    if (resolved !== 'fleet') clearMapFleetVehicleContext();
    setCommandMode(resolved);
  }, []);

  const handleCityAction = useCallback((action: CityQuickAction) => {
    setCommandMode(resolveMapCommandMode(cityQuickActionMode(action)));
  }, []);

  const handleClearCity = useCallback(() => {
    setCityClearNonce((value) => value + 1);
  }, []);

  const handleCountrySelect = useCallback((selection: MapV2CountrySelection) => {
    countryLabelRef.current = selection.displayName;
    setLocationLabel(selection.displayName);
    if (!selection.geoCountryId) {
      setCityLink(null);
      setMapScope('WORLD');
      clearMapFleetVehicleContext();
      return;
    }
    setMapScope('COUNTRY');
  }, []);

  const handleShowTruckCity = useCallback((gameplayCityId: string) => {
    setFleetCityFocus((current) => ({ gameplayCityId, nonce: (current?.nonce ?? 0) + 1 }));
  }, []);

  const handleShowTruckRoute = useCallback(() => {
    // The selected truck already emphasizes its existing corridor. No gameplay write.
  }, []);

  const handleCitySelect = useCallback((selection: MapV2CitySelection) => {
    if (!selection.geoCityId) {
      setCityLink(null);
      setLocationLabel(countryLabelRef.current);
      return;
    }
    const link = resolveMapV2CityGameplay({
      geoCityId: selection.geoCityId,
      geoDisplayName: selection.displayName,
      countryId: 'country.tur',
      countryName: countryLabelRef.current,
    });
    setCityLink(link);
    setInspectorFocusKey((value) => value + 1);
    setLocationLabel(link.displayName);
  }, []);

  if (!hasPlayer) {
    return (
      <View style={[styles.safeArea, { paddingTop: screenTopPadding, paddingBottom: contentBottomPadding }]}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Oyun yükleniyor...</Text>
        </View>
      </View>
    );
  }

  if (mapExperience === 'LEGACY_MAP' && cities.length === 0) {
    return (
      <View style={[styles.safeArea, { paddingTop: screenTopPadding, paddingBottom: contentBottomPadding }]}>
        <View style={styles.loadingContainer}>
          <Text style={styles.emptyStateTitle}>Harita verisi yok</Text>
          <Text style={styles.emptyStateSubtitle}>Şehir verileri henüz yüklenmedi.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.safeArea}>
      <MapCommandCenterShell
        mode={safeMode}
        telemetry={telemetry}
        onModeChange={handleModeChange}
        onExit={onExitHome}
        locationLabel={cityLink ? null : locationLabel}
        cityLink={cityLink}
        mapScope={mapScope}
        inspectorFocusKey={inspectorFocusKey}
        onCityAction={handleCityAction}
        onClearCity={handleClearCity}
        fleetPanel={safeMode === 'fleet' ? fleet.panel : null}
        currentTime={currentTime}
        onShowTruckCity={handleShowTruckCity}
        onShowTruckRoute={handleShowTruckRoute}
        helpSlot={
          <MapHelpMenu
            compact
            helpGuideOnPress={() => openHelpGuide('deliveries')}
            helpGuideAccessibilityLabel="Yardım ve Rehber"
            onSyncMap={handleSyncMap}
            onInspectVehicles={handleInspectMapVehicles}
          />
        }
      >
        {mapExperience === 'MAP_V2' ? (
          <MapV2CommandCenterViewport
            emphasis={safeMode === 'road' ? 'road' : safeMode === 'rail' ? 'rail' : 'overview'}
            onCountrySelect={handleCountrySelect}
            onCitySelect={handleCitySelect}
            onRouteSelect={() => undefined}
            onMarkerSelect={() => undefined}
            cityClearNonce={cityClearNonce}
            fleetMode={safeMode === 'fleet'}
            fleetLayer={safeMode === 'fleet' ? fleet.layer : null}
            fleetCityFocus={fleetCityFocus}
          />
        ) : (
          <WorldMapCanvas
            ref={mapRef}
            calibrationMode={debugConfig.mapCalibrationEnabled}
            activeDeliveries={activeDeliveries}
            activeTransfers={activeTransfers}
            validTruckIds={validTruckIds}
            selectedFilter={networkFilterForMode(safeMode)}
            selectedDeliveryId={selectedDeliveryId}
            onDeliveryPress={handleDeliveryPress}
            fill
          />
        )}
        {statusMessage ? (
          <View style={styles.statusToast} pointerEvents="none">
            <Text style={styles.statusToastText}>{statusMessage}</Text>
          </View>
        ) : null}
      </MapCommandCenterShell>
      <ContextualGuideHost cardId="follow_route" blockingUi={false} />
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: MAP_BG,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  loadingText: {
    color: mapUiTheme.textMuted,
    fontSize: 16,
  },
  emptyStateTitle: {
    color: mapUiTheme.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
  },
  emptyStateSubtitle: {
    color: mapUiTheme.textMuted,
    fontSize: 13,
    textAlign: 'center',
  },
  statusToast: {
    position: 'absolute',
    top: 8,
    left: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: mapUiTheme.smallRadius,
    backgroundColor: 'rgba(8, 18, 32, 0.88)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: mapUiTheme.greenSuccess,
  },
  statusToastText: {
    color: mapUiTheme.greenSuccess,
    fontSize: 11,
    fontWeight: '700',
  },
});

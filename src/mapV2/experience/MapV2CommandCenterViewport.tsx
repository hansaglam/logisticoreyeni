/**
 * Map V2 inside the accepted Harita command-center viewport.
 * No second header, rail, or inspector.
 *
 * Fleet markers come from the command screen when Filo is active.
 * Warehouse and delivery overlays stay pending.
 */
import React, { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import { geoCityIdForGameplayCity } from '../world/countryCityLoader';
import MapScopeBackControl from './MapScopeBackControl';
import MapV2ExperienceCanvas from './MapV2ExperienceCanvas';
import type { MapFleetLayerModel } from './useMapFleetOverlay';
import {
  useMapV2GeographicExperience,
  type MapV2CitySelection,
  type MapV2CountrySelection,
  type MapV2MarkerSelection,
  type MapV2RouteSelection,
} from './useMapV2GeographicExperience';

export const MAP_V2_WAREHOUSE_OVERLAY_PENDING = 'MAP_V2_WAREHOUSE_OVERLAY_PENDING' as const;
export const MAP_V2_DELIVERY_OVERLAY_PENDING = 'MAP_V2_DELIVERY_OVERLAY_PENDING' as const;

export type MapV2CommandEmphasis = 'overview' | 'road' | 'rail';

type Props = {
  emphasis: MapV2CommandEmphasis;
  onCountrySelect?: (selection: MapV2CountrySelection) => void;
  onCitySelect?: (selection: MapV2CitySelection) => void;
  onRouteSelect?: (selection: MapV2RouteSelection) => void;
  onMarkerSelect?: (selection: MapV2MarkerSelection) => void;
  cityClearNonce?: number;
  fleetMode?: boolean;
  fleetLayer?: MapFleetLayerModel | null;
  fleetCityFocus?: { gameplayCityId: string; nonce: number } | null;
};

export default function MapV2CommandCenterViewport({
  emphasis,
  onCountrySelect,
  onCitySelect,
  onRouteSelect,
  onMarkerSelect,
  cityClearNonce = 0,
  fleetMode = false,
  fleetLayer = null,
  fleetCityFocus = null,
}: Props) {
  const experience = useMapV2GeographicExperience({
    enterCountryOnSelect: true,
    cityDetailEnabled: false,
    emphasizeRoad: emphasis === 'road',
    showRailFoundation: emphasis === 'rail',
    railVisualPreview: false,
    seaVisualPreview: false,
    airVisualPreview: false,
    handleHardwareBack: true,
    onCountrySelect,
    onCitySelect,
    onRouteSelect,
    onMarkerSelect,
    cityClearNonce,
  });
  const seenFleetCityFocus = useRef(0);

  useEffect(() => {
    if (!fleetCityFocus || fleetCityFocus.nonce === seenFleetCityFocus.current) return;
    seenFleetCityFocus.current = fleetCityFocus.nonce;
    const geoCityId = geoCityIdForGameplayCity(fleetCityFocus.gameplayCityId);
    if (!geoCityId) return;
    experience.selectOverviewCity(geoCityId);
  }, [experience.selectOverviewCity, fleetCityFocus]);

  return (
    <View style={styles.fill} pointerEvents="box-none">
      <MapV2ExperienceCanvas experience={experience} fleetLayer={fleetMode ? fleetLayer : null} />
      <MapScopeBackControl experience={experience} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    width: '100%',
    minWidth: 0,
    minHeight: 0,
  },
});

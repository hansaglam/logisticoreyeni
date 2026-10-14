/**
 * Map V2 inside the accepted Harita command-center viewport.
 * No second header, rail, or inspector.
 *
 * Fleet, warehouse, and delivery markers are not invented here.
 * City-node hints already exist inside country mode via the shared experience.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';

import MapV2ExperienceCanvas from './MapV2ExperienceCanvas';
import {
  useMapV2GeographicExperience,
  type MapV2CitySelection,
  type MapV2CountrySelection,
  type MapV2MarkerSelection,
  type MapV2RouteSelection,
} from './useMapV2GeographicExperience';

export const MAP_V2_FLEET_OVERLAY_PENDING = 'MAP_V2_FLEET_OVERLAY_PENDING' as const;
export const MAP_V2_WAREHOUSE_OVERLAY_PENDING = 'MAP_V2_WAREHOUSE_OVERLAY_PENDING' as const;
export const MAP_V2_DELIVERY_OVERLAY_PENDING = 'MAP_V2_DELIVERY_OVERLAY_PENDING' as const;

export type MapV2CommandEmphasis = 'overview' | 'road' | 'rail';

type Props = {
  emphasis: MapV2CommandEmphasis;
  onCountrySelect?: (selection: MapV2CountrySelection) => void;
  onCitySelect?: (selection: MapV2CitySelection) => void;
  onRouteSelect?: (selection: MapV2RouteSelection) => void;
  onMarkerSelect?: (selection: MapV2MarkerSelection) => void;
};

export default function MapV2CommandCenterViewport({
  emphasis,
  onCountrySelect,
  onCitySelect,
  onRouteSelect,
  onMarkerSelect,
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
  });

  return (
    <View style={styles.fill} pointerEvents="box-none">
      <MapV2ExperienceCanvas experience={experience} />
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

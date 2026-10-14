/**
 * The one Map V2 geographic surface.
 * Diagnostic chrome and the Harita command center both mount this.
 */
import React from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import {
  COUNTRY_OVERVIEW_MAX_SCALE_FACTOR,
  COUNTRY_OVERVIEW_MIN_SCALE_FACTOR,
  WORLD_MIN_SCALE_FACTOR,
} from '../geo/worldCamera';
import { WORLD_INHABITED_BOUNDS } from '../geo/worldCamera';
import { MAP_V2_OCEAN } from '../presentation/countryPaint';
import { lodShowsRoadNetwork, resolveMapLod } from '../presentation/mapLodPolicy';
import MapV2GeographicCanvas from '../world/MapV2GeographicCanvas';
import type { MapFleetLayerModel } from './useMapFleetOverlay';
import type { MapV2GeographicExperience } from './useMapV2GeographicExperience';

type Props = {
  experience: MapV2GeographicExperience;
  fleetLayer?: MapFleetLayerModel | null;
};

export default function MapV2ExperienceCanvas({ experience, fleetLayer = null }: Props) {
  const {
    canvasRef,
    mode,
    focusCountryId,
    selectedId,
    onSelect,
    getCountryPaint,
    worldMaxScale,
    countryPanBounds,
    countryDrawIds,
    turkeyCityLayer,
    availabilityByGeoCityId,
    reduceMotion,
    railVisualPreview,
    seaVisualPreview,
    airVisualPreview,
    emphasizeRoad,
    showRailFoundation,
    fade,
    initialCamera,
    onCameraSample,
  } = experience;
  const lod = resolveMapLod({
    scope: mode === 'CITY_DETAIL' ? 'CITY_DETAIL' : mode,
    hasCitySelection: Boolean(experience.selectedCityId),
  });
  const countryNetwork = mode === 'COUNTRY' && focusCountryId === 'country.tur' && lodShowsRoadNetwork(lod);
  const showTurkeyRoads = countryNetwork || (emphasizeRoad && mode === 'COUNTRY' && focusCountryId === 'country.tur');
  const showTurkeyRail = countryNetwork && (railVisualPreview || showRailFoundation);

  return (
    <View style={styles.fill} pointerEvents="auto" collapsable={false}>
      <MapV2GeographicCanvas
        ref={canvasRef}
        selectedId={mode === 'COUNTRY' ? focusCountryId : selectedId}
        lodOverride={mode === 'COUNTRY' ? 'COUNTRY_HIGH' : 'AUTO'}
        cullEnabled={mode === 'WORLD'}
        onSelect={onSelect}
        getCountryPaint={getCountryPaint}
        homePolicy="INHABITED"
        initialCamera={initialCamera}
        onCameraSample={onCameraSample}
        maxScaleFactor={mode === 'COUNTRY' ? COUNTRY_OVERVIEW_MAX_SCALE_FACTOR : worldMaxScale}
        minScaleFactor={mode === 'COUNTRY' ? COUNTRY_OVERVIEW_MIN_SCALE_FACTOR : WORLD_MIN_SCALE_FACTOR}
        contentBounds={countryPanBounds}
        forcedDrawIds={countryDrawIds}
        hitTestIds={mode === 'COUNTRY' ? [] : null}
        cityLayer={turkeyCityLayer}
        playerCorridorLayer={
          showTurkeyRoads
            ? {
                enabled: true,
                availabilityByGeoCityId,
                reduceMotion,
              }
            : null
        }
        playerRailCorridorLayer={
          showTurkeyRail
            ? {
                enabled: true,
                availabilityByGeoCityId,
                reduceMotion,
              }
            : null
        }
        playerSeaCorridorLayer={
          mode === 'COUNTRY' && focusCountryId === 'country.tur' && seaVisualPreview
            ? {
                enabled: true,
                availabilityByGeoCityId,
                reduceMotion,
              }
            : null
        }
        playerAirCorridorLayer={
          mode === 'COUNTRY' && focusCountryId === 'country.tur' && airVisualPreview
            ? {
                enabled: true,
                availabilityByGeoCityId,
                reduceMotion,
              }
            : null
        }
        cameraScope={mode === 'COUNTRY' ? 'COUNTRY' : 'WORLD'}
        cameraFrameBounds={mode === 'COUNTRY' ? countryPanBounds : WORLD_INHABITED_BOUNDS}
        elasticGestures={mode !== 'COUNTRY'}
        mapGesturesEnabled
        countryVisualProfile={mode === 'COUNTRY' ? 'DASHBOARD' : 'DEFAULT'}
        viewportClip={mode === 'WORLD' ? 'ROUNDED' : 'NONE'}
        fleetLayer={fleetLayer}
      />
      <Animated.View pointerEvents="none" style={[styles.fade, { opacity: fade, backgroundColor: MAP_V2_OCEAN }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    width: '100%',
    minWidth: 0,
    minHeight: 0,
    alignSelf: 'stretch',
  },
  fade: { ...StyleSheet.absoluteFillObject },
});

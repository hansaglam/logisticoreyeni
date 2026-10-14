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
import { MAP_V2_OCEAN } from '../presentation/countryPaint';
import MapV2GeographicCanvas from '../world/MapV2GeographicCanvas';
import type { MapV2GeographicExperience } from './useMapV2GeographicExperience';

type Props = {
  experience: MapV2GeographicExperience;
};

export default function MapV2ExperienceCanvas({ experience }: Props) {
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
  } = experience;
  const showTurkeyRoads =
    (mode === 'COUNTRY' && focusCountryId === 'country.tur') ||
    (emphasizeRoad && (mode === 'WORLD' || focusCountryId === 'country.tur'));
  const showTurkeyRail =
    (mode === 'COUNTRY' && focusCountryId === 'country.tur' && railVisualPreview) ||
    (showRailFoundation && (mode === 'WORLD' || focusCountryId === 'country.tur'));

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
        elasticGestures={mode !== 'COUNTRY'}
        mapGesturesEnabled={mode !== 'COUNTRY'}
        countryVisualProfile={mode === 'COUNTRY' ? 'DASHBOARD' : 'DEFAULT'}
        viewportClip={mode === 'WORLD' ? 'ROUNDED' : 'NONE'}
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

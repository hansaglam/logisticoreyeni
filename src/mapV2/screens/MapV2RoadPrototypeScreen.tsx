import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTabBarLayout } from '../../hooks/useTabBarLayout';
import { colors, spacing, typography } from '../../theme';
import { countryWorkingBounds } from '../gameplay/mapV2ExperienceNavigation';
import { COUNTRY_CONTENT_MAX_SCALE_FACTOR, COUNTRY_CONTENT_MIN_SCALE_FACTOR } from '../geo/worldCamera';
import type { TransportNetworkLod } from '../geo/transportNetwork';
import { OSM_HIGHWAY_EXCLUDED, OSM_HIGHWAY_PROTOTYPE_INCLUDED } from '../geo/roadClassPolicy';
import { ROAD_RENDER_PROFILE_DEBUG } from '../presentation/roadRenderProfile';
import { paintForCountryFocus } from '../presentation/countryPaint';
import { resolveCityDisplayName } from '../presentation/cityDisplayName';
import { TURKEY_ROADS_RAW_REL } from '../geo/roadRawSource';
import MapV2GeographicCanvas, { type WorldGeometryHud } from '../world/MapV2GeographicCanvas';
import { getTurkeyCityPackage, mappedGeoCityIds } from '../world/countryCityLoader';
import { getCountryRecord } from '../world/worldBoundaryLoader';
import { getTransportNetwork } from '../world/transportNetworkLoader';
import { evictRoadChunks, getRoadRuntimeManifest } from '../world/roadChunkLoader';
import { clearRoadPathCache } from '../world/roadPathCache';

const LODS: Array<TransportNetworkLod | 'AUTO'> = ['AUTO', 'NETWORK_LOW', 'NETWORK_MEDIUM', 'NETWORK_HIGH'];

export default function MapV2RoadPrototypeScreen({ onClose }: { onClose: () => void }) {
  const { contentBottomPadding } = useTabBarLayout();
  const turkey = useMemo(() => getCountryRecord('country.tur'), []);
  const cities = useMemo(() => getTurkeyCityPackage(), []);
  const network = useMemo(() => getTransportNetwork('country.tur', 'ROAD'), []);
  const runtime = useMemo(() => (network?.sourceStatus === 'PROTOTYPE' ? getRoadRuntimeManifest() : null), [network?.sourceStatus]);
  const [lodOverride, setLodOverride] = useState<TransportNetworkLod | 'AUTO'>('AUTO');
  const [cullEnabled, setCullEnabled] = useState(true);
  const [roadsEnabled, setRoadsEnabled] = useState(true);
  const [hud, setHud] = useState<WorldGeometryHud>({
    zoom: 1,
    selectedLod: 'AUTO',
    loadedLod: 'COUNTRY_HIGH',
    visibleCountries: 1,
    visiblePolygons: 0,
    renderedPaths: 0,
    renderedPolygons: 0,
    renderedVertices: 0,
    totalPathsForLod: 1,
    totalPolygonsForLod: 0,
    totalVerticesForLod: 0,
    countryCount: 1,
    sourceCountries: 1,
    renderedCountries: 1,
    polarPolicy: 'omit',
    omittedPolarFeatures: [],
    culling: 'ON',
    roadLod: 'NONE',
    totalEdges: 0,
    visibleEdges: 0,
    renderedEdges: 0,
    pathBatchCount: 0,
    nodeCount: 0,
  });
  const onHud = useCallback((next: WorldGeometryHud) => setHud(next), []);
  const pending = network?.sourceStatus !== 'PROTOTYPE';

  return (
    <View style={[styles.root, { paddingBottom: contentBottomPadding }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.back}>
          <Text style={styles.backText}>‹ Inspector</Text>
        </Pressable>
        <Text style={styles.title} accessibilityRole="header">
          Map V2 ROAD Prototype
        </Text>
      </View>
      <Text style={styles.note}>
        OSM ODbL adayı · DEV only · {pending ? `SOURCE_PENDING · ${TURKEY_ROADS_RAW_REL}` : `PROTOTYPE · chunks ${runtime?.chunks.length ?? 0}`}
      </Text>
      <View style={styles.canvasWrap}>
        {turkey ? (
          <MapV2GeographicCanvas
            selectedId="country.tur"
            lodOverride="COUNTRY_HIGH"
            cullEnabled={false}
            onSelect={() => undefined}
            onHud={onHud}
            getCountryPaint={() => paintForCountryFocus()}
            homePolicy="INHABITED"
            maxScaleFactor={COUNTRY_CONTENT_MAX_SCALE_FACTOR}
            minScaleFactor={COUNTRY_CONTENT_MIN_SCALE_FACTOR}
            contentBounds={countryWorkingBounds(turkey, 'COUNTRY_HIGH')}
            forcedDrawIds={['country.tur']}
            hitTestIds={[]}
            elasticGestures={false}
            cityLayer={{
              cities: cities.cities,
              selectedCityId: null,
              mappedGeoCityIds: mappedGeoCityIds(),
              showLegacyHalo: false,
              onSelectCity: () => undefined,
              resolveLabel: (city) => resolveCityDisplayName(city, 'tr'),
            }}
            roadLayer={{ lodOverride, cullEnabled, roadsEnabled, renderProfile: ROAD_RENDER_PROFILE_DEBUG }}
          />
        ) : null}
      </View>
      <Text style={styles.hud}>
        lod {String(hud.roadLod)} · zoom {hud.zoom.toFixed(2)} · totalEdges {hud.totalEdges ?? 0} · visibleEdges{' '}
        {hud.visibleEdges ?? 0} · renderedEdges {hud.renderedEdges ?? 0}
      </Text>
      <Text style={styles.hud}>
        required {hud.requiredChunks ?? 0} · loaded {hud.loadedChunks ?? 0} · visibleChunks {hud.visibleChunks ?? 0} ·
        cache {(hud.cacheSizeEstimate ?? 0).toFixed(0)}B · evict {hud.evictions ?? 0}
      </Text>
      <Text style={styles.hud}>
        mode {hud.roadMode ?? 'NONE'} · tti {hud.timeToInteractiveMs ?? 0}ms · firstRoad {hud.firstRoadPaintMs ?? 0}ms ·
        loading {hud.roadLoading ? 'yes' : 'no'}
      </Text>
      <Text style={styles.meta}>
        include {OSM_HIGHWAY_PROTOTYPE_INCLUDED.join(', ')} · exclude {OSM_HIGHWAY_EXCLUDED.slice(0, 4).join(', ')}…
      </Text>
      <View style={styles.row}>
        {LODS.map((lod) => (
          <Pressable key={lod} onPress={() => setLodOverride(lod)} style={[styles.chip, lodOverride === lod && styles.chipOn]}>
            <Text style={styles.chipText}>{lod === 'AUTO' ? 'AUTO' : lod.replace('NETWORK_', '')}</Text>
          </Pressable>
        ))}
        <Pressable onPress={() => setRoadsEnabled((value) => !value)} style={[styles.chip, roadsEnabled && styles.chipOn]}>
          <Text style={styles.chipText}>ROAD {roadsEnabled ? 'ON' : 'OFF'}</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            evictRoadChunks('all');
            clearRoadPathCache();
          }}
          style={styles.chip}
        >
          <Text style={styles.chipText}>CACHE CLEAR</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing.sm, gap: spacing.xs },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingTop: spacing.sm },
  back: { paddingVertical: spacing.xs, paddingRight: spacing.sm },
  backText: { ...typography.bodySmall, color: colors.primaryLight },
  title: { ...typography.cardTitle, color: colors.textPrimary, flex: 1 },
  note: { ...typography.caption, color: colors.textMuted },
  canvasWrap: { flex: 1, minHeight: 280, borderRadius: 12, overflow: 'hidden' },
  hud: { ...typography.caption, color: colors.textSecondary },
  meta: { ...typography.caption, color: colors.textDisabled },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingBottom: spacing.sm },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  chipOn: { borderColor: colors.primaryLight },
  chipText: { ...typography.caption, color: colors.textPrimary },
});

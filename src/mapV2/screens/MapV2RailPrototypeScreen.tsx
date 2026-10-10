import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTabBarLayout } from '../../hooks/useTabBarLayout';
import { colors, spacing, typography } from '../../theme';
import { countryWorkingBounds } from '../gameplay/mapV2ExperienceNavigation';
import { COUNTRY_CONTENT_MAX_SCALE_FACTOR, COUNTRY_CONTENT_MIN_SCALE_FACTOR } from '../geo/worldCamera';
import type { TransportNetworkLod } from '../geo/transportNetwork';
import { paintForCountryFocus } from '../presentation/countryPaint';
import { resolveCityDisplayName } from '../presentation/cityDisplayName';
import { TURKEY_RAIL_GEOJSON_RAW_REL } from '../geo/railRawSource';
import MapV2GeographicCanvas, { type WorldGeometryHud } from '../world/MapV2GeographicCanvas';
import { getTurkeyCityPackage, mappedGeoCityIds } from '../world/countryCityLoader';
import { getCountryRecord } from '../world/worldBoundaryLoader';
import { getRailRuntimeManifest, getTransportNetwork } from '../world/transportNetworkLoader';

const LODS: Array<TransportNetworkLod | 'AUTO'> = ['AUTO', 'NETWORK_LOW', 'NETWORK_MEDIUM', 'NETWORK_HIGH'];

export default function MapV2RailPrototypeScreen({ onClose }: { onClose: () => void }) {
  const { contentBottomPadding } = useTabBarLayout();
  const turkey = useMemo(() => getCountryRecord('country.tur'), []);
  const cities = useMemo(() => getTurkeyCityPackage(), []);
  const network = useMemo(() => getTransportNetwork('country.tur', 'RAIL'), []);
  const runtime = useMemo(() => (network?.sourceStatus === 'PROTOTYPE' ? getRailRuntimeManifest() : null), [network?.sourceStatus]);
  const [lodOverride, setLodOverride] = useState<TransportNetworkLod | 'AUTO'>('NETWORK_LOW');
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
  });
  const onHud = useCallback((next: WorldGeometryHud) => setHud(next), []);

  return (
    <View style={[styles.root, { paddingBottom: contentBottomPadding }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.back}>
          <Text style={styles.backText}>‹ Inspector</Text>
        </Pressable>
        <Text style={styles.title} accessibilityRole="header">
          Map V2 RAIL Prototype
        </Text>
      </View>
      <Text style={styles.note}>
        OSM ODbL · DEV only · TCDD QA only · player rail inactive · {runtime ? `${runtime.stats.edgeCount} edges` : TURKEY_RAIL_GEOJSON_RAW_REL}
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
            railDebugLayer={{ enabled: true, lodOverride, showStations: true }}
          />
        ) : null}
      </View>
      <Text style={styles.hud}>
        zoom {hud.zoom.toFixed(2)} · stations {runtime?.stats.stationCount ?? 0} · components {runtime?.connectivity.componentCount ?? 0}
      </Text>
      <View style={styles.row}>
        {LODS.map((lod) => (
          <Pressable key={lod} onPress={() => setLodOverride(lod)} style={[styles.chip, lodOverride === lod && styles.chipOn]}>
            <Text style={styles.chipText}>{lod === 'AUTO' ? 'AUTO' : lod.replace('NETWORK_', '')}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, paddingTop: spacing.sm, gap: spacing.sm },
  back: { paddingVertical: 6, paddingHorizontal: 4 },
  backText: { ...typography.body, color: colors.primaryLight },
  title: { ...typography.cardTitle, color: colors.textPrimary, flex: 1 },
  note: { ...typography.caption, color: colors.textMuted, paddingHorizontal: spacing.sm, paddingBottom: 4 },
  canvasWrap: { flex: 1, marginHorizontal: spacing.sm, borderRadius: 12, overflow: 'hidden' },
  hud: { ...typography.caption, color: colors.textSecondary, paddingHorizontal: spacing.sm, paddingTop: 6 },
  row: { flexDirection: 'row', gap: 6, padding: spacing.sm, flexWrap: 'wrap' },
  chip: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, backgroundColor: colors.surface },
  chipOn: { backgroundColor: colors.accentBlueSoft },
  chipText: { ...typography.caption, color: colors.textPrimary, fontWeight: '700' },
});

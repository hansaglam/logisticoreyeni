import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTabBarLayout } from '../../hooks/useTabBarLayout';
import type { GeometryLodId } from '../geo/geometry';
import { getCountryRecord, getWorldBoundaryPackage } from './worldBoundaryLoader';
import MapV2WorldGeometryCanvas, { type WorldGeometryHud } from './MapV2WorldGeometryCanvas';

const LODS: Array<GeometryLodId | 'AUTO'> = ['AUTO', 'WORLD_LOW', 'WORLD_MEDIUM', 'COUNTRY_HIGH'];

export default function MapV2WorldGeometryScreen({ onClose }: { onClose: () => void }) {
  const { contentBottomPadding } = useTabBarLayout();
  const pkg = useMemo(() => getWorldBoundaryPackage(), []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lodOverride, setLodOverride] = useState<GeometryLodId | 'AUTO'>('AUTO');
  const [cullEnabled, setCullEnabled] = useState(true);
  const [hud, setHud] = useState<WorldGeometryHud>({
    zoom: 1,
    selectedLod: 'AUTO',
    loadedLod: 'WORLD_LOW',
    visibleCountries: pkg.renderedCountryCount,
    visiblePolygons: 0,
    renderedPaths: 0,
    renderedPolygons: 0,
    renderedVertices: 0,
    totalPathsForLod: pkg.renderedCountryCount,
    totalPolygonsForLod: 0,
    totalVerticesForLod: 0,
    countryCount: pkg.sourceCountryCount,
    sourceCountries: pkg.sourceCountryCount,
    renderedCountries: pkg.renderedCountryCount,
    polarPolicy: pkg.polarRenderPolicy,
    omittedPolarFeatures: pkg.omittedPolarFeatures.map((f) => f.sourceDisplayName),
    culling: 'ON',
  });

  const selected = selectedId ? getCountryRecord(selectedId) : undefined;
  const onHud = useCallback((next: WorldGeometryHud) => setHud(next), []);

  return (
    <View style={[styles.root, { paddingBottom: contentBottomPadding }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.back}>
          <Text style={styles.backText}>‹ Debug</Text>
        </Pressable>
        <Text style={styles.title} accessibilityRole="header">
          Map V2 World Geometry
        </Text>
      </View>
      <Text style={styles.disclaimer}>
        geoBoundaries gbOpen ADM0. DEV viewer only. Not production Harita. Attribution: CC BY 4.0.
      </Text>
      <View style={styles.canvasWrap}>
        <MapV2WorldGeometryCanvas
          selectedId={selectedId}
          lodOverride={lodOverride}
          cullEnabled={cullEnabled}
          onSelect={setSelectedId}
          onHud={onHud}
        />
      </View>
      <View style={styles.chrome} pointerEvents="box-none">
        <Text style={styles.hud}>
          projection WEB_MERCATOR · polarPolicy {hud.polarPolicy}
        </Text>
        <Text style={styles.hud}>
          sourceCountries {hud.sourceCountries} · renderedCountries {hud.renderedCountries} · visibleCountries{' '}
          {hud.visibleCountries} · renderedPaths {hud.renderedPaths}
        </Text>
        <Text style={styles.hud}>
          selectedLod {hud.selectedLod} · loadedLod {hud.loadedLod} · totalPathsForLod {hud.totalPathsForLod} ·
          totalPolygonsForLod {hud.totalPolygonsForLod} · totalVerticesForLod {hud.totalVerticesForLod}
        </Text>
        <Text style={styles.hud}>
          renderedPolygons {hud.renderedPolygons} · renderedVertices {hud.renderedVertices} · zoom {hud.zoom.toFixed(2)}{' '}
          · culling: {hud.culling}
        </Text>
        <Text style={styles.hud}>
          omittedPolarFeatures{' '}
          {hud.omittedPolarFeatures.length === 0 ? 'none' : hud.omittedPolarFeatures.join(', ')}
        </Text>
        <View style={styles.row}>
          {LODS.map((lod) => (
            <Pressable
              key={lod}
              onPress={() => setLodOverride(lod)}
              style={[styles.chip, lodOverride === lod && styles.chipOn]}
              hitSlop={6}
            >
              <Text style={styles.chipText}>{lod}</Text>
            </Pressable>
          ))}
          <Pressable
            onPress={() => setCullEnabled((v) => !v)}
            style={[styles.chip, cullEnabled && styles.chipOn]}
            hitSlop={6}
          >
            <Text style={styles.chipText}>{cullEnabled ? 'CULL: ON' : 'CULL: OFF'}</Text>
          </Pressable>
        </View>
        <Text style={styles.select}>
          {selected
            ? `${selected.geoCountryId} · ${selected.sourceDisplayName} · ${selected.sourceFeatureId}`
            : 'tap a country'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#040A14' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 8 },
  back: { paddingVertical: 8, paddingRight: 8, minHeight: 44, justifyContent: 'center' },
  backText: { color: '#39A0FF', fontSize: 16 },
  title: { color: '#F3F7FF', fontSize: 16, fontWeight: '700' },
  disclaimer: { color: '#91A0B8', fontSize: 11, paddingHorizontal: 12, paddingBottom: 6 },
  canvasWrap: { flex: 1, marginHorizontal: 8, borderRadius: 12, overflow: 'hidden', minHeight: 200 },
  chrome: { paddingHorizontal: 12, paddingTop: 8, gap: 6 },
  hud: { color: '#A9B6CC', fontSize: 11 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    borderWidth: 1,
    borderColor: '#1E3A5F',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 8,
    minHeight: 36,
    justifyContent: 'center',
  },
  chipOn: { backgroundColor: '#123156', borderColor: '#2388FF' },
  chipText: { color: '#F3F7FF', fontSize: 11 },
  select: { color: '#F3F7FF', fontSize: 12, paddingBottom: 4 },
});

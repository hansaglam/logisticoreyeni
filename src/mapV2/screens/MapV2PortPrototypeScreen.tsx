import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useTabBarLayout } from '../../hooks/useTabBarLayout';
import { colors, spacing, typography } from '../../theme';
import { countryWorkingBounds } from '../gameplay/mapV2ExperienceNavigation';
import { COUNTRY_CONTENT_MAX_SCALE_FACTOR, COUNTRY_CONTENT_MIN_SCALE_FACTOR } from '../geo/worldCamera';
import { paintForCountryFocus } from '../presentation/countryPaint';
import { resolveCityDisplayName } from '../presentation/cityDisplayName';
import MapV2GeographicCanvas, { type WorldGeometryHud } from '../world/MapV2GeographicCanvas';
import { geoCityIdForGameplayCity, getTurkeyCityPackage, mappedGeoCityIds } from '../world/countryCityLoader';
import { getCountryRecord } from '../world/worldBoundaryLoader';
import { getTurkeyPortPackage } from '../world/countryPortLoader';
import { getSeaDebugView, getSeaRuntimeManifest } from '../world/transportNetworkLoader';

export default function MapV2PortPrototypeScreen({ onClose }: { onClose: () => void }) {
  const { contentBottomPadding } = useTabBarLayout();
  const turkey = useMemo(() => getCountryRecord('country.tur'), []);
  const cities = useMemo(() => getTurkeyCityPackage(), []);
  const pkg = useMemo(() => getTurkeyPortPackage(), []);
  const seaRuntime = useMemo(() => getSeaRuntimeManifest(), []);
  const seaDebug = useMemo(() => getSeaDebugView(), []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
  const selected = pkg.ports.find((row) => row.id === selectedId) ?? null;
  const markers = useMemo(
    () =>
      pkg.ports.map((port) => ({
        id: port.id,
        x: port.projected.x,
        y: port.projected.y,
        eligibility: port.logisticsEligibility,
        selected: port.id === selectedId,
      })),
    [pkg.ports, selectedId],
  );
  const seaAccessMarkers = useMemo(
    () =>
      pkg.ports
        .filter((port) => port.logisticsEligibility === 'LOGISTICS_ELIGIBLE')
        .map((port) => ({
          id: `${port.id}:access`,
          x: port.seaAccess.projected.x,
          y: port.seaAccess.projected.y,
          unresolved: port.seaAccess.status === 'UNRESOLVED',
        })),
    [pkg.ports],
  );
  const accessLines = useMemo(
    () =>
      pkg.ports
        .filter((port) => port.logisticsEligibility === 'LOGISTICS_ELIGIBLE' && port.seaAccess.status === 'PROVISIONAL')
        .map((port) => ({
          x1: port.projected.x,
          y1: port.projected.y,
          x2: port.seaAccess.projected.x,
          y2: port.seaAccess.projected.y,
        })),
    [pkg.ports],
  );
  const associationLines = useMemo(() => {
    if (!selected) return [];
    return selected.cityAssociations.map((row) => {
      const geoCityId = geoCityIdForGameplayCity(row.gameplayCityId);
      const city = cities.cities.find((item) => item.geoCityId === geoCityId);
      if (!city) return null;
      return { x1: city.projected.x, y1: city.projected.y, x2: selected.projected.x, y2: selected.projected.y };
    }).filter((row): row is NonNullable<typeof row> => row != null);
  }, [cities.cities, selected]);

  return (
    <View style={[styles.root, { paddingBottom: contentBottomPadding }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.back}>
          <Text style={styles.backText}>‹ Inspector</Text>
        </Pressable>
        <Text style={styles.title} accessibilityRole="header">
          Map V2 PORT / SEA Prototype
        </Text>
      </View>
      <Text style={styles.note}>
        DEV maritime graph · muted diagnostic overlay · not player SEA routes · Denizyolu Yakında · nodes{' '}
        {seaRuntime.stats.nodeCount} · edges {seaRuntime.stats.edgeCount}
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
            devPortLayer={{
              enabled: true,
              markers,
              associationLines,
              maritimeEdges: seaDebug.edges,
              seaAccessMarkers,
              accessLines,
              smokePaths: seaDebug.smokePaths,
              onSelect: setSelectedId,
            }}
          />
        ) : null}
      </View>
      <Text style={styles.hud}>
        zoom {hud.zoom.toFixed(2)} · ports {pkg.stats.logicalPortCount} · logistics {pkg.stats.logisticsEligibleCount} · sea{' '}
        {seaRuntime.seaAccess.resolved}/{seaRuntime.seaAccess.unresolved} · Bosphorus {seaRuntime.stats.bosphorusNodeCount} ·
        Dardanelles {seaRuntime.stats.dardanellesNodeCount}
      </Text>
      {selected ? (
        <View style={styles.detail}>
          <Text style={styles.detailTitle}>{selected.displayName}</Text>
          <Text style={styles.line}>source: {selected.sourceName ?? '—'}</Text>
          <Text style={styles.line}>
            {selected.classification} · {selected.logisticsEligibility} · {selected.verificationStatus}
          </Text>
          <Text style={styles.line}>OSM: {selected.sourceIds.join(', ')}</Text>
          <Text style={styles.line}>operator: {selected.attributes.operator ?? '—'}</Text>
          <Text style={styles.line}>
            cargo: container {selected.attributes.capabilities.container} · ferry {selected.attributes.capabilities.ferry}
          </Text>
          <Text style={styles.line}>
            cities:{' '}
            {selected.cityAssociations.length
              ? selected.cityAssociations.map((row) => `${row.gameplayCityId} ${row.associationType} ${row.distanceMeters}m`).join(' · ')
              : 'none'}
          </Text>
          <Text style={styles.line}>
            sea access: {selected.seaAccess.status}
            {selected.seaAccess.maritimeRegion ? ` · ${selected.seaAccess.maritimeRegion}` : ''}
            {selected.seaAccess.failureReason ? ` · ${selected.seaAccess.failureReason}` : ''}
          </Text>
          <Text style={styles.line}>
            approach: {selected.seaAccess.approachKind ?? '—'} · stage {selected.seaAccess.failureStage ?? 'ok'} · node{' '}
            {selected.seaAccess.graphNodeId ?? 'none'}
          </Text>
          <Text style={styles.line}>
            GeoPort {selected.position.longitude.toFixed(4)},{selected.position.latitude.toFixed(4)} → access{' '}
            {selected.seaAccess.position.longitude.toFixed(4)},{selected.seaAccess.position.latitude.toFixed(4)}
          </Text>
        </View>
      ) : null}
      <ScrollView style={styles.list} horizontal>
        {pkg.ports
          .filter((port) => port.logisticsEligibility === 'LOGISTICS_ELIGIBLE')
          .map((port) => (
            <Pressable key={port.id} onPress={() => setSelectedId(port.id)} style={[styles.chip, selectedId === port.id && styles.chipOn]}>
              <Text style={styles.chipText}>{port.displayName}</Text>
            </Pressable>
          ))}
      </ScrollView>
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
  detail: { paddingHorizontal: spacing.sm, paddingBottom: 6, gap: 2 },
  detailTitle: { ...typography.body, color: colors.textPrimary, fontWeight: '700' },
  line: { ...typography.caption, color: colors.textSecondary },
  list: { maxHeight: 52, paddingHorizontal: spacing.sm },
  chip: { marginRight: 6, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, backgroundColor: colors.surface },
  chipOn: { backgroundColor: colors.accentBlueSoft },
  chipText: { ...typography.caption, color: colors.textPrimary, fontWeight: '700' },
});

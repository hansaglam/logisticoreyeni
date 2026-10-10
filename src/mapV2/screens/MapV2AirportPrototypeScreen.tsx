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
import { getTurkeyAirportPackage } from '../world/countryAirportLoader';
import type { AirportLogisticsEligibility } from '../geo/airportClassPolicy';

type AirportDevFilter = 'ALL' | 'CARGO_READY' | 'CARGO_UNKNOWN' | 'PASSENGER_ONLY' | 'MILITARY_DUAL' | 'CLOSED';

export default function MapV2AirportPrototypeScreen({ onClose }: { onClose: () => void }) {
  const { contentBottomPadding } = useTabBarLayout();
  const turkey = useMemo(() => getCountryRecord('country.tur'), []);
  const cities = useMemo(() => getTurkeyCityPackage(), []);
  const pkg = useMemo(() => getTurkeyAirportPackage(), []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<AirportDevFilter>('ALL');
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
  const filteredAirports = useMemo(() => {
    return pkg.airports.filter((airport) => {
      if (filter === 'CARGO_READY') return airport.airLogisticsReadiness === 'READY';
      if (filter === 'CARGO_UNKNOWN') return airport.cargoCapability === 'UNKNOWN';
      if (filter === 'PASSENGER_ONLY') return airport.logisticsEligibility === 'PASSENGER_ONLY' || airport.logisticsEligibility === 'UNRESOLVED';
      if (filter === 'MILITARY_DUAL') return airport.civilUse === 'MILITARY' || airport.civilUse === 'DUAL_USE';
      if (filter === 'CLOSED') return airport.operationalStatus === 'CLOSED_OR_INACTIVE';
      return true;
    });
  }, [filter, pkg.airports]);
  const selected = pkg.airports.find((row) => row.id === selectedId) ?? null;
  const markers = useMemo(
    () =>
      filteredAirports.map((airport) => ({
        id: airport.id,
        x: airport.projected.x,
        y: airport.projected.y,
        eligibility: airport.logisticsEligibility as AirportLogisticsEligibility,
        selected: airport.id === selectedId,
      })),
    [filteredAirports, selectedId],
  );
  const associationLines = useMemo(() => {
    if (!selected) return [];
    return selected.cityAssociations
      .map((row) => {
        const geoCityId = geoCityIdForGameplayCity(row.gameplayCityId);
        const city = cities.cities.find((item) => item.geoCityId === geoCityId);
        if (!city) return null;
        return { x1: city.projected.x, y1: city.projected.y, x2: selected.projected.x, y2: selected.projected.y };
      })
      .filter((row): row is NonNullable<typeof row> => row != null);
  }, [cities.cities, selected]);
  const runways = useMemo(
    () =>
      hud.zoom >= 4
        ? pkg.airports.flatMap((airport) =>
            airport.runways.map((rwy) => ({
              id: `${airport.id}:${rwy.sourceId}`,
              x1: rwy.x1,
              y1: rwy.y1,
              x2: rwy.x2,
              y2: rwy.y2,
            })),
          )
        : [],
    [hud.zoom, pkg.airports],
  );

  return (
    <View style={[styles.root, { paddingBottom: contentBottomPadding }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.back}>
          <Text style={styles.backText}>‹ Inspector</Text>
        </Pressable>
        <Text style={styles.title} accessibilityRole="header">
          Map V2 AIR / AIRPORT Prototype
        </Text>
      </View>
      <Text style={styles.note}>
        DEV airport catalog · OSM ODbL · DHMİ cargo QA · no player AIR routes · Havayolu Yakında · UNKNOWN ≠ unavailable
      </Text>
      <ScrollView horizontal style={styles.filters}>
        {(['ALL', 'CARGO_READY', 'CARGO_UNKNOWN', 'PASSENGER_ONLY', 'MILITARY_DUAL', 'CLOSED'] as const).map((item) => (
          <Pressable key={item} onPress={() => setFilter(item)} style={[styles.chip, filter === item && styles.chipOn]}>
            <Text style={styles.chipText}>{item}</Text>
          </Pressable>
        ))}
      </ScrollView>
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
            devAirportLayer={{
              enabled: true,
              markers,
              associationLines,
              runways,
              onSelect: setSelectedId,
            }}
          />
        ) : null}
      </View>
      <Text style={styles.hud}>
        zoom {hud.zoom.toFixed(2)} · airports {pkg.stats.logicalAirportCount} · commercial {pkg.stats.commercialCount} · logistics{' '}
        {pkg.stats.logisticsEligibleCount} · military {pkg.stats.militaryRestrictedCount}
      </Text>
      {selected ? (
        <View style={styles.detail}>
          <Text style={styles.detailTitle}>{selected.displayName}</Text>
          <Text style={styles.line}>IATA {selected.iataCode ?? '—'} · ICAO {selected.icaoCode ?? '—'}</Text>
          <Text style={styles.line}>
            {selected.classification} · {selected.logisticsEligibility} · {selected.verificationStatus} · {selected.civilUse}
          </Text>
          <Text style={styles.line}>ops {selected.operationalStatus} · cargo {selected.cargoCapability} · AIR {selected.airLogisticsReadiness}</Text>
          <Text style={styles.line}>{selected.readinessReason}</Text>
          <Text style={styles.line}>evidence {selected.cargoEvidence.length} · DHMİ kargo t {selected.cargoTonnesYtd ?? '—'}</Text>
          <Text style={styles.line}>
            {selected.cargoEvidence.slice(0, 2).map((row) => row.sourceAuthority).join(' · ') || 'no cargo evidence'}
          </Text>
          <Text style={styles.line}>operator: {selected.attributes.operator ?? '—'}</Text>
          <Text style={styles.line}>runways {selected.runwayCount} · terminals {selected.terminalCount}</Text>
          <Text style={styles.line}>OSM: {selected.sourceIds.join(', ')}</Text>
          <Text style={styles.line}>
            cities:{' '}
            {selected.cityAssociations.length
              ? selected.cityAssociations.map((row) => `${row.gameplayCityId} ${row.associationType} ${row.distanceMeters}m`).join(' · ')
              : 'none'}
          </Text>
          <Text style={styles.line}>
            pax primary:{' '}
            {pkg.cityAssociations
              .filter((row) => row.primaryPassengerAirportCandidateId === selected.id)
              .map((row) => row.gameplayCityId)
              .join(', ') || '—'}
            {' · '}logistics primary:{' '}
            {pkg.cityAssociations
              .filter((row) => row.primaryLogisticsAirportCandidateId === selected.id)
              .map((row) => row.gameplayCityId)
              .join(', ') || '—'}
          </Text>
        </View>
      ) : null}
      <ScrollView style={styles.list} horizontal>
        {pkg.airports
          .filter((airport) => airport.iataCode)
          .map((airport) => (
            <Pressable
              key={airport.id}
              onPress={() => setSelectedId(airport.id)}
              style={[styles.chip, selectedId === airport.id && styles.chipOn]}
            >
              <Text style={styles.chipText}>
                {airport.iataCode} {airport.displayName}
              </Text>
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
  filters: { maxHeight: 40, paddingHorizontal: spacing.sm, marginBottom: 4 },
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

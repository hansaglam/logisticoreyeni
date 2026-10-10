import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActionButton, ScreenHeader } from '../../components/ui';
import { useTabBarLayout } from '../../hooks/useTabBarLayout';
import { colors, radius, spacing, typography } from '../../theme';
import { MAP_V2_TRANSPORT_MODES } from '../domain/transport';
import { OSM_HIGHWAY_EXCLUDED, OSM_HIGHWAY_PROTOTYPE_INCLUDED } from '../geo/roadClassPolicy';
import { TURKEY_ROADS_RAW_REL } from '../geo/roadRawSource';
import { mapV2TransportInspectorCopy } from '../presentation/mapV2TransportInspectorCopy';
import MapV2RoadPrototypeScreen from './MapV2RoadPrototypeScreen';
import MapV2RailPrototypeScreen from './MapV2RailPrototypeScreen';
import MapV2PortPrototypeScreen from './MapV2PortPrototypeScreen';
import MapV2AirportPrototypeScreen from './MapV2AirportPrototypeScreen';
import {
  getCityTransportAccessPackage,
  getRailConnectivityQa,
  getRailRuntimeManifest,
  getSeaRuntimeManifest,
  getTransportNetwork,
  getTurkeyInfrastructurePackage,
  getTurkeyTransportManifest,
} from '../world/transportNetworkLoader';
import { getRoadRuntimeManifest } from '../world/roadChunkLoader';
import { getTurkeyPlayerRoadCorridors } from '../world/countryRoadCorridorLoader';
import { getTurkeyPlayerRailCorridors } from '../world/countryRailCorridorLoader';
import { getTurkeyPortPackage } from '../world/countryPortLoader';
import { getTurkeyAirportPackage } from '../world/countryAirportLoader';

export default function MapV2TransportInspectorScreen({ onClose }: { onClose: () => void }) {
  const { contentBottomPadding } = useTabBarLayout();
  const [showRoadMap, setShowRoadMap] = useState(false);
  const [showRailMap, setShowRailMap] = useState(false);
  const [showPortMap, setShowPortMap] = useState(false);
  const [showAirportMap, setShowAirportMap] = useState(false);
  const manifest = useMemo(() => getTurkeyTransportManifest(), []);
  const access = useMemo(() => getCityTransportAccessPackage(), []);
  const infra = useMemo(() => getTurkeyInfrastructurePackage(), []);
  const road = useMemo(() => getTransportNetwork('country.tur', 'ROAD'), []);
  const runtime = useMemo(() => (road?.sourceStatus === 'PROTOTYPE' ? getRoadRuntimeManifest() : null), [road?.sourceStatus]);
  const playerCorridors = useMemo(() => getTurkeyPlayerRoadCorridors(), []);
  const playerRailCorridors = useMemo(() => getTurkeyPlayerRailCorridors(), []);
  const ports = useMemo(() => getTurkeyPortPackage(), []);
  const airports = useMemo(() => getTurkeyAirportPackage(), []);
  const seaRuntime = useMemo(() => getSeaRuntimeManifest(), []);
  const rail = useMemo(() => getTransportNetwork('country.tur', 'RAIL'), []);
  const railRuntime = useMemo(() => (rail?.sourceStatus === 'PROTOTYPE' ? getRailRuntimeManifest() : null), [rail?.sourceStatus]);
  const railQa = useMemo(() => (rail?.sourceStatus === 'PROTOTYPE' ? getRailConnectivityQa() : null), [rail?.sourceStatus]);
  const roadAccess = access.accesses.filter((row) => row.mode === 'ROAD');
  const railAccess = access.accesses.filter((row) => row.mode === 'RAIL');

  if (showRoadMap) {
    return <MapV2RoadPrototypeScreen onClose={() => setShowRoadMap(false)} />;
  }
  if (showRailMap) {
    return <MapV2RailPrototypeScreen onClose={() => setShowRailMap(false)} />;
  }
  if (showPortMap) {
    return <MapV2PortPrototypeScreen onClose={() => setShowPortMap(false)} />;
  }
  if (showAirportMap) {
    return <MapV2AirportPrototypeScreen onClose={() => setShowAirportMap(false)} />;
  }

  const low = runtime?.totalCounts.edgesLow ?? 0;
  const mid = (runtime?.totalCounts.edgesLow ?? 0) + (runtime?.totalCounts.edgesMediumAdditional ?? 0);
  const high = runtime?.totalCounts.sourceEdges ?? 0;

  return (
    <View style={[styles.root, { paddingBottom: contentBottomPadding }]}>
      <ScreenHeader
        title={mapV2TransportInspectorCopy.title}
        subtitle={mapV2TransportInspectorCopy.subtitle}
        onBack={onClose}
        compact
        titleIcon="map"
      />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.note}>{mapV2TransportInspectorCopy.fixtureNote}</Text>
        <Text style={styles.meta}>{mapV2TransportInspectorCopy.odbl}</Text>
        {MAP_V2_TRANSPORT_MODES.map((mode) => {
          const row = manifest.modes.find((item) => item.mode === mode);
          const network = getTransportNetwork('country.tur', mode);
          return (
            <View key={mode} style={styles.card}>
              <Text style={styles.mode}>{mode}</Text>
              <Text style={styles.line}>Durum: {row?.status ?? mapV2TransportInspectorCopy.pending}</Text>
              <Text style={styles.line}>Kaynak: {row?.source}</Text>
              <Text style={styles.line}>Lisans: {row?.license}</Text>
              <Text style={styles.line}>QA: {row?.qaAuthority}</Text>
              <Text style={styles.line}>ODbL: {row?.odblDerived ? 'evet (aday)' : 'hayır'}</Text>
              <Text style={styles.line}>
                Düğüm:{' '}
                {mode === 'ROAD'
                  ? runtime?.totalCounts.sourceNodes ?? network?.stats.nodeCount ?? 0
                  : mode === 'RAIL'
                    ? railRuntime?.stats.nodeCount ?? network?.stats.nodeCount ?? 0
                    : mode === 'SEA'
                      ? seaRuntime.stats.nodeCount
                      : network?.stats.nodeCount ?? 0}
              </Text>
              <Text style={styles.line}>
                Kenar:{' '}
                {mode === 'ROAD'
                  ? runtime?.totalCounts.sourceEdges ?? network?.stats.edgeCount ?? 0
                  : mode === 'RAIL'
                    ? railRuntime?.stats.edgeCount ?? network?.stats.edgeCount ?? 0
                    : mode === 'SEA'
                      ? seaRuntime.stats.edgeCount
                      : network?.stats.edgeCount ?? 0}
              </Text>
              <Text style={styles.line}>Provenance: {network?.sourceManifest.datasetId}</Text>
              <Text style={styles.notes}>{row?.notes}</Text>
              {network?.mode === 'AIR' && (network?.edges.length ?? 0) === 0 ? (
                <Text style={styles.empty}>{mapV2TransportInspectorCopy.noGeometry}</Text>
              ) : null}
              {network?.mode === 'ROAD' && (network?.stats.edgeCount ?? 0) === 0 ? (
                <Text style={styles.empty}>{mapV2TransportInspectorCopy.noGeometry}</Text>
              ) : null}
              {network?.mode === 'RAIL' && (railRuntime?.stats.edgeCount ?? 0) === 0 ? (
                <Text style={styles.empty}>{mapV2TransportInspectorCopy.noGeometry}</Text>
              ) : null}
            </View>
          );
        })}
        <View style={styles.card}>
          <Text style={styles.mode}>ROAD prototype</Text>
          <Text style={styles.line}>Durum: {road?.sourceStatus}</Text>
          <Text style={styles.line}>Package: {road?.packageId}</Text>
          <Text style={styles.line}>Runtime chunks: {runtime?.chunks.length ?? 0}</Text>
          <Text style={styles.line}>Runtime transform: {runtime?.runtimeTransformVersion}</Text>
          <Text style={styles.line}>LOW/MED/HIGH visible: {low}/{mid}/{high}</Text>
          <Text style={styles.line}>Include: {OSM_HIGHWAY_PROTOTYPE_INCLUDED.join(', ')}</Text>
          <Text style={styles.line}>Exclude: {OSM_HIGHWAY_EXCLUDED.join(', ')}</Text>
          <Text style={styles.line}>Source hash: {String(road?.sourceManifest.sourceHash)}</Text>
          <Text style={styles.line}>Package hash: {road?.contentHash}</Text>
          <Text style={styles.line}>Bileşen: {road?.stats.componentCount ?? 0}</Text>
          <Text style={styles.notes}>Ham kaynak: {TURKEY_ROADS_RAW_REL}</Text>
          {road?.sourceStatus !== 'PROTOTYPE' ? (
            <Text style={styles.empty}>STEP_2E_BLOCKED_RAW_SOURCE_REQUIRED</Text>
          ) : null}
          <ActionButton label="ROAD Haritasını Aç" onPress={() => setShowRoadMap(true)} compact />
        </View>
        <View style={styles.card}>
          <Text style={styles.mode}>RAIL prototype</Text>
          <Text style={styles.line}>Durum: {rail?.sourceStatus}</Text>
          <Text style={styles.line}>Kaynak: OpenStreetMap · ODbL 1.0</Text>
          <Text style={styles.line}>QA: TCDD_QA_ONLY (geometri kopyalanmaz)</Text>
          <Text style={styles.line}>Düğüm: {railRuntime?.stats.nodeCount ?? 0}</Text>
          <Text style={styles.line}>Kenar: {railRuntime?.stats.edgeCount ?? 0}</Text>
          <Text style={styles.line}>
            LOW/MED/HIGH: {railRuntime?.stats.edgesLow ?? 0}/{railRuntime?.stats.edgesMedium ?? 0}/{railRuntime?.stats.edgesHigh ?? 0}
          </Text>
          <Text style={styles.line}>İstasyon: {railRuntime?.stats.stationCount ?? 0}</Text>
          <Text style={styles.line}>Junction: {railRuntime?.stats.junctionCount ?? 0}</Text>
          <Text style={styles.line}>Bileşen: {railRuntime?.connectivity.componentCount ?? 0}</Text>
          <Text style={styles.line}>Kaynak hash: {String(rail?.sourceManifest.sourceHash)}</Text>
          <Text style={styles.line}>Package hash: {rail?.contentHash}</Text>
          <Text style={styles.notes}>{railRuntime?.tcddQa.status} · Player Demiryolu Yakında</Text>
          {railAccess.map((row) => (
            <Text key={`rail-access:${row.geoCityId}`} style={styles.line}>
              {row.geoCityId} RAIL {row.status}
            </Text>
          ))}
          {rail?.sourceStatus !== 'PROTOTYPE' ? <Text style={styles.empty}>RAIL_FOUNDATION_BLOCKED_RAW_SOURCE_REQUIRED</Text> : null}
          <ActionButton label="RAIL Haritasını Aç" onPress={() => setShowRailMap(true)} compact />
        </View>
        <View style={styles.card}>
          <Text style={styles.mode}>Connectivity QA</Text>
          <Text style={styles.notes}>DEV only. Nearby endpoints are candidates, not auto-joins. TCDD_QA_ONLY.</Text>
          <Text style={styles.line}>Bileşen: {railQa?.componentCount ?? railRuntime?.connectivity.componentCount ?? 0}</Text>
          <Text style={styles.line}>En büyük: {railQa?.largestComponent?.nodeCount ?? railRuntime?.connectivity.largestComponentNodes ?? 0}</Text>
          <Text style={styles.line}>Yetim istasyon: {railQa?.stationOrphans ?? 0}</Text>
          <Text style={styles.line}>
            Near-break 25/50/100/250/500m: {railQa?.nearBreakCounts.r25 ?? 0}/{railQa?.nearBreakCounts.r50 ?? 0}/
            {railQa?.nearBreakCounts.r100 ?? 0}/{railQa?.nearBreakCounts.r250 ?? 0}/{railQa?.nearBreakCounts.r500 ?? 0}
          </Text>
          <Text style={styles.line}>QA issue: {railQa?.issues.length ?? 0}</Text>
          {railQa?.cityAccessAudit.map((row) => (
            <Text key={`qa-access:${row.legacyCityId}`} style={styles.line}>
              {row.legacyCityId} {row.status} · cmp {row.componentSize} · {row.candidateKind ?? '—'}
            </Text>
          ))}
          {railQa?.corridors.map((row) => (
            <Text key={`qa-cor:${row.id}`} style={styles.line}>
              {row.id}: {row.sameComponent ? 'same-component' : 'split'}
            </Text>
          ))}
        </View>
        <View style={styles.card}>
          <Text style={styles.mode}>{mapV2TransportInspectorCopy.corridorInspectorTitle}</Text>
          <Text style={styles.notes}>{mapV2TransportInspectorCopy.corridorInspectorNote}</Text>
          <Text style={styles.line}>Koridor: {playerCorridors.corridors.length}</Text>
          <Text style={styles.line}>Çözülemeyen: {playerCorridors.unresolved.length}</Text>
          <Text style={styles.line}>Kaynak hash: {playerCorridors.sourceRoadPackageHash}</Text>
          <Text style={styles.line}>İçerik hash: {playerCorridors.contentHash}</Text>
          {playerCorridors.corridors.map((row) => (
            <Text key={row.id} style={styles.line}>
              {row.id} · {row.sourceEdgeCount} kenar · {row.sourceRouteLengthMeters} m
            </Text>
          ))}
        </View>
        <View style={styles.card}>
          <Text style={styles.mode}>Player RAIL corridors (visual only)</Text>
          <Text style={styles.notes}>Curated OSM paths. Not train gameplay. Inspector only.</Text>
          <Text style={styles.line}>Koridor: {playerRailCorridors.corridors.length}</Text>
          <Text style={styles.line}>Çözülemeyen: {playerRailCorridors.unresolved.length}</Text>
          <Text style={styles.line}>Kaynak hash: {playerRailCorridors.sourceRailPackageHash}</Text>
          {playerRailCorridors.corridors.map((row) => (
            <Text key={row.id} style={styles.line}>
              {row.id} · {row.fromAccessName ?? '—'} → {row.toAccessName ?? '—'} · {row.sourceRouteLengthMeters} m
            </Text>
          ))}
        </View>
        <View style={styles.card}>
          <Text style={styles.mode}>City access</Text>
          <Text style={styles.line}>Kayıt: {access.accesses.length}</Text>
          {roadAccess.map((row) => (
            <Text key={`${row.geoCityId}:${row.mode}`} style={styles.line}>
              {row.geoCityId} ROAD {row.status}
            </Text>
          ))}
        </View>
        <View style={styles.card}>
          <Text style={styles.mode}>SEA / PORT infrastructure</Text>
          <Text style={styles.notes}>
            GeoPort catalog + hybrid water grid. Not player shipping routes. Warehouse type=port is not a GeoPort.{' '}
            {ports.officialQaStatus}.
          </Text>
          <Text style={styles.line}>Graph policy: {seaRuntime.graphPolicyVersion}</Text>
          <Text style={styles.line}>Land mask: {seaRuntime.landMaskVersion}</Text>
          <Text style={styles.line}>Düğüm: {seaRuntime.stats.nodeCount}</Text>
          <Text style={styles.line}>Kenar: {seaRuntime.stats.edgeCount}</Text>
          <Text style={styles.line}>Approach düğüm: {seaRuntime.stats.approachNodeCount ?? 0}</Text>
          <Text style={styles.line}>Bileşen: {seaRuntime.stats.componentCount}</Text>
          <Text style={styles.line}>
            Bölgeler: {seaRuntime.regions.join(', ')} · kanallar: {seaRuntime.channels.join(', ')}
          </Text>
          <Text style={styles.line}>
            Bosphorus düğüm: {seaRuntime.stats.bosphorusNodeCount} · Dardanelles düğüm: {seaRuntime.stats.dardanellesNodeCount}
          </Text>
          <Text style={styles.line}>
            Sea access resolved/unresolved: {seaRuntime.seaAccess.resolved}/{seaRuntime.seaAccess.unresolved} of{' '}
            {seaRuntime.seaAccess.logisticsEvaluated}
          </Text>
          {(Object.entries(seaRuntime.seaAccess.failureReasons) as Array<[string, number]>)
            .filter(([, count]) => count > 0)
            .map(([code, count]) => (
              <Text key={`sea-fail:${code}`} style={styles.line}>
                {code}: {count}
              </Text>
            ))}
          {seaRuntime.smokeTests.map((row) => (
            <Text key={`sea-smoke:${row.id}`} style={styles.line}>
              smoke {row.id}: {row.ok ? 'ok' : 'fail'}
              {row.meters != null ? ` · ${row.meters} m` : ''} · {row.channels.join(',') || 'no-channel'}
            </Text>
          ))}
          <Text style={styles.line}>Kaynak hash: {String(seaRuntime.sourceManifest.sourceHash)}</Text>
          <Text style={styles.line}>Package hash: {seaRuntime.sourcePackageHash}</Text>
          <Text style={styles.line}>Runtime hash: {seaRuntime.contentHash}</Text>
          <Text style={styles.line}>Kaynak: {ports.sourceManifest.sourceName}</Text>
          <Text style={styles.line}>Lisans: {ports.sourceManifest.license}</Text>
          <Text style={styles.line}>Ham özellik: {ports.stats.sourceFeatureCount}</Text>
          <Text style={styles.line}>Aday nesne: {ports.stats.candidateObjectCount}</Text>
          <Text style={styles.line}>Mantıksal port: {ports.stats.logicalPortCount}</Text>
          <Text style={styles.line}>Lojistik uygun: {ports.stats.logisticsEligibleCount}</Text>
          <Text style={styles.line}>Yolcu/iskele: {ports.stats.passengerOnlyCount}</Text>
          <Text style={styles.line}>Doğrulama: PROVISIONAL {ports.stats.provisionalCount}</Text>
          <Text style={styles.line}>Kaynak hash: {ports.sourceManifest.sourceHash}</Text>
          <Text style={styles.line}>Paket hash: {ports.contentHash}</Text>
          {ports.cityAssociations.map((row) => (
            <Text key={`port-city:${row.gameplayCityId}`} style={styles.line}>
              {row.gameplayCityId} {row.associationType}
              {row.primaryPortCandidateId ? ` · primary ${row.primaryPortCandidateId.slice(-8)}` : ''}
            </Text>
          ))}
          <Text style={styles.mode}>Port Approach QA</Text>
          <Text style={styles.notes}>DEV two-stage access: harbour water → local approach → regional trunk. GeoPort position is not moved.</Text>
          {['istanbul', 'izmir', 'bursa', 'antalya', 'adana', 'trabzon', 'ankara', 'diyarbakir'].map((cityId) => {
            const row = ports.cityAssociations.find((item) => item.gameplayCityId === cityId);
            const port = ports.ports.find((item) => item.id === row?.primaryPortCandidateId);
            return (
              <Text key={`approach-qa:${cityId}`} style={styles.line}>
                {cityId}: {port ? `${port.displayName} ${port.seaAccess.status}` : row?.associationType ?? 'NONE'}
                {port?.seaAccess.maritimeRegion ? ` · ${port.seaAccess.maritimeRegion}` : ''}
                {port?.seaAccess.approachKind ? ` · ${port.seaAccess.approachKind}` : ''}
                {port?.seaAccess.searchRadiusMeters != null ? ` · ${port.seaAccess.searchRadiusMeters}m` : ''}
                {port?.seaAccess.graphNodeId ? ` · ${port.seaAccess.graphNodeId.slice(-18)}` : ''}
                {port?.seaAccess.failureReason ? ` · ${port.seaAccess.failureReason}` : ''}
                {port?.seaAccess.failureStage ? ` · stage ${port.seaAccess.failureStage}` : ''}
              </Text>
            );
          })}
          <ActionButton label="PORT Haritasını Aç" onPress={() => setShowPortMap(true)} compact />
        </View>
        <View style={styles.card}>
          <Text style={styles.mode}>AIR / AIRPORT</Text>
          <Text style={styles.notes}>
            GeoAirport catalog. Not player AIR routes. Warehouse type=airport is not a GeoAirport. {airports.officialQaStatus}. Route graph
            SOURCE_PENDING.
          </Text>
          <Text style={styles.line}>Kaynak: {airports.sourceManifest.sourceName}</Text>
          <Text style={styles.line}>Lisans: {airports.sourceManifest.license}</Text>
          <Text style={styles.line}>Ham özellik: {airports.stats.sourceFeatureCount}</Text>
          <Text style={styles.line}>Mantıksal havalimanı: {airports.stats.logicalAirportCount}</Text>
          <Text style={styles.line}>Ticari: {airports.stats.commercialCount}</Text>
          <Text style={styles.line}>Lojistik uygun: {airports.stats.logisticsEligibleCount}</Text>
          <Text style={styles.line}>Lojistik önizleme: {airports.stats.logisticsPreviewCount ?? 0}</Text>
          <Text style={styles.line}>Yolcu: {airports.stats.passengerOnlyCount}</Text>
          <Text style={styles.line}>Askeri/kısıtlı: {airports.stats.militaryRestrictedCount}</Text>
          <Text style={styles.line}>Kargo VERIFIED/PROVISIONAL/UNKNOWN/UNAVAIL: {airports.stats.cargoVerifiedCount}/{airports.stats.cargoProvisionalCount}/{airports.stats.cargoUnknownCount}/{airports.stats.cargoUnavailableCount}</Text>
          <Text style={styles.line}>AIR READY havalimanı: {airports.stats.airReadyCount}</Text>
          <Text style={styles.line}>Helipad hariç: {airports.stats.heliportExcludedCount}</Text>
          <Text style={styles.line}>Doğrulama: PROVISIONAL {airports.stats.provisionalCount} · UNRESOLVED {airports.stats.unresolvedCount}</Text>
          <Text style={styles.line}>IATA/ICAO: {airports.stats.iataCount}/{airports.stats.icaoCount}</Text>
          <Text style={styles.line}>Kaynak hash: {airports.sourceManifest.sourceHash}</Text>
          <Text style={styles.line}>Paket hash: {airports.contentHash}</Text>
          <Text style={styles.line}>QA issue: {airports.issues.length}</Text>
          {airports.cityAssociations.map((row) => {
            const passenger = airports.airports.find((item) => item.id === row.primaryPassengerAirportCandidateId);
            const logistics = airports.airports.find((item) => item.id === row.primaryLogisticsAirportCandidateId);
            return (
              <Text key={`air-city:${row.gameplayCityId}`} style={styles.line}>
                {row.gameplayCityId} {row.airLogisticsReadiness} · pax {passenger?.iataCode ?? '—'} · cargo {logistics?.iataCode ?? 'none'} · {row.readinessReason}
              </Text>
            );
          })}
          <ActionButton label="AIRPORT Haritasını Aç" onPress={() => setShowAirportMap(true)} compact />
        </View>
        <View style={styles.card}>
          <Text style={styles.mode}>City AIR logistics readiness</Text>
          <Text style={styles.notes}>DEV. Future AIR corridors only if both cities have READY logistics primaries. PREVIEW_ONLY is not a corridor grant.</Text>
          {airports.cityAssociations.map((row) => {
            const passenger = airports.airports.find((item) => item.id === row.primaryPassengerAirportCandidateId);
            const logistics = airports.airports.find((item) => item.id === row.primaryLogisticsAirportCandidateId);
            return (
              <Text key={`air-ready:${row.gameplayCityId}`} style={styles.line}>
                {row.gameplayCityId}: {row.airLogisticsReadiness} · pax {passenger?.iataCode ?? '—'} {passenger?.cargoCapability ?? ''} · log {logistics?.iataCode ?? 'null'} {logistics?.cargoCapability ?? ''}
              </Text>
            );
          })}
        </View>
        <View style={styles.card}>
          <Text style={styles.mode}>GeoInfrastructure</Text>
          <Text style={styles.line}>Tesis: {infra.facilities.length}</Text>
          <Text style={styles.line}>Intermodal link: {infra.intermodalLinks.length}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.sm, gap: spacing.sm },
  note: { ...typography.bodySmall, color: colors.textSecondary },
  meta: { ...typography.caption, color: colors.textMuted },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.sm,
    gap: 4,
  },
  mode: { ...typography.cardTitle, color: colors.textPrimary },
  line: { ...typography.caption, color: colors.textSecondary },
  notes: { ...typography.caption, color: colors.textMuted },
  empty: { ...typography.caption, color: colors.primaryLight },
});

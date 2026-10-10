import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ScreenHeader } from '../../components/ui';
import { useTabBarLayout } from '../../hooks/useTabBarLayout';
import { colors, radius, spacing, typography } from '../../theme';
import { LEGACY_STABLE_GAMEPLAY_CITY_IDS } from '../domain/ids';
import { enumerateMultimodalModeSequences } from '../gameplay/multimodalPlanner';
import { mapV2MultimodalInspectorCopy as copy } from '../presentation/mapV2MultimodalInspectorCopy';
import { getTurkeyMultimodalFoundation } from '../world/multimodalFoundationLoader';

export default function MapV2MultimodalInspectorScreen({ onClose }: { onClose: () => void }) {
  const { contentBottomPadding } = useTabBarLayout();
  const foundation = useMemo(() => getTurkeyMultimodalFoundation(), []);
  const [origin, setOrigin] = useState('ankara');
  const [destination, setDestination] = useState('istanbul');
  const sequences = useMemo(
    () => enumerateMultimodalModeSequences({ foundation, originCityId: origin, destinationCityId: destination }),
    [destination, foundation, origin],
  );

  return (
    <View style={[styles.root, { paddingBottom: contentBottomPadding }]}>
      <ScreenHeader title={copy.title} subtitle={copy.subtitle} onBack={onClose} compact titleIcon="map" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.note}>{copy.note}</Text>
        <Text style={styles.meta}>
          Readiness {foundation.multimodalReadiness} · ROAD {foundation.modeOperationalReadiness.ROAD} · RAIL{' '}
          {foundation.modeOperationalReadiness.RAIL} · SEA {foundation.modeOperationalReadiness.SEA} · AIR{' '}
          {foundation.modeOperationalReadiness.AIR}
        </Text>
        <View style={styles.card}>
          <Text style={styles.mode}>{copy.matrix}</Text>
          {foundation.cityModeMatrix.map((row) => (
            <Text key={row.gameplayCityId} style={styles.line}>
              {row.gameplayCityId}: ROAD {row.ROAD} · RAIL {row.RAIL} · SEA {row.SEA} · AIR {row.AIR}
            </Text>
          ))}
        </View>
        <View style={styles.card}>
          <Text style={styles.mode}>{copy.transfers}</Text>
          {foundation.cityTransferMatrix.map((row) => (
            <Text key={row.gameplayCityId} style={styles.line}>
              {row.gameplayCityId}: {row.capabilities.filter((cap) => cap.startsWith('ROAD_TO_')).join(' ') || '—'}
            </Text>
          ))}
        </View>
        <View style={styles.card}>
          <Text style={styles.mode}>{copy.nodes}</Text>
          {foundation.transferNodes.map((node) => (
            <View key={node.id} style={styles.node}>
              <Text style={styles.line}>{node.id}</Text>
              <Text style={styles.meta}>
                {node.transferCapabilities.join(', ')} · {node.verificationStatus} · {node.gameplayCityId}
              </Text>
              <Text style={styles.meta}>
                port {node.lineage.geoPortId ?? '—'} · air {node.lineage.geoAirportId ?? '—'} · rail{' '}
                {node.lineage.railAccessId ?? '—'}
              </Text>
              <Text style={styles.meta}>{node.evidence[0]?.reason}</Text>
            </View>
          ))}
        </View>
        <View style={styles.card}>
          <Text style={styles.mode}>{copy.planner}</Text>
          <Text style={styles.meta}>{copy.noRank}</Text>
          <Text style={styles.line}>{copy.origin}</Text>
          <View style={styles.chips}>
            {LEGACY_STABLE_GAMEPLAY_CITY_IDS.map((city) => (
              <Pressable
                key={`o:${city}`}
                onPress={() => setOrigin(city)}
                style={[styles.chip, origin === city && styles.chipOn]}
              >
                <Text style={styles.chipText}>{city}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.line}>{copy.destination}</Text>
          <View style={styles.chips}>
            {LEGACY_STABLE_GAMEPLAY_CITY_IDS.map((city) => (
              <Pressable
                key={`d:${city}`}
                onPress={() => setDestination(city)}
                style={[styles.chip, destination === city && styles.chipOn]}
              >
                <Text style={styles.chipText}>{city}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.line}>
            {copy.sequences}: {origin} → {destination}
          </Text>
          {sequences.map((row) => (
            <Text key={row.sequence} style={styles.line}>
              {row.sequence}
            </Text>
          ))}
        </View>
        <View style={styles.card}>
          <Text style={styles.mode}>{copy.unresolved}</Text>
          {foundation.cityTransferMatrix.flatMap((row) =>
            row.unresolvedNotes.map((note) => (
              <Text key={`${row.gameplayCityId}:${note}`} style={styles.meta}>
                {row.gameplayCityId}: {note}
              </Text>
            )),
          )}
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
  node: { gap: 2, paddingVertical: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipOn: { borderColor: colors.primaryLight, backgroundColor: colors.accentBlueSoft },
  chipText: { ...typography.caption, color: colors.textPrimary },
});

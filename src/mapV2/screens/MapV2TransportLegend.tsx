import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '../../theme';
import { mapV2ExperienceCopy } from '../presentation/mapV2ExperienceCopy';

const MODES = [
  { key: 'ROAD', label: mapV2ExperienceCopy.legendRoad, active: true },
  { key: 'RAIL', label: mapV2ExperienceCopy.legendRail, active: false },
  { key: 'SEA', label: mapV2ExperienceCopy.legendSea, active: false },
  { key: 'AIR', label: mapV2ExperienceCopy.legendAir, active: false },
] as const;

type Props = {
  /** DEV-only visual preview. Never marks Demiryolu as gameplay-active. */
  railPreview?: boolean;
  /** DEV-only visual preview. Never marks Denizyolu as gameplay-active. */
  seaPreview?: boolean;
  /** DEV-only visual preview. Never marks Havayolu as gameplay-active. */
  airPreview?: boolean;
};

export default function MapV2TransportLegend({
  railPreview = false,
  seaPreview = false,
  airPreview = false,
}: Props) {
  return (
    <View style={styles.wrap} accessibilityRole="summary" accessibilityLabel={mapV2ExperienceCopy.legendTitle}>
      <View style={styles.row}>
        {MODES.map((mode) => {
          const stateLabel =
            mode.key === 'RAIL' && railPreview
              ? mapV2ExperienceCopy.legendPreview
              : mode.key === 'SEA' && seaPreview
                ? mapV2ExperienceCopy.legendPreview
                : mode.key === 'AIR' && airPreview
                  ? mapV2ExperienceCopy.legendPreview
                  : mode.active
                    ? mapV2ExperienceCopy.legendActive
                    : mapV2ExperienceCopy.legendSoon;
          return (
            <View key={mode.key} style={[styles.item, !mode.active && styles.itemOff]}>
              <View style={[styles.dot, mode.active ? styles.dotOn : styles.dotOff]} />
              <Text style={[styles.label, !mode.active && styles.labelOff]} numberOfLines={1}>
                {mode.label}
              </Text>
              <Text style={[styles.state, mode.active && styles.stateOn]} numberOfLines={1}>
                {stateLabel}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  item: {
    flexGrow: 1,
    flexBasis: '22%',
    minWidth: 70,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderRadius: radius.sm,
    backgroundColor: colors.accentBlueSoft,
  },
  itemOff: { backgroundColor: 'transparent' },
  dot: { width: 6, height: 6, borderRadius: 3 },
  dotOn: { backgroundColor: colors.primaryLight },
  dotOff: { backgroundColor: colors.border },
  label: { ...typography.caption, color: colors.textPrimary, fontWeight: '700', flexShrink: 1 },
  labelOff: { color: colors.textMuted, fontWeight: '600' },
  state: { ...typography.caption, color: colors.textMuted, fontSize: 10, marginLeft: 'auto' },
  stateOn: { color: colors.primaryLight },
});

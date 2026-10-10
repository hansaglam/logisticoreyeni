import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '../../components/ui';
import { MIN_TOUCH_TARGET } from '../../constants/layout';
import { colors, radius, spacing, typography } from '../../theme';
import type { CityProgressionState } from '../gameplay/cityProgression';
import { COUNTRY_CORRIDOR_LOCKED_SELECTED } from '../presentation/countryDashboardPaint';
import {
  cityAvailabilityStatusLabel,
  formatCityUnlockRequirementRow,
  mapV2ExperienceCopy,
} from '../presentation/mapV2ExperienceCopy';

type Props = {
  displayName: string;
  progression: CityProgressionState;
  onClose: () => void;
};

export default function MapV2CityLockPanel({ displayName, progression, onClose }: Props) {
  return (
    <View
      style={styles.sheet}
      accessibilityRole="summary"
      accessibilityLabel={`${displayName}, ${mapV2ExperienceCopy.statusLocked}`}
    >
      <View style={styles.topRow}>
        <View style={styles.titles}>
          <Text style={styles.name} accessibilityRole="header" numberOfLines={1}>
            {displayName}
          </Text>
          <Text style={styles.role} numberOfLines={1}>
            {cityAvailabilityStatusLabel(progression.availability)}
          </Text>
        </View>
        <Pressable
          onPress={onClose}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={mapV2ExperienceCopy.closeSelection}
          style={styles.closeHit}
        >
          <Text style={styles.close}>{mapV2ExperienceCopy.closeSelection}</Text>
        </Pressable>
      </View>
      <Text style={styles.section}>{mapV2ExperienceCopy.requirementsTitle}</Text>
      {progression.rows.map((row, index) => {
        const labels = formatCityUnlockRequirementRow(row);
        return (
          <View key={`${row.type}-${index}`} style={styles.reqRow}>
            <Text style={[styles.mark, row.met ? styles.markMet : styles.markOpen]}>{row.met ? '✓' : '○'}</Text>
            <View style={styles.reqMeta}>
              <Text style={styles.reqTitle}>{labels.requiredLabel}</Text>
              <Text style={styles.reqCurrent}>{labels.currentLabel}</Text>
            </View>
          </View>
        );
      })}
      <ActionButton
        label={mapV2ExperienceCopy.cityUnlockCta}
        onPress={() => undefined}
        disabled
        compact
        accessibilityLabel={mapV2ExperienceCopy.comingSoonTitle}
        style={styles.cta}
      />
      <Text style={styles.soon}>{mapV2ExperienceCopy.comingSoonTitle}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderLeftWidth: 3,
    borderLeftColor: COUNTRY_CORRIDOR_LOCKED_SELECTED,
    borderRadius: radius.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    gap: spacing.xs,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  titles: { flex: 1, minWidth: 0 },
  name: { ...typography.sectionTitle, color: colors.textPrimary },
  role: { ...typography.caption, color: colors.textMuted },
  closeHit: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
  close: { ...typography.caption, color: colors.primaryLight },
  section: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  reqRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  mark: { width: 18, ...typography.body, fontWeight: '800' },
  markMet: { color: colors.primaryLight },
  markOpen: { color: colors.textMuted },
  reqMeta: { flex: 1, minWidth: 0 },
  reqTitle: { ...typography.bodySmall, color: colors.textPrimary, fontWeight: '700' },
  reqCurrent: { ...typography.caption, color: colors.textMuted },
  cta: { alignSelf: 'flex-start', minHeight: MIN_TOUCH_TARGET, opacity: 0.55 },
  soon: { ...typography.caption, color: colors.textDisabled },
});

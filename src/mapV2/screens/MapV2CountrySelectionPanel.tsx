import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ActionButton, GameIcon, StatusBadge } from '../../components/ui';
import { colors, radius, spacing, typography } from '../../theme';
import type { CountryGameplayAvailability } from '../gameplay/mapV2CountryAvailability.fixture';
import { isCountryOpenable } from '../gameplay/mapV2CountryAvailability.fixture';
import {
  availabilityBody,
  availabilityStatusLabel,
  mapV2ExperienceCopy,
} from '../presentation/mapV2ExperienceCopy';

type Props = {
  displayName: string;
  availability: CountryGameplayAvailability;
  onClose: () => void;
  onPrimary: () => void;
};

function badgeVariant(
  availability: CountryGameplayAvailability,
): 'success' | 'info' | 'muted' | 'warning' {
  if (availability === 'STARTER_AVAILABLE' || availability === 'UNLOCKED') return 'success';
  if (availability === 'LOCKED') return 'warning';
  return 'muted';
}

export default function MapV2CountrySelectionPanel({
  displayName,
  availability,
  onClose,
  onPrimary,
}: Props) {
  const openable = isCountryOpenable(availability);
  const locked = availability === 'LOCKED';
  const primaryLabel = openable
    ? mapV2ExperienceCopy.openCountry
    : locked
      ? mapV2ExperienceCopy.viewRequirements
      : mapV2ExperienceCopy.unsupportedBody;

  return (
    <View
      style={styles.sheet}
      accessibilityRole="summary"
      accessibilityLabel={`${displayName}, ${availabilityStatusLabel(availability)}`}
    >
      <View style={styles.topRow}>
        <View style={styles.titleBlock}>
          {locked ? <GameIcon name="lock" size={16} color={colors.textMuted} /> : null}
          <Text style={styles.name} accessibilityRole="header">
            {displayName}
          </Text>
        </View>
        <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel={mapV2ExperienceCopy.closeSelection}>
          <Text style={styles.close}>{mapV2ExperienceCopy.closeSelection}</Text>
        </Pressable>
      </View>
      <StatusBadge
        label={availabilityStatusLabel(availability)}
        variant={badgeVariant(availability)}
        icon={locked ? 'lock' : undefined}
      />
      <Text style={styles.body}>{availabilityBody(availability)}</Text>
      <ActionButton
        label={openable || locked ? primaryLabel : mapV2ExperienceCopy.statusUnsupported}
        onPress={onPrimary}
        disabled={availability === 'NOT_GAMEPLAY_SUPPORTED'}
        fullWidth
        accessibilityLabel={openable || locked ? primaryLabel : mapV2ExperienceCopy.statusUnsupported}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  titleBlock: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 },
  name: { ...typography.cardTitle, color: colors.textPrimary, flexShrink: 1 },
  close: { ...typography.caption, color: colors.primaryLight },
  body: { ...typography.body, color: colors.textSecondary },
});

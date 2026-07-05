import React from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';

import { colors, radius, spacing, typography } from '../../theme';

interface FilterChipProps {
  label: string;
  selected?: boolean;
  onPress: () => void;
  accentColor?: string;
  compact?: boolean;
}

export default function FilterChip({
  label,
  selected = false,
  onPress,
  accentColor = colors.accentBlue,
  compact = false,
}: FilterChipProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[
        compact ? styles.chipCompact : styles.chip,
        selected && {
          backgroundColor: `${accentColor}22`,
          borderColor: accentColor,
        },
      ]}
    >
      <Text
        style={[
          compact ? styles.labelCompact : styles.label,
          selected && { color: accentColor, fontWeight: '800' },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginRight: spacing.sm,
    flexShrink: 0,
  },
  chipCompact: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: 10,
    height: 32,
    justifyContent: 'center',
    marginRight: spacing.sm,
    flexShrink: 0,
  },
  label: {
    ...typography.bodySmall,
    color: colors.textMuted,
    fontWeight: '600',
  },
  labelCompact: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '600',
  },
});

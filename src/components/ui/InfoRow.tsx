import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '../../theme';

interface InfoRowProps {
  label: string;
  value: string;
  valueColor?: string;
  right?: React.ReactNode;
}

export default function InfoRow({ label, value, valueColor = colors.textPrimary, right }: InfoRowProps) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.valueWrap}>
        {right ?? (
          <Text style={[styles.value, { color: valueColor }]} numberOfLines={1}>
            {value}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  label: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    flex: 1,
  },
  valueWrap: {
    marginLeft: spacing.md,
    flexShrink: 1,
    alignItems: 'flex-end',
  },
  value: {
    ...typography.bodySmall,
    fontWeight: '700',
    textAlign: 'right',
  },
});

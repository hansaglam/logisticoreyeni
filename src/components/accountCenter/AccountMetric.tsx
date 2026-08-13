import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, typography } from '../../theme';
import { ACCOUNT_ROW_GAP } from './accountCenterTheme';

export interface AccountMetricProps {
  label: string;
  value: string;
  valueColor?: string;
}

export default function AccountMetric({ label, value, valueColor }: AccountMetricProps) {
  return (
    <View style={styles.cell}>
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
      <Text
        style={[styles.value, valueColor ? { color: valueColor } : null]}
        numberOfLines={2}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  cell: {
    flex: 1,
    minWidth: '46%',
    backgroundColor: 'rgba(4, 10, 20, 0.42)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: ACCOUNT_ROW_GAP / 2,
  },
  label: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '600',
  },
  value: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.textPrimary,
  },
});

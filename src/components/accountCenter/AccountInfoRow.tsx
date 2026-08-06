import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, typography } from '../../theme';
import { accountLabelColor, accountValueColor } from './accountCenterTheme';

export interface AccountInfoRowProps {
  label: string;
  value: string;
}

export default function AccountInfoRow({ label, value }: AccountInfoRowProps) {
  return (
    <View style={styles.row} accessibilityLabel={`${label}: ${value}`}>
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.value} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 40,
    paddingVertical: 4,
  },
  label: {
    ...typography.bodySmall,
    color: accountLabelColor,
    flex: 1,
  },
  value: {
    ...typography.bodySmall,
    fontWeight: '700',
    color: accountValueColor,
    flex: 1.2,
    textAlign: 'right',
  },
});

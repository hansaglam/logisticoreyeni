import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '../../theme';
import type { GameIconName } from '../../theme/icons';
import GameIcon from './GameIcon';

interface MetricCardProps {
  label: string;
  value: string;
  icon?: GameIconName;
  accentColor?: string;
  hint?: string;
}

export default function MetricCard({
  label,
  value,
  icon,
  accentColor = colors.accentBlue,
  hint,
}: MetricCardProps) {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        {icon ? (
          <View style={[styles.iconWrap, { backgroundColor: `${accentColor}22` }]}>
            <GameIcon name={icon} size={16} color={accentColor} />
          </View>
        ) : null}
        <Text style={styles.label}>{label}</Text>
      </View>
      <Text style={[styles.value, { color: accentColor }]}>{value}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minWidth: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
    gap: spacing.sm,
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    ...typography.statLabel,
    textTransform: 'none',
    letterSpacing: 0,
  },
  value: {
    ...typography.statValue,
    fontSize: 18,
  },
  hint: {
    ...typography.caption,
    marginTop: spacing.xs,
  },
});

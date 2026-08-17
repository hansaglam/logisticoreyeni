import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { VehicleStateIssue } from '../../domain/vehicleStateRecovery';
import { colors, spacing, typography } from '../../theme';
import { ActionButton, GameIcon } from '../ui';

export default function VehicleRecoveryBanner({
  issue,
  onRecover,
}: {
  issue: VehicleStateIssue | null | undefined;
  onRecover: () => void;
}) {
  if (!issue) {
    return null;
  }

  return (
    <View style={styles.banner}>
      <View style={styles.header}>
        <GameIcon name="warning" size={14} color={colors.warning} />
        <Text style={styles.title}>{issue.title}</Text>
      </View>
      <Text style={styles.body}>{issue.cause}</Text>
      <ActionButton label="Kurtar" onPress={onRecover} variant="secondary" compact />
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: `${colors.warning}66`,
    backgroundColor: colors.surface2,
    gap: 6,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  title: {
    ...typography.caption,
    fontWeight: '800',
    color: colors.warning,
    flex: 1,
  },
  body: {
    ...typography.caption,
    color: colors.textSecondary,
    lineHeight: 16,
  },
});

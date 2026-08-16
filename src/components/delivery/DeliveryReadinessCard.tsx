import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { formatReadinessSummary } from '../../domain/deliveryResultPresentation';
import type { DeliveryReadinessResult } from '../../domain/deliveryReadiness';
import { getDeadlineRiskBadgeLabel } from '../../utils/deadlineUx';
import { colors, spacing, typography } from '../../theme';
import { ActionButton, GameIcon } from '../ui';

export interface DeliveryReadinessCardProps {
  readiness: DeliveryReadinessResult | null;
  onSelectAnotherVehicle?: () => void;
  onBuyFuel?: () => void;
}

export default function DeliveryReadinessCard({
  readiness,
  onSelectAnotherVehicle,
  onBuyFuel,
}: DeliveryReadinessCardProps) {
  if (!readiness) {
    return null;
  }

  const summary = formatReadinessSummary(readiness);
  const toneColor =
    summary.tone === 'safe'
      ? colors.success
      : summary.tone === 'warning'
        ? colors.warning
        : colors.danger;

  return (
    <View style={[styles.card, { borderColor: `${toneColor}66` }]}>
      <View style={styles.header}>
        <GameIcon
          name={summary.tone === 'fuel' ? 'fuel' : summary.tone === 'safe' ? 'success' : 'warning'}
          size={16}
          color={toneColor}
        />
        <Text style={[styles.title, { color: toneColor }]}>{summary.title}</Text>
        <View style={[styles.badge, { borderColor: `${toneColor}99` }]}>
          <Text style={[styles.badgeText, { color: toneColor }]}>
            {getDeadlineRiskBadgeLabel(readiness.deadlineRisk)}
          </Text>
        </View>
      </View>
      <Text style={styles.body}>{summary.body}</Text>
      {summary.tone === 'impossible' && onSelectAnotherVehicle ? (
        <ActionButton
          label="Başka Araç Seç"
          onPress={onSelectAnotherVehicle}
          variant="secondary"
          style={styles.action}
        />
      ) : null}
      {summary.tone === 'fuel' && onBuyFuel ? (
        <ActionButton
          label="Yakıt Al"
          icon="fuel"
          onPress={onBuyFuel}
          variant="secondary"
          style={styles.action}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: colors.surface2,
    gap: 6,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    ...typography.bodySmall,
    flex: 1,
    fontWeight: '800',
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  body: {
    ...typography.caption,
    color: colors.textSecondary,
    lineHeight: 17,
  },
  action: {
    marginTop: 4,
    minHeight: 40,
  },
});

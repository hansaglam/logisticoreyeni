import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  resolveDeliveryHealth,
  type DeliveryHealthStatus,
} from '../../domain/deliveryHealthStatus';
import { formatGameDuration } from '../../utils/formatGameDuration';
import { colors, spacing, typography } from '../../theme';
import type { Delivery, Truck } from '../../types/game';
import { ActionButton } from '../ui';

export interface DeliveryHealthBannerProps {
  delivery: Delivery;
  currentTime: number;
  truck?: Truck | null;
  onRefuel?: () => void;
}

function statusColor(
  status: DeliveryHealthStatus,
  flags: { showOutOfFuelWarning: boolean; showLowFuelWarning: boolean },
): string {
  if (flags.showOutOfFuelWarning) return colors.danger;
  if (flags.showLowFuelWarning && status === 'on_time') return colors.warning;
  switch (status) {
    case 'on_time':
      return colors.success;
    case 'deadline_risk':
      return colors.warning;
    case 'late':
    case 'out_of_fuel':
    case 'incident_pending':
    case 'critical':
      return colors.danger;
    default:
      return colors.accentBlue;
  }
}

export default function DeliveryHealthBanner({
  delivery,
  currentTime,
  truck,
  onRefuel,
}: DeliveryHealthBannerProps) {
  const health = resolveDeliveryHealth({ delivery, currentTime, truck });
  const color = statusColor(health.status, {
    showOutOfFuelWarning: health.showOutOfFuelWarning,
    showLowFuelWarning: health.showLowFuelWarning,
  });

  return (
    <View style={[styles.wrap, { borderColor: `${color}66` }]}>
      <View style={styles.row}>
        <View style={[styles.badge, { backgroundColor: `${color}22`, borderColor: `${color}88` }]}>
          <Text style={[styles.badgeText, { color }]}>{health.label}</Text>
        </View>
        <Text style={styles.times} numberOfLines={1}>
          Tahmini varış: {formatGameDuration(health.etaHoursLeft)} · Son teslim:{' '}
          {formatGameDuration(health.deadlineHoursLeft)}
        </Text>
      </View>
      {health.alreadyLate ? (
        <Text style={[styles.detail, { color: colors.danger }]}>
          {formatGameDuration(health.latenessHours)} gecikmiş durumda
        </Text>
      ) : null}
      {health.detailLine ? <Text style={styles.detail}>{health.detailLine}</Text> : null}
      {health.showRefuelCta && onRefuel ? (
        <ActionButton label="Yakıt Al" icon="fuel" onPress={onRefuel} style={styles.cta} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: 10,
    borderWidth: 1,
    backgroundColor: colors.cardSoft,
    gap: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
    letterSpacing: 0.3,
  },
  times: {
    ...typography.caption,
    flex: 1,
    color: colors.textMuted,
  },
  detail: {
    ...typography.caption,
    color: colors.textSecondary,
    lineHeight: 16,
  },
  cta: {
    marginTop: 4,
    minHeight: 40,
  },
});

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  formatRentalAssignmentBlockMessage,
  formatRentalFitSummary,
  formatRentalHoursLabel,
  getRentalFitBadgeLabel,
  type RentalAssignmentFitResult,
} from '../../domain/rentalAssignmentFit';
import { colors, spacing, typography } from '../../theme';
import { ActionButton, GameIcon } from '../ui';

export interface RentalAssignmentFitBannerProps {
  fit: RentalAssignmentFitResult | null | undefined;
  onSelectAnotherVehicle?: () => void;
  onGoBack?: () => void;
}

export default function RentalAssignmentFitBanner({
  fit,
  onSelectAnotherVehicle,
  onGoBack,
}: RentalAssignmentFitBannerProps) {
  if (!fit?.applicable) {
    return null;
  }
  if (fit.status === 'suitable') {
    return null;
  }

  const blocked = !fit.canAssign;
  const toneColor = blocked ? colors.danger : colors.warning;
  const title = blocked
    ? 'Bu kiralık aracın süresi bu teslimat için yeterli değil.'
    : 'Kira süresi bu teslimat için sınırda.';

  return (
    <View style={[styles.card, { borderColor: `${toneColor}66` }]}>
      <View style={styles.header}>
        <GameIcon name="warning" size={16} color={toneColor} />
        <Text style={[styles.title, { color: toneColor }]}>{title}</Text>
        <View style={[styles.badge, { borderColor: `${toneColor}99` }]}>
          <Text style={[styles.badgeText, { color: toneColor }]}>
            {getRentalFitBadgeLabel(fit.status)}
          </Text>
        </View>
      </View>
      <Text style={styles.body}>
        {blocked
          ? formatRentalAssignmentBlockMessage(fit)
          : `${formatRentalFitSummary(fit)}\nGerekli süre (tampon dahil): ${formatRentalHoursLabel(fit.requiredHours)}`}
      </Text>
      {blocked ? (
        <View style={styles.actions}>
          {onSelectAnotherVehicle ? (
            <ActionButton
              label="Başka araç seç"
              onPress={onSelectAnotherVehicle}
              variant="secondary"
              style={styles.action}
            />
          ) : null}
          {onGoBack ? (
            <ActionButton
              label="Geri dön"
              onPress={onGoBack}
              variant="secondary"
              style={styles.action}
            />
          ) : null}
        </View>
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
  actions: {
    gap: 6,
    marginTop: 4,
  },
  action: {
    minHeight: 40,
  },
});

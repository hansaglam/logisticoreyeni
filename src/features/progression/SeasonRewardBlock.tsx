import React, { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '../../components/ui';
import { colors, spacing, typography } from '../../theme';
import { formatMoney } from '../../theme/format';
import type { SeasonRewardUiModel } from './seasonRewardUi';

type Props = {
  model: SeasonRewardUiModel;
  claiming?: boolean;
  onClaimPress?: () => void;
};

/**
 * Compact season reward presentation. Amounts come from server model only.
 */
export function SeasonRewardBlock({ model, claiming, onClaimPress }: Props) {
  const amountLabel = useMemo(() => {
    if (model.cashAmount == null) return null;
    return formatMoney(model.cashAmount);
  }, [model.cashAmount]);

  if (model.state === 'hidden' || model.state === 'guest') {
    return null;
  }

  if (model.state === 'pending') {
    return (
      <View style={styles.wrap}>
        <Text style={styles.label}>Sezon Ödülü</Text>
        <Text style={styles.hint}>{model.primaryText}</Text>
      </View>
    );
  }

  if (
    model.state === 'no_reward' ||
    model.state === 'insufficient_participants' ||
    model.state === 'unavailable'
  ) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.label}>Sezon Ödülü</Text>
        <Text style={styles.hint}>{model.primaryText}</Text>
      </View>
    );
  }

  if (model.state === 'claimed') {
    return (
      <View style={styles.wrap}>
        <Text style={styles.label}>Sezon Ödülü</Text>
        {amountLabel ? <Text style={styles.amount}>{amountLabel}</Text> : null}
        <Text style={styles.claimed}>✓ Alındı</Text>
      </View>
    );
  }

  if (model.state === 'eligible_unclaimed') {
    return (
      <View style={styles.wrap}>
        <Text style={styles.label}>Sezon Ödülü</Text>
        {amountLabel ? <Text style={styles.amount}>{amountLabel}</Text> : null}
        {claiming ? (
          <ActivityIndicator color={colors.accentBlue} style={styles.loader} />
        ) : model.showClaimCta && onClaimPress ? (
          <ActionButton
            label="Ödülü Al"
            variant="primary"
            compact
            onPress={onClaimPress}
            style={styles.cta}
          />
        ) : null}
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: spacing.sm,
    gap: 4,
  },
  label: { ...typography.caption, color: colors.textMuted },
  amount: { ...typography.bodySmall, color: colors.success, fontWeight: '800' },
  claimed: { ...typography.caption, color: colors.success, fontWeight: '700' },
  hint: { ...typography.caption, color: colors.textMuted },
  loader: { marginTop: 4, alignSelf: 'flex-start' },
  cta: { marginTop: 6, alignSelf: 'flex-start' },
});

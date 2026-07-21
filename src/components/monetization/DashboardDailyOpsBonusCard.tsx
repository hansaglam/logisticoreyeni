/**
 * Dashboard — günlük operasyon desteği (daily_ops_bonus) reklam kartı.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { getDailyOpsBonusCash } from '../../config/monetization';
import { isAdProviderAvailable } from '../../services/adProvider';
import { colors, formatMoney, spacing, typography } from '../../theme';
import { AppCard, GameIcon } from '../ui';
import AdRewardButton from './AdRewardButton';

interface DashboardDailyOpsBonusCardProps {
  playerLevel: number;
  onboardingCompleted: boolean;
  onSuccess?: (amount: number) => void;
}

export default function DashboardDailyOpsBonusCard({
  playerLevel,
  onboardingCompleted,
  onSuccess,
}: DashboardDailyOpsBonusCardProps) {
  if (!onboardingCompleted || !isAdProviderAvailable()) {
    return null;
  }

  const rewardAmount = getDailyOpsBonusCash(playerLevel);

  return (
    <AppCard variant="soft" style={styles.card} padded>
      <View style={styles.headerRow}>
        <GameIcon name="cash" size={16} color={colors.success} />
        <View style={styles.textBlock}>
          <Text style={styles.title}>Günlük Operasyon Desteği</Text>
          <Text style={styles.subtitle}>
            Reklam izle, küçük operasyon desteği al ({formatMoney(rewardAmount)})
          </Text>
        </View>
      </View>
      <AdRewardButton
        slotId="daily_ops_bonus"
        label="Reklam izle, operasyon desteği al"
        description="Görev ödülünden ayrıdır · günde 1 kez"
        context={{}}
        onSuccess={() => onSuccess?.(rewardAmount)}
        variant="secondary"
      />
    </AppCard>
  );
}

const styles = StyleSheet.create({
  card: {
    borderColor: 'rgba(74, 222, 128, 0.28)',
    gap: spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  textBlock: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    ...typography.bodySmall,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
  },
});

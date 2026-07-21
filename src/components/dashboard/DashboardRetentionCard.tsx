import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppCard, GameIcon } from '../ui';
import { colors, spacing, typography } from '../../theme';

interface DashboardRetentionCardProps {
  readyRewards: number;
  weeklyInProgress: number;
  weeklyTotal: number;
  onPress: () => void;
}

export default function DashboardRetentionCard({
  readyRewards,
  weeklyInProgress,
  weeklyTotal,
  onPress,
}: DashboardRetentionCardProps) {
  if (readyRewards <= 0 && weeklyInProgress <= 0) {
    return null;
  }

  return (
    <Pressable onPress={onPress}>
      <AppCard variant="soft" style={styles.card} padded>
        <View style={styles.row}>
          <GameIcon name="level" size={18} color={colors.accentAmber} />
          <View style={styles.textBlock}>
            {readyRewards > 0 ? (
              <Text style={styles.title}>Alınacak {readyRewards} ödül var</Text>
            ) : (
              <Text style={styles.title}>Haftalık sezon devam ediyor</Text>
            )}
            <Text style={styles.subtitle}>
              Haftalık sezon: {weeklyInProgress}/{weeklyTotal} görev ilerliyor
            </Text>
          </View>
        </View>
      </AppCard>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderColor: 'rgba(245, 158, 11, 0.35)',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  textBlock: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    ...typography.bodySmall,
    fontWeight: '700',
    color: colors.accentAmber,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});

import React, { memo } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { MIN_TOUCH_TARGET } from '../../constants/layout';
import { formatMoney, colors, radius, spacing, typography } from '../../theme';
import { AppCard, GameIcon, ProgressBar, StatusBadge } from '../../components/ui';
import type { ChallengeProgressItem } from '../seasons/types';

interface ChallengeCardProps {
  item: ChallengeProgressItem;
  pending: boolean;
  onClaim: (item: ChallengeProgressItem) => void;
}

function formatReward(item: ChallengeProgressItem): string {
  const parts: string[] = [];
  const cash = item.definition.reward.cash ?? 0;
  const seasonPoints = item.definition.reward.seasonPoints ?? 0;
  if (cash > 0) parts.push(formatMoney(cash));
  if (seasonPoints > 0) parts.push(`${seasonPoints} sezon puanı`);
  return parts.join(' + ') || 'Özel ödül';
}

function ChallengeCard({ item, pending, onClaim }: ChallengeCardProps) {
  const { definition, progress } = item;
  const ratio = progress.target > 0 ? progress.current / progress.target : 0;
  const claimable = progress.completed && !progress.claimed;
  const variant = progress.claimed ? 'success' : claimable ? 'highlighted' : 'default';

  return (
    <AppCard variant={variant} style={styles.card} padded={false}>
      <View style={styles.headerRow}>
        <View style={styles.titleWrap}>
          <Text style={styles.title} numberOfLines={2}>{definition.title}</Text>
          <Text style={styles.description} numberOfLines={2}>{definition.description}</Text>
        </View>
        <StatusBadge
          label={progress.claimed ? 'Alındı' : claimable ? 'Hazır' : 'Aktif'}
          variant={progress.claimed ? 'success' : claimable ? 'amber' : 'blue'}
          size="sm"
        />
      </View>

      <View style={styles.progressRow}>
        <Text style={styles.progressLabel}>İlerleme</Text>
        <Text style={styles.progressValue}>{progress.current} / {progress.target}</Text>
      </View>
      <ProgressBar
        progress={ratio}
        color={progress.claimed ? colors.success : claimable ? colors.accentAmber : colors.accentBlue}
        height={7}
      />

      <View style={styles.footerRow}>
        <View style={styles.rewardWrap}>
          <GameIcon name="trophy" size={15} color={colors.accentAmber} />
          <Text style={styles.reward} numberOfLines={2}>{formatReward(item)}</Text>
        </View>
        {claimable ? (
          <TouchableOpacity
            style={[styles.claimButton, pending && styles.claimButtonDisabled]}
            onPress={() => onClaim(item)}
            disabled={pending}
            accessibilityRole="button"
            accessibilityLabel={`${definition.title} ödülünü al`}
          >
            {pending ? (
              <ActivityIndicator size="small" color={colors.textPrimary} />
            ) : (
              <Text style={styles.claimText}>Ödülü Al</Text>
            )}
          </TouchableOpacity>
        ) : null}
      </View>
    </AppCard>
  );
}

export default memo(ChallengeCard);

const styles = StyleSheet.create({
  card: { padding: spacing.md, marginBottom: spacing.sm },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  titleWrap: { flex: 1, minWidth: 0 },
  title: { ...typography.cardTitle, fontSize: 14 },
  description: { ...typography.bodySmall, marginTop: 3, lineHeight: 16 },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md, marginBottom: 5 },
  progressLabel: { ...typography.caption },
  progressValue: { ...typography.caption, color: colors.textPrimary, fontWeight: '800' },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  rewardWrap: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6 },
  reward: { ...typography.caption, color: colors.accentAmber, fontWeight: '700', flex: 1 },
  claimButton: {
    minHeight: MIN_TOUCH_TARGET,
    minWidth: 96,
    borderRadius: radius.md,
    backgroundColor: colors.accentBlue,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  claimButtonDisabled: { backgroundColor: colors.primaryDeep },
  claimText: { ...typography.buttonText, fontSize: 12, color: colors.textPrimary },
});

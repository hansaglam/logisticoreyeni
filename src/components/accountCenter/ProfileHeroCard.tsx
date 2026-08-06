import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '../../theme';
import GameIcon from '../ui/GameIcon';
import { accountCardStyle } from './accountCenterTheme';
import AccountStatusBadge from './AccountStatusBadge';

import type { StatusBadgeVariant } from '../ui';

export interface ProfileHeroCardProps {
  isGuest: boolean;
  displayName: string;
  subtitle: string;
  avatarLetter: string;
  providerBadge: string;
  cloudStatusLabel?: string;
  cloudStatusVariant?: StatusBadgeVariant;
  stats: {
    level: number;
    contracts: number;
    trucks: number;
    warehouses: number;
  };
}

export default function ProfileHeroCard({
  isGuest,
  displayName,
  subtitle,
  avatarLetter,
  providerBadge,
  cloudStatusLabel,
  cloudStatusVariant = 'muted',
  stats,
}: ProfileHeroCardProps) {
  return (
    <View style={[styles.card, styles.heroCard]}>
      <View style={styles.hero}>
        <View style={[styles.avatar, isGuest ? styles.avatarGuest : styles.avatarLinked]}>
          {isGuest ? (
            <GameIcon name="account" size={24} color={colors.accentAmber} />
          ) : (
            <Text style={styles.avatarLetter}>{avatarLetter}</Text>
          )}
        </View>
        <View style={styles.heroMain}>
          <Text style={styles.name} numberOfLines={1}>
            {displayName}
          </Text>
          <Text style={styles.subtitle} numberOfLines={2}>
            {subtitle}
          </Text>
          <View style={styles.badgeRow}>
            <AccountStatusBadge
              label={providerBadge}
              variant={isGuest ? 'amber' : 'success'}
            />
            {!isGuest && cloudStatusLabel ? (
              <AccountStatusBadge label={cloudStatusLabel} variant={cloudStatusVariant} />
            ) : null}
          </View>
        </View>
      </View>
      <View style={styles.statGrid}>
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>Seviye</Text>
          <Text style={styles.statValue}>{stats.level}</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>Sözleşme</Text>
          <Text style={styles.statValue}>{stats.contracts}</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>Araç</Text>
          <Text style={styles.statValue}>{stats.trucks}</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>Depo</Text>
          <Text style={styles.statValue}>{stats.warehouses}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    ...accountCardStyle,
    borderWidth: 1,
    overflow: 'hidden',
  },
  heroCard: {
    borderColor: 'rgba(56, 189, 248, 0.28)',
    backgroundColor: '#0B1A30',
  },
  hero: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarGuest: {
    backgroundColor: colors.amberSoft,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.28)',
  },
  avatarLinked: {
    backgroundColor: colors.successSoft,
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.28)',
  },
  avatarLetter: {
    ...typography.cardTitle,
    fontSize: 22,
    fontWeight: '800',
    color: colors.success,
  },
  heroMain: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  name: {
    ...typography.cardTitle,
    fontSize: 19,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    lineHeight: 18,
    fontSize: 12,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: 4,
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    paddingTop: spacing.sm,
  },
  statItem: {
    width: '47%',
    backgroundColor: 'rgba(8, 20, 38, 0.72)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(56, 129, 200, 0.16)',
    paddingVertical: 10,
    paddingHorizontal: spacing.sm,
    alignItems: 'flex-start',
  },
  statLabel: {
    ...typography.caption,
    fontSize: 10,
    color: colors.textMuted,
    fontWeight: '600',
  },
  statValue: {
    ...typography.bodySmall,
    fontWeight: '800',
    marginTop: 2,
    color: colors.textPrimary,
    fontSize: 15,
  },
});

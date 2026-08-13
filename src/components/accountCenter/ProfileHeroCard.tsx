import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, typography } from '../../theme';
import GameIcon from '../ui/GameIcon';
import { ACCOUNT_CARD_PADDING, accountCardStyle } from './accountCenterTheme';
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
            <GameIcon name="account" size={22} color={colors.accentAmber} />
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
              variant={isGuest ? 'amber' : 'blue'}
            />
            {!isGuest && cloudStatusLabel ? (
              <AccountStatusBadge label={cloudStatusLabel} variant={cloudStatusVariant} />
            ) : null}
          </View>
        </View>
      </View>

      <View style={styles.statRow}>
        <Text style={styles.statChip}>
          <Text style={styles.statValue}>Sv.{stats.level}</Text>
        </Text>
        <Text style={styles.statDivider}>·</Text>
        <Text style={styles.statChip} numberOfLines={1}>
          <Text style={styles.statValue}>{stats.contracts}</Text>
          <Text style={styles.statLabel}> sözleşme</Text>
        </Text>
        <Text style={styles.statDivider}>·</Text>
        <Text style={styles.statChip} numberOfLines={1}>
          <Text style={styles.statValue}>{stats.trucks}</Text>
          <Text style={styles.statLabel}> araç</Text>
        </Text>
        <Text style={styles.statDivider}>·</Text>
        <Text style={styles.statChip} numberOfLines={1}>
          <Text style={styles.statValue}>{stats.warehouses}</Text>
          <Text style={styles.statLabel}> depo</Text>
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    ...accountCardStyle,
    borderWidth: 1,
    overflow: 'hidden',
    padding: ACCOUNT_CARD_PADDING,
    gap: 10,
  },
  heroCard: {
    borderColor: 'rgba(56, 189, 248, 0.22)',
    backgroundColor: '#0B1A30',
  },
  hero: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarGuest: {
    backgroundColor: colors.amberSoft,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.22)',
  },
  avatarLinked: {
    backgroundColor: colors.successSoft,
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.22)',
  },
  avatarLetter: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.success,
  },
  heroMain: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  name: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    lineHeight: 16,
    fontSize: 12,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 2,
  },
  statRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 4,
    paddingTop: 2,
  },
  statChip: {
    flexShrink: 1,
    minWidth: 0,
  },
  statValue: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: colors.textMuted,
  },
  statDivider: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '600',
  },
});

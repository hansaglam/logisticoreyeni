import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { LEADERBOARD_ENABLED } from '../../config/backendRoadmap';
import { colors, typography } from '../../theme';
import { formatCompanyScore } from '../../simulation/companyScore';
import GameIcon from '../ui/GameIcon';
import AccountActionRow from './AccountActionRow';
import AccountMetric from './AccountMetric';
import AccountSectionCard from './AccountSectionCard';
import ProfileHeroCard from './ProfileHeroCard';
import { ACCOUNT_SECTION_GAP } from './accountCenterTheme';

import type { StatusBadgeVariant } from '../ui';

export interface AccountProfileTabProps {
  isGuest: boolean;
  displayName: string;
  heroSubtitle: string;
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
  usernameLabel: string | null;
  usernameSetupCompleted: boolean;
  usernameChangeLocked: boolean;
  onSetupUsername: () => void;
  onEditUsername: () => void;
  companyName: string;
  companyLevel: number;
  companyScore: number;
  homeCityName: string;
  truckCount: number;
  warehouseCount: number;
  leaderboardLoading: boolean;
  leaderboardUnavailable: boolean;
  leaderboardRank: number | null;
  onOpenLeaderboard: () => void;
}

export default function AccountProfileTab({
  isGuest,
  displayName,
  heroSubtitle,
  avatarLetter,
  providerBadge,
  cloudStatusLabel,
  cloudStatusVariant,
  stats,
  usernameLabel,
  usernameSetupCompleted,
  usernameChangeLocked,
  onSetupUsername,
  onEditUsername,
  companyName,
  companyLevel,
  companyScore,
  homeCityName,
  truckCount,
  warehouseCount,
  leaderboardLoading,
  leaderboardUnavailable,
  leaderboardRank,
  onOpenLeaderboard,
}: AccountProfileTabProps) {
  const identityPress = usernameSetupCompleted ? onEditUsername : onSetupUsername;

  return (
    <View style={styles.tab}>
      <ProfileHeroCard
        isGuest={isGuest}
        displayName={displayName}
        subtitle={heroSubtitle}
        avatarLetter={avatarLetter}
        providerBadge={providerBadge}
        cloudStatusLabel={cloudStatusLabel}
        cloudStatusVariant={cloudStatusVariant}
        stats={stats}
      />

      <AccountSectionCard title="Oyuncu Kimliği" compact>
        <Pressable
          onPress={identityPress}
          disabled={isGuest && !usernameSetupCompleted}
          accessibilityRole="button"
          accessibilityLabel="Oyuncu kimliği"
          style={({ pressed }) => [styles.identityRow, pressed && styles.pressed]}
        >
          <View style={styles.identityCopy}>
            {usernameSetupCompleted && usernameLabel ? (
              <Text style={styles.username} numberOfLines={1}>
                @{usernameLabel}
              </Text>
            ) : (
              <Text style={styles.usernamePlaceholder} numberOfLines={1}>
                Kullanıcı adı oluştur
              </Text>
            )}
            <Text style={styles.identityHint} numberOfLines={2}>
              Liderlik ve Araç Pazarı için görünen ad
            </Text>
          </View>
          <GameIcon name="chevronRight" size={14} color={colors.textMuted} />
        </Pressable>
        {usernameChangeLocked ? (
          <Text style={styles.helperText}>Adını daha sonra tekrar değiştirebilirsin.</Text>
        ) : null}
        {isGuest && !usernameSetupCompleted ? (
          <Text style={styles.helperText}>Önce hesabını bağlaman gerekir.</Text>
        ) : null}
      </AccountSectionCard>

      <AccountSectionCard title="Şirket Özeti" compact>
        <View style={styles.companyHeader}>
          <View style={styles.hqIcon}>
            <GameIcon name="city" size={16} color={colors.accentBlue} />
          </View>
          <View style={styles.companyCopy}>
            <Text style={styles.companyName} numberOfLines={1}>
              {companyName}
            </Text>
            <Text style={styles.companyMeta} numberOfLines={1}>
              {homeCityName} · Seviye {companyLevel}
            </Text>
          </View>
        </View>
        <View style={styles.metricGrid}>
          <AccountMetric label="Şirket puanı" value={formatCompanyScore(companyScore)} />
          <AccountMetric label="Merkez şehir" value={homeCityName} />
          <AccountMetric label="Araç" value={String(truckCount)} />
          <AccountMetric label="Depo" value={String(warehouseCount)} />
        </View>
      </AccountSectionCard>

      {LEADERBOARD_ENABLED ? (
        <AccountSectionCard compact>
          <AccountActionRow
            title="Liderlik Tablosu"
            subtitle={
              leaderboardUnavailable
                ? 'Liderlik servisine şu anda ulaşılamıyor.'
                : !usernameSetupCompleted
                  ? 'Katılmak için kullanıcı adını oluştur.'
                  : leaderboardLoading
                    ? 'Sıralama yükleniyor…'
                    : leaderboardRank != null
                      ? `Haftalık sıra: #${leaderboardRank}`
                      : `Şirket puanı: ${formatCompanyScore(companyScore)}`
            }
            icon="trophy"
            onPress={onOpenLeaderboard}
            compact
          />
        </AccountSectionCard>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tab: {
    gap: ACCOUNT_SECTION_GAP,
  },
  pressed: {
    opacity: 0.92,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
  },
  identityCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  username: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.accentBlue,
  },
  usernamePlaceholder: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  identityHint: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 14,
  },
  helperText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 14,
    marginTop: -2,
  },
  companyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  hqIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: 'rgba(35, 136, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  companyCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  companyName: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  companyMeta: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 12,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
});

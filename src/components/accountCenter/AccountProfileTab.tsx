import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { LEADERBOARD_ENABLED } from '../../config/backendRoadmap';
import { ActionButton } from '../ui';
import { colors, typography } from '../../theme';
import type { StatusBadgeVariant } from '../ui';
import { formatCompanyScore } from '../../simulation/companyScore';
import GameIcon from '../ui/GameIcon';
import AccountInfoRow from './AccountInfoRow';
import AccountSectionCard from './AccountSectionCard';
import ProfileHeroCard from './ProfileHeroCard';
import { ACCOUNT_SECTION_GAP } from './accountCenterTheme';

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
  leaderboardLoading,
  leaderboardUnavailable,
  leaderboardRank,
  onOpenLeaderboard,
}: AccountProfileTabProps) {
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

      <AccountSectionCard title="Oyuncu Kimliği">
        {usernameSetupCompleted && usernameLabel ? (
          <>
            <Text style={styles.identityValue}>@{usernameLabel}</Text>
            <Text style={styles.identityHint}>
              Liderlik Tablosu ve Araç Pazarı&apos;nda görünür.
            </Text>
            {usernameChangeLocked ? (
              <Text style={styles.identityHint}>
                Kullanıcı adını daha sonra tekrar değiştirebilirsin.
              </Text>
            ) : (
              <ActionButton
                label="Kullanıcı Adını Düzenle"
                onPress={onEditUsername}
                variant="secondary"
                compact
                style={styles.cardAction}
              />
            )}
          </>
        ) : (
          <>
            <Text style={styles.identityHint}>
              Liderlik Tablosu ve Araç Pazarı için görünen adını oluştur.
            </Text>
            <ActionButton
              label="Kullanıcı Adı Oluştur"
              onPress={onSetupUsername}
              variant="primary"
              compact
              style={styles.cardAction}
              disabled={isGuest}
            />
            {isGuest ? (
              <Text style={styles.identityHint}>Önce hesabını bağlaman gerekir.</Text>
            ) : null}
          </>
        )}
      </AccountSectionCard>

      <AccountSectionCard title="Şirket Kimliği">
        <AccountInfoRow label="Şirket adı" value={companyName} />
        <AccountInfoRow label="Seviye" value={`Seviye ${companyLevel}`} />
        <AccountInfoRow label="Şirket puanı" value={formatCompanyScore(companyScore)} />
        <AccountInfoRow label="Merkez şehir" value={homeCityName} />
      </AccountSectionCard>

      {LEADERBOARD_ENABLED ? (
        <Pressable
          onPress={onOpenLeaderboard}
          accessibilityRole="button"
          accessibilityLabel="Liderlik Tablosu"
          style={({ pressed }) => [pressed && styles.pressed]}
        >
          <AccountSectionCard>
            <View style={styles.leaderboardRow}>
              <View style={styles.leaderboardIcon}>
                <GameIcon name="trophy" size={20} color={colors.accentAmber} />
              </View>
              <View style={styles.leaderboardCopy}>
                <Text style={styles.leaderboardTitle}>Liderlik Tablosu</Text>
                {leaderboardUnavailable ? (
                  <Text style={styles.leaderboardSubtitle}>
                    Liderlik servisine şu anda ulaşılamıyor.
                  </Text>
                ) : !usernameSetupCompleted ? (
                  <Text style={styles.leaderboardSubtitle}>
                    Katılmak için kullanıcı adını oluştur.
                  </Text>
                ) : leaderboardLoading ? (
                  <Text style={styles.leaderboardSubtitle}>Sıralama yükleniyor…</Text>
                ) : (
                  <Text style={styles.leaderboardSubtitle}>
                    {leaderboardRank != null
                      ? `Haftalık sıra: #${leaderboardRank} · Puan: ${formatCompanyScore(companyScore)}`
                      : `Şirket puanı: ${formatCompanyScore(companyScore)}`}
                  </Text>
                )}
              </View>
              {usernameSetupCompleted && !leaderboardUnavailable ? (
                <Text style={styles.leaderboardCta}>Gör</Text>
              ) : null}
            </View>
          </AccountSectionCard>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tab: {
    gap: ACCOUNT_SECTION_GAP,
    paddingBottom: 8,
  },
  pressed: {
    opacity: 0.94,
  },
  identityValue: {
    ...typography.cardTitle,
    fontSize: 18,
    color: colors.accentBlue,
    fontWeight: '800',
  },
  identityHint: {
    ...typography.caption,
    color: colors.textSecondary,
    lineHeight: 17,
    fontSize: 12,
  },
  cardAction: {
    marginTop: 4,
    alignSelf: 'stretch',
  },
  leaderboardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 48,
  },
  leaderboardIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.amberSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  leaderboardCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  leaderboardTitle: {
    ...typography.bodySmall,
    fontWeight: '800',
    fontSize: 14,
  },
  leaderboardSubtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    lineHeight: 16,
  },
  leaderboardCta: {
    ...typography.caption,
    color: colors.accentAmber,
    fontWeight: '800',
    fontSize: 13,
    minWidth: 32,
    textAlign: 'right',
  },
});

/**
 * Kompakt hesap özeti — tam ayarlar için Hesap Merkezi ekranını açın.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAccountCenter } from '../hooks/useAccountCenter';
import { ActionButton, AppCard, GameIcon, StatusBadge } from './ui';
import { colors, spacing, typography } from '../theme';
import { getProviderBadgeLabel } from '../utils/accountCenterCloudStatus';

export default function AccountSection({
  onOpenLeaderboard,
  onOpenAccountCenter,
}: {
  onOpenLeaderboard?: () => void;
  onOpenAccountCenter?: () => void;
}) {
  const vm = useAccountCenter({ onOpenLeaderboard });
  const providerBadge = getProviderBadgeLabel(vm.safeAccountStatus.provider, vm.isGuest);

  return (
    <AppCard style={styles.card} padded={false}>
      <Pressable
        style={styles.inner}
        onPress={onOpenAccountCenter}
        disabled={!onOpenAccountCenter}
        accessibilityRole="button"
        accessibilityLabel="Hesap Merkezini aç"
        accessibilityHint="Profil, bulut kaydı ve uygulama tercihleri"
      >
        <View style={styles.hero}>
          <View style={[styles.avatar, vm.isGuest ? styles.avatarGuest : styles.avatarLinked]}>
            <Text style={styles.avatarLetter}>{vm.avatarLetter}</Text>
          </View>
          <View style={styles.copy}>
            <Text style={styles.title}>Hesap Merkezi</Text>
            <Text style={styles.subtitle} numberOfLines={2}>
              {vm.isGuest
                ? 'Hesabını bağla, bulut kaydını yönet'
                : vm.usernameLabel
                  ? `@${vm.usernameLabel} · ${vm.cloudUserStatus.label}`
                  : `${vm.providerLabel} · ${vm.cloudUserStatus.label}`}
            </Text>
            <StatusBadge label={providerBadge} variant={vm.isGuest ? 'amber' : 'success'} size="sm" />
          </View>
          {onOpenAccountCenter ? (
            <GameIcon name="chevronRight" size={20} color={colors.textMuted} />
          ) : null}
        </View>
        {onOpenAccountCenter ? (
          <ActionButton
            label="Hesap Merkezini Aç"
            onPress={onOpenAccountCenter}
            variant="secondary"
            compact
            style={styles.cta}
          />
        ) : null}
      </Pressable>
    </AppCard>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.lg,
    borderColor: 'rgba(35, 136, 255, 0.22)',
    backgroundColor: '#0B1930',
    borderRadius: 20,
  },
  inner: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarGuest: {
    backgroundColor: colors.amberSoft,
  },
  avatarLinked: {
    backgroundColor: colors.successSoft,
  },
  avatarLetter: {
    ...typography.cardTitle,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  title: {
    ...typography.cardTitle,
    fontSize: 16,
    fontWeight: '800',
  },
  subtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    lineHeight: 16,
  },
  cta: {
    alignSelf: 'stretch',
  },
});

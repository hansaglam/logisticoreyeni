import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { CloudSaveDisplayInfo } from '../../utils/accountCenterCloudStatus';
import { ActionButton } from '../ui';
import { colors, typography } from '../../theme';
import GameIcon from '../ui/GameIcon';
import AccountActionRow from './AccountActionRow';
import AccountSectionCard from './AccountSectionCard';
import AccountStatusBadge from './AccountStatusBadge';
import { ACCOUNT_SECTION_GAP } from './accountCenterTheme';

export interface AccountConnectionTabProps {
  isReady: boolean;
  isGuest: boolean;
  providerLabel: string;
  maskedEmail: string | null;
  cloudUserStatusLabel: string;
  lastSyncLabel: string;
  isSwitchingAccount: boolean;
  recoveryRequired: boolean;
  showGoogle: boolean;
  showApple: boolean;
  googleConfigured: boolean;
  isLinking: 'google' | 'apple' | null;
  onLinkGoogle: () => void;
  onLinkApple: () => void;
  cloudDisplay: CloudSaveDisplayInfo;
  isManualSyncing: boolean;
  isChecking: boolean;
  onCloudCta: () => void;
  showAccountSwitch: boolean;
  isSigningOut: boolean;
  isDeleting: boolean;
  onAccountSwitch: () => void;
  onSignOut: () => void;
}

function cloudStatusColor(key: CloudSaveDisplayInfo['key']): string {
  switch (key) {
    case 'synced':
      return colors.success;
    case 'pending':
      return colors.accentBlue;
    case 'retry':
    case 'link-required':
      return colors.accentAmber;
    case 'conflict':
    case 'recovery':
    case 'offline':
      return colors.danger;
    default:
      return colors.accentBlue;
  }
}

function cloudBadgeLabel(display: CloudSaveDisplayInfo): string {
  switch (display.key) {
    case 'synced':
      return 'SENKRONİZE';
    case 'pending':
      return 'SENKRONİZE EDİLİYOR';
    case 'retry':
      return 'YENİDEN DENE';
    case 'conflict':
      return 'ÇAKIŞMA';
    case 'recovery':
      return 'KURTARMA';
    case 'link-required':
      return 'BAĞLANTI GEREKLİ';
    default:
      return display.title.toUpperCase();
  }
}

export default function AccountConnectionTab({
  isReady,
  isGuest,
  providerLabel,
  maskedEmail,
  cloudUserStatusLabel,
  lastSyncLabel,
  isSwitchingAccount,
  recoveryRequired,
  showGoogle,
  showApple,
  googleConfigured,
  isLinking,
  onLinkGoogle,
  onLinkApple,
  cloudDisplay,
  isManualSyncing,
  isChecking,
  onCloudCta,
  showAccountSwitch,
  isSigningOut,
  isDeleting,
  onAccountSwitch,
  onSignOut,
}: AccountConnectionTabProps) {
  const statusColor = cloudStatusColor(cloudDisplay.key);
  const showSecureMessage = cloudDisplay.key === 'synced';

  return (
    <View style={styles.tab}>
      <AccountSectionCard
        title="Bağlı Hesap"
        compact
        headerRight={
          !isGuest && isReady ? (
            <AccountStatusBadge label="BAĞLI" variant="success" />
          ) : null
        }
      >
        {!isReady ? (
          <Text style={styles.hint}>Hesap kontrol ediliyor…</Text>
        ) : isGuest ? (
          <>
            <Text style={styles.hint}>
              İlerlemeni korumak için Google veya Apple hesabını bağla.
            </Text>
            <View style={styles.authButtons}>
              {showGoogle ? (
                <ActionButton
                  label={isLinking === 'google' ? 'Bağlanıyor…' : 'Google ile Devam Et'}
                  onPress={onLinkGoogle}
                  variant="primary"
                  icon="account"
                  disabled={Boolean(isLinking)}
                />
              ) : null}
              {showApple ? (
                <ActionButton
                  label={isLinking === 'apple' ? 'Bağlanıyor…' : 'Apple ile Devam Et'}
                  onPress={onLinkApple}
                  variant="secondary"
                  icon="account"
                  disabled={Boolean(isLinking)}
                />
              ) : null}
            </View>
            {__DEV__ && !googleConfigured && showGoogle ? (
              <Text style={styles.devHint}>
                Google yapılandırmasını kontrol et. Değişiklikten sonra: npx expo start -c
              </Text>
            ) : null}
          </>
        ) : (
          <View style={styles.linkedAccount}>
            <View style={styles.providerRow}>
              <View style={styles.providerIcon}>
                <GameIcon name="account" size={16} color={colors.accentBlue} />
              </View>
              <View style={styles.providerCopy}>
                <Text style={styles.providerName}>{providerLabel}</Text>
                {maskedEmail ? (
                  <Text style={styles.providerEmail} numberOfLines={1}>
                    {maskedEmail}
                  </Text>
                ) : null}
              </View>
            </View>
            <View style={styles.statusRow}>
              <Text style={styles.statusLabel}>Durum</Text>
              <Text style={styles.statusValue}>{cloudUserStatusLabel}</Text>
            </View>
          </View>
        )}
      </AccountSectionCard>

      <AccountSectionCard
        title="Bulut Koruması"
        compact
        headerRight={
          <AccountStatusBadge label={cloudBadgeLabel(cloudDisplay)} variant={cloudDisplay.badgeVariant} />
        }
      >
        <View style={styles.cloudStatus}>
          <GameIcon
            name={showSecureMessage ? 'success' : cloudDisplay.key === 'retry' ? 'warning' : 'account'}
            size={16}
            color={statusColor}
          />
          <View style={styles.cloudCopy}>
            {showSecureMessage ? (
              <Text style={[styles.cloudSecure, { color: statusColor }]}>
                İlerlemen güvende
              </Text>
            ) : (
              <Text style={styles.cloudTitle}>{cloudDisplay.title}</Text>
            )}
            <Text style={styles.cloudDescription} numberOfLines={2}>
              {cloudDisplay.key === 'synced'
                ? `Son kayıt: ${lastSyncLabel}`
                : cloudDisplay.description}
            </Text>
          </View>
        </View>

        {isSwitchingAccount ? (
          <Text style={styles.statusBanner} accessibilityLiveRegion="polite">
            Hesap geçişi sürüyor… Bulut kaydı doğrulanıyor.
          </Text>
        ) : null}
        {recoveryRequired ? (
          <Text style={styles.statusBannerDanger} accessibilityLiveRegion="polite">
            Kurtarma gerekli — hesap geçişini tamamlaman gerekiyor.
          </Text>
        ) : null}

        {cloudDisplay.ctaLabel ? (
          <ActionButton
            label={
              isManualSyncing || isChecking
                ? 'İşleniyor…'
                : cloudDisplay.ctaLabel === 'Şimdi Senkronize Et'
                  ? 'Senkronize Et'
                  : cloudDisplay.ctaLabel
            }
            onPress={onCloudCta}
            variant="primary"
            compact
            style={styles.cloudCta}
            disabled={isManualSyncing || isChecking || isSwitchingAccount}
          />
        ) : null}
      </AccountSectionCard>

      {!isGuest ? (
        <AccountSectionCard title="Hesap Yönetimi" compact>
          {showAccountSwitch ? (
            <>
              <AccountActionRow
                title="Hesap Değiştir"
                icon="account"
                onPress={onAccountSwitch}
                disabled={isSwitchingAccount || isSigningOut || isDeleting}
                showChevron
                compact
              />
              <View style={styles.divider} />
            </>
          ) : null}
          <AccountActionRow
            title={isSigningOut ? 'Çıkış yapılıyor…' : 'Çıkış Yap'}
            icon="back"
            onPress={onSignOut}
            disabled={isSwitchingAccount || isSigningOut || isDeleting}
            tone="warning"
            showChevron
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
  hint: {
    ...typography.caption,
    color: colors.textSecondary,
    lineHeight: 16,
    fontSize: 12,
  },
  authButtons: {
    gap: 8,
    marginTop: 4,
  },
  devHint: {
    ...typography.caption,
    color: colors.accentAmber,
    marginTop: 4,
    fontSize: 11,
  },
  linkedAccount: {
    gap: 10,
  },
  providerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  providerIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: 'rgba(35, 136, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  providerCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  providerName: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  providerEmail: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 12,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    minHeight: 32,
  },
  statusLabel: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 12,
  },
  statusValue: {
    ...typography.bodySmall,
    fontWeight: '700',
    color: colors.textPrimary,
    fontSize: 13,
  },
  cloudStatus: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  cloudCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  cloudSecure: {
    fontSize: 14,
    fontWeight: '800',
  },
  cloudTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  cloudDescription: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 14,
  },
  cloudCta: {
    alignSelf: 'flex-start',
    minHeight: 44,
    marginTop: 4,
  },
  statusBanner: {
    ...typography.caption,
    color: colors.accentBlue,
    padding: 8,
    borderRadius: 8,
    backgroundColor: colors.accentBlueSoft,
    lineHeight: 15,
    fontSize: 11,
  },
  statusBannerDanger: {
    ...typography.caption,
    color: colors.danger,
    padding: 8,
    borderRadius: 8,
    backgroundColor: colors.dangerSoft,
    lineHeight: 15,
    fontSize: 11,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(56, 129, 200, 0.1)',
  },
});

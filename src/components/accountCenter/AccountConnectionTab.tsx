import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { CloudSaveDisplayInfo } from '../../utils/accountCenterCloudStatus';
import { ActionButton } from '../ui';
import { colors, typography } from '../../theme';
import GameIcon from '../ui/GameIcon';
import AccountInfoRow from './AccountInfoRow';
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

function cloudIconName(key: CloudSaveDisplayInfo['key']): 'refresh' | 'warning' | 'success' | 'account' {
  switch (key) {
    case 'synced':
      return 'success';
    case 'pending':
      return 'refresh';
    case 'conflict':
    case 'retry':
    case 'recovery':
      return 'warning';
    default:
      return 'account';
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
  return (
    <View style={styles.tab}>
      <AccountSectionCard title="Hesap Bağlantısı">
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
          <>
            <AccountInfoRow label="Bağlı hesap" value={`${providerLabel} hesabı bağlı`} />
            {maskedEmail ? <AccountInfoRow label="E-posta" value={maskedEmail} /> : null}
            <AccountInfoRow label="Bulut kaydı" value={cloudUserStatusLabel} />
            <AccountInfoRow label="Son senkronizasyon" value={lastSyncLabel} />
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
          </>
        )}
      </AccountSectionCard>

      <AccountSectionCard
        title="Bulut Kaydı"
        headerRight={
          <AccountStatusBadge label={cloudDisplay.title} variant={cloudDisplay.badgeVariant} />
        }
      >
        <View style={styles.cloudBanner}>
          <View style={styles.cloudIconWrap}>
            <GameIcon name={cloudIconName(cloudDisplay.key)} size={20} color={colors.accentBlue} />
          </View>
          <View style={styles.cloudCopy}>
            <Text style={styles.cloudTitle}>{cloudDisplay.title}</Text>
            <Text style={styles.cloudDescription}>{cloudDisplay.description}</Text>
          </View>
        </View>
        {cloudDisplay.ctaLabel ? (
          <ActionButton
            label={isManualSyncing || isChecking ? 'İşleniyor…' : cloudDisplay.ctaLabel}
            onPress={onCloudCta}
            variant="primary"
            compact
            style={styles.cardAction}
            disabled={isManualSyncing || isChecking || isSwitchingAccount}
          />
        ) : null}
      </AccountSectionCard>

      {!isGuest ? (
        <AccountSectionCard title="Hesap İşlemleri">
          <Text style={styles.hint}>Bağlı oturumu yönet</Text>
          <View style={styles.actionStack}>
            {showAccountSwitch ? (
              <ActionButton
                label={isSwitchingAccount ? 'Hesap değiştiriliyor…' : 'Hesap Değiştir'}
                onPress={onAccountSwitch}
                variant="secondary"
                compact
                icon="account"
                disabled={isSwitchingAccount || isSigningOut || isDeleting}
              />
            ) : null}
            <ActionButton
              label={isSigningOut ? 'Çıkış yapılıyor…' : 'Çıkış Yap'}
              onPress={onSignOut}
              variant="secondary"
              compact
              disabled={isSwitchingAccount || isSigningOut || isDeleting}
            />
          </View>
        </AccountSectionCard>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tab: {
    gap: ACCOUNT_SECTION_GAP,
    paddingBottom: 8,
  },
  hint: {
    ...typography.caption,
    color: colors.textSecondary,
    lineHeight: 17,
    fontSize: 12,
  },
  authButtons: {
    gap: 10,
    marginTop: 4,
  },
  devHint: {
    ...typography.caption,
    color: colors.accentAmber,
    marginTop: 4,
  },
  statusBanner: {
    ...typography.caption,
    color: colors.accentBlue,
    marginTop: 4,
    padding: 10,
    borderRadius: 10,
    backgroundColor: colors.accentBlueSoft,
    lineHeight: 16,
  },
  statusBannerDanger: {
    ...typography.caption,
    color: colors.danger,
    marginTop: 4,
    padding: 10,
    borderRadius: 10,
    backgroundColor: colors.dangerSoft,
    lineHeight: 16,
  },
  cloudBanner: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
    paddingVertical: 4,
  },
  cloudIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(35, 136, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cloudCopy: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  cloudTitle: {
    ...typography.bodySmall,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  cloudDescription: {
    ...typography.caption,
    color: colors.textSecondary,
    lineHeight: 17,
  },
  cardAction: {
    marginTop: 4,
    alignSelf: 'stretch',
  },
  actionStack: {
    gap: 10,
    marginTop: 4,
  },
});

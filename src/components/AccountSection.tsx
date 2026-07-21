/**
 * Şirket ekranı — Hesap / bulut kaydı (oyuncu yüzü).
 *
 * Cloud save arka planda otomatik çalışır.
 * Teknik sync / UID yalnızca __DEV__ panelinde görünür.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { AuthCredential } from 'firebase/auth';

import { useAppDialog } from './AppDialogProvider';
import { ActionButton, AppCard, GameIcon, StatusBadge } from './ui';
import type { StatusBadgeVariant } from './ui';
import {
  DEFAULT_ACCOUNT_STATUS,
  getAccountStatus,
  linkAnonymousAccountWithApple,
  linkAnonymousAccountWithGoogle,
  retryProviderAccountLink,
  subscribeAuthState,
  switchToLinkedProviderAccount,
  type AccountStatus,
} from '../services/authService';
import {
  configureGoogleSignIn,
  isGoogleSignInConfigured,
} from '../services/googleAuthService';
import { isAppleSignInAvailable } from '../services/appleAuthService';
import { useGameStore } from '../store/gameStore';
import {
  checkCloudSaveMeta,
  getCloudSaveStatus,
  getCloudSaveStatusSubtitle,
  subscribeCloudSaveStatus,
  syncLocalSaveToCloud,
  type CloudSaveStatusState,
} from '../storage/cloudSaveSync';
import {
  getAccountDeletionErrorMessage,
  type AccountDeletionErrorCode,
} from '../utils/accountDeletion';
import {
  getAccountLinkConflictFooter,
  getAccountLinkConflictMessage,
  getAccountLinkConflictTitle,
  getAccountLinkGeneralErrorMessage,
  isAccountLinkConflictError,
} from '../utils/accountLinkErrors';
import { colors, spacing, typography } from '../theme';

function getStatusBadgeVariant(
  status: CloudSaveStatusState['status'],
): StatusBadgeVariant {
  switch (status) {
    case 'success':
      return 'success';
    case 'syncing':
    case 'pending':
      return 'blue';
    case 'failed':
      return 'danger';
    default:
      return 'muted';
  }
}

function formatLastSaveLabel(timestamp: number | null): string {
  if (!timestamp) {
    return 'Henüz kaydedilmedi';
  }

  const date = new Date(timestamp);
  const now = new Date();
  const time = date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

  if (date.toDateString() === now.toDateString()) {
    return `Bugün ${time}`;
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return `Dün ${time}`;
  }

  return date.toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getCloudSaveUserStatus(status: CloudSaveStatusState): {
  label: string;
  variant: StatusBadgeVariant;
} {
  if (!status.firebaseEnabled || !status.uid) {
    return { label: 'Yerel kayıt', variant: 'muted' };
  }
  if (status.status === 'failed') {
    return { label: 'Yeniden denenecek', variant: 'amber' };
  }
  if (status.status === 'syncing' || status.status === 'pending') {
    return { label: 'Kaydediliyor', variant: 'blue' };
  }
  return { label: 'Güvende', variant: 'success' };
}

function linkErrorMessage(error: string | undefined): string | null {
  if (!error || error === 'cancelled') {
    return null;
  }
  if (isAccountLinkConflictError(error)) {
    return null;
  }
  if (error === 'config-missing') {
    return Platform.OS === 'ios'
      ? 'EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID veya Google yapılandırmasını kontrol et.'
      : 'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID kontrol et. Değişiklikten sonra: npx expo start -c';
  }
  if (error === 'native-module-unavailable') {
    return 'Google girişi Expo Go\'da çalışmaz. Development build gerekir:\nnpx expo run:android';
  }
  if (error === 'apple-not-available' || error === 'apple-not-supported') {
    return 'Apple ile giriş bu cihazda kullanılamıyor.';
  }
  if (error === 'crypto-unavailable') {
    return 'Apple ile giriş için gerekli güvenlik modülü hazırlanamadı. Lütfen uygulamayı yeniden başlat.';
  }
  if (error === 'not-implemented') {
    return 'Hesap bağlama henüz hazır değil.';
  }
  return getAccountLinkGeneralErrorMessage();
}

function AccountStatusRow({
  label,
  value,
  badgeVariant = 'muted',
}: {
  label: string;
  value: string;
  badgeVariant?: StatusBadgeVariant;
}) {
  return (
    <View style={styles.statusRow}>
      <Text style={styles.statusRowLabel}>{label}</Text>
      <StatusBadge label={value} variant={badgeVariant} size="sm" />
    </View>
  );
}

function DeveloperCloudStatus({
  status,
  onManualSync,
  onCheckCloud,
  isManualSyncing,
  isChecking,
}: {
  status: CloudSaveStatusState;
  onManualSync: () => void;
  onCheckCloud: () => void;
  isManualSyncing: boolean;
  isChecking: boolean;
}) {
  return (
    <View style={styles.devPanel}>
      <View style={styles.headerRow}>
        <Text style={styles.devTitle}>Geliştirici Bulut Durumu</Text>
        <StatusBadge
          label={status.statusLabel}
          variant={getStatusBadgeVariant(status.status)}
          size="sm"
        />
      </View>
      <Text style={styles.devSubtitle}>{getCloudSaveStatusSubtitle(status)}</Text>
      {status.uidShort ? <Text style={styles.metaText}>UID: {status.uidShort}</Text> : null}
      <View style={styles.buttonRow}>
        <ActionButton
          label={isManualSyncing ? 'Senkronize ediliyor...' : 'Manuel Senkronize Et'}
          onPress={onManualSync}
          variant="secondary"
          compact
          disabled={isManualSyncing || status.status === 'disabled'}
          style={styles.actionButton}
        />
        <ActionButton
          label={isChecking ? 'Kontrol ediliyor...' : 'Bulut Kaydını Kontrol Et'}
          onPress={onCheckCloud}
          variant="secondary"
          compact
          disabled={isChecking || status.status === 'disabled'}
          style={styles.actionButton}
        />
      </View>
    </View>
  );
}

export default function AccountSection() {
  const { alert: showAlert, showDialog } = useAppDialog();
  const [account, setAccount] = useState<AccountStatus>(DEFAULT_ACCOUNT_STATUS);
  const [cloudStatus, setCloudStatus] = useState<CloudSaveStatusState>(getCloudSaveStatus);
  const [isManualSyncing, setIsManualSyncing] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [isLinking, setIsLinking] = useState<'google' | 'apple' | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [dangerExpanded, setDangerExpanded] = useState(false);
  const [googleConfigured, setGoogleConfigured] = useState(() => isGoogleSignInConfigured());
  const [appleAvailable, setAppleAvailable] = useState(false);
  const deleteAccountAndCloudData = useGameStore((state) => state.deleteAccountAndCloudData);

  const safeAccountStatus = account ?? DEFAULT_ACCOUNT_STATUS;

  const refreshAccount = useCallback(() => {
    try {
      setAccount(getAccountStatus() ?? DEFAULT_ACCOUNT_STATUS);
    } catch {
      setAccount(DEFAULT_ACCOUNT_STATUS);
    }
  }, []);

  const refreshCloudStatus = useCallback(() => {
    setCloudStatus(getCloudSaveStatus());
  }, []);

  useEffect(() => {
    configureGoogleSignIn();
    setGoogleConfigured(isGoogleSignInConfigured());
    refreshAccount();
    const unsubAuth = subscribeAuthState(() => {
      refreshAccount();
    });
    return () => {
      unsubAuth();
    };
  }, [refreshAccount]);

  useEffect(() => {
    if (Platform.OS !== 'ios') {
      setAppleAvailable(false);
      return;
    }

    let cancelled = false;
    void isAppleSignInAvailable().then((available) => {
      if (!cancelled) {
        setAppleAvailable(available);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    refreshCloudStatus();
    return subscribeCloudSaveStatus(refreshCloudStatus);
  }, [refreshCloudStatus]);

  const handleManualSync = async () => {
    if (!__DEV__) {
      return;
    }
    setIsManualSyncing(true);
    try {
      await useGameStore.getState().saveGame();
      await syncLocalSaveToCloud('manual', {
        force: true,
        state: useGameStore.getState(),
      });
      refreshCloudStatus();
    } finally {
      setIsManualSyncing(false);
    }
  };

  const handleCheckCloud = async () => {
    if (!__DEV__) {
      return;
    }
    setIsChecking(true);
    try {
      const candidate = await checkCloudSaveMeta(useGameStore.getState());
      refreshCloudStatus();
      if (__DEV__ && candidate.hasCandidate && candidate.cloudSummary) {
        console.log('[cloud-save] restore candidate', candidate.cloudSummary);
      }
    } finally {
      setIsChecking(false);
    }
  };

  const handleLink = async (provider: 'google' | 'apple') => {
    if (isLinking) {
      return;
    }

    setIsLinking(provider);
    try {
      const result =
        provider === 'google'
          ? await linkAnonymousAccountWithGoogle()
          : await linkAnonymousAccountWithApple();

      refreshAccount();
      refreshCloudStatus();

      if (result.ok) {
        showAlert('Hesap bağlandı', 'İlerlemen artık hesabınla korunuyor.');
        return;
      }

      if (
        isAccountLinkConflictError(result.error, result.errorKind) &&
        result.pendingCredential
      ) {
        showAccountConflictDialog(provider, result.pendingCredential);
        return;
      }

      const message = linkErrorMessage(result.error);
      if (message) {
        showAlert('Hesap Bağlanamadı', message);
      }
    } catch (error) {
      console.warn('[account] link failed', error);
      showAlert('Hesap Bağlanamadı', getAccountLinkGeneralErrorMessage());
    } finally {
      setIsLinking(null);
    }
  };

  const handleSwitchToProviderAccount = async (
    provider: 'google' | 'apple',
    pendingCredential: AuthCredential,
  ) => {
    if (isLinking) {
      return;
    }

    setIsLinking(provider);
    try {
      const result = await switchToLinkedProviderAccount(pendingCredential, provider);
      refreshAccount();
      refreshCloudStatus();

      if (result.ok) {
        const providerLabel = provider === 'google' ? 'Google' : 'Apple';
        showAlert(`${providerLabel} kaydına geçildi`, 'Hesabına bağlı oyun kaydı yüklendi.');
        return;
      }

      if (result.revertedToGuest) {
        if (result.error === 'no-cloud-save') {
          showAlert(
            'Kayıt bulunamadı',
            'Bu hesapta yüklenecek bulut kaydı bulunamadı. Misafir kaydınla devam ediyorsun.',
          );
        } else if (result.error === 'cancelled') {
          showAlert(
            'Geçiş iptal edildi',
            'Apple girişi tamamlanmadı. Misafir kaydınla devam ediyorsun.',
          );
        } else {
          showAlert(
            'Geçiş başarısız',
            'Hesap kaydına geçilemedi. Misafir kaydınla devam ediyorsun.',
          );
        }
        return;
      }

      showAlert('Geçiş başarısız', getAccountLinkGeneralErrorMessage());
    } catch (error) {
      console.warn('[account] switch to linked account failed', error);
      showAlert('Geçiş başarısız', getAccountLinkGeneralErrorMessage());
    } finally {
      setIsLinking(null);
    }
  };

  const showSwitchConfirmDialog = (
    provider: 'google' | 'apple',
    pendingCredential: AuthCredential,
  ) => {
    const providerLabel = provider === 'google' ? 'Google' : 'Apple';
    showDialog({
      title: `${providerLabel} kaydına geçilsin mi?`,
      message: `Mevcut misafir kaydın bu hesapla birleştirilmeyecek. ${providerLabel} hesabına bağlı kayıt yüklenecek.`,
      footerNote: 'Onay vermeden mevcut misafir kaydın silinmez veya üzerine yazılmaz.',
      variant: 'danger',
      cancelLabel: 'Vazgeç',
      confirmLabel: `${providerLabel} Kaydına Geç`,
      destructive: true,
      onConfirm: () => {
        void handleSwitchToProviderAccount(provider, pendingCredential);
      },
    });
  };

  const showAccountConflictDialog = (
    provider: 'google' | 'apple',
    pendingCredential: AuthCredential,
  ) => {
    const switchLabel = provider === 'google' ? 'Google Kaydına Geç' : 'Apple Kaydına Geç';
    showDialog({
      title: getAccountLinkConflictTitle(provider),
      message: getAccountLinkConflictMessage(provider),
      footerNote: getAccountLinkConflictFooter(provider),
      variant: 'warning',
      actions: [
        {
          label: switchLabel,
          variant: 'primary',
          onPress: () => showSwitchConfirmDialog(provider, pendingCredential),
        },
        {
          label: 'Misafir Kaydıyla Devam Et',
          variant: 'secondary',
          onPress: () => {},
        },
        {
          label: 'Farklı Hesap Dene',
          variant: 'secondary',
          onPress: () => {
            void handleRetryLink(provider);
          },
        },
      ],
    });
  };

  const handleRetryLink = async (provider: 'google' | 'apple') => {
    if (isLinking) {
      return;
    }

    setIsLinking(provider);
    try {
      const result = await retryProviderAccountLink(provider);
      refreshAccount();
      refreshCloudStatus();

      if (result.ok) {
        showAlert('Hesap bağlandı', 'İlerlemen artık hesabınla korunuyor.');
        return;
      }

      if (
        isAccountLinkConflictError(result.error, result.errorKind) &&
        result.pendingCredential
      ) {
        showAccountConflictDialog(provider, result.pendingCredential);
        return;
      }

      const message = linkErrorMessage(result.error);
      if (message) {
        showAlert('Hesap Bağlanamadı', message);
      }
    } catch (error) {
      console.warn('[account] retry link failed', error);
      showAlert('Hesap Bağlanamadı', getAccountLinkGeneralErrorMessage());
    } finally {
      setIsLinking(null);
    }
  };

  const handleDeleteAccount = () => {
    if (isDeleting) {
      return;
    }

    const isGuest =
      safeAccountStatus.isAnonymous || safeAccountStatus.provider === 'guest';
    showDialog({
      title: isGuest ? 'Misafir Kaydını Sil' : 'Hesabı Sil',
      message: isGuest
        ? 'Bu işlem yerel ilerlemeni silebilir. Devam etmek istiyor musun?'
        : 'Oyun verilerin, bulut kaydın ve hesap bağlantın silinir. Bu işlem geri alınamaz.',
      variant: 'danger',
      confirmLabel: 'Kalıcı Olarak Sil',
      cancelLabel: 'Vazgeç',
      destructive: true,
      onConfirm: () => {
        void (async () => {
          setIsDeleting(true);
          try {
            const result = await deleteAccountAndCloudData();
            refreshAccount();
            refreshCloudStatus();
            if (result.ok) {
              showAlert(
                isGuest ? 'Misafir kaydın silindi' : 'Hesabın silindi',
                'Yeni oyun başlatıldı.',
              );
              return;
            }
            showAlert(
              'Silme Başarısız',
              getAccountDeletionErrorMessage(
                result.errorCode as AccountDeletionErrorCode | undefined,
                result.error,
              ),
            );
          } catch (error) {
            console.warn('[account] delete failed', error);
            showAlert('Silme Başarısız', 'İşlem tamamlanamadı. Lütfen tekrar deneyin.');
          } finally {
            setIsDeleting(false);
          }
        })();
      },
    });
  };

  const isGuest =
    safeAccountStatus.isAnonymous || safeAccountStatus.provider === 'guest';
  const showApple = Platform.OS === 'ios' && appleAvailable;
  const showGoogle = Platform.OS === 'ios' || Platform.OS === 'android';
  const cloudUserStatus = getCloudSaveUserStatus(cloudStatus);
  const cardVariant = isGuest ? 'guest' : 'linked';

  return (
    <AppCard
      style={[styles.card, cardVariant === 'linked' ? styles.cardLinked : styles.cardGuest]}
      padded={false}
    >
      <View style={styles.cardInner}>
        <View style={styles.heroRow}>
          <View
            style={[
              styles.heroIconWrap,
              cardVariant === 'linked' ? styles.heroIconWrapLinked : styles.heroIconWrapGuest,
            ]}
          >
            <GameIcon
              name={cardVariant === 'linked' ? 'success' : 'warning'}
              size={22}
              color={cardVariant === 'linked' ? colors.success : colors.accentAmber}
            />
          </View>
          <View style={styles.heroMain}>
            {!safeAccountStatus.isReady ? (
              <>
                <Text style={styles.heroTitle}>Hesap kontrol ediliyor...</Text>
                <Text style={styles.heroSubtitle}>Oturum bilgisi yükleniyor.</Text>
              </>
            ) : isGuest ? (
              <>
                <Text style={styles.heroTitle}>Hesabını Güvenceye Al</Text>
                <Text style={styles.heroSubtitle}>
                  Misafir modunda oynuyorsun. İlerlemeni kaybetmemek ve liderlik tablosuna
                  katılmak için hesabını bağla.
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.heroTitle}>Hesap Bağlı</Text>
                <Text style={styles.heroSubtitle}>
                  İlerlemen bulut kaydıyla korunuyor.
                </Text>
              </>
            )}
          </View>
          {safeAccountStatus.isReady && !isGuest ? (
            <StatusBadge label="Bağlı" variant="success" size="sm" />
          ) : null}
        </View>

        {safeAccountStatus.isReady ? (
          <View style={styles.statusPanel}>
            <AccountStatusRow
              label="Bulut Kaydı"
              value={cloudUserStatus.label}
              badgeVariant={cloudUserStatus.variant}
            />
            <AccountStatusRow
              label="Son kayıt"
              value={formatLastSaveLabel(cloudStatus.lastSyncAt)}
              badgeVariant="muted"
            />
            <AccountStatusRow
              label="Liderlik Tablosu"
              value={isGuest ? 'Hesap bağlanınca aktif' : 'Aktif'}
              badgeVariant={isGuest ? 'muted' : 'success'}
            />
          </View>
        ) : null}

        {safeAccountStatus.isReady && isGuest ? (
          <View style={styles.linkButtons}>
            {showGoogle ? (
              <ActionButton
                label={isLinking === 'google' ? 'Bağlanıyor...' : 'Google ile Devam Et'}
                onPress={() => void handleLink('google')}
                variant="primary"
                compact
                disabled={Boolean(isLinking)}
                style={styles.primaryLinkButton}
              />
            ) : null}
            {showApple ? (
              <ActionButton
                label={isLinking === 'apple' ? 'Bağlanıyor...' : 'Apple ile Devam Et'}
                onPress={() => void handleLink('apple')}
                variant="secondary"
                compact
                disabled={Boolean(isLinking)}
              />
            ) : null}
            {__DEV__ && !googleConfigured && showGoogle ? (
              <Text style={styles.devHintText}>
                {Platform.OS === 'ios'
                  ? 'EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID veya Google yapılandırmasını kontrol et.'
                  : 'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID eksik. .env sonrası: npx expo start -c'}
              </Text>
            ) : null}
          </View>
        ) : null}

        {safeAccountStatus.isReady && !isGuest ? (
          <Text style={styles.secureFootnote}>Hesabın güvende · Bulut kaydı aktif</Text>
        ) : null}

        <View style={styles.dangerZone}>
          <Pressable
            style={styles.dangerToggle}
            onPress={() => setDangerExpanded((open) => !open)}
            accessibilityRole="button"
            accessibilityState={{ expanded: dangerExpanded }}
          >
            <Text style={styles.dangerTitle}>Tehlikeli İşlemler</Text>
            <Text style={styles.dangerChevron}>{dangerExpanded ? '▾' : '▸'}</Text>
          </Pressable>
          {dangerExpanded ? (
            <ActionButton
              label={
                isDeleting
                  ? 'Siliniyor...'
                  : isGuest
                    ? 'Misafir Kaydını Sil'
                    : 'Hesabı Sil'
              }
              onPress={handleDeleteAccount}
              variant="danger"
              compact
              disabled={isDeleting || !safeAccountStatus.isReady}
              style={styles.dangerButton}
            />
          ) : null}
        </View>

        {__DEV__ ? (
          <DeveloperCloudStatus
            status={cloudStatus}
            onManualSync={() => void handleManualSync()}
            onCheckCloud={() => void handleCheckCloud()}
            isManualSyncing={isManualSyncing}
            isChecking={isChecking}
          />
        ) : null}
      </View>
    </AppCard>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  cardGuest: {
    borderColor: 'rgba(245, 158, 11, 0.28)',
    backgroundColor: 'rgba(15, 23, 42, 0.98)',
  },
  cardLinked: {
    borderColor: 'rgba(34, 197, 94, 0.28)',
    backgroundColor: 'rgba(11, 18, 32, 0.98)',
  },
  cardInner: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  heroIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroIconWrapGuest: {
    backgroundColor: colors.warningSoft,
  },
  heroIconWrapLinked: {
    backgroundColor: colors.successSoft,
  },
  heroMain: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  heroTitle: {
    ...typography.cardTitle,
    fontSize: 16,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  heroSubtitle: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    lineHeight: 19,
  },
  statusPanel: {
    backgroundColor: colors.cardSoft,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    gap: 2,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: 6,
  },
  statusRowLabel: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    flex: 1,
  },
  linkButtons: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  primaryLinkButton: {
    alignSelf: 'stretch',
  },
  secureFootnote: {
    ...typography.caption,
    color: colors.success,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 2,
  },
  dangerZone: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  dangerToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  dangerTitle: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.35,
  },
  dangerChevron: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '700',
  },
  dangerButton: {
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
  },
  devHintText: {
    ...typography.caption,
    color: colors.textMuted,
    lineHeight: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  devSubtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    lineHeight: 16,
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  actionButton: {
    flexGrow: 1,
    minWidth: 140,
  },
  devPanel: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: 'rgba(245, 158, 11, 0.35)',
    gap: spacing.xs,
  },
  devTitle: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.accentAmber,
  },
  metaText: {
    ...typography.caption,
    color: colors.textMuted,
    fontFamily: 'monospace',
  },
});

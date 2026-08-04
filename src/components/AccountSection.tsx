/**
 * Şirket ekranı — Hesap / bulut kaydı (oyuncu yüzü).
 *
 * Cloud save arka planda otomatik çalışır.
 * Teknik sync / UID yalnızca __DEV__ panelinde görünür.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { AuthCredential } from 'firebase/auth';

import { useAppDialog } from './AppDialogProvider';
import BackendDiagnosticsPanel from './BackendDiagnosticsPanel';
import UsernameSetupModal from './username/UsernameSetupModal';
import { ActionButton, AppCard, AuthProviderButton, GameIcon, StatusBadge } from './ui';
import type { StatusBadgeVariant } from './ui';
import {
  fetchUsernameProfile,
  type UsernameProfile,
} from '../services/usernameService';
import {
  DEFAULT_ACCOUNT_STATUS,
  getAccountStatus,
  markAccountSwitchSyncing,
  linkAnonymousAccountWithApple,
  linkAnonymousAccountWithGoogle,
  beginGoogleAccountSwitchSelection,
  cancelPendingGoogleLinkConflict,
  linkSelectedGoogleAccountToGuest,
  retryProviderAccountLink,
  resetAccountSwitchTransition,
  signInSelectedGoogleAccountForNewGame,
  signOutGoogleAccountToGuest,
  subscribeAuthState,
  switchToLinkedProviderAccount,
  type AccountStatus,
} from '../services/authService';
import { setCloudSaveAccountConflictPending } from '../services/cloudSaveConflictState';
import { getFirebaseAuthSafe } from '../services/firebase';
import { isVehicleMarketplaceOperationActive } from '../services/vehicleMarketplaceService';
import { LEADERBOARD_ENABLED } from '../config/backendRoadmap';
import {
  configureGoogleSignIn,
} from '../services/googleAuthService';
import { isAppleSignInAvailable } from '../services/appleAuthService';
import { useGameStore } from '../store/gameStore';
import {
  checkCloudSaveMeta,
  getCloudSaveStatus,
  getCloudSaveStatusSubtitle,
  subscribeCloudSaveStatus,
  syncLocalSaveToCloud,
  resetCloudSaveSyncState,
  type CloudSaveStatusState,
} from '../storage/cloudSaveSync';
import {
  getAccountConnectionHeroCopy,
  getCloudSaveRowForConnectionState,
  resolveAccountConnectionState,
  type AccountConnectionState,
} from '../utils/accountConnectionState';
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
import {
  failureFromLinkError,
  formatAppleAuthDiagnosticDisplay,
  getAppleAuthDiagnosticFooter,
  isAppleAuthCancelFailure,
  isAppleExistingAccountConflictCode,
  normalizeAppleAuthFailure,
  type AppleAuthFailure,
} from '../utils/appleAuthDiagnostics';
import {
  beginCloudSaveConflictResolution,
  endCloudSaveConflictResolution,
  getCloudSaveConflictErrorMessage,
} from '../utils/cloudSaveConflict';
import {
  getAccountTransitionErrorMessage,
  isLocalSaveSafeForAccountTransition,
} from '../utils/accountTransition';
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

function formatLastSaveLabel(
  timestamp: number | null,
  connectionState: AccountConnectionState,
): string {
  if (connectionState === 'cloud-protected' && timestamp) {
    const delta = Date.now() - timestamp;
    if (delta < 60_000) {
      return 'Az önce';
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

  if (
    connectionState === 'linked-local-only' ||
    connectionState === 'sync-retry' ||
    connectionState === 'cloud-syncing' ||
    connectionState === 'error' ||
    !timestamp
  ) {
    return 'Henüz yok';
  }

  return 'Henüz kaydedilmedi';
}

function linkErrorMessage(error: string | undefined): string | null {
  if (
    !error ||
    error === 'cancelled' ||
    error === 'apple-signin-cancelled'
  ) {
    return null;
  }
  if (isAccountLinkConflictError(error)) {
    return null;
  }
  if (error === 'config-missing') {
    return 'Google girişi şu an yapılandırılamadı. Lütfen daha sonra tekrar dene.';
  }
  if (error === 'native-module-unavailable') {
    return 'Google girişi bu yapıda kullanılamıyor. Development build gerekir.';
  }
  if (error === 'apple-not-available' || error === 'apple-not-supported') {
    return 'Apple ile giriş bu cihazda kullanılamıyor.';
  }
  if (
    error === 'apple-token-missing' ||
    error === 'apple-missing-token' ||
    error === 'APPLE_IDENTITY_TOKEN_MISSING'
  ) {
    return "Apple'dan geçerli kimlik bilgisi alınamadı.";
  }
  if (error === 'apple-credential-invalid' || error === 'apple-credential-revoked') {
    return 'Apple oturumu geçersiz veya iptal edilmiş. Lütfen tekrar dene.';
  }
  if (error === 'provider-not-enabled' || error === 'auth/operation-not-allowed') {
    return 'Apple ile giriş şu anda yapılandırılamadı.';
  }
  if (
    error === 'auth/missing-or-invalid-nonce' ||
    error === 'auth/invalid-nonce' ||
    error === 'auth/invalid-credential'
  ) {
    return 'Apple kimliği doğrulanamadı. Tanı kodu: APPLE_AUTH_CONFIGURATION';
  }
  if (error === 'provider-already-linked' || error === 'already-linked') {
    return 'Bu hesaba zaten bir giriş yöntemi bağlı.';
  }
  if (error === 'auth/network-request-failed') {
    return 'İnternet bağlantısı kurulamadı. Tekrar deneyin.';
  }
  if (error === 'auth/internal-error') {
    return 'Giriş sırasında beklenmeyen bir hata oluştu. Lütfen tekrar dene.';
  }
  if (error === 'crypto-unavailable') {
    return 'Apple ile giriş için gerekli güvenlik modülü hazırlanamadı. Lütfen uygulamayı yeniden başlat.';
  }
  if (error === 'apple-token-missing') {
    return 'Apple kimlik belirteci alınamadı. Apple hesabını kontrol edip tekrar dene.';
  }
  if (error === 'provider-already-linked') {
    return 'Bu sağlayıcı zaten mevcut hesaba bağlı.';
  }
  if (error === 'DEVELOPER_ERROR' || error === '10') {
    return 'Google Sign-In yapılandırması hatalı (DEVELOPER_ERROR). Firebase SHA parmak izlerini kontrol et.';
  }
  if (error === 'auth/operation-not-allowed' || error === 'provider-not-enabled') {
    return 'Bu giriş yöntemi Firebase’de kapalı. Google / Anonymous provider’ı etkinleştir.';
  }
  if (error === 'auth/network-request-failed' || error === 'network-error') {
    return 'Ağ bağlantısı kurulamadı. Bağlantını kontrol edip tekrar dene.';
  }
  if (error === 'auth/credential-already-in-use' || error === 'credential-already-in-use') {
    return 'Bu Google hesabı başka bir oturuma bağlı.';
  }
  if (
    error === 'auth/account-exists-with-different-credential' ||
    error === 'account-exists-with-different-credential'
  ) {
    return 'Bu e-posta başka bir giriş yöntemiyle kayıtlı.';
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

export default function AccountSection({
  onOpenLeaderboard,
}: {
  onOpenLeaderboard?: () => void;
}) {
  const { alert: showAlert, showDialog, hideDialog } = useAppDialog();
  const [account, setAccount] = useState<AccountStatus>(DEFAULT_ACCOUNT_STATUS);
  const [cloudStatus, setCloudStatus] = useState<CloudSaveStatusState>(getCloudSaveStatus);
  const [isManualSyncing, setIsManualSyncing] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [isLinking, setIsLinking] = useState<'google' | 'apple' | null>(null);
  const [isResolvingConflict, setIsResolvingConflict] = useState(false);
  const [pendingAccountConflict, setPendingAccountConflict] = useState<{
    provider: 'google' | 'apple';
    credential: AuthCredential;
  } | null>(null);
  const conflictDebugLoggedRef = useRef(false);
  const conflictResolutionInFlightRef = useRef(false);
  const accountSwitchConflictRef = useRef(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSwitchingAccount, setIsSwitchingAccount] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [accountSettingsExpanded, setAccountSettingsExpanded] = useState(false);
  const [dangerExpanded, setDangerExpanded] = useState(false);
  const [appleAvailable, setAppleAvailable] = useState(false);
const [configHint, setConfigHint] = useState<string | null>(null);
  const [usernameProfile, setUsernameProfile] = useState<UsernameProfile | null>(null);
  const [usernameModal, setUsernameModal] = useState<'setup' | 'edit' | null>(null);
  const linkTapLock = useRef(false);
  const mountedRef = useRef(true);
  const deleteAccountAndCloudData = useGameStore((state) => state.deleteAccountAndCloudData);

  const refreshUsernameProfile = useCallback(async (openSetupIfNeeded: boolean) => {
    const result = await fetchUsernameProfile();
    if (!result.ok) {
      return;
    }
    setUsernameProfile(result.profile);
    if (openSetupIfNeeded && !result.profile.usernameSetupCompleted) {
      setUsernameModal('setup');
    }
  }, []);

  useEffect(() => {
    setCloudSaveAccountConflictPending(
      Boolean(pendingAccountConflict) || isResolvingConflict,
    );
    return () => setCloudSaveAccountConflictPending(false);
  }, [isResolvingConflict, pendingAccountConflict]);

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
    mountedRef.current = true;
    configureGoogleSignIn();
    refreshAccount();
    const unsubAuth = subscribeAuthState(() => {
      refreshAccount();
    });
    return () => {
      mountedRef.current = false;
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

  useEffect(() => {
    const linked =
      safeAccountStatus.isReady &&
      !safeAccountStatus.isAnonymous &&
      safeAccountStatus.provider !== 'guest';
    if (!linked) {
      setUsernameProfile(null);
      return;
    }
    void refreshUsernameProfile(true);
  }, [
    refreshUsernameProfile,
    safeAccountStatus.isAnonymous,
    safeAccountStatus.isReady,
    safeAccountStatus.provider,
  ]);

  const handleManualSync = async () => {
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

  const showAppleLinkFailure = (failure: AppleAuthFailure, fallbackError?: string) => {
    if (isAppleAuthCancelFailure(failure) || fallbackError === 'cancelled') {
      return;
    }
    // Conflict codes never become a generic modal — conflict dialog owns that path.
    if (
      isAppleExistingAccountConflictCode(failure.code) ||
      isAppleExistingAccountConflictCode(failure.firebaseCode) ||
      isAppleExistingAccountConflictCode(fallbackError)
    ) {
      return;
    }
    // Internal/TestFlight: stage + code always in the message body. Never drop real codes.
    showDialog({
      title: 'Hesap Bağlanamadı',
      message: formatAppleAuthDiagnosticDisplay(failure),
      variant: 'warning',
      footerNote: getAppleAuthDiagnosticFooter(failure),
      confirmLabel: 'Tamam',
    });
  };

  const resolveAppleFailure = (
    result: { error?: string; appleFailure?: AppleAuthFailure; errorKind?: string },
  ): AppleAuthFailure => {
    if (result.appleFailure) {
      return result.appleFailure;
    }
    return failureFromLinkError(
      result.error,
      isAppleExistingAccountConflictCode(result.error) ? 'cloud-conflict' : 'anonymous-link-failure',
    );
  };

  const handleLink = async (provider: 'google' | 'apple') => {
    if (isLinking || isResolvingConflict || isSwitchingAccount || linkTapLock.current) {
      return;
    }
    linkTapLock.current = true;

    setIsLinking(provider);
    setConfigHint(null);
    try {
      const result =
        provider === 'google'
          ? await linkAnonymousAccountWithGoogle({ forceInteractivePicker: true })
          : await linkAnonymousAccountWithApple();

      if (!mountedRef.current) {
        return;
      }

      refreshAccount();
      refreshCloudStatus();

      if (result.ok) {
if (result.cloudSyncOk) {
          showAlert('Hesap bağlandı', 'İlerlemen bulut kaydıyla korunuyor.');
        } else {
          showAlert(
            'Hesap bağlandı',
            'Hesabın bağlandı. İlk bulut kaydı yeniden denenecek.',
          );
        }
        await refreshUsernameProfile(true);
        return;
      }

      if (isAccountLinkConflictError(result.error, result.errorKind)) {
        if (provider === 'apple') {
          const conflictFailure = resolveAppleFailure(result);
          showDialog({
            title: getAccountLinkConflictTitle(provider),
            message: getAccountLinkConflictMessage(provider),
            footerNote: [
              getAccountLinkConflictFooter(provider),
              '',
              `Tanı:`,
              `stage=${conflictFailure.stage}`,
              `code=${conflictFailure.firebaseCode || conflictFailure.code}`,
            ].join('\n'),
            variant: 'warning',
            actions: [
              {
                label: 'Apple Kaydına Geç',
                variant: 'primary',
                onPress: () => showSwitchConfirmDialog(provider, result.pendingCredential ?? null),
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
          return;
        }
        showAccountConflictDialog(provider, result.pendingCredential ?? null);
        return;
      }

      if (result.error === 'cancelled') {
        // Picker iptali: anonymous + local save korunur; loading finally ile kapanır.
        return;
      }

      if (
        result.error === 'config-missing' ||
        result.error === 'native-module-unavailable'
      ) {
        setConfigHint(linkErrorMessage(result.error));
      }

      if (provider === 'apple') {
        showAppleLinkFailure(resolveAppleFailure(result), result.error);
        return;
      }

      const message = linkErrorMessage(result.error);
      if (message) {
        showAlert('Hesap Bağlanamadı', message);
      }
    } catch (error) {
      console.warn('[account] link failed', error);
      if (!mountedRef.current) {
        return;
      }
      if (provider === 'apple') {
        showAppleLinkFailure(
          normalizeAppleAuthFailure(error, 'anonymous-link-failure'),
          'apple-sign-in-failed',
        );
        return;
      }
      showAlert('Hesap Bağlanamadı', getAccountLinkGeneralErrorMessage());
    } finally {
      if (mountedRef.current) {
        setIsLinking(null);
      }
      linkTapLock.current = false;
    }
  };

  const handleCancelGoogleLinkConflict = async () => {
    setPendingAccountConflict(null);
    setIsResolvingConflict(false);
    setIsLinking(null);
    setCloudSaveAccountConflictPending(false);
    accountSwitchConflictRef.current = false;
    endCloudSaveConflictResolution(conflictResolutionInFlightRef);
    hideDialog();
    await cancelPendingGoogleLinkConflict();
    refreshAccount();
  };

  const handleSelectDifferentGoogleAccount = async () => {
    if (isLinking || isResolvingConflict) {
      return;
    }
    setPendingAccountConflict(null);
    setIsResolvingConflict(false);
    setCloudSaveAccountConflictPending(false);
    accountSwitchConflictRef.current = false;
    endCloudSaveConflictResolution(conflictResolutionInFlightRef);
    hideDialog();
    await cancelPendingGoogleLinkConflict();
    // Interactive picker’ı yeniden aç; yeni hesapta conflict kontrolü tekrar çalışır.
    await handleLink('google');
  };

  const handleSwitchToProviderAccount = async (
    provider: 'google' | 'apple',
    pendingCredential: AuthCredential | null,
  ) => {
    if (!beginCloudSaveConflictResolution(conflictResolutionInFlightRef)) {
      showAlert(
        'Kayıt işlemi devam ediyor',
        getCloudSaveConflictErrorMessage('already-resolving'),
      );
      return;
    }
    if (!pendingCredential || pendingAccountConflict?.provider !== provider) {
      endCloudSaveConflictResolution(conflictResolutionInFlightRef);
      showAlert(
        'Kayıt kullanılamıyor',
        getCloudSaveConflictErrorMessage('missing-conflict'),
      );
      return;
    }

    const providerLabel = provider === 'google' ? 'Google' : 'Apple';
    setIsResolvingConflict(true);
    setIsLinking(provider);
    const debugEnabled =
      __DEV__ &&
      process.env.EXPO_PUBLIC_DEBUG_CLOUD_SAVE_CONFLICT === '1';
    if (debugEnabled && !conflictDebugLoggedRef.current) {
      conflictDebugLoggedRef.current = true;
      console.log('[cloud-save-conflict-action]', {
        action: 'use-google-save',
        pressed: true,
        selectedAccountUid: null,
        hasCloudSave: cloudStatus.restoreCandidate?.hasCandidate === true,
        isResolving: isResolvingConflict,
        modalVisible: true,
      });
    }
    showDialog({
      title: `${providerLabel} kaydına geçiliyor`,
      message: 'Bulut kaydı doğrulanıyor ve güvenli şekilde hazırlanıyor.',
      footerNote: 'Mevcut misafir kaydın doğrulama tamamlanmadan değiştirilmez.',
      variant: 'info',
      actions: [
        {
          label: `${providerLabel} Kaydına Geçiliyor...`,
          variant: 'primary',
          loading: true,
          disabled: true,
          onPress: () => {},
        },
        {
          label: 'Misafir Kaydıyla Devam Et',
          variant: 'secondary',
          disabled: true,
          onPress: () => {},
        },
        {
          label: 'Farklı Hesap Dene',
          variant: 'secondary',
          disabled: true,
          onPress: () => {},
        },
      ],
    });

    try {
      const result = await switchToLinkedProviderAccount(pendingCredential, provider);
      if (!mountedRef.current) {
        return;
      }
      refreshAccount();
      refreshCloudStatus();
      if (result.ok) {
        setPendingAccountConflict(null);
        accountSwitchConflictRef.current = false;
        hideDialog();
        showAlert(
          `${providerLabel} kaydına geçildi`,
          'Hesabına bağlı oyun kaydı yüklendi.',
        );
        useGameStore.setState({
          navigationRequest: { tab: 'dashboard' },
        });
        return;
      }
      showAccountConflictDialog(
        provider,
        pendingCredential,
        getCloudSaveConflictErrorMessage(result.error),
      );
    } catch (error) {
      console.warn('[account] switch to linked account failed', error);
      if (mountedRef.current) {
        showAccountConflictDialog(
          provider,
          pendingCredential,
          getCloudSaveConflictErrorMessage('unknown'),
        );
      }
    } finally {
      endCloudSaveConflictResolution(conflictResolutionInFlightRef);
      setIsResolvingConflict(false);
      if (mountedRef.current) {
        setIsLinking(null);
      }
    }
  };

  const showSwitchConfirmDialog = (
    provider: 'google' | 'apple',
    pendingCredential: AuthCredential | null,
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
    pendingCredential: AuthCredential | null,
    errorMessage?: string,
    fromAccountSwitch = accountSwitchConflictRef.current,
  ) => {
    accountSwitchConflictRef.current = fromAccountSwitch;
    setPendingAccountConflict({ provider, credential: pendingCredential });
    const switchLabel = 'Bulut Kaydı';
    const showComparison = () => {
      const local = cloudStatus.restoreCandidate?.localSummary;
      const cloud = cloudStatus.restoreCandidate?.cloudSummary;
      const format = (label: string, value: unknown) => `${label}: ${String(value ?? '—')}`;
      showDialog({
        title: 'Kayıtları Karşılaştır',
        message: [
          'BU CİHAZ',
          format('Seviye', local?.level),
          format('XP', local?.xp),
          format('Nakit', local?.money),
          format('Kamyon', local?.trucksCount),
          format('Depo', local?.warehousesCount),
          '',
          'BULUT',
          format('Seviye', cloud?.level),
          format('XP', cloud?.xp),
          format('Nakit', cloud?.money),
          format('Kamyon', cloud?.trucksCount),
          format('Depo', cloud?.warehousesCount),
        ].join('\n'),
        variant: 'info',
        confirmLabel: 'Geri',
        onConfirm: () =>
          showAccountConflictDialog(
            provider,
            pendingCredential,
            errorMessage,
            fromAccountSwitch,
          ),
      });
    };
    showDialog({
      title: getAccountLinkConflictTitle(provider),
      message: errorMessage
        ? `${errorMessage}\n\n${getAccountLinkConflictMessage(provider)}`
        : getAccountLinkConflictMessage(provider),
      footerNote: getAccountLinkConflictFooter(provider),
      variant: 'warning',
      actions: [
        {
          label: switchLabel,
          variant: 'primary',
          onPress: () => {
            void handleSwitchToProviderAccount(provider, pendingCredential);
          },
        },
        {
          label: 'Bu Cihazdaki Kayıt',
          variant: 'secondary',
          onPress: () => {
            setPendingAccountConflict(null);
            if (fromAccountSwitch && provider === 'google') {
              void completeNewGoogleAccountChoice(pendingCredential, true);
            }
          },
        },
        {
          label: 'Detayları Karşılaştır',
          variant: 'secondary',
          onPress: showComparison,
        },
        ...(provider === 'google'
          ? [
              {
                label: 'Farklı Hesap Seç',
                variant: 'secondary' as const,
                onPress: () => {
                  void handleSelectDifferentGoogleAccount();
                },
              },
            ]
          : []),
        {
          label: 'Vazgeç',
          variant: 'secondary',
          onPress: () => {
            if (provider === 'google') {
              void handleCancelGoogleLinkConflict();
            } else {
              setPendingAccountConflict(null);
              hideDialog();
            }
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
      if (!mountedRef.current) {
        return;
      }
      refreshAccount();
      refreshCloudStatus();

      if (result.ok) {
        if (result.cloudSyncOk) {
          showAlert('Hesap bağlandı', 'İlerlemen bulut kaydıyla korunuyor.');
        } else {
          showAlert(
            'Hesap bağlandı',
            'Hesabın bağlandı. İlk bulut kaydı yeniden denenecek.',
          );
        }
        return;
      }

      if (isAccountLinkConflictError(result.error, result.errorKind)) {
        showAccountConflictDialog(provider, result.pendingCredential ?? null);
        return;
      }

      if (provider === 'apple') {
        showAppleLinkFailure(resolveAppleFailure(result), result.error);
        return;
      }

      const message = linkErrorMessage(result.error);
      if (message) {
        showAlert('Hesap Bağlanamadı', message);
      }
    } catch (error) {
      console.warn('[account] retry link failed', error);
      if (!mountedRef.current) {
        return;
      }
      if (provider === 'apple') {
        showAppleLinkFailure(normalizeAppleAuthFailure(error, 'anonymous-link-failure'));
        return;
      }
      showAlert('Hesap Bağlanamadı', getAccountLinkGeneralErrorMessage());
    } finally {
      if (mountedRef.current) {
        setIsLinking(null);
      }
    }
  };

  const syncBeforeAccountTransition = async (): Promise<boolean> => {
    const state = useGameStore.getState();
    if (!isLocalSaveSafeForAccountTransition(state)) return false;
    await state.saveGame();
    return syncLocalSaveToCloud('manual', {
      force: true,
      state: useGameStore.getState(),
    });
  };

  const clearAccountScopedClientState = () => {
    setPendingAccountConflict(null);
    setIsResolvingConflict(false);
    setCloudSaveAccountConflictPending(false);
    accountSwitchConflictRef.current = false;
    resetCloudSaveSyncState();
    useGameStore.setState({
      vehicleMarketplace: {
        activeMarketplaceListingIds: [],
        soldTruckIds: [],
      },
      notifications: [],
      navigationRequest: null,
      pendingMarketplaceSellTruckId: null,
    });
  };

  const completeNewGoogleAccountChoice = (
    credential: AuthCredential,
    useLocalProgress: boolean,
  ) => {
    void (async () => {
      setIsSwitchingAccount(true);
      try {
        if (useLocalProgress) {
          const linked = await linkSelectedGoogleAccountToGuest(credential);
          if (
            !linked.ok &&
            isAccountLinkConflictError(linked.error, linked.errorKind) &&
            linked.pendingCredential
          ) {
            showAccountConflictDialog('google', linked.pendingCredential);
            return;
          }
          if (!linked.ok) {
            showAlert(
              'Hesap Bağlanamadı',
              getAccountTransitionErrorMessage('network-error'),
            );
            return;
          }
        } else {
          const signedIn = await signInSelectedGoogleAccountForNewGame(
            credential,
          );
          if (!signedIn.ok) {
            showAlert(
              'Yeni oyun başlatılamadı',
              getAccountTransitionErrorMessage(signedIn.error),
            );
            return;
          }
          await useGameStore.getState().clearSave();
          await useGameStore.getState().saveGame();
          const synced = await syncLocalSaveToCloud('manual', {
            force: true,
            state: useGameStore.getState(),
          });
          if (!synced) {
            showAlert(
              'Bulut kaydı tamamlanamadı',
              getAccountTransitionErrorMessage('cloud-sync-failed'),
            );
            return;
          }
        }
        refreshAccount();
        refreshCloudStatus();
        showAlert(
          'Hesap değiştirildi',
          useLocalProgress
            ? 'Bu cihazdaki ilerleme seçtiğin Google hesabına bağlandı.'
            : 'Seçtiğin Google hesabında yeni oyun başlatıldı.',
        );
      } finally {
        setIsSwitchingAccount(false);
      }
    })();
  };

  const executeAccountSwitch = async () => {
    if (isSwitchingAccount) return;
    if (isVehicleMarketplaceOperationActive()) {
      showAlert(
        'Hesap değiştirilemedi',
        getAccountTransitionErrorMessage('marketplace-operation-active'),
      );
      return;
    }
    setIsSwitchingAccount(true);
    showDialog({
      title: 'Hesap değiştiriliyor',
      message: 'Mevcut ilerleme doğrulanıyor ve buluta kaydediliyor.',
      variant: 'info',
      actions: [
        {
          label: 'Kaydediliyor...',
          variant: 'primary',
          loading: true,
          disabled: true,
          onPress: () => {},
        },
      ],
    });
    try {
      markAccountSwitchSyncing();
      const synced = await syncBeforeAccountTransition();
      if (!synced) {
        showAlert(
          'Hesap değişikliği iptal edildi',
          getAccountTransitionErrorMessage('cloud-sync-failed'),
        );
        return;
      }
      const selection = await beginGoogleAccountSwitchSelection();
      if (!selection.ok) {
        refreshAccount();
        showAlert(
          'Hesap değiştirilemedi',
          getAccountTransitionErrorMessage(selection.error),
        );
        return;
      }
      clearAccountScopedClientState();
      refreshAccount();
      if (selection.hasCloudSave) {
        showAccountConflictDialog(
          'google',
          selection.credential,
          undefined,
          true,
        );
        return;
      }
      showDialog({
        title: 'Yeni Google Hesabı',
        message: 'Bu Google hesabında bulut kaydı bulunmuyor. Nasıl devam etmek istersin?',
        footerNote: 'Yerel ilerleme seçimin olmadan yeni hesaba aktarılmaz.',
        variant: 'confirm',
        actions: [
          {
            label: 'Bu İlerlemeyi Yeni Hesaba Bağla',
            variant: 'primary',
            onPress: () =>
              completeNewGoogleAccountChoice(selection.credential, true),
          },
          {
            label: 'Yeni Oyun Başlat',
            variant: 'secondary',
            onPress: () =>
              completeNewGoogleAccountChoice(selection.credential, false),
          },
          {
            label: 'Vazgeç',
            variant: 'secondary',
            onPress: () => {},
          },
        ],
      });
    } finally {
      setIsSwitchingAccount(false);
      if (!accountSwitchConflictRef.current) {
        resetAccountSwitchTransition();
      }
    }
  };

  const handleAccountSwitch = () => {
    const user = getFirebaseAuthSafe()?.currentUser;
    showDialog({
      title: 'Hesap Değiştir',
      message:
        'Mevcut ilerlemen buluta kaydedildikten sonra farklı bir Google hesabıyla giriş yapabilirsin.',
      details: [
        {
          label: 'Mevcut hesap',
          value: user?.email ?? user?.displayName ?? 'Google hesabı',
        },
        {
          label: 'Son bulut kayıt zamanı',
          value: formatLastSaveLabel(cloudStatus.lastSyncAt),
        },
        {
          label: 'Bulut kayıt durumu',
          value: getCloudSaveUserStatus(cloudStatus).label,
        },
      ],
      variant: 'confirm',
      cancelLabel: 'Vazgeç',
      confirmLabel: 'Kaydet ve Hesap Değiştir',
      onConfirm: () => void executeAccountSwitch(),
    });
  };

  const executeGoogleSignOut = async () => {
    if (isSigningOut) return;
    if (isVehicleMarketplaceOperationActive()) {
      showAlert(
        'Çıkış yapılamadı',
        getAccountTransitionErrorMessage('marketplace-operation-active'),
      );
      return;
    }
    setIsSigningOut(true);
    try {
      if (!(await syncBeforeAccountTransition())) {
        showAlert(
          'Çıkış iptal edildi',
          getAccountTransitionErrorMessage('cloud-sync-failed'),
        );
        return;
      }
      const result = await signOutGoogleAccountToGuest();
      if (!result.ok) {
        showAlert(
          'Çıkış yapılamadı',
          getAccountTransitionErrorMessage(result.error),
        );
        return;
      }
      clearAccountScopedClientState();
      refreshAccount();
      refreshCloudStatus();
      showAlert(
        'Çıkış yapıldı',
        'Çıkış yaptın. Bu cihazdaki misafir kayıt korunuyor.',
      );
    } finally {
      setIsSigningOut(false);
    }
  };

  const handleGoogleSignOut = () => {
    showDialog({
      title: 'Hesaptan Çıkış Yap',
      message:
        'Önce ilerlemen buluta kaydedilecek. Bu cihazdaki oyun kaydı silinmeyecek.',
      variant: 'warning',
      cancelLabel: 'Vazgeç',
      confirmLabel: 'Kaydet ve Çıkış Yap',
      onConfirm: () => void executeGoogleSignOut(),
    });
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
  const connectionState = resolveAccountConnectionState({
    authReady: safeAccountStatus.isReady,
    isAnonymous: safeAccountStatus.isAnonymous,
    provider: safeAccountStatus.provider,
    isLinking: Boolean(isLinking),
    hasConflict: false,
    cloudStatus: cloudStatus.status,
    lastCloudSaveAt: cloudStatus.lastSyncAt,
    lastCloudErrorCode: cloudStatus.lastErrorCode,
  });
  const heroCopy = getAccountConnectionHeroCopy(connectionState);
  const cloudRow = getCloudSaveRowForConnectionState(connectionState);
  const cardVariant = isGuest ? 'guest' : 'linked';
const showManualCloudSave =
    !isGuest &&
    (connectionState === 'sync-retry' ||
      connectionState === 'linked-local-only' ||
      connectionState === 'error');

  const handleManualCloudSave = async () => {
    if (isManualSyncing) return;
    const state = useGameStore.getState();
    setIsManualSyncing(true);
    try {
      const ok = await syncLocalSaveToCloud('manual', { force: true, state });
      refreshCloudStatus();
      if (ok) {
        showAlert('Bulut kaydı', 'Kayıt başarıyla doğrulandı.');
      } else {
        showAlert(
          'Bulut kaydı',
          'Kayıt şu an tamamlanamadı. Yeniden denenecek.',
        );
      }
    } finally {
      if (mountedRef.current) {
        setIsManualSyncing(false);
      }
    }
  };

  const providerLabel =
    safeAccountStatus.provider === 'apple'
      ? 'Apple'
      : safeAccountStatus.provider === 'google'
        ? 'Google'
        : 'Bağlı';
  const usernameLabel = usernameProfile?.username?.trim() || null;
  const avatarLetter = (usernameLabel ?? providerLabel).charAt(0).toUpperCase();
  const leaderboardStatus = isGuest
    ? 'Hesap bağlanınca aktif'
    : usernameProfile?.usernameSetupCompleted
      ? 'Aktif'
      : 'Kullanıcı adı gerekli';

  return (
    <>
    <AppCard
      style={[styles.card, cardVariant === 'linked' ? styles.cardLinked : styles.cardGuest]}
      padded={false}
    >
      <View style={styles.cardInner}>
        <View style={styles.heroRow}>
          <View
            style={[
              styles.heroIconWrap,
              connectionState === 'cloud-protected'
                ? styles.heroIconWrapLinked
                : styles.heroIconWrapGuest,
            ]}
          >
{cardVariant === 'linked' ? (
              <Text style={styles.avatarLetter}>{avatarLetter}</Text>
            ) : (
              <GameIcon name="warning" size={20} color={colors.accentAmber} />
            )}
          </View>
          <View style={styles.heroMain}>
            {!safeAccountStatus.isReady ? (
              <>
                <Text style={styles.heroTitle}>Hesap kontrol ediliyor...</Text>
                <Text style={styles.heroSubtitle}>Oturum bilgisi yükleniyor.</Text>
              </>
) : isGuest ? (
              <>
                <Text style={styles.heroTitle}>{heroCopy.title}</Text>
                <Text style={styles.heroSubtitle}>{heroCopy.subtitle}</Text>
              </>
            ) : (
              <>
                <Text style={styles.heroTitle} numberOfLines={1}>
                  {usernameLabel ?? 'Hesap bağlı'}
                </Text>
                <Text style={styles.heroSubtitle} numberOfLines={1}>
                  {providerLabel} · Bulut kaydı aktif
                </Text>
              </>
            )}
          </View>
          {safeAccountStatus.isReady && !isGuest ? (
            <StatusBadge label={providerLabel} variant="success" size="sm" />
          ) : null}
        </View>

        {safeAccountStatus.isReady && !isGuest && !usernameProfile?.usernameSetupCompleted ? (
          <View style={styles.usernameSetupCard}>
            <View style={styles.usernameSetupCopy}>
              <Text style={styles.usernameSetupTitle}>Kullanıcı adını belirle</Text>
              <Text style={styles.usernameSetupDescription}>
                Liderlik Tablosu ve Araç Pazarı için görünen adını oluştur.
              </Text>
            </View>
            <ActionButton
              label="Kullanıcı Adı Oluştur"
              onPress={() => setUsernameModal('setup')}
              variant="primary"
              compact
            />
          </View>
        ) : null}

        {safeAccountStatus.isReady ? (
          <View style={styles.statusPanel}>
            <AccountStatusRow
              label="Hesap bağlantısı"
              value={isGuest ? 'Misafir' : 'Bağlı'}
              badgeVariant={isGuest ? 'muted' : 'success'}
            />
            <AccountStatusRow
              label="Bulut Kaydı"
              value={cloudRow.label}
              badgeVariant={cloudRow.variant}
            />
            <AccountStatusRow
              label="Son başarılı kayıt"
              value={formatLastSaveLabel(cloudStatus.lastSyncAt, connectionState)}
              badgeVariant="muted"
            />
            {LEADERBOARD_ENABLED ? (
              <AccountStatusRow
                label="Liderlik Tablosu"
                value={leaderboardStatus}
                badgeVariant={
                  !isGuest && usernameProfile?.usernameSetupCompleted ? 'success' : 'muted'
                }
              />
            ) : null}
          </View>
        ) : null}

        {LEADERBOARD_ENABLED && onOpenLeaderboard ? (
          <Pressable
            style={styles.leaderboardEntry}
            onPress={onOpenLeaderboard}
            accessibilityRole="button"
            accessibilityLabel="Liderlik Tablosunu aç"
          >
            <View style={styles.leaderboardEntryIcon}>
              <GameIcon name="trophy" size={17} color={colors.accentAmber} />
            </View>
            <View style={styles.leaderboardEntryCopy}>
              <Text style={styles.leaderboardEntryTitle}>Liderlik Tablosu</Text>
              <Text style={styles.leaderboardEntrySubtitle} numberOfLines={1}>
                {isGuest
                  ? 'Katılmak için hesabını bağla'
                  : usernameProfile?.usernameSetupCompleted
                    ? 'Haftalık şirket sıralamanı gör'
                    : 'Katılmak için kullanıcı adını oluştur'}
              </Text>
            </View>
            <GameIcon name="chevronRight" size={18} color={colors.textMuted} />
          </Pressable>
        ) : null}

        {safeAccountStatus.isReady && isGuest ? (
          <View style={styles.linkButtons}>
            {showGoogle ? (
              <AuthProviderButton
                provider="google"
                label="Google ile Devam Et"
                onPress={() => void handleLink('google')}
                variant="primary"
                disabled={Boolean(isLinking)}
                loading={isLinking === 'google'}
                style={[styles.authButton, styles.primaryLinkButton]}
              />
            ) : null}
            {showApple ? (
              <AuthProviderButton
                provider="apple"
                label="Apple ile Devam Et"
                onPress={() => void handleLink('apple')}
                variant="secondary"
                disabled={Boolean(isLinking)}
                loading={isLinking === 'apple'}
                style={[styles.authButton, styles.appleLinkButton]}
              />
            ) : null}
            {configHint ? <Text style={styles.configHintText}>{configHint}</Text> : null}
          </View>
        ) : null}

{showManualCloudSave ? (
          <ActionButton
            label={isManualSyncing ? 'Kaydediliyor...' : 'Şimdi Kaydet'}
            onPress={() => void handleManualCloudSave()}
            variant="secondary"
            disabled={isManualSyncing || Boolean(isLinking)}
            fullWidth
            style={styles.manualSaveButton}
          />
        ) : null}

        {safeAccountStatus.isReady && !isGuest ? (
          <View style={styles.linkedActions}>
            <View style={styles.primaryActionRow}>
              <ActionButton
                label={usernameProfile?.usernameSetupCompleted ? 'Kullanıcı Adını Düzenle' : 'Kullanıcı Adı Oluştur'}
                onPress={() => setUsernameModal(usernameProfile?.usernameSetupCompleted ? 'edit' : 'setup')}
                variant="secondary"
                compact
                style={styles.primaryAccountAction}
              />
              <ActionButton
                label={isManualSyncing ? 'Senkronize ediliyor…' : 'Senkronize Et'}
                onPress={() => void handleManualCloudSave()}
                variant="primary"
                compact
                disabled={isManualSyncing || isChecking}
                style={styles.primaryAccountAction}
              />
            </View>

            <View style={styles.accountSettings}>
              <Pressable
                style={styles.accountSettingsToggle}
                onPress={() => setAccountSettingsExpanded((open) => !open)}
                accessibilityRole="button"
                accessibilityState={{ expanded: accountSettingsExpanded }}
              >
                <Text style={styles.accountSettingsTitle}>Hesap Ayarları</Text>
                <GameIcon
                  name={accountSettingsExpanded ? 'chevronUp' : 'chevronDown'}
                  size={16}
                  color={colors.textMuted}
                />
              </Pressable>
              {accountSettingsExpanded ? (
                <View style={styles.accountSettingsActions}>
                  <ActionButton
                    label={isChecking ? 'Kontrol ediliyor…' : 'Bulut Kaydını Kontrol Et'}
                    onPress={() => void handleCheckCloud()}
                    variant="secondary"
                    compact
                    disabled={isManualSyncing || isChecking}
                  />
                  {safeAccountStatus.provider === 'google' ? (
                    <ActionButton
                      label={isSwitchingAccount ? 'Hesap değiştiriliyor…' : 'Hesap Değiştir'}
                      onPress={handleAccountSwitch}
                      variant="secondary"
                      compact
                      disabled={isSwitchingAccount || isSigningOut || isDeleting}
                    />
                  ) : null}
                  <ActionButton
                    label={isSigningOut ? 'Çıkış yapılıyor…' : 'Çıkış Yap'}
                    onPress={handleGoogleSignOut}
                    variant="secondary"
                    compact
                    disabled={isSwitchingAccount || isSigningOut || isDeleting}
                  />
                </View>
              ) : null}
            </View>
          </View>

        {safeAccountStatus.isReady && !isGuest && heroCopy.footnote ? (
          <Text
            style={[
              styles.secureFootnote,
              heroCopy.footnoteTone === 'amber' && styles.secureFootnoteAmber,
            ]}
          >
            {heroCopy.footnote}
          </Text>
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
            <View style={styles.dangerActions}>
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
                disabled={
                  isDeleting ||
                  isSwitchingAccount ||
                  isSigningOut ||
                  !safeAccountStatus.isReady
                }
                style={styles.dangerButton}
              />
            </View>
          ) : null}
        </View>
      </View>
    </AppCard>
    <BackendDiagnosticsPanel />
    <UsernameSetupModal
      visible={usernameModal != null}
      mode={usernameModal === 'edit' ? 'edit' : 'setup'}
      initialUsername={usernameProfile?.username}
      suggestedUsername={usernameProfile?.suggestedUsername}
      nextChangeAvailableAtMs={usernameProfile?.nextChangeAvailableAtMs}
      onClose={() => setUsernameModal(null)}
      onSaved={(username) => {
        setUsernameProfile((prev) =>
          prev
            ? {
                ...prev,
                username,
                usernameSetupCompleted: true,
              }
            : {
                username,
                usernameSetupCompleted: true,
                usernameChangeCount: 0,
                usernameUpdatedAtMs: Date.now(),
                suggestedUsername: username,
                nextChangeAvailableAtMs: Date.now() + 30 * 24 * 60 * 60 * 1000,
              },
        );
        void refreshUsernameProfile(false);
      }}
    />
    </>
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
  leaderboardEntry: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 170, 0, 0.32)',
    backgroundColor: 'rgba(255, 170, 0, 0.06)',
  },
  leaderboardEntryIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.amberSoft,
  },
  leaderboardEntryCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  leaderboardEntryTitle: {
    ...typography.bodySmall,
    color: colors.textPrimary,
    fontWeight: '800',
  },
  leaderboardEntrySubtitle: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  linkButtons: {
    gap: 13,
    marginTop: spacing.xs,
  },
configHintText: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 16,
    marginTop: 2,
    paddingHorizontal: spacing.xs,
  },
  authButton: {
    alignSelf: 'stretch',
    minHeight: 56,
  },
  primaryLinkButton: {
    alignSelf: 'stretch',
  },
  appleLinkButton: {
    alignSelf: 'stretch',
    backgroundColor: 'rgba(8, 20, 38, 0.98)',
    borderWidth: 1,
    borderColor: 'rgba(35, 136, 255, 0.55)',
  },
  linkedActions: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  primaryActionRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: spacing.sm,
  },
  primaryAccountAction: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
  },
  usernameSetupCard: {
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 170, 0, 0.42)',
    backgroundColor: colors.amberSoft,
  },
  usernameSetupCopy: {
    gap: 3,
  },
  usernameSetupTitle: {
    ...typography.bodySmall,
    color: colors.textPrimary,
    fontWeight: '800',
  },
  usernameSetupDescription: {
    ...typography.caption,
    color: colors.textSecondary,
    lineHeight: 16,
  },
  accountSettings: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cardSoft,
    overflow: 'hidden',
  },
  accountSettingsToggle: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
  },
  accountSettingsTitle: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  accountSettingsActions: {
    gap: spacing.sm,
    padding: spacing.sm,
    paddingTop: 0,
  },
  avatarLetter: {
    color: colors.success,
    fontWeight: '800',
    fontSize: 16,
  },
  secureFootnoteAmber: {
    color: colors.accentAmber,
  },
  manualSaveButton: {
    marginTop: 2,
  },
  dangerZone: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  dangerActions: {
    gap: spacing.sm,
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

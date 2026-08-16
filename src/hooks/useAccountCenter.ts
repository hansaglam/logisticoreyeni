/**
 * Şirket ekranı — Hesap / bulut kaydı (oyuncu yüzü).
 *
 * Cloud save arka planda otomatik çalışır.
 * Teknik sync / UID yalnızca __DEV__ panelinde görünür.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import type { AuthCredential } from 'firebase/auth';
import type { ProviderAccountSaveOutcome } from '../services/accountCloudLogin';
import { useAppDialog } from '../components/AppDialogProvider';
import type { StatusBadgeVariant } from '../components/ui';
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
  retryProviderAccountLink,
  signOutGoogleAccountToGuest,
  subscribeAuthState,
  resetAccountSwitchTransition,
  getCurrentUserId,
  reauthenticateCurrentUser,
  type AccountStatus,
} from '../services/authService';
import {
  commitAccountSwitch,
  finalizeAccountSwitchJournal,
  isAccountSwitchRecoveryRequired,
  rollbackAccountSwitch,
} from '../services/accountSwitchService';
import { setCloudSaveAccountConflictPending } from '../services/cloudSaveConflictState';
import {
  resolveSaveConflict,
  retryPostSignInSaveFlow,
} from '../services/accountCloudLogin';
import {
  clearAccountSaveConflictSession,
  completeAccountSaveConflictSession,
  ensureAccountSaveConflictSession,
  getAccountSaveConflictSession,
  beginConflictResolveRequest,
  isConflictResolveRequestCurrent,
  releaseConflictResolveRequest,
  setAccountSaveConflictError,
} from '../services/accountSaveConflictSession';
import { getFirebaseAuthSafe } from '../services/firebase';
import { isVehicleMarketplaceOperationActive } from '../services/vehicleMarketplaceService';
import { ensureAuthoritativeFleetReady } from '../services/serverStateMigrationService';
import { LEADERBOARD_ENABLED } from '../config/backendRoadmap';
import {
  configureGoogleSignIn,
  isGoogleSignInConfigured,
} from '../services/googleAuthService';
import { isAppleSignInAvailable } from '../services/appleAuthService';
import { useGameStore } from '../store/gameStore';
import {
  checkCloudSaveMeta,
  getCloudSaveStatus,
  subscribeCloudSaveStatus,
  syncLocalSaveToCloud,
  resetCloudSaveSyncState,
  buildCloudSaveSummaryForState,
  type CloudSaveStatusState,
} from '../storage/cloudSaveSync';
import { saveGameState } from '../storage/saveGame';
import {
  getAccountDeletionErrorMessage,
  type AccountDeletionErrorCode,
} from '../utils/accountDeletion';
import { logAccountSignOut } from '../utils/accountLifecycleLog';
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
  isPermanentCloudSaveConflictReason,
  isRetryableCloudSaveConflictReason,
  type CloudSaveConflictReason,
} from '../utils/cloudSaveConflict';
import {
  getAccountTransitionErrorMessage,
  isLocalSaveSafeForAccountTransition,
} from '../utils/accountTransition';

export type AccountCenterTab = 'profile' | 'account' | 'preferences';

export function getStatusBadgeVariant(
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

export function formatLastSaveLabel(timestamp: number | null): string {
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

export function getCloudSaveUserStatus(status: CloudSaveStatusState): {
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

export function linkErrorMessage(error: string | undefined): string | null {
  if (!error || error === 'cancelled' || error === 'apple-signin-cancelled') {
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

export function useAccountCenter({
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
    authenticatedUid: string;
    errorReason?: CloudSaveConflictReason;
    cloudDisabled?: boolean;
  } | null>(null);
  const conflictResolutionInFlightRef = useRef(false);
  const accountSwitchConflictRef = useRef(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSwitchingAccount, setIsSwitchingAccount] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [accountSettingsExpanded, setAccountSettingsExpanded] = useState(false);
  const [dangerExpanded, setDangerExpanded] = useState(false);
  const [googleConfigured, setGoogleConfigured] = useState(() => isGoogleSignInConfigured());
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [usernameProfile, setUsernameProfile] = useState<UsernameProfile | null>(null);
  const [usernameModal, setUsernameModal] = useState<'setup' | 'edit' | null>(null);
  const linkTapLock = useRef(false);
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
    const pending =
      Boolean(pendingAccountConflict) ||
      isResolvingConflict ||
      getAccountSaveConflictSession() != null;
    setCloudSaveAccountConflictPending(pending);
    return () => {
      if (!getAccountSaveConflictSession()) {
        setCloudSaveAccountConflictPending(false);
      }
    };
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
      await ensureAuthoritativeFleetReady();
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

  const showCloudRecoveryDialog = (
    provider: 'google' | 'apple',
    authenticatedUid: string,
    options: {
      errorReason: CloudSaveConflictReason;
      retryable: boolean;
      corrupt: boolean;
    },
  ) => {
    const message = getCloudSaveConflictErrorMessage(options.errorReason);
    showDialog({
      title: options.corrupt ? 'Bulut kaydı doğrulanamadı' : 'Bulut kaydı yüklenemedi',
      message,
      variant: 'warning',
      actions: [
        ...(options.retryable
          ? [
              {
                label: 'Tekrar Dene',
                variant: 'primary' as const,
                onPress: () => {
                  void (async () => {
                    setIsLinking(provider);
                    try {
                      const outcome = await retryPostSignInSaveFlow(provider);
                      await applyProviderSaveOutcome(outcome, provider);
                    } finally {
                      setIsLinking(null);
                    }
                  })();
                },
              },
            ]
          : []),
        ...(options.corrupt
          ? [
              {
                label: 'Yeni Oyun Başlat',
                variant: 'secondary' as const,
                onPress: () => {
                  showDialog({
                    title: 'Yeni oyun başlatılsın mı?',
                    message:
                      'Bu işlem buluttaki mevcut kaydın üzerine yazar. Emin misin?',
                    variant: 'danger',
                    confirmLabel: 'Evet, Yeni Oyun',
                    cancelLabel: 'Vazgeç',
                    onConfirm: () => {
                      void (async () => {
                        const result = await resolveSaveConflict({
                          authenticatedUid,
                          choice: 'local',
                          provider,
                        });
                        if (result.ok) {
                          hideDialog();
                          showAlert('Yeni oyun başlatıldı', 'Hesabınla yeni bir kayıt oluşturuldu.');
                          useGameStore.setState({ navigationRequest: { tab: 'dashboard' } });
                        }
                      })();
                    },
                  });
                },
              },
            ]
          : []),
        {
          label: 'Vazgeç',
          variant: 'secondary',
          onPress: () => hideDialog(),
        },
      ],
    });
  };

  const showAccountConflictDialog = (
    provider: 'google' | 'apple',
    authenticatedUid: string,
    options: {
      errorReason?: CloudSaveConflictReason;
      cloudDisabled?: boolean;
      fromAccountSwitch?: boolean;
    } = {},
  ) => {
    const fromAccountSwitch = options.fromAccountSwitch ?? accountSwitchConflictRef.current;
    accountSwitchConflictRef.current = fromAccountSwitch;
    ensureAccountSaveConflictSession({
      provider,
      authenticatedUid,
      fromAccountSwitch,
    });
    const errorMessage = options.errorReason
      ? getCloudSaveConflictErrorMessage(options.errorReason)
      : undefined;
    const cloudDisabled = options.cloudDisabled === true;
    setPendingAccountConflict({
      provider,
      authenticatedUid,
      errorReason: options.errorReason,
      cloudDisabled,
    });
    const showComparison = () => {
      const local = buildCloudSaveSummaryForState(useGameStore.getState());
      const cloud = cloudStatus.restoreCandidate?.cloudSummary ?? null;
      const format = (label: string, value: unknown) => `${label}: ${String(value ?? '—')}`;
      showDialog({
        title: 'Kayıtları Karşılaştır',
        message: [
          'BU CİHAZ',
          format('Şirket', useGameStore.getState().player?.companyName),
          format('Seviye', local.level),
          format('XP', local.xp),
          format('Nakit', local.money),
          format('Kamyon', local.trucksCount),
          format('Depo', local.warehousesCount),
          '',
          'BULUT',
          cloud
            ? [
                format('Seviye', cloud.level),
                format('XP', cloud.xp),
                format('Nakit', cloud.money),
                format('Kamyon', cloud.trucksCount),
                format('Depo', cloud.warehousesCount),
              ].join('\n')
            : 'Bulut kaydı özeti hazır.',
        ].join('\n'),
        variant: 'info',
        confirmLabel: 'Geri',
        onConfirm: () =>
          showAccountConflictDialog(provider, authenticatedUid, {
            errorReason: options.errorReason,
            cloudDisabled,
            fromAccountSwitch,
          }),
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
          label: 'Bulut Kaydı',
          variant: 'primary',
          disabled: cloudDisabled,
          onPress: () => {
            void handleResolveAccountSaveConflict('cloud', provider, authenticatedUid);
          },
        },
        {
          label: 'Bu Cihazdaki Kayıt',
          variant: 'secondary',
          onPress: () => {
            void handleResolveAccountSaveConflict('local', provider, authenticatedUid);
          },
        },
        {
          label: 'Detayları Karşılaştır',
          variant: 'secondary',
          onPress: showComparison,
        },
        {
          label: 'Vazgeç',
          variant: 'secondary',
          onPress: () => {
            setPendingAccountConflict(null);
            clearAccountSaveConflictSession();
            accountSwitchConflictRef.current = false;
            hideDialog();
          },
        },
      ],
    });
  };

  const applyProviderSaveOutcome = async (
    outcome: ProviderAccountSaveOutcome,
    provider: 'google' | 'apple',
  ) => {
    refreshAccount();
    refreshCloudStatus();

    if (outcome.type === 'completed') {
      hideDialog();
      if (accountSwitchConflictRef.current) {
        await finalizeAccountSwitchJournal();
        accountSwitchConflictRef.current = false;
      }
      showAlert(
        'Hesap bağlandı',
        outcome.message ?? 'İlerlemen artık hesabınla korunuyor.',
      );
      await refreshUsernameProfile(true);
      useGameStore.setState({ navigationRequest: { tab: 'dashboard' } });
      return;
    }

    if (outcome.type === 'conflict') {
      showAccountConflictDialog(provider, outcome.authenticatedUid, {
        fromAccountSwitch: accountSwitchConflictRef.current,
      });
      return;
    }

    if (outcome.type === 'cloud_load_failed') {
      showCloudRecoveryDialog(provider, outcome.authenticatedUid, {
        errorReason: outcome.reason,
        retryable: outcome.retryable,
        corrupt: false,
      });
      return;
    }

    if (outcome.type === 'cloud_corrupt') {
      showCloudRecoveryDialog(provider, outcome.authenticatedUid, {
        errorReason: outcome.reason,
        retryable: false,
        corrupt: true,
      });
    }
  };

  const showAppleLinkFailure = (
    failure: AppleAuthFailure,
    fallbackError?: string,
  ) => {
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

  const resolveAppleFailure = (result: {
    error?: string;
    appleFailure?: AppleAuthFailure;
    errorKind?: string;
  }): AppleAuthFailure => {
    if (result.appleFailure) {
      return result.appleFailure;
    }
    return failureFromLinkError(
      result.error,
      isAppleExistingAccountConflictCode(result.error)
        ? 'cloud-conflict'
        : 'anonymous-link-failure',
    );
  };

  const handleLink = async (provider: 'google' | 'apple') => {
    if (isLinking || isResolvingConflict || isSwitchingAccount || linkTapLock.current) {
      return;
    }
    linkTapLock.current = true;

    setIsLinking(provider);
    try {
      const result =
        provider === 'google'
          ? await linkAnonymousAccountWithGoogle({ forceInteractivePicker: true })
          : await linkAnonymousAccountWithApple();

      refreshAccount();
      refreshCloudStatus();

      if (result.ok) {
        showAlert('Hesap bağlandı', 'İlerlemen artık hesabınla korunuyor.');
        await refreshUsernameProfile(true);
        return;
      }

      if (result.error === 'cancelled') {
        return;
      }

      if (result.saveOutcome) {
        await applyProviderSaveOutcome(result.saveOutcome, provider);
        return;
      }

      if (isAccountLinkConflictError(result.error, result.errorKind)) {
        if (provider === 'apple') {
          // Conflict path is owned by saveOutcome / conflict dialogs.
          showAppleLinkFailure(resolveAppleFailure(result), result.error);
        }
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
      console.warn('[account] link failed', error);
      if (provider === 'apple') {
        showAppleLinkFailure(
          normalizeAppleAuthFailure(error, 'anonymous-link-failure'),
          'apple-sign-in-failed',
        );
        return;
      }
      showAlert('Hesap Bağlanamadı', getAccountLinkGeneralErrorMessage());
    } finally {
      setIsLinking(null);
      linkTapLock.current = false;
    }
  };

  const handleCancelGoogleLinkConflict = async () => {
    setPendingAccountConflict(null);
    setIsResolvingConflict(false);
    setIsLinking(null);
    clearAccountSaveConflictSession();
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
    clearAccountSaveConflictSession();
    accountSwitchConflictRef.current = false;
    endCloudSaveConflictResolution(conflictResolutionInFlightRef);
    hideDialog();
    await cancelPendingGoogleLinkConflict();
    await handleLink('google');
  };

  const handleResolveAccountSaveConflict = async (
    choice: 'cloud' | 'local',
    provider: 'google' | 'apple',
    authenticatedUid: string,
  ) => {
    const session = ensureAccountSaveConflictSession({
      provider,
      authenticatedUid,
      fromAccountSwitch: accountSwitchConflictRef.current,
    });

    if (!beginCloudSaveConflictResolution(conflictResolutionInFlightRef)) {
      showAlert(
        'Kayıt işlemi devam ediyor',
        getCloudSaveConflictErrorMessage('already-resolving'),
      );
      return;
    }

    const request = beginConflictResolveRequest(session.conflictId);
    if (!request.ok) {
      endCloudSaveConflictResolution(conflictResolutionInFlightRef);
      showAlert(
        'Kayıt işlemi devam ediyor',
        getCloudSaveConflictErrorMessage('already-resolving'),
      );
      return;
    }

    const providerLabel = provider === 'google' ? 'Google' : 'Apple';
    setIsResolvingConflict(true);
    setIsLinking(provider);
    showDialog({
      title:
        choice === 'cloud'
          ? `${providerLabel} kaydına geçiliyor`
          : 'Bu cihazdaki kayıt bağlanıyor',
      message:
        choice === 'cloud'
          ? 'Bulut kaydı doğrulanıyor ve güvenli şekilde hazırlanıyor.'
          : 'Bu cihazdaki kayıt seçilen hesaba bağlanıyor ve buluta yazılıyor.',
      variant: 'info',
      actions: [
        {
          label: choice === 'cloud' ? 'Bulut Kaydı Yükleniyor…' : 'Kaydediliyor…',
          variant: 'primary',
          loading: true,
          disabled: true,
          onPress: () => {},
        },
      ],
    });

    try {
      const result = await resolveSaveConflict({
        authenticatedUid,
        choice,
        provider,
      });
      if (!isConflictResolveRequestCurrent(request.token)) {
        return;
      }
      refreshAccount();
      refreshCloudStatus();
      if (result.ok) {
        if (accountSwitchConflictRef.current) {
          await finalizeAccountSwitchJournal();
        }
        completeAccountSaveConflictSession(request.token);
        setPendingAccountConflict(null);
        accountSwitchConflictRef.current = false;
        hideDialog();
        showAlert(
          choice === 'cloud' ? `${providerLabel} kaydına geçildi` : 'Bu cihazdaki kayıt bağlandı',
          choice === 'cloud'
            ? 'Hesabına bağlı oyun kaydı yüklendi.'
            : 'Bu cihazdaki ilerleme hesabına bağlandı ve buluta kaydedildi.',
        );
        useGameStore.setState({ navigationRequest: { tab: 'dashboard' } });
        return;
      }

      releaseConflictResolveRequest(request.token);
      setAccountSaveConflictError(result.error);
      const permanent = isPermanentCloudSaveConflictReason(result.error);
      setPendingAccountConflict({
        provider,
        authenticatedUid,
        errorReason: result.error,
        cloudDisabled: permanent && choice === 'cloud',
      });
      showAccountConflictDialog(provider, authenticatedUid, {
        errorReason: result.error,
        cloudDisabled: permanent && choice === 'cloud',
        fromAccountSwitch: accountSwitchConflictRef.current,
      });
    } catch (error) {
      console.warn('[account] resolve save conflict failed', error);
      if (isConflictResolveRequestCurrent(request.token)) {
        releaseConflictResolveRequest(request.token);
        setAccountSaveConflictError('unknown');
        setPendingAccountConflict({
          provider,
          authenticatedUid,
          errorReason: 'unknown',
        });
        showAccountConflictDialog(provider, authenticatedUid, {
          errorReason: 'unknown',
          fromAccountSwitch: accountSwitchConflictRef.current,
        });
      }
    } finally {
      if (isConflictResolveRequestCurrent(request.token)) {
        releaseConflictResolveRequest(request.token);
      }
      endCloudSaveConflictResolution(conflictResolutionInFlightRef);
      setIsResolvingConflict(false);
      setIsLinking(null);
    }
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

      if (result.saveOutcome) {
        await applyProviderSaveOutcome(result.saveOutcome, provider);
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
      if (provider === 'apple') {
        showAppleLinkFailure(normalizeAppleAuthFailure(error, 'anonymous-link-failure'));
        return;
      }
      showAlert('Hesap Bağlanamadı', getAccountLinkGeneralErrorMessage());
    } finally {
      setIsLinking(null);
    }
  };

  const syncBeforeSignOutBestEffort = async (): Promise<'synced' | 'skipped' | 'failed'> => {
    const state = useGameStore.getState();
    if (!isLocalSaveSafeForAccountTransition(state)) {
      return 'skipped';
    }
    try {
      await state.saveGame();
      const synced = await syncLocalSaveToCloud('manual', {
        force: true,
        state: useGameStore.getState(),
      });
      return synced ? 'synced' : 'failed';
    } catch {
      return 'failed';
    }
  };

  const rebindLocalSaveToAuth = async () => {
    const uid = getCurrentUserId();
    if (!uid) return;
    await saveGameState(useGameStore.getState(), { ownerUid: uid });
  };

  const syncBeforeAccountTransition = async (): Promise<boolean> => {
    const state = useGameStore.getState();
    if (!isLocalSaveSafeForAccountTransition(state)) return false;
    await state.saveGame();
    const synced = await syncLocalSaveToCloud('manual', {
      force: true,
      state: useGameStore.getState(),
    });
    if (synced) {
      await ensureAuthoritativeFleetReady();
    }
    return synced;
  };

  const clearAccountScopedClientState = () => {
    setPendingAccountConflict(null);
    setIsResolvingConflict(false);
    clearAccountSaveConflictSession();
    accountSwitchConflictRef.current = false;
    resetCloudSaveSyncState();
    setUsernameProfile(null);
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
    targetAccountUid?: string,
  ) => {
    void (async () => {
      setIsSwitchingAccount(true);
      try {
        const targetUid =
          targetAccountUid ?? getFirebaseAuthSafe()?.currentUser?.uid ?? null;
        if (!targetUid) {
          await rollbackAccountSwitch('missing-target-uid');
          showAlert(
            'Hesap değiştirilemedi',
            getAccountTransitionErrorMessage('auth-required'),
          );
          return;
        }
        const committed = await commitAccountSwitch({
          targetUid,
          bindLocalProgress: useLocalProgress,
          newGame: !useLocalProgress,
        });
        if (!committed.ok) {
          await rollbackAccountSwitch(committed.reason);
          showAlert(
            useLocalProgress ? 'Hesap Bağlanamadı' : 'Yeni oyun başlatılamadı',
            getAccountTransitionErrorMessage(
              committed.reason === 'cloud-sync-failed'
                ? 'cloud-sync-failed'
                : 'network-error',
            ),
          );
          return;
        }
        clearAccountScopedClientState();
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
        accountSwitchConflictRef.current = false;
        resetAccountSwitchTransition();
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
      refreshAccount();
      hideDialog();
      accountSwitchConflictRef.current = true;
      await applyProviderSaveOutcome(selection.saveOutcome, 'google');
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
    const linked =
      safeAccountStatus.isReady &&
      !safeAccountStatus.isAnonymous &&
      safeAccountStatus.provider !== 'guest';
    setIsSigningOut(true);
    logAccountSignOut({
      stage: 'start',
      authUidPresent: Boolean(getCurrentUserId()),
      linked,
    });
    try {
      const syncResult = await syncBeforeSignOutBestEffort();
      logAccountSignOut({
        stage: 'pre-sync',
        authUidPresent: Boolean(getCurrentUserId()),
        linked,
        syncResult,
      });

      const result = await signOutGoogleAccountToGuest();
      if (!result.ok) {
        logAccountSignOut({
          stage: 'sign-out-failed',
          authUidPresent: Boolean(getCurrentUserId()),
          linked,
          syncResult,
          success: false,
          errorCode: result.error,
        });
        showAlert(
          'Çıkış yapılamadı',
          getAccountTransitionErrorMessage(result.error),
        );
        return;
      }
      clearAccountScopedClientState();
      await rebindLocalSaveToAuth();
      refreshAccount();
      refreshCloudStatus();
      logAccountSignOut({
        stage: 'complete',
        authUidPresent: Boolean(getCurrentUserId()),
        linked: false,
        syncResult,
        success: true,
      });
      showAlert(
        'Çıkış yapıldı',
        syncResult === 'failed'
          ? 'Çıkış yaptın. Son bulut kaydı tamamlanamadı; bağlı hesabındaki son kayıtlı ilerleme korunur.'
          : 'Çıkış yaptın. Buluta kaydedilmiş ilerlemen korunur.',
      );
    } finally {
      setIsSigningOut(false);
    }
  };

  const handleGoogleSignOut = () => {
    showDialog({
      title: 'Çıkış yapmak istiyor musun?',
      message: 'Hesabından çıkış yapacaksın. Buluta kaydedilmiş ilerlemen korunur.',
      variant: 'warning',
      cancelLabel: 'Vazgeç',
      confirmLabel: 'Çıkış Yap',
      onConfirm: () => void executeGoogleSignOut(),
    });
  };

  const runAccountDeletionFlow = async (options?: {
    skipCloudDelete?: boolean;
    diagnosticId?: string;
  }) => {
    const isGuest =
      safeAccountStatus.isAnonymous || safeAccountStatus.provider === 'guest';
    setIsDeleting(true);
    try {
      const result = await deleteAccountAndCloudData(options);
      refreshAccount();
      refreshCloudStatus();
      setUsernameProfile(null);

      if (result.ok) {
        showAlert(
          isGuest ? 'Misafir kaydın silindi' : 'Hesabın silindi',
          'Yeni oyun başlatıldı.',
        );
        return;
      }

      if (result.errorCode === 'requires-recent-login') {
        showDialog({
          title: 'Kimlik doğrulama gerekli',
          message:
            'Hesabını silmek için Google veya Apple ile tekrar giriş yapman gerekiyor.',
          variant: 'warning',
          cancelLabel: 'Vazgeç',
          confirmLabel: 'Doğrula ve Sil',
          onConfirm: () => {
            void (async () => {
              setIsDeleting(true);
              try {
                const reauth = await reauthenticateCurrentUser();
                if (!reauth.ok) {
                  if (!reauth.cancelled) {
                    showAlert(
                      'Hesap silinemedi',
                      getAccountDeletionErrorMessage(
                        reauth.error === 'requires-recent-login'
                          ? 'requires-recent-login'
                          : undefined,
                      ),
                    );
                  }
                  return;
                }
                const retry = await deleteAccountAndCloudData({
                  skipCloudDelete: true,
                  diagnosticId: result.diagnosticId,
                });
                refreshAccount();
                refreshCloudStatus();
                setUsernameProfile(null);
                if (retry.ok) {
                  showAlert(
                    isGuest ? 'Misafir kaydın silindi' : 'Hesabın silindi',
                    'Yeni oyun başlatıldı.',
                  );
                  return;
                }
                showAlert(
                  'Hesap silinemedi',
                  getAccountDeletionErrorMessage(
                    retry.errorCode as AccountDeletionErrorCode | undefined,
                    retry.error,
                  ),
                );
              } finally {
                setIsDeleting(false);
              }
            })();
          },
        });
        return;
      }

      showAlert(
        'Hesap silinemedi',
        getAccountDeletionErrorMessage(
          result.errorCode as AccountDeletionErrorCode | undefined,
          result.error,
        ),
      );
    } catch (error) {
      console.warn('[account] delete failed', error);
      showAlert('Hesap silinemedi', 'Tekrar dene.');
    } finally {
      setIsDeleting(false);
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
        ? 'Yerel ilerlemen kalıcı olarak silinecek.'
        : 'Bulut kaydın, kullanıcı adın ve hesap verilerin kalıcı olarak silinecek.',
      variant: 'danger',
      cancelLabel: 'Vazgeç',
      confirmLabel: 'Devam Et',
      onConfirm: () => {
        showDialog({
          title: isGuest ? 'Misafir Kaydını Sil' : 'Hesabı Kalıcı Olarak Sil',
          message: 'Bu işlem geri alınamaz. Onaylıyor musun?',
          variant: 'danger',
          cancelLabel: 'Vazgeç',
          confirmLabel: 'Hesabı Kalıcı Olarak Sil',
          destructive: true,
          onConfirm: () => {
            void runAccountDeletionFlow();
          },
        });
      },
    });
  };

  const isGuest =
    safeAccountStatus.isAnonymous || safeAccountStatus.provider === 'guest';
  const showApple = Platform.OS === 'ios' && appleAvailable;
  const showGoogle = Platform.OS === 'ios' || Platform.OS === 'android';
  const cloudUserStatus = getCloudSaveUserStatus(cloudStatus);
  const cardVariant = isGuest ? 'guest' : 'linked';
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

  return {
    showAlert,
    showDialog,
    hideDialog,
    account,
    safeAccountStatus,
    cloudStatus,
    cloudUserStatus,
    isGuest,
    showApple,
    showGoogle,
    providerLabel,
    usernameLabel,
    avatarLetter,
    leaderboardStatus,
    isLinking,
    isManualSyncing,
    isChecking,
    isSwitchingAccount,
    isSigningOut,
    isDeleting,
    googleConfigured,
    usernameProfile,
    usernameModal,
    setUsernameModal,
    handleLink,
    handleManualSync,
    handleCheckCloud,
    handleAccountSwitch,
    handleGoogleSignOut,
    handleDeleteAccount,
    refreshUsernameProfile,
    onOpenLeaderboard,
    formatLastSaveLabel,
  };
}

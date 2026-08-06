import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type ScrollView } from 'react-native';
import Constants from 'expo-constants';

import AppTutorialHelpButton from '../components/tutorial/AppTutorialHelpButton';
import AppTutorialOverlay from '../components/tutorial/AppTutorialOverlay';
import { AppTutorialTarget } from '../components/tutorial/AppTutorialTarget';
import { useScreenAppTutorial } from '../hooks/useScreenAppTutorial';
import BackendDiagnosticsGate from '../components/BackendDiagnosticsGate';
import UsernameSetupModal from '../components/username/UsernameSetupModal';
import AccountConnectionTab from '../components/accountCenter/AccountConnectionTab';
import AccountPreferencesTab from '../components/accountCenter/AccountPreferencesTab';
import AccountProfileTab from '../components/accountCenter/AccountProfileTab';
import AccountSegmentedTabs from '../components/accountCenter/AccountSegmentedTabs';
import { ACCOUNT_CENTER_HEADER } from '../components/accountCenter/constants';
import { useAppDialog } from '../components/AppDialogProvider';
import { AppScreen, ScreenHeader } from '../components/ui';
import { CITIES_BY_ID } from '../data/cities';
import { LEADERBOARD_ENABLED } from '../config/backendRoadmap';
import { isAccountSwitchRecoveryRequired } from '../services/accountSwitchService';
import {
  getAppPreferences,
  loadAppPreferences,
  subscribeAppPreferences,
} from '../services/appPreferences';
import { AD_PRIVACY_ERROR_MESSAGE } from '../domain/adPrivacyState';
import { useAdPrivacyAction } from '../hooks/useAdPrivacyAction';
import { getCurrentUserId } from '../services/authService';
import { getFirebaseAuthSafe } from '../services/firebase';
import { fetchWeeklyLeaderboard } from '../services/leaderboardService';
import { subscribeUsernameProfileChanged } from '../services/usernameProfileEvents';
import { useAccountCenter, type AccountCenterTab } from '../hooks/useAccountCenter';
import { useGameStore } from '../store/gameStore';
import { calculateCompanyScore } from '../simulation/companyScore';
import { spacing } from '../theme';
import {
  formatRelativeSaveAgo,
  getProviderBadgeLabel,
  resolveCloudSaveDisplayInfo,
} from '../utils/accountCenterCloudStatus';
import { openLegalLink } from '../utils/legalLinks';

interface AccountCenterScreenProps {
  onBack: () => void;
  onOpenLeaderboard?: () => void;
}

function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 1) {
    return email;
  }
  return `${email.slice(0, 2)}***${email.slice(at)}`;
}

function formatRegistrationDate(timestampMs: number | null | undefined): string {
  if (!timestampMs || !Number.isFinite(timestampMs)) {
    return '—';
  }
  return new Date(timestampMs).toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export default function AccountCenterScreen({
  onBack,
  onOpenLeaderboard,
}: AccountCenterScreenProps) {
  const vm = useAccountCenter({ onOpenLeaderboard });
  const { alert: showAlert } = useAppDialog();
  const scrollRef = useRef<ScrollView>(null);
  const [activeTab, setActiveTab] = useState<AccountCenterTab>('profile');
  const [dangerExpanded, setDangerExpanded] = useState(false);
  const [recoveryRequired, setRecoveryRequired] = useState(false);
  const [prefs, setPrefs] = useState(getAppPreferences());
  const [leaderboardRank, setLeaderboardRank] = useState<number | null>(null);
  const [leaderboardUnavailable, setLeaderboardUnavailable] = useState(false);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [deleteConfirmStep, setDeleteConfirmStep] = useState<0 | 1>(0);
  const [layoutReady, setLayoutReady] = useState(false);
  const { runPrivacyAction } = useAdPrivacyAction();

  const accountTutorial = useScreenAppTutorial({
    tutorialId: 'account',
    layoutReady,
    blockingModals: vm.usernameModal != null,
    scrollRef,
  });

  const player = useGameStore((state) => state.player);
  const gameState = useGameStore();

  const level = Math.max(1, player?.level ?? player?.companyLevel ?? 1);
  const trucks = player?.trucks ?? [];
  const warehouses = player?.warehouses ?? [];
  const completedContracts = player?.completedContracts ?? 0;
  const companyName = player?.companyName ?? 'LogistiCore Lojistik';
  const homeCityName = CITIES_BY_ID[player?.homeCityId ?? '']?.name ?? '—';
  const companyScore = useMemo(() => calculateCompanyScore(gameState), [gameState]);

  const cloudDisplay = useMemo(
    () =>
      resolveCloudSaveDisplayInfo({
        cloudStatus: vm.cloudStatus,
        isGuest: vm.isGuest,
        recoveryRequired,
        hasAccountConflict: Boolean(vm.cloudStatus.restoreCandidate?.hasCandidate),
      }),
    [vm.cloudStatus, vm.isGuest, recoveryRequired],
  );

  const providerBadge = getProviderBadgeLabel(vm.safeAccountStatus.provider, vm.isGuest);
  const maskedEmail = useMemo(() => {
    const email = getFirebaseAuthSafe()?.currentUser?.email;
    return email ? maskEmail(email) : null;
  }, [vm.safeAccountStatus.isReady, vm.safeAccountStatus.provider]);

  const heroSubtitle = vm.isGuest
    ? 'Hesabını bağlayarak ilerlemeni koru'
    : `${vm.providerLabel} hesabı bağlı · Bulut kaydı aktif`;

  const displayName =
    vm.usernameLabel ?? (vm.isGuest ? 'Misafir Oyuncu' : 'Hesap bağlı');

  const usernameChangeLocked =
    vm.usernameProfile?.nextChangeAvailableAtMs != null &&
    vm.usernameProfile.nextChangeAvailableAtMs > Date.now();

  const refreshRecovery = useCallback(() => {
    void isAccountSwitchRecoveryRequired().then(setRecoveryRequired);
  }, []);

  const refreshLeaderboardRank = useCallback(async () => {
    if (!LEADERBOARD_ENABLED || vm.isGuest || !vm.usernameProfile?.usernameSetupCompleted) {
      setLeaderboardRank(null);
      setLeaderboardUnavailable(false);
      return;
    }
    setLeaderboardLoading(true);
    try {
      const uid = getCurrentUserId();
      const result = await fetchWeeklyLeaderboard(uid);
      if (!result.ok) {
        setLeaderboardRank(null);
        setLeaderboardUnavailable(true);
        return;
      }
      setLeaderboardUnavailable(false);
      setLeaderboardRank(result.playerRank ?? null);
    } finally {
      setLeaderboardLoading(false);
    }
  }, [vm.isGuest, vm.usernameProfile?.usernameSetupCompleted]);

  useEffect(() => {
    refreshRecovery();
  }, [refreshRecovery, vm.isSwitchingAccount]);

  useEffect(() => {
    void loadAppPreferences().then(setPrefs);
    return subscribeAppPreferences(setPrefs);
  }, []);

  useEffect(() => {
    void refreshLeaderboardRank();
    return subscribeUsernameProfileChanged(() => {
      void refreshLeaderboardRank();
    });
  }, [refreshLeaderboardRank]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [activeTab]);

  const handleCloudCta = () => {
    if (cloudDisplay.key === 'conflict') {
      void vm.handleCheckCloud();
      return;
    }
    if (cloudDisplay.key === 'recovery') {
      vm.handleAccountSwitch();
      return;
    }
    void vm.handleManualSync();
  };

  const handleOpenLegal = async (key: Parameters<typeof openLegalLink>[0], label: string) => {
    const result = await openLegalLink(key);
    if (!result.ok) {
      showAlert(label, result.message);
    }
  };

  const handlePrivacyChoices = async () => {
    const success = await runPrivacyAction();
    if (!success) {
      showAlert('Gizlilik Ayarları', AD_PRIVACY_ERROR_MESSAGE);
    }
  };

  const handleDeleteAccountTwoStep = () => {
    if (deleteConfirmStep === 0) {
      setDeleteConfirmStep(1);
      showAlert(
        vm.isGuest ? 'Misafir Kaydını Sil' : 'Hesabı Sil — Son Onay',
        vm.isGuest
          ? 'Yerel ilerlemen kalıcı olarak silinecek. Devam etmek istiyor musun?'
          : 'Oyun verilerin, bulut kaydın ve hesap bağlantın kalıcı olarak silinecek. Bu işlem geri alınamaz.',
      );
      return;
    }
    setDeleteConfirmStep(0);
    vm.handleDeleteAccount();
  };

  const handleOpenLeaderboard = () => {
    if (!vm.usernameProfile?.usernameSetupCompleted) {
      vm.setUsernameModal('setup');
      return;
    }
    onOpenLeaderboard?.();
  };

  const appVersion = Constants.expoConfig?.version ?? '0.1.0';
  const buildNumber =
    Constants.expoConfig?.ios?.buildNumber ??
    Constants.expoConfig?.android?.versionCode?.toString() ??
    '—';

  return (
    <View style={styles.screenRoot}>
      <AppScreen
        scroll
        embedded
        scrollRef={scrollRef}
        onScroll={accountTutorial.handleScroll}
        onScrollEndDrag={accountTutorial.handleScrollEnd}
        onMomentumScrollEnd={accountTutorial.handleScrollEnd}
        scrollEventThrottle={16}
        contentContainerStyle={styles.content}
      >
        <View onLayout={() => setLayoutReady(true)}>
      <ScreenHeader
        title={ACCOUNT_CENTER_HEADER.title}
        subtitle={ACCOUNT_CENTER_HEADER.subtitle}
        onBack={onBack}
        titleIcon="account"
        compact
        rightAction={<AppTutorialHelpButton {...accountTutorial.helpButtonProps} />}
      />

      <AccountSegmentedTabs active={activeTab} onChange={setActiveTab} />

      {activeTab === 'profile' ? (
        <AppTutorialTarget tutorialId="account" targetId="profile">
          <AccountProfileTab
          isGuest={vm.isGuest}
          displayName={displayName}
          heroSubtitle={heroSubtitle}
          avatarLetter={vm.avatarLetter}
          providerBadge={providerBadge}
          cloudStatusLabel={vm.isGuest ? undefined : vm.cloudUserStatus.label}
          cloudStatusVariant={vm.isGuest ? undefined : vm.cloudUserStatus.variant}
          stats={{
            level,
            contracts: completedContracts,
            trucks: trucks.length,
            warehouses: warehouses.length,
          }}
          usernameLabel={vm.usernameLabel}
          usernameSetupCompleted={Boolean(vm.usernameProfile?.usernameSetupCompleted)}
          usernameChangeLocked={usernameChangeLocked}
          onSetupUsername={() => vm.setUsernameModal('setup')}
          onEditUsername={() => vm.setUsernameModal('edit')}
          companyName={companyName}
          companyLevel={level}
          companyScore={companyScore}
          homeCityName={homeCityName}
          leaderboardLoading={leaderboardLoading}
          leaderboardUnavailable={leaderboardUnavailable}
          leaderboardRank={leaderboardRank}
          onOpenLeaderboard={handleOpenLeaderboard}
        />
        </AppTutorialTarget>
      ) : null}

      {activeTab === 'account' ? (
        <AppTutorialTarget tutorialId="account" targetId="cloud-save">
          <AccountConnectionTab
          isReady={vm.safeAccountStatus.isReady}
          isGuest={vm.isGuest}
          providerLabel={vm.providerLabel}
          maskedEmail={maskedEmail}
          cloudUserStatusLabel={vm.cloudUserStatus.label}
          lastSyncLabel={formatRelativeSaveAgo(vm.cloudStatus.lastSyncAt)}
          isSwitchingAccount={vm.isSwitchingAccount}
          recoveryRequired={recoveryRequired}
          showGoogle={vm.showGoogle}
          showApple={vm.showApple}
          googleConfigured={vm.googleConfigured}
          isLinking={vm.isLinking}
          onLinkGoogle={() => void vm.handleLink('google')}
          onLinkApple={() => void vm.handleLink('apple')}
          cloudDisplay={cloudDisplay}
          isManualSyncing={vm.isManualSyncing}
          isChecking={vm.isChecking}
          onCloudCta={handleCloudCta}
          showAccountSwitch={vm.safeAccountStatus.provider === 'google'}
          isSigningOut={vm.isSigningOut}
          isDeleting={vm.isDeleting}
          onAccountSwitch={vm.handleAccountSwitch}
          onSignOut={vm.handleGoogleSignOut}
        />
        </AppTutorialTarget>
      ) : null}

      {activeTab === 'preferences' ? (
        <AppTutorialTarget tutorialId="account" targetId="preferences">
          <AccountPreferencesTab
          prefs={prefs}
          appVersion={appVersion}
          buildNumber={buildNumber}
          registrationDateLabel={formatRegistrationDate(
            useGameStore.getState().lastSeenRealTimeMs,
          )}
          dangerExpanded={dangerExpanded}
          onToggleDanger={() => setDangerExpanded((open) => !open)}
          isSigningOut={vm.isSigningOut}
          isDeleting={vm.isDeleting}
          isSwitchingAccount={vm.isSwitchingAccount}
          isGuest={vm.isGuest}
          isReady={vm.safeAccountStatus.isReady}
          deleteConfirmStep={deleteConfirmStep}
          onSignOut={vm.handleGoogleSignOut}
          onDeleteAccount={handleDeleteAccountTwoStep}
          onLanguagePress={() => showAlert('Dil', 'Şu an yalnızca Türkçe destekleniyor.')}
          onPrivacyPolicy={() => void handleOpenLegal('privacyPolicy', 'Gizlilik Politikası')}
          onPrivacyChoices={() => void handlePrivacyChoices()}
          onAccountDeletionInfo={() => void handleOpenLegal('accountDeletion', 'Hesap Silme')}
          onSupport={() => void handleOpenLegal('support', 'Destek')}
          onLegalDocuments={() => void handleOpenLegal('privacyPolicy', 'Yasal Belgeler')}
        />
        </AppTutorialTarget>
      ) : null}

      <BackendDiagnosticsGate />
      <UsernameSetupModal
        visible={vm.usernameModal != null}
        mode={vm.usernameModal === 'edit' ? 'edit' : 'setup'}
        initialUsername={vm.usernameProfile?.username}
        suggestedUsername={vm.usernameProfile?.suggestedUsername}
        nextChangeAvailableAtMs={vm.usernameProfile?.nextChangeAvailableAtMs}
        onClose={() => vm.setUsernameModal(null)}
        onSaved={() => {
          void vm.refreshUsernameProfile(false);
          vm.setUsernameModal(null);
        }}
      />
        </View>
      </AppScreen>
      <AppTutorialOverlay {...accountTutorial.overlayProps} />
    </View>
  );
}

const styles = StyleSheet.create({
  screenRoot: {
    flex: 1,
  },
  content: {
    paddingBottom: spacing.xl,
    gap: 0,
  },
});

// Re-export tab config for regression tests and external references.
export { ACCOUNT_CENTER_TABS } from '../components/accountCenter/constants';

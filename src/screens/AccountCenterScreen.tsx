import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { InteractionManager, StyleSheet, View, type ScrollView } from 'react-native';
import Constants from 'expo-constants';

import AppTutorialHelpButton from '../components/tutorial/AppTutorialHelpButton';
import AppTutorialOverlay from '../components/tutorial/AppTutorialOverlay';
import { AppTutorialTarget } from '../components/tutorial/AppTutorialTarget';
import { useScreenAppTutorial } from '../hooks/useScreenAppTutorial';
import { useTutorialLayoutReady } from '../hooks/useTutorialLayoutReady';
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
import { shouldShowAccountPrivacyOptions } from '../domain/adPrivacyState';
import { useAccountPrivacyOptions } from '../hooks/useRewardedAdRequest';
import { useAdPrivacyAvailability } from '../hooks/useAdPrivacyAvailability';
import { getAdsConsentSnapshot } from '../services/adsConsentService';
import { getCurrentUserId } from '../services/authService';
import { getFirebaseAuthSafe } from '../services/firebase';
import { fetchWeeklyLeaderboard } from '../services/leaderboardService';
import { subscribeUsernameProfileChanged } from '../services/usernameProfileEvents';
import { useScreenRenderProfiler } from '../hooks/useScreenRenderProfiler';
import { useAccountCenter, type AccountCenterTab } from '../hooks/useAccountCenter';
import { useGameStore } from '../store/gameStore';
import { calculateCompanyScore } from '../simulation/companyScore';
import { useTabBarLayout } from '../hooks/useTabBarLayout';
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
  useScreenRenderProfiler('Account');
  const vm = useAccountCenter({ onOpenLeaderboard });
  const { scrollBottomPadding } = useTabBarLayout();
  const { alert: showAlert } = useAppDialog();
  const scrollRef = useRef<ScrollView>(null);
  const [activeTab, setActiveTab] = useState<AccountCenterTab>('profile');
  const [recoveryRequired, setRecoveryRequired] = useState(false);
  const [prefs, setPrefs] = useState(getAppPreferences());
  const [leaderboardRank, setLeaderboardRank] = useState<number | null>(null);
  const [leaderboardUnavailable, setLeaderboardUnavailable] = useState(false);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const { layoutReady, markLayoutReady } = useTutorialLayoutReady();
  const { openPrivacyOptions } = useAccountPrivacyOptions();
  useAdPrivacyAvailability();
  const showPrivacyOptions = shouldShowAccountPrivacyOptions(getAdsConsentSnapshot());

  const accountTutorial = useScreenAppTutorial({
    tutorialId: 'account',
    layoutReady,
    blockingModals: vm.usernameModal != null,
    scrollRef,
  });

  const player = useGameStore((state) => state.player);
  const cities = useGameStore((state) => state.cities);
  const products = useGameStore((state) => state.products);
  const financeLedger = useGameStore((state) => state.financeLedger);
  const currentTime = useGameStore((state) => Math.floor(state.currentTime));

  const level = Math.max(1, player?.level ?? player?.companyLevel ?? 1);
  const trucks = player?.trucks ?? [];
  const warehouses = player?.warehouses ?? [];
  const completedContracts = player?.completedContracts ?? 0;
  const companyName = player?.companyName ?? 'LogistiCore Lojistik';
  const homeCityName = CITIES_BY_ID[player?.homeCityId ?? '']?.name ?? '—';
  const companyScore = useMemo(
    () => calculateCompanyScore({ player, cities, products, financeLedger, currentTime }),
    [player, cities, products, financeLedger, currentTime],
  );

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
    : `${vm.providerLabel} hesabı bağlı`;

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
    const task = InteractionManager.runAfterInteractions(() => {
      void refreshLeaderboardRank();
    });
    const unsub = subscribeUsernameProfileChanged(() => {
      void refreshLeaderboardRank();
    });
    return () => {
      task.cancel();
      unsub();
    };
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
    const result = await openPrivacyOptions();
    if (!result.ok && result.userMessage) {
      showAlert('Gizlilik Ayarları', result.userMessage);
    }
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
        scrollRef={scrollRef}
        onScroll={accountTutorial.handleScroll}
        onScrollEndDrag={accountTutorial.handleScrollEnd}
        onMomentumScrollEnd={accountTutorial.handleScrollEnd}
        scrollEventThrottle={16}
        scrollBottomPadding={scrollBottomPadding}
        contentContainerStyle={styles.content}
      >
        <View onLayout={markLayoutReady}>
      <ScreenHeader
        title={ACCOUNT_CENTER_HEADER.title}
        subtitle={ACCOUNT_CENTER_HEADER.subtitle}
        onBack={onBack}
        compact
        rightAction={<AppTutorialHelpButton {...accountTutorial.helpButtonProps} />}
      />

      <AccountSegmentedTabs active={activeTab} onChange={setActiveTab} />

      {activeTab === 'profile' ? (
        <AppTutorialTarget tutorialId="account" targetId="profile" layoutMode="stretch">
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
          truckCount={trucks.length}
          warehouseCount={warehouses.length}
          leaderboardLoading={leaderboardLoading}
          leaderboardUnavailable={leaderboardUnavailable}
          leaderboardRank={leaderboardRank}
          onOpenLeaderboard={handleOpenLeaderboard}
        />
        </AppTutorialTarget>
      ) : null}

      {activeTab === 'account' ? (
        <AppTutorialTarget tutorialId="account" targetId="cloud-save" layoutMode="stretch">
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
          onDeleteAccount={vm.handleDeleteAccount}
        />
        </AppTutorialTarget>
      ) : null}

      {activeTab === 'preferences' ? (
        <AppTutorialTarget tutorialId="account" targetId="preferences" layoutMode="stretch">
          <AccountPreferencesTab
          prefs={prefs}
          appVersion={appVersion}
          buildNumber={buildNumber}
          registrationDateLabel={formatRegistrationDate(
            useGameStore.getState().lastSeenRealTimeMs,
          )}
          onLanguagePress={() => showAlert('Dil', 'Şu an yalnızca Türkçe destekleniyor.')}
          onPrivacyPolicy={() => void handleOpenLegal('privacyPolicy', 'Gizlilik Politikası')}
          showPrivacyOptions={showPrivacyOptions}
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
    paddingBottom: 0,
    gap: 0,
  },
});

// Re-export tab config for regression tests and external references.
export { ACCOUNT_CENTER_TABS } from '../components/accountCenter/constants';

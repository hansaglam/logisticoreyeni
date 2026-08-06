import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import Constants from 'expo-constants';

import BackendDiagnosticsGate from '../components/BackendDiagnosticsGate';
import UsernameSetupModal from '../components/username/UsernameSetupModal';
import { useAppDialog } from '../components/AppDialogProvider';
import {
  ActionButton,
  AppCard,
  AppScreen,
  GameIcon,
  ListRowCard,
  ScreenHeader,
  SectionTitle,
  StatusBadge,
} from '../components/ui';
import { CITIES_BY_ID } from '../data/cities';
import { LEADERBOARD_ENABLED } from '../config/backendRoadmap';
import { isAccountSwitchRecoveryRequired } from '../services/accountSwitchService';
import {
  getAppPreferences,
  loadAppPreferences,
  subscribeAppPreferences,
  updateAppPreference,
} from '../services/appPreferences';
import { showAdsPrivacyOptionsForm } from '../services/adsConsentService';
import { getCurrentUserId } from '../services/authService';
import { fetchWeeklyLeaderboard } from '../services/leaderboardService';
import { subscribeUsernameProfileChanged } from '../services/usernameProfileEvents';
import { useAccountCenter, type AccountCenterTab } from '../hooks/useAccountCenter';
import { useGameStore } from '../store/gameStore';
import { calculateCompanyScore, formatCompanyScore } from '../simulation/companyScore';
import { colors, spacing, typography } from '../theme';
import type { GameIconName } from '../theme/icons';
import {
  formatRelativeSaveAgo,
  getProviderBadgeLabel,
  resolveCloudSaveDisplayInfo,
} from '../utils/accountCenterCloudStatus';
import { openLegalLink } from '../utils/legalLinks';
import { getFirebaseAuthSafe } from '../services/firebase';

const TABS: { key: AccountCenterTab; label: string }[] = [
  { key: 'profile', label: 'Profil' },
  { key: 'account', label: 'Hesap' },
  { key: 'preferences', label: 'Tercihler' },
];

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

function AccountCenterTabs({
  active,
  onChange,
}: {
  active: AccountCenterTab;
  onChange: (tab: AccountCenterTab) => void;
}) {
  return (
    <View
      style={styles.tabRow}
      accessibilityRole="tablist"
      accessibilityLabel="Hesap Merkezi sekmeleri"
    >
      {TABS.map((tab) => {
        const selected = tab.key === active;
        return (
          <Pressable
            key={tab.key}
            style={[styles.tabButton, selected && styles.tabButtonActive]}
            onPress={() => onChange(tab.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={tab.label}
          >
            <Text style={[styles.tabLabel, selected && styles.tabLabelActive]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function CenterCard({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: object;
}) {
  return (
    <AppCard style={[styles.centerCard, style]} padded={false}>
      <View style={styles.centerCardInner}>{children}</View>
    </AppCard>
  );
}

export default function AccountCenterScreen({
  onBack,
  onOpenLeaderboard,
}: AccountCenterScreenProps) {
  const vm = useAccountCenter({ onOpenLeaderboard });
  const { alert: showAlert } = useAppDialog();
  const [activeTab, setActiveTab] = useState<AccountCenterTab>('profile');
  const [dangerExpanded, setDangerExpanded] = useState(false);
  const [recoveryRequired, setRecoveryRequired] = useState(false);
  const [prefs, setPrefs] = useState(getAppPreferences());
  const [leaderboardRank, setLeaderboardRank] = useState<number | null>(null);
  const [leaderboardUnavailable, setLeaderboardUnavailable] = useState(false);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [deleteConfirmStep, setDeleteConfirmStep] = useState<0 | 1>(0);

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
    const result = await showAdsPrivacyOptionsForm();
    if (!result.ok) {
      showAlert(
        'Gizlilik Ayarları',
        'Gizlilik formu şu anda açılamadı. Lütfen daha sonra tekrar dene.',
      );
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

  const appVersion = Constants.expoConfig?.version ?? '0.1.0';
  const buildNumber =
    Constants.expoConfig?.ios?.buildNumber ??
    Constants.expoConfig?.android?.versionCode?.toString() ??
    '—';

  const renderProfileTab = () => (
    <View style={styles.tabContent}>
      <CenterCard>
        <View style={styles.profileHero}>
          <View
            style={[
              styles.avatar,
              vm.isGuest ? styles.avatarGuest : styles.avatarLinked,
            ]}
          >
            {vm.isGuest ? (
              <GameIcon name="account" size={22} color={colors.accentAmber} />
            ) : (
              <Text style={styles.avatarLetter}>{vm.avatarLetter}</Text>
            )}
          </View>
          <View style={styles.profileHeroMain}>
            <Text style={styles.profileName} numberOfLines={1}>
              {vm.usernameLabel ?? (vm.isGuest ? 'Misafir Oyuncu' : 'Hesap bağlı')}
            </Text>
            <Text style={styles.profileSubtitle} numberOfLines={2}>
              {vm.isGuest
                ? 'Hesabını bağlayarak ilerlemeni koru'
                : `${vm.providerLabel} hesabı bağlı · Bulut kaydı aktif`}
            </Text>
            <View style={styles.badgeRow}>
              <StatusBadge label={providerBadge} variant={vm.isGuest ? 'amber' : 'success'} size="sm" />
              {!vm.isGuest ? (
                <StatusBadge label={vm.cloudUserStatus.label} variant={vm.cloudUserStatus.variant} size="sm" />
              ) : null}
            </View>
          </View>
        </View>
        <View style={styles.statGrid}>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Seviye</Text>
            <Text style={styles.statValue}>{level}</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Sözleşme</Text>
            <Text style={styles.statValue}>{completedContracts}</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Araç</Text>
            <Text style={styles.statValue}>{trucks.length}</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Depo</Text>
            <Text style={styles.statValue}>{warehouses.length}</Text>
          </View>
        </View>
      </CenterCard>

      <CenterCard>
        <SectionTitle title="Oyuncu Kimliği" compact />
        {vm.usernameProfile?.usernameSetupCompleted && vm.usernameLabel ? (
          <>
            <Text style={styles.identityValue}>@{vm.usernameLabel}</Text>
            <Text style={styles.identityHint}>
              Liderlik Tablosu ve Araç Pazarı&apos;nda görünür.
            </Text>
            {vm.usernameProfile?.nextChangeAvailableAtMs != null &&
            vm.usernameProfile.nextChangeAvailableAtMs > Date.now() ? (
              <Text style={styles.identityHint}>
                Kullanıcı adını daha sonra tekrar değiştirebilirsin.
              </Text>
            ) : (
              <ActionButton
                label="Kullanıcı Adını Düzenle"
                onPress={() => vm.setUsernameModal('edit')}
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
              onPress={() => vm.setUsernameModal('setup')}
              variant="primary"
              compact
              style={styles.cardAction}
              disabled={vm.isGuest}
            />
            {vm.isGuest ? (
              <Text style={styles.identityHint}>Önce hesabını bağlaman gerekir.</Text>
            ) : null}
          </>
        )}
      </CenterCard>

      <CenterCard>
        <SectionTitle title="Şirket Kimliği" compact />
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Şirket adı</Text>
          <Text style={styles.infoValue} numberOfLines={1}>
            {companyName}
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Şirket seviyesi</Text>
          <Text style={styles.infoValue}>Seviye {level}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Şirket puanı</Text>
          <Text style={styles.infoValue}>{formatCompanyScore(companyScore)}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Merkez şehir</Text>
          <Text style={styles.infoValue}>{homeCityName}</Text>
        </View>
      </CenterCard>

      {LEADERBOARD_ENABLED ? (
        <Pressable
          onPress={() => {
            if (!vm.usernameProfile?.usernameSetupCompleted) {
              vm.setUsernameModal('setup');
              return;
            }
            onOpenLeaderboard?.();
          }}
          accessibilityRole="button"
          accessibilityLabel="Liderlik Tablosu"
        >
          <CenterCard>
            <View style={styles.leaderboardRow}>
              <View style={styles.leaderboardIcon}>
                <GameIcon name="trophy" size={18} color={colors.accentAmber} />
              </View>
              <View style={styles.leaderboardCopy}>
                <Text style={styles.leaderboardTitle}>Liderlik Tablosu</Text>
                {leaderboardUnavailable ? (
                  <Text style={styles.leaderboardSubtitle}>
                    Liderlik servisine şu anda ulaşılamıyor.
                  </Text>
                ) : !vm.usernameProfile?.usernameSetupCompleted ? (
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
              {vm.usernameProfile?.usernameSetupCompleted && !leaderboardUnavailable ? (
                <Text style={styles.leaderboardCta}>Gör ›</Text>
              ) : null}
            </View>
          </CenterCard>
        </Pressable>
      ) : null}
    </View>
  );

  const renderAccountTab = () => (
    <View style={styles.tabContent}>
      <CenterCard>
        <SectionTitle title="Hesap Bağlantısı" compact />
        {!vm.safeAccountStatus.isReady ? (
          <Text style={styles.identityHint}>Hesap kontrol ediliyor…</Text>
        ) : vm.isGuest ? (
          <>
            <Text style={styles.identityHint}>
              İlerlemeni korumak için Google veya Apple hesabını bağla.
            </Text>
            <View style={styles.authButtons}>
              {vm.showGoogle ? (
                <ActionButton
                  label={vm.isLinking === 'google' ? 'Bağlanıyor…' : 'Google ile Devam Et'}
                  onPress={() => void vm.handleLink('google')}
                  variant="primary"
                  icon="account"
                  disabled={Boolean(vm.isLinking)}
                />
              ) : null}
              {vm.showApple ? (
                <ActionButton
                  label={vm.isLinking === 'apple' ? 'Bağlanıyor…' : 'Apple ile Devam Et'}
                  onPress={() => void vm.handleLink('apple')}
                  variant="secondary"
                  icon="account"
                  disabled={Boolean(vm.isLinking)}
                />
              ) : null}
            </View>
            {__DEV__ && !vm.googleConfigured && vm.showGoogle ? (
              <Text style={styles.devHint}>
                Google yapılandırmasını kontrol et. Değişiklikten sonra: npx expo start -c
              </Text>
            ) : null}
          </>
        ) : (
          <>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Bağlı hesap</Text>
              <Text style={styles.infoValue}>{vm.providerLabel} hesabı bağlı</Text>
            </View>
            {maskedEmail ? (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>E-posta</Text>
                <Text style={styles.infoValue}>{maskedEmail}</Text>
              </View>
            ) : null}
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Bulut kaydı</Text>
              <Text style={styles.infoValue}>{vm.cloudUserStatus.label}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Son senkronizasyon</Text>
              <Text style={styles.infoValue}>
                {formatRelativeSaveAgo(vm.cloudStatus.lastSyncAt)}
              </Text>
            </View>
            {vm.isSwitchingAccount ? (
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
      </CenterCard>

      <CenterCard>
        <View style={styles.cloudHeader}>
          <SectionTitle title="Bulut Kaydı" compact />
          <StatusBadge label={cloudDisplay.title} variant={cloudDisplay.badgeVariant} size="sm" />
        </View>
        <Text style={styles.identityHint}>{cloudDisplay.description}</Text>
        {cloudDisplay.ctaLabel ? (
          <ActionButton
            label={
              vm.isManualSyncing || vm.isChecking
                ? 'İşleniyor…'
                : cloudDisplay.ctaLabel
            }
            onPress={handleCloudCta}
            variant="primary"
            compact
            style={styles.cardAction}
            disabled={vm.isManualSyncing || vm.isChecking || vm.isSwitchingAccount}
          />
        ) : null}
      </CenterCard>

      {!vm.isGuest ? (
        <CenterCard>
          <SectionTitle title="Hesap İşlemleri" compact />
          <View style={styles.actionStack}>
            {vm.safeAccountStatus.provider === 'google' ? (
              <ActionButton
                label={vm.isSwitchingAccount ? 'Hesap değiştiriliyor…' : 'Hesap Değiştir'}
                onPress={vm.handleAccountSwitch}
                variant="secondary"
                compact
                disabled={vm.isSwitchingAccount || vm.isSigningOut || vm.isDeleting}
              />
            ) : null}
            <ActionButton
              label={vm.isSigningOut ? 'Çıkış yapılıyor…' : 'Çıkış Yap'}
              onPress={vm.handleGoogleSignOut}
              variant="secondary"
              compact
              disabled={vm.isSwitchingAccount || vm.isSigningOut || vm.isDeleting}
            />
          </View>
        </CenterCard>
      ) : null}
    </View>
  );

  const renderPreferenceToggle = (
    key: keyof typeof prefs,
    title: string,
    subtitle: string,
    icon: GameIconName,
  ) => (
    <View style={styles.toggleRow} key={key}>
      <View style={styles.toggleIcon}>
        <GameIcon name={icon} size={18} color={colors.accentBlue} />
      </View>
      <View style={styles.toggleCopy}>
        <Text style={styles.toggleTitle}>{title}</Text>
        <Text style={styles.toggleSubtitle}>{subtitle}</Text>
      </View>
      <Switch
        value={prefs[key]}
        onValueChange={(value) => {
          void updateAppPreference(key, value);
        }}
        trackColor={{ false: colors.surface3, true: colors.primarySoft }}
        thumbColor={prefs[key] ? colors.accentBlue : colors.textMuted}
        accessibilityLabel={title}
        accessibilityRole="switch"
      />
    </View>
  );

  const renderPreferencesTab = () => (
    <View style={styles.tabContent}>
      <CenterCard>
        <SectionTitle title="Uygulama" compact />
        {renderPreferenceToggle(
          'notificationsEnabled',
          'Bildirimler',
          'Teslimat ve filo bildirimleri',
          'notification',
        )}
        {renderPreferenceToggle(
          'vibrationEnabled',
          'Titreşim',
          'Uyarılarda titreşim kullan',
          'cog',
        )}
        {renderPreferenceToggle(
          'soundEnabled',
          'Ses',
          'Bildirim ve uyarı sesleri',
          'play',
        )}
        {renderPreferenceToggle(
          'incomeSummaryEnabled',
          'Gelir özeti penceresi',
          'Günlük gelir özetini göster',
          'profit',
        )}
        <ListRowCard
          title="Dil"
          subtitle="Türkçe"
          icon="settings"
          onPress={() => showAlert('Dil', 'Şu an yalnızca Türkçe destekleniyor.')}
        />
      </CenterCard>

      <CenterCard>
        <SectionTitle title="Gizlilik ve Destek" compact />
        <ListRowCard
          title="Gizlilik Politikası"
          subtitle="Veri işleme ve saklama"
          icon="level"
          onPress={() => void handleOpenLegal('privacyPolicy', 'Gizlilik Politikası')}
        />
        <ListRowCard
          title="Gizlilik ve Çerez Ayarları"
          subtitle="Reklam ve çerez tercihleri"
          icon="settings"
          onPress={() => void handlePrivacyChoices()}
        />
        <ListRowCard
          title="Hesap Silme Bilgileri"
          subtitle="Silme süreci ve kapsam"
          icon="warning"
          onPress={() => void handleOpenLegal('accountDeletion', 'Hesap Silme')}
        />
        <ListRowCard
          title="Destek"
          subtitle="Yardım ve iletişim"
          icon="alert"
          onPress={() => void handleOpenLegal('support', 'Destek')}
        />
      </CenterCard>

      <CenterCard>
        <SectionTitle title="Hakkında" compact />
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Uygulama sürümü</Text>
          <Text style={styles.infoValue}>{appVersion}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Build</Text>
          <Text style={styles.infoValue}>{buildNumber}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Kayıt tarihi</Text>
          <Text style={styles.infoValue}>
            {formatRegistrationDate(useGameStore.getState().lastSeenRealTimeMs)}
          </Text>
        </View>
        <ListRowCard
          title="Yasal Belgeler"
          subtitle="Gizlilik ve kullanım koşulları"
          icon="contract"
          onPress={() => void handleOpenLegal('privacyPolicy', 'Yasal Belgeler')}
        />
      </CenterCard>

      <View style={styles.dangerZone}>
        <Pressable
          style={styles.dangerToggle}
          onPress={() => setDangerExpanded((open) => !open)}
          accessibilityRole="button"
          accessibilityState={{ expanded: dangerExpanded }}
          accessibilityLabel="Tehlikeli İşlemler"
        >
          <Text style={styles.dangerTitle}>Tehlikeli İşlemler</Text>
          <GameIcon
            name={dangerExpanded ? 'chevronUp' : 'chevronDown'}
            size={16}
            color={colors.danger}
          />
        </Pressable>
        {dangerExpanded ? (
          <View style={styles.dangerActions}>
            <ActionButton
              label={vm.isSigningOut ? 'Çıkış yapılıyor…' : 'Çıkış Yap'}
              onPress={vm.handleGoogleSignOut}
              variant="secondary"
              compact
              disabled={vm.isSwitchingAccount || vm.isSigningOut || vm.isDeleting}
            />
            <ActionButton
              label={
                vm.isDeleting
                  ? 'Siliniyor…'
                  : deleteConfirmStep === 1
                    ? 'Silme İşlemini Onayla'
                    : vm.isGuest
                      ? 'Misafir Kaydını Sil'
                      : 'Hesabı Sil'
              }
              onPress={handleDeleteAccountTwoStep}
              variant="danger"
              compact
              disabled={
                vm.isDeleting ||
                vm.isSwitchingAccount ||
                vm.isSigningOut ||
                !vm.safeAccountStatus.isReady
              }
            />
            {deleteConfirmStep === 1 ? (
              <Text style={styles.dangerHint}>
                Silinecek: yerel oyun kaydı, bulut verileri ve hesap bağlantısı.
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );

  return (
    <AppScreen scroll embedded>
      <ScreenHeader
        title="Hesap Merkezi"
        subtitle="Profil, bulut kaydı ve uygulama tercihleri"
        onBack={onBack}
        titleIcon="account"
        compact
      />

      <AccountCenterTabs active={activeTab} onChange={setActiveTab} />

      {activeTab === 'profile' ? renderProfileTab() : null}
      {activeTab === 'account' ? renderAccountTab() : null}
      {activeTab === 'preferences' ? renderPreferencesTab() : null}

      <BackendDiagnosticsGate />
      <UsernameSetupModal
        visible={vm.usernameModal != null}
        mode={vm.usernameModal === 'edit' ? 'edit' : 'setup'}
        initialUsername={vm.usernameProfile?.username}
        suggestedUsername={vm.usernameProfile?.suggestedUsername}
        nextChangeAvailableAtMs={vm.usernameProfile?.nextChangeAvailableAtMs}
        onClose={() => vm.setUsernameModal(null)}
        onSaved={(username) => {
          void vm.refreshUsernameProfile(false);
          vm.setUsernameModal(null);
        }}
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  tabRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
    padding: 4,
    borderRadius: 14,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
    backgroundColor: colors.surface,
  },
  tabButtonActive: {
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.accentBlue,
    shadowColor: colors.accentBlue,
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 2,
  },
  tabLabel: {
    ...typography.bodySmall,
    color: colors.textMuted,
    fontWeight: '700',
  },
  tabLabelActive: {
    color: colors.textPrimary,
  },
  tabContent: {
    gap: spacing.md,
    paddingBottom: spacing.lg,
  },
  centerCard: {
    borderColor: 'rgba(35, 136, 255, 0.22)',
    backgroundColor: '#0B1930',
    borderRadius: 20,
  },
  centerCardInner: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  profileHero: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 14,
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
    fontSize: 22,
    fontWeight: '800',
    color: colors.success,
  },
  profileHeroMain: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  profileName: {
    ...typography.cardTitle,
    fontSize: 18,
    fontWeight: '800',
  },
  profileSubtitle: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: 4,
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  statItem: {
    width: '47%',
    backgroundColor: colors.cardSoft,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
  },
  statLabel: {
    ...typography.caption,
    fontSize: 10,
  },
  statValue: {
    ...typography.bodySmall,
    fontWeight: '800',
    marginTop: 2,
  },
  identityValue: {
    ...typography.cardTitle,
    fontSize: 17,
    color: colors.accentBlue,
    fontWeight: '800',
  },
  identityHint: {
    ...typography.caption,
    color: colors.textSecondary,
    lineHeight: 16,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    minHeight: 36,
  },
  infoLabel: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    flex: 1,
  },
  infoValue: {
    ...typography.bodySmall,
    fontWeight: '700',
    color: colors.textPrimary,
    flex: 1,
    textAlign: 'right',
  },
  cardAction: {
    marginTop: spacing.xs,
    alignSelf: 'stretch',
  },
  leaderboardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  leaderboardIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
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
  },
  leaderboardSubtitle: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  leaderboardCta: {
    ...typography.caption,
    color: colors.accentAmber,
    fontWeight: '800',
  },
  authButtons: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  devHint: {
    ...typography.caption,
    color: colors.accentAmber,
    marginTop: spacing.xs,
  },
  cloudHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  actionStack: {
    gap: spacing.sm,
  },
  statusBanner: {
    ...typography.caption,
    color: colors.accentBlue,
    marginTop: spacing.xs,
    padding: spacing.sm,
    borderRadius: 10,
    backgroundColor: colors.accentBlueSoft,
  },
  statusBannerDanger: {
    ...typography.caption,
    color: colors.danger,
    marginTop: spacing.xs,
    padding: spacing.sm,
    borderRadius: 10,
    backgroundColor: colors.dangerSoft,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 52,
    paddingVertical: 6,
  },
  toggleIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: colors.accentBlueSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  toggleTitle: {
    ...typography.bodySmall,
    fontWeight: '700',
  },
  toggleSubtitle: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  dangerZone: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 90, 89, 0.35)',
    backgroundColor: colors.dangerSoft,
    overflow: 'hidden',
    marginBottom: spacing.lg,
  },
  dangerToggle: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  dangerTitle: {
    ...typography.bodySmall,
    color: colors.danger,
    fontWeight: '800',
  },
  dangerActions: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  dangerHint: {
    ...typography.caption,
    color: colors.danger,
    lineHeight: 16,
  },
});

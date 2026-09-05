/**
 * LogistiCore - Şirket / Daha Fazla Ekranı
 *
 * Premium şirket yönetim merkezi — finans, depolar ve yönetim araçları.
 */

import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  InteractionManager,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type LayoutChangeEvent,
  type ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppDialog } from '../components/AppDialogProvider';
import { MIN_TOUCH_TARGET } from '../constants/layout';
import { useTabBarLayout } from '../hooks/useTabBarLayout';

import {
  AppCard,
  AppScreen,
  GameIcon,
  ListRowCard,
  ProgressBar,
  ScreenHeader,
  SectionTitle,
  StatusBadge,
} from '../components/ui';
import type { GameIconName } from '../theme/icons';
import { CITIES_BY_ID } from '../data/cities';
import { getLevelProgress } from '../simulation/leveling';
import { getDriverProgress, MAX_DRIVER_LEVEL } from '../simulation/driverProgress';
import {
  captureCompanyStatsPeaks,
  normalizeCompanyStats,
} from '../domain/companyStats';
import CompanyProgressFoundationCard from '../features/companyStats/CompanyProgressFoundationCard';
import { useGameStore } from '../store/gameStore';
import { colors, formatMoney, spacing, typography } from '../theme';
import { restartSpotlightTutorial } from '../hooks/useSpotlightTutorialTriggers';
import { ENABLE_SPOTLIGHT_TUTORIAL } from '../tutorial/featureFlags';
import { useSpotlightTutorialStore } from '../store/spotlightTutorialStore';
import AccountSection from '../components/AccountSection';
import {
  resolveMoreScreenRoute,
  shouldFocusAccountSection,
} from '../navigation/managementNavigation';
import {
  CHALLENGES_ENABLED,
  COMPANY_STATS_ENABLED,
  DRIVER_PROGRESSION_ENABLED,
  ACHIEVEMENTS_ENABLED,
  INBOX_ENABLED,
  LEADERBOARD_ENABLED,
  SEASONS_ENABLED,
  SEASON_HISTORY_ENABLED,
} from '../config/backendRoadmap';

const WarehouseScreen = lazy(() => import('./WarehouseScreen'));
const FinanceScreen = lazy(() => import('./FinanceScreen'));
const MissionsScreen = lazy(() => import('./MissionsScreen'));
const LeaderboardScreen = lazy(() => import('./LeaderboardScreen'));
const UpgradesScreen = lazy(() => import('./UpgradesScreen'));
const AccountCenterScreen = lazy(() => import('./AccountCenterScreen'));
const SeasonsChallengesScreen = lazy(
  () => import('../features/seasons/SeasonsChallengesScreen'),
);
const ProgressHistoryScreen = lazy(
  () => import('../features/progression/ProgressHistoryScreen'),
);
const DebugSimulationScreen = lazy(() => import('./DebugSimulationScreen'));

function EmbeddedScreenFallback() {
  return (
    <View style={styles.embeddedFallback}>
      <ActivityIndicator size="small" color={colors.accentAmber} />
    </View>
  );
}

type MoreRoute =
  | 'menu'
  | 'warehouse'
  | 'finance'
  | 'debug'
  | 'missions'
  | 'leaderboard'
  | 'upgrades'
  | 'account'
  | 'seasons-challenges'
  | 'progress-history';

interface ModuleItem {
  key: MoreRoute | 'settings' | 'stats' | 'upgrades' | 'leaderboard';
  label: string;
  subtitle: string;
  icon: GameIconName;
  badge?: { label: string; variant: 'amber' | 'danger' | 'info' | 'muted' };
  placeholder?: boolean;
}

const DEV_MODULE_ITEMS: ModuleItem[] = [
  {
    key: 'stats',
    label: 'Şirket İstatistikleri',
    subtitle: 'Performans ve kariyer özetini incele',
    icon: 'profit',
    placeholder: true,
    badge: { label: 'Yakında', variant: 'muted' },
  },
  {
    key: 'settings',
    label: 'Ayarlar',
    subtitle: 'Oyun tercihleri ve bildirimler',
    icon: 'settings',
    placeholder: true,
    badge: { label: 'Yakında', variant: 'muted' },
  },
  {
    key: 'debug',
    label: 'Simülasyon Testi',
    subtitle: 'Internal test araçları',
    icon: 'maintenance',
    badge: { label: 'DEBUG', variant: 'amber' },
  },
];

const PLACEHOLDER_ALERT_MESSAGE = 'Bu özellik yakında eklenecek.';

function getCityName(cityId: string | undefined): string {
  if (!cityId) return 'Bilinmeyen şehir';
  return CITIES_BY_ID[cityId]?.name ?? cityId;
}

function CompanyProfileCard({
  companyName,
  level,
  reputation,
  driverCount,
  truckCount,
  homeCityName,
}: {
  companyName: string;
  level: number;
  reputation: number;
  driverCount: number;
  truckCount: number;
  homeCityName: string;
}) {
  const safeReputation = Math.max(0, Math.min(100, Math.round(reputation)));

  return (
    <AppCard variant="soft" style={styles.profileCard} padded={false}>
      <View style={styles.profileRow}>
        <View style={styles.profileIconWrap}>
          <GameIcon name="company" size={26} color={colors.accentAmber} />
        </View>
        <View style={styles.profileMain}>
          <Text style={styles.profileBrand}>LogistiCore</Text>
          <Text style={styles.profileName} numberOfLines={1}>
            {companyName}
          </Text>
          <Text style={styles.profileMeta} numberOfLines={1}>
            Seviye {level} · İtibar {safeReputation}/100
          </Text>
          <Text style={styles.profileMeta} numberOfLines={1}>
            {driverCount} şoför · {truckCount} kamyon · Merkez: {homeCityName}
          </Text>
        </View>
        <StatusBadge label={`Lv.${level}`} variant="amber" size="sm" />
      </View>
    </AppCard>
  );
}

function CompanyGrowthCard({
  level,
  xpProgress,
  completedContracts,
  truckCount,
  warehouseCount,
}: {
  level: number;
  xpProgress: number;
  completedContracts: number;
  truckCount: number;
  warehouseCount: number;
}) {
  return (
    <AppCard style={styles.growthCard} padded={false}>
      <View style={styles.growthHeader}>
        <GameIcon name="level" size={16} color={colors.accentBlue} />
        <Text style={styles.growthTitle}>Şirket Gelişimi</Text>
      </View>

      <View style={styles.growthStats}>
        <View style={styles.growthStatItem}>
          <Text style={styles.growthStatLabel} numberOfLines={2}>
            Seviye
          </Text>
          <Text style={styles.growthStatValue} numberOfLines={1}>
            {level}
          </Text>
        </View>
        <View style={styles.growthStatItem}>
          <Text style={styles.growthStatLabel} numberOfLines={2}>
            Sözleşme
          </Text>
          <Text style={styles.growthStatValue} numberOfLines={1}>
            {completedContracts}
          </Text>
        </View>
        <View style={styles.growthStatItem}>
          <Text style={styles.growthStatLabel} numberOfLines={2}>
            Filo
          </Text>
          <Text style={styles.growthStatValue} numberOfLines={1}>
            {truckCount}
          </Text>
        </View>
        <View style={styles.growthStatItem}>
          <Text style={styles.growthStatLabel} numberOfLines={2}>
            Depo
          </Text>
          <Text style={styles.growthStatValue} numberOfLines={1}>
            {warehouseCount}
          </Text>
        </View>
      </View>

      <Text style={styles.xpLabel}>XP ilerlemesi</Text>
      <ProgressBar progress={xpProgress} color={colors.accentBlue} height={6} />
      <Text style={styles.xpHint}>{Math.round(xpProgress * 100)}% tamamlandı</Text>
    </AppCard>
  );
}

function ModuleChevron() {
  return <Text style={styles.chevron}>›</Text>;
}

export default function MoreScreen({ isActive = true }: { isActive?: boolean }) {
  const { alert: showAlert } = useAppDialog();
  const [route, setRoute] = useState<MoreRoute>('menu');
  const [focusAccountSection, setFocusAccountSection] = useState(false);
  const player = useGameStore((state) => state.player);
  const companyStats = useGameStore((state) => state.companyStats);
  const progressionFoundationState = useGameStore((state) => state.progressionFoundation);
  const pendingMoreSubRoute = useGameStore((state) => state.pendingMoreSubRoute);
  const clearPendingMoreSubRoute = useGameStore((state) => state.clearPendingMoreSubRoute);
  const menuScrollRef = useRef<ScrollView | null>(null);
  const accountSectionYRef = useRef(0);

  const pendingUpgradeTruckId = useGameStore((state) => state.pendingUpgradeTruckId);
  const clearPendingUpgradeTruckId = useGameStore((state) => state.clearPendingUpgradeTruckId);

  useEffect(() => {
    if (!isActive || !pendingMoreSubRoute) return;
    if (pendingMoreSubRoute === 'account') {
      setRoute('account');
      setFocusAccountSection(false);
    } else {
      const nextRoute = resolveMoreScreenRoute(pendingMoreSubRoute);
      const focusAccount = shouldFocusAccountSection(pendingMoreSubRoute);
      if (nextRoute) {
        setRoute(nextRoute);
      }
      setFocusAccountSection(focusAccount);
    }
    clearPendingMoreSubRoute();
  }, [isActive, pendingMoreSubRoute, clearPendingMoreSubRoute]);

  useEffect(() => {
    if (!focusAccountSection || route !== 'menu') {
      return;
    }
    const task = InteractionManager.runAfterInteractions(() => {
      menuScrollRef.current?.scrollTo({
        y: Math.max(0, accountSectionYRef.current - 12),
        animated: true,
      });
      setFocusAccountSection(false);
    });
    return () => task.cancel();
  }, [focusAccountSection, route]);

  const handleAccountSectionLayout = (event: LayoutChangeEvent) => {
    accountSectionYRef.current = event.nativeEvent.layout.y;
  };

  const levelProgress = useMemo(
    () => (player ? getLevelProgress(player) : null),
    [player],
  );
  const progressionFoundation = useMemo(() => {
    if (!player || !DRIVER_PROGRESSION_ENABLED || !COMPANY_STATS_ENABLED) return null;
    const driver = player.drivers[0];
    if (!driver) return null;
    const progress = getDriverProgress(driver);
    const stats = captureCompanyStatsPeaks(
      normalizeCompanyStats(companyStats, { player, currentTime: 0 }),
      player,
    );
    return {
      driverName: driver.name,
      driverLevel: progress.level,
      driverXpIntoLevel: progress.xpIntoLevel,
      driverXpForNextLevel: progress.xpForNextLevel,
      driverProgress:
        progress.level >= MAX_DRIVER_LEVEL || progress.xpForNextLevel <= 0
          ? 1
          : Math.max(0, Math.min(1, progress.xpIntoLevel / progress.xpForNextLevel)),
      stats,
    };
  }, [companyStats, player]);

  const handleModulePress = (item: ModuleItem) => {
    if (item.placeholder) {
      showAlert('Yakında', PLACEHOLDER_ALERT_MESSAGE);
      return;
    }
    setRoute(item.key as MoreRoute);
  };

  if (route === 'warehouse') {
    return (
      <EmbeddedModule>
        <SubNavBar title="Depolar" onBack={() => setRoute('menu')} />
        <Suspense fallback={<EmbeddedScreenFallback />}>
          <WarehouseScreen />
        </Suspense>
      </EmbeddedModule>
    );
  }

  if (route === 'finance') {
    return (
      <View style={styles.embeddedRoot}>
        <Suspense fallback={<EmbeddedScreenFallback />}>
          <FinanceScreen onBack={() => setRoute('menu')} />
        </Suspense>
      </View>
    );
  }

  if (route === 'missions') {
    return (
      <View style={styles.embeddedRoot}>
        <Suspense fallback={<EmbeddedScreenFallback />}>
          <MissionsScreen onBack={() => setRoute('menu')} />
        </Suspense>
      </View>
    );
  }

  if (route === 'leaderboard') {
    return (
      <View style={styles.embeddedRoot}>
        <Suspense fallback={<EmbeddedScreenFallback />}>
          <LeaderboardScreen
            onBack={() => setRoute('menu')}
            onOpenAccountSettings={() => setRoute('account')}
          />
        </Suspense>
      </View>
    );
  }

  if (route === 'account') {
    return (
      <View style={styles.embeddedRoot}>
        <Suspense fallback={<EmbeddedScreenFallback />}>
          <AccountCenterScreen
            onBack={() => setRoute('menu')}
            onOpenLeaderboard={LEADERBOARD_ENABLED ? () => setRoute('leaderboard') : undefined}
          />
        </Suspense>
      </View>
    );
  }

  if (route === 'seasons-challenges' && SEASONS_ENABLED && CHALLENGES_ENABLED) {
    return (
      <View style={styles.embeddedRoot}>
        <Suspense fallback={<EmbeddedScreenFallback />}>
          <SeasonsChallengesScreen
            onBack={() => setRoute('menu')}
            onOpenAccountCenter={() => setRoute('account')}
            onOpenLeaderboard={
              LEADERBOARD_ENABLED ? () => setRoute('leaderboard') : undefined
            }
          />
        </Suspense>
      </View>
    );
  }

  if (
    route === 'progress-history' &&
    ACHIEVEMENTS_ENABLED &&
    SEASON_HISTORY_ENABLED &&
    INBOX_ENABLED
  ) {
    return (
      <View style={styles.embeddedRoot}>
        <Suspense fallback={<EmbeddedScreenFallback />}>
          <ProgressHistoryScreen
            onBack={() => setRoute('menu')}
            onOpenSeasons={
              SEASONS_ENABLED && CHALLENGES_ENABLED
                ? () => setRoute('seasons-challenges')
                : undefined
            }
          />
        </Suspense>
      </View>
    );
  }

  if (route === 'upgrades') {
    return (
      <View style={styles.embeddedRoot}>
        <Suspense fallback={<EmbeddedScreenFallback />}>
          <UpgradesScreen
            truckId={pendingUpgradeTruckId}
            onBack={() => {
              clearPendingUpgradeTruckId();
              setRoute('menu');
            }}
            backLabel="‹ Şirket"
          />
        </Suspense>
      </View>
    );
  }

  if (route === 'debug' && __DEV__) {
    return (
      <EmbeddedModule>
        <SubNavBar title="Simülasyon Testi" onBack={() => setRoute('menu')} />
        <Suspense fallback={<EmbeddedScreenFallback />}>
          <DebugSimulationScreen />
        </Suspense>
      </EmbeddedModule>
    );
  }

  const level = Math.max(1, player?.level ?? player?.companyLevel ?? 1);
  const reputation = player?.reputation ?? 0;
  const trucks = player?.trucks ?? [];
  const drivers = player?.drivers ?? [];
  const warehouses = player?.warehouses ?? [];
  const completedContracts = player?.completedContracts ?? 0;
  const companyName = player?.companyName ?? 'LogistiCore Lojistik';
  const homeCityName = getCityName(player?.homeCityId);
  const xpProgress = levelProgress?.progressRatio ?? 0;

  return (
    <AppScreen scroll scrollRef={menuScrollRef}>
      <ScreenHeader
        title="Şirket"
        subtitle="Şirket özeti, gelişim ve hesap"
        titleIcon="company"
        compact
      />

      {player ? (
        <>
          <CompanyProfileCard
            companyName={companyName}
            level={level}
            reputation={reputation}
            driverCount={drivers.length}
            truckCount={trucks.length}
            homeCityName={homeCityName}
          />

          <CompanyGrowthCard
            level={level}
            xpProgress={Math.max(0, Math.min(1, xpProgress))}
            completedContracts={completedContracts}
            truckCount={trucks.length}
            warehouseCount={warehouses.length}
          />

          <View style={styles.cashStrip}>
            <GameIcon name="cash" size={16} color={colors.success} />
            <Text style={styles.cashLabel}>Nakit</Text>
            <Text style={styles.cashValue}>{formatMoney(player.money ?? 0)}</Text>
          </View>
        </>
      ) : null}

      <View onLayout={handleAccountSectionLayout} collapsable={false}>
        <AccountSection
          onOpenLeaderboard={
            LEADERBOARD_ENABLED ? () => setRoute('leaderboard') : undefined
          }
          onOpenAccountCenter={() => setRoute('account')}
        />
      </View>

      {SEASONS_ENABLED && CHALLENGES_ENABLED ? (
        <View style={styles.moduleList}>
          <ListRowCard
            title="Sezonlar ve Görevler"
            subtitle="Günlük ve haftalık hedeflerini takip et"
            icon="trophy"
            onPress={() => setRoute('seasons-challenges')}
            right={
              <View style={styles.moduleRight}>
                <StatusBadge label="V1.1" variant="amber" size="sm" />
                <ModuleChevron />
              </View>
            }
          />

          {progressionFoundation ? (
            <CompanyProgressFoundationCard
              driverName={progressionFoundation.driverName}
              driverLevel={progressionFoundation.driverLevel}
              driverXpIntoLevel={progressionFoundation.driverXpIntoLevel}
              driverXpForNextLevel={progressionFoundation.driverXpForNextLevel}
              driverProgress={progressionFoundation.driverProgress}
              deliveriesCompleted={progressionFoundation.stats.deliveriesCompleted}
              totalDistanceCompleted={progressionFoundation.stats.totalDistanceCompleted}
              deliveryRevenueEarned={progressionFoundation.stats.deliveryRevenueEarned}
              historicalDataComplete={progressionFoundation.stats.historicalDataComplete}
            />
          ) : null}
        </View>
      ) : null}

      {ACHIEVEMENTS_ENABLED && SEASON_HISTORY_ENABLED && INBOX_ENABLED ? (
        <View style={styles.moduleList}>
          <ListRowCard
            title="İlerleme ve Geçmiş"
            subtitle="Başarımlar, sezon geçmişi ve bildirimler"
            icon="trophy"
            onPress={() => setRoute('progress-history')}
            right={
              <View style={styles.moduleRight}>
                {(progressionFoundationState?.inbox ?? []).some((item) => !item.readAt) ? (
                  <StatusBadge
                    label={String((progressionFoundationState?.inbox ?? []).filter((item) => !item.readAt).length)}
                    variant="info"
                    size="sm"
                  />
                ) : null}
                <ModuleChevron />
              </View>
            }
          />
        </View>
      ) : null}

      {/* Finans / Depolar / Görevler / Geliştirmeler bu ekranda tekrarlanmaz —
          mevcut tab ve deep-link (pendingMoreSubRoute) girişleri korunur. */}

      {__DEV__ ? (
        <View style={styles.moduleList}>
          {DEV_MODULE_ITEMS.filter((item) => item.key === 'debug').map((item) => (
            <ListRowCard
              key={item.key}
              title={item.label}
              subtitle={item.subtitle}
              icon={item.icon}
              onPress={() => handleModulePress(item)}
              right={
                <View style={styles.moduleRight}>
                  {item.badge ? (
                    <StatusBadge label={item.badge.label} variant={item.badge.variant} size="sm" />
                  ) : null}
                  <ModuleChevron />
                </View>
              }
            />
          ))}
        </View>
      ) : null}

      {__DEV__ && ENABLE_SPOTLIGHT_TUTORIAL ? (
        <AppCard variant="soft" style={styles.debugNoteCard} padded>
          <SectionTitle title="Tutorial (Test)" compact />
          <Text style={styles.debugNoteText}>
            Spotlight tutorial akışlarını yeniden başlatmak için aşağıdaki butonları kullan.
          </Text>
          <View style={styles.tutorialRestartRow}>
            <TouchableOpacity
              style={styles.tutorialRestartButton}
              onPress={() => restartSpotlightTutorial('first_contract')}
            >
              <Text style={styles.tutorialRestartText}>İlk Sözleşme</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.tutorialRestartButton}
              onPress={() => restartSpotlightTutorial('track_delivery')}
            >
              <Text style={styles.tutorialRestartText}>Teslimat Takibi</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.tutorialRestartButton}
              onPress={() => restartSpotlightTutorial('market_basics')}
            >
              <Text style={styles.tutorialRestartText}>Piyasa</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            onPress={() => {
              useGameStore.getState().resetSpotlightTutorials();
              useSpotlightTutorialStore.getState().resetActive();
              showAlert('Tutorial sıfırlandı', 'Tüm spotlight tutorial ilerlemesi temizlendi.');
            }}
          >
            <Text style={styles.tutorialResetAll}>Tüm tutorial kaydını sıfırla</Text>
          </TouchableOpacity>
        </AppCard>
      ) : null}

      {__DEV__ ? (
        <AppCard variant="soft" style={styles.debugNoteCard} padded>
          <SectionTitle title="Başlangıç Rehberi (Test)" compact />
          <TouchableOpacity
            onPress={() => {
              useGameStore.getState().resetOnboardingForDev();
              showAlert('Rehber sıfırlandı', 'Başlangıç rehberi yeniden başlatıldı.');
            }}
          >
            <Text style={styles.tutorialResetAll}>Onboarding&apos;i Sıfırla</Text>
          </TouchableOpacity>
        </AppCard>
      ) : null}

      {__DEV__ ? (
        <AppCard variant="soft" style={styles.debugNoteCard} padded={false}>
          <GameIcon name="warning" size={14} color={colors.accentAmber} />
          <Text style={styles.debugNoteText}>
            Simülasyon Testi internal test aracıdır. Production öncesi gizlenecek.
          </Text>
        </AppCard>
      ) : null}
    </AppScreen>
  );
}

function EmbeddedModule({ children }: { children: React.ReactNode }) {
  const { screenTopPadding } = useTabBarLayout();
  return <View style={[styles.embeddedRoot, { paddingTop: screenTopPadding }]}>{children}</View>;
}

function SubNavBar({ title, onBack }: { title: string; onBack: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.subNav, { paddingTop: Math.max(insets.top, 8) }]}>
      <TouchableOpacity style={styles.subNavBack} onPress={onBack} activeOpacity={0.8}>
        <Text style={styles.subNavBackText}>‹ Şirket</Text>
      </TouchableOpacity>
      <Text style={styles.subNavTitle} numberOfLines={1}>
        {title}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  embeddedRoot: {
    flex: 1,
    backgroundColor: colors.background,
  },
  embeddedFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  subNav: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: 2,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  subNavBack: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    paddingRight: 12,
  },
  subNavBackText: {
    color: colors.accentAmber,
    fontSize: 14,
    fontWeight: '700',
  },
  subNavTitle: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },

  profileCard: {
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  profileIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: colors.accentAmberSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileMain: {
    flex: 1,
    minWidth: 0,
  },
  profileBrand: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  profileName: {
    ...typography.cardTitle,
    fontSize: 16,
    marginTop: 2,
  },
  profileMeta: {
    ...typography.caption,
    marginTop: 3,
    lineHeight: 14,
  },

  growthCard: {
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  growthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  growthTitle: {
    ...typography.sectionTitle,
    fontSize: 14,
  },
  growthStats: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  growthStatItem: {
    flex: 1,
    minWidth: 0,
    backgroundColor: colors.cardSoft,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    paddingHorizontal: 4,
    alignItems: 'center',
  },
  growthStatLabel: {
    ...typography.caption,
    fontSize: 10,
    lineHeight: 13,
    textAlign: 'center',
  },
  growthStatValue: {
    ...typography.bodySmall,
    fontWeight: '800',
    marginTop: 2,
  },
  xpLabel: {
    ...typography.caption,
    marginBottom: 4,
  },
  xpHint: {
    ...typography.caption,
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 4,
    textAlign: 'right',
  },

  cashStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.successSoft,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.success,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
  },
  cashLabel: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    flex: 1,
  },
  cashValue: {
    ...typography.bodySmall,
    fontWeight: '800',
    color: colors.success,
  },

  moduleList: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  moduleRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  chevron: {
    color: colors.textMuted,
    fontSize: 22,
    fontWeight: '700',
  },

  debugNoteCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  debugNoteText: {
    ...typography.caption,
    flex: 1,
    lineHeight: 15,
    color: colors.textSecondary,
  },
  tutorialRestartRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  tutorialRestartButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 10,
    backgroundColor: colors.accentBlueSoft,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.35)',
  },
  tutorialRestartText: {
    ...typography.caption,
    color: colors.accentBlue,
    fontWeight: '700',
  },
  tutorialResetAll: {
    ...typography.caption,
    color: colors.accentAmber,
    fontWeight: '700',
  },
});

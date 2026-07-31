/**
 * LogistiCore - Şirket / Daha Fazla Ekranı
 *
 * Premium şirket yönetim merkezi — finans, depolar ve yönetim araçları.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  InteractionManager,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type LayoutChangeEvent,
  type ScrollView,
} from 'react-native';

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
import { useGameStore } from '../store/gameStore';
import { colors, formatMoney, spacing, typography } from '../theme';
import { restartSpotlightTutorial } from '../hooks/useSpotlightTutorialTriggers';
import { ENABLE_SPOTLIGHT_TUTORIAL } from '../tutorial/featureFlags';
import { useSpotlightTutorialStore } from '../store/spotlightTutorialStore';
import DebugSimulationScreen from './DebugSimulationScreen';
import FinanceScreen from './FinanceScreen';
import LeaderboardScreen from './LeaderboardScreen';
import MissionsScreen from './MissionsScreen';
import WarehouseScreen from './WarehouseScreen';
import UpgradesScreen from './UpgradesScreen';
import AccountSection from '../components/AccountSection';
import {
  resolveMoreScreenRoute,
  shouldFocusAccountSection,
} from '../navigation/managementNavigation';
import { LEADERBOARD_ENABLED } from '../config/backendRoadmap';

type MoreRoute = 'menu' | 'warehouse' | 'finance' | 'debug' | 'missions' | 'leaderboard' | 'upgrades';

interface ModuleItem {
  key: MoreRoute | 'settings' | 'stats' | 'upgrades' | 'leaderboard';
  label: string;
  subtitle: string;
  icon: GameIconName;
  badge?: { label: string; variant: 'amber' | 'danger' | 'info' | 'muted' };
  placeholder?: boolean;
}

const PRODUCTION_MODULE_ITEMS: ModuleItem[] = [
  {
    key: 'finance',
    label: 'Finans',
    subtitle: 'Gelir, gider ve şirket sağlığını görüntüle',
    icon: 'cash',
  },
  {
    key: 'warehouse',
    label: 'Depolar',
    subtitle: 'Stok, kapasite ve ticaret ürünlerini yönet',
    icon: 'warehouse',
  },
  {
    key: 'missions',
    label: 'Görevler',
    subtitle: 'Hedeflerini ve ödüllerini takip et',
    icon: 'contract',
  },
  {
    key: 'leaderboard',
    label: 'Liderlik Tablosu',
    subtitle: 'Haftalık şirket puanı sıralaması',
    icon: 'company',
  },
  {
    key: 'upgrades',
    label: 'Geliştirmeler',
    subtitle: 'Filo ve şirket yükseltmeleri',
    icon: 'upgrade',
  },
];

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

const ENABLED_PRODUCTION_MODULE_ITEMS = PRODUCTION_MODULE_ITEMS.filter(
  (item) => item.key !== 'leaderboard' || LEADERBOARD_ENABLED,
);

const VISIBLE_MODULE_ITEMS = __DEV__
  ? [...ENABLED_PRODUCTION_MODULE_ITEMS, ...DEV_MODULE_ITEMS]
  : ENABLED_PRODUCTION_MODULE_ITEMS;

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

export default function MoreScreen() {
  const { alert: showAlert } = useAppDialog();
  const [route, setRoute] = useState<MoreRoute>('menu');
  const [focusAccountSection, setFocusAccountSection] = useState(false);
  const player = useGameStore((state) => state.player);
  const pendingMoreSubRoute = useGameStore((state) => state.pendingMoreSubRoute);
  const clearPendingMoreSubRoute = useGameStore((state) => state.clearPendingMoreSubRoute);
  const menuScrollRef = useRef<ScrollView | null>(null);
  const accountSectionYRef = useRef(0);

  const pendingUpgradeTruckId = useGameStore((state) => state.pendingUpgradeTruckId);
  const clearPendingUpgradeTruckId = useGameStore((state) => state.clearPendingUpgradeTruckId);

  useEffect(() => {
    if (!pendingMoreSubRoute) return;
    const nextRoute = resolveMoreScreenRoute(pendingMoreSubRoute);
    const focusAccount = shouldFocusAccountSection(pendingMoreSubRoute);
    if (nextRoute) {
      setRoute(nextRoute);
    }
    setFocusAccountSection(focusAccount);
    clearPendingMoreSubRoute();
  }, [pendingMoreSubRoute, clearPendingMoreSubRoute]);

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
        <WarehouseScreen />
      </EmbeddedModule>
    );
  }

  if (route === 'finance') {
    return (
      <EmbeddedModule>
        <SubNavBar title="Finans" onBack={() => setRoute('menu')} />
        <FinanceScreen />
      </EmbeddedModule>
    );
  }

  if (route === 'missions') {
    return (
      <View style={styles.embeddedRoot}>
        <MissionsScreen onBack={() => setRoute('menu')} />
      </View>
    );
  }

  if (route === 'leaderboard' && LEADERBOARD_ENABLED) {
    return (
      <View style={styles.embeddedRoot}>
        <LeaderboardScreen onBack={() => setRoute('menu')} />
      </View>
    );
  }

  if (route === 'upgrades') {
    return (
      <View style={styles.embeddedRoot}>
        <UpgradesScreen
          truckId={pendingUpgradeTruckId}
          onBack={() => {
            clearPendingUpgradeTruckId();
            setRoute('menu');
          }}
          backLabel="‹ Şirket"
        />
      </View>
    );
  }

  if (route === 'debug' && __DEV__) {
    return (
      <EmbeddedModule>
        <SubNavBar title="Simülasyon Testi" onBack={() => setRoute('menu')} />
        <DebugSimulationScreen />
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
        subtitle="Şirket özeti, gelişim ve yönetim modülleri"
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
            <Text style={styles.diamondStrip}>💎 {Math.max(0, player.diamonds ?? 0)}</Text>
          </View>
          {/* TODO: Add premium shop and diamond spending system later. */}
        </>
      ) : null}

      <View onLayout={handleAccountSectionLayout} collapsable={false}>
        <AccountSection />
      </View>

      <SectionTitle title="Yönetim Modülleri" compact />

      <View style={styles.moduleList}>
        {VISIBLE_MODULE_ITEMS.map((item) => (
          <ListRowCard
            key={item.key}
            title={item.label}
            subtitle={item.subtitle}
            icon={item.icon}
            onPress={() => handleModulePress(item)}
            right={
              <View style={styles.moduleRight}>
                {__DEV__ && item.badge ? (
                  <StatusBadge label={item.badge.label} variant={item.badge.variant} size="sm" />
                ) : null}
                <ModuleChevron />
              </View>
            }
          />
        ))}
      </View>

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
  return (
    <View style={styles.subNav}>
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
  subNav: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: 4,
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
  diamondStrip: {
    ...typography.bodySmall,
    fontWeight: '800',
    color: colors.accentBlue,
    marginLeft: spacing.sm,
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

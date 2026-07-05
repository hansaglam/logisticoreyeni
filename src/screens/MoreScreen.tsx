/**
 * LogistiCore - Şirket / Daha Fazla Ekranı
 *
 * Premium şirket yönetim merkezi — finans, depolar ve yönetim araçları.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

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
import { STATUS_BAR_HEIGHT } from '../theme/ui';
import DebugSimulationScreen from './DebugSimulationScreen';
import FinanceScreen from './FinanceScreen';
import WarehouseScreen from './WarehouseScreen';

type MoreRoute = 'menu' | 'warehouse' | 'finance' | 'debug';

interface ModuleItem {
  key: MoreRoute | 'settings' | 'stats' | 'upgrades';
  label: string;
  subtitle: string;
  icon: GameIconName;
  badge?: { label: string; variant: 'amber' | 'danger' | 'info' | 'muted' };
  placeholder?: boolean;
}

// TODO: Hide Debug Simulation in production builds.
const MODULE_ITEMS: ModuleItem[] = [
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
    key: 'stats',
    label: 'Şirket İstatistikleri',
    subtitle: 'Performans ve kariyer özetini incele',
    icon: 'profit',
    placeholder: true,
    badge: { label: 'Yakında', variant: 'muted' },
  },
  {
    key: 'upgrades',
    label: 'Geliştirmeler',
    subtitle: 'Şirket ve filo yükseltmeleri',
    icon: 'upgrade',
    placeholder: true,
    badge: { label: 'Yakında', variant: 'muted' },
  },
  {
    key: 'debug',
    label: 'Simülasyon Testi',
    subtitle: 'Yalnızca test sürümünde kullanılmalı',
    icon: 'maintenance',
    badge: { label: 'DEBUG', variant: 'amber' },
  },
  {
    key: 'settings',
    label: 'Ayarlar',
    subtitle: 'Oyun tercihleri ve bildirimler',
    icon: 'settings',
    placeholder: true,
    badge: { label: 'Yakında', variant: 'muted' },
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
            Level {level} · İtibar {safeReputation}/100
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
          <Text style={styles.growthStatLabel}>Level</Text>
          <Text style={styles.growthStatValue}>{level}</Text>
        </View>
        <View style={styles.growthStatItem}>
          <Text style={styles.growthStatLabel}>Sözleşme</Text>
          <Text style={styles.growthStatValue}>{completedContracts}</Text>
        </View>
        <View style={styles.growthStatItem}>
          <Text style={styles.growthStatLabel}>Filo</Text>
          <Text style={styles.growthStatValue}>{truckCount}</Text>
        </View>
        <View style={styles.growthStatItem}>
          <Text style={styles.growthStatLabel}>Depo</Text>
          <Text style={styles.growthStatValue}>{warehouseCount}</Text>
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
  const [route, setRoute] = useState<MoreRoute>('menu');
  const player = useGameStore((state) => state.player);
  const pendingMoreSubRoute = useGameStore((state) => state.pendingMoreSubRoute);
  const clearPendingMoreSubRoute = useGameStore((state) => state.clearPendingMoreSubRoute);

  useEffect(() => {
    if (!pendingMoreSubRoute) return;
    setRoute(pendingMoreSubRoute);
    clearPendingMoreSubRoute();
  }, [pendingMoreSubRoute, clearPendingMoreSubRoute]);

  const levelProgress = useMemo(
    () => (player ? getLevelProgress(player) : null),
    [player],
  );

  const handleModulePress = (item: ModuleItem) => {
    if (item.placeholder) {
      Alert.alert('Yakında', PLACEHOLDER_ALERT_MESSAGE);
      return;
    }
    setRoute(item.key as MoreRoute);
  };

  if (route === 'warehouse') {
    return (
      <View style={styles.embeddedRoot}>
        <SubNavBar title="Depolar" onBack={() => setRoute('menu')} />
        <WarehouseScreen />
      </View>
    );
  }

  if (route === 'finance') {
    return (
      <View style={styles.embeddedRoot}>
        <SubNavBar title="Finans" onBack={() => setRoute('menu')} />
        <FinanceScreen />
      </View>
    );
  }

  if (route === 'debug') {
    return (
      <View style={styles.embeddedRoot}>
        <SubNavBar title="Simülasyon Testi" onBack={() => setRoute('menu')} />
        <DebugSimulationScreen />
      </View>
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
    <AppScreen scroll>
      <ScreenHeader
        title="Şirket"
        subtitle="Şirketini, finansını ve yönetim araçlarını kontrol et"
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

      <SectionTitle title="Yönetim Modülleri" compact />

      {MODULE_ITEMS.map((item) => (
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

      <AppCard variant="soft" style={styles.debugNoteCard} padded={false}>
        <GameIcon name="warning" size={14} color={colors.accentAmber} />
        <Text style={styles.debugNoteText}>
          Simülasyon Testi internal test aracıdır. Production öncesi gizlenecek.
        </Text>
      </AppCard>
    </AppScreen>
  );
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
    paddingTop: STATUS_BAR_HEIGHT,
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
    paddingVertical: 6,
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
    backgroundColor: colors.cardSoft,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    alignItems: 'center',
  },
  growthStatLabel: {
    ...typography.caption,
    fontSize: 10,
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
});

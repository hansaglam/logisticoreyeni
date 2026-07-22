/**
 * LogistiCore - Geliştirmeler (Upgrade Hub V1.1)
 *
 * Filo kamyon yükseltmeleri + şirket preview sekmesi.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  ActionButton,
  AppCard,
  AppScreen,
  GameIcon,
  ScreenHeader,
  SectionTitle,
  StatusBadge,
} from '../components/ui';
import { useTabBarLayout } from '../hooks/useTabBarLayout';
import { CITIES_BY_ID } from '../data/cities';
import { resolveTruckCityId } from '../simulation/delivery';
import {
  MAX_UPGRADE_LEVEL,
  TRUCK_UPGRADE_ACTION_LABELS,
  TRUCK_UPGRADE_BENEFITS,
  TRUCK_UPGRADE_DISPLAY_NAMES,
  TRUCK_UPGRADE_TYPES,
  formatTruckUpgradeCurrentEffect,
  formatTruckUpgradeSuccessToast,
  getEffectiveTruckCapacity,
  getTruckUpgradeCost,
  normalizeTruckUpgrades,
  type TruckUpgradeType,
} from '../simulation/truckUpgrades';
import { useGameStore } from '../store/gameStore';
import type { Truck, TruckStatus } from '../types/game';
import { colors, formatMoney, spacing, typography } from '../theme';

type UpgradesTab = 'fleet' | 'company';

interface UpgradesScreenProps {
  truckId?: string | null;
  onBack: () => void;
  backLabel?: string;
}

interface CompanyPreviewItem {
  id: string;
  title: string;
  description: string;
}

const COMPANY_PREVIEW_ITEMS: CompanyPreviewItem[] = [
  {
    id: 'operations',
    title: 'Operasyon Yönetimi',
    description: 'Teslimat planlama ve rota verimliliği',
  },
  {
    id: 'warehouse',
    title: 'Depo Verimliliği',
    description: 'Depo kapasitesi ve işlem maliyetleri',
  },
  {
    id: 'contracts',
    title: 'Sözleşme Ağı',
    description: 'Daha kârlı ve prestijli işler',
  },
  {
    id: 'market',
    title: 'Piyasa Analizi',
    description: 'Ürün fiyat tahminleri ve fırsatlar',
  },
];

const UPGRADE_SUMMARY_LABELS: Record<TruckUpgradeType, string> = {
  engine: 'Motor',
  fuelEfficiency: 'Yakıt',
  cargo: 'Kargo',
  durability: 'Dayanıklılık',
};

function getCityName(cityId: string | undefined): string {
  if (!cityId) return 'Bilinmeyen şehir';
  return CITIES_BY_ID[cityId]?.name ?? cityId;
}

function translateErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  if (error.message.includes('Yetersiz')) return 'Yetersiz bakiye';
  if (error.message.includes('maksimum')) return 'Maksimum seviye';
  if (error.message.includes('Kiralık')) return 'Kiralık kamyon geliştirilemez';
  if (error.message.includes('boştaki')) return 'Kamyon boşta olmalı';
  return error.message;
}

function getTruckStatusShortLabel(status: TruckStatus): string {
  switch (status) {
    case 'idle':
      return 'Boşta';
    case 'on_route':
      return 'Teslimatta';
    case 'transferring':
      return 'Yolda';
    case 'maintenance':
      return 'Bakımda';
    default:
      return 'Meşgul';
  }
}

function getTruckStatusPresentation(status: TruckStatus): {
  label: string;
  variant: 'success' | 'blue' | 'amber' | 'muted';
} {
  switch (status) {
    case 'idle':
      return { label: 'BOŞTA', variant: 'success' };
    case 'on_route':
      return { label: 'TESLİMATTA', variant: 'blue' };
    case 'transferring':
      return { label: 'YOLDA', variant: 'amber' };
    case 'maintenance':
      return { label: 'BAKIMDA', variant: 'amber' };
    default:
      return { label: 'MEŞGUL', variant: 'muted' };
  }
}

function formatTruckUpgradeSummaryLine(truck: Truck): string {
  const normalized = normalizeTruckUpgrades(truck);
  return TRUCK_UPGRADE_TYPES.map((type) => {
    const level = normalized.upgrades?.[type] ?? 0;
    return `${UPGRADE_SUMMARY_LABELS[type]} Lv.${level}`;
  }).join(' · ');
}

const TabButton = React.memo(function TabButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.tabButton, active && styles.tabButtonActive]}>
      <Text style={[styles.tabButtonText, active && styles.tabButtonTextActive]}>{label}</Text>
    </Pressable>
  );
});

interface TruckPickerChipProps {
  truck: Truck;
  homeCityId?: string;
  selected: boolean;
  onPress: () => void;
}

const TruckPickerChip = React.memo(function TruckPickerChip({
  truck,
  homeCityId,
  selected,
  onPress,
}: TruckPickerChipProps) {
  const cityId = resolveTruckCityId(truck, homeCityId);
  const status = getTruckStatusPresentation(truck.status);

  return (
    <Pressable
      onPress={onPress}
      style={[styles.truckChip, selected && styles.truckChipSelected]}
    >
      {selected ? (
        <View style={styles.truckChipSelectedBadge}>
          <Text style={styles.truckChipSelectedBadgeText}>SEÇİLİ</Text>
        </View>
      ) : null}
      <Text style={styles.truckChipName} numberOfLines={1}>
        {truck.name}
      </Text>
      <Text style={styles.truckChipMeta} numberOfLines={1}>
        {getCityName(cityId)} · {getTruckStatusShortLabel(truck.status)}
      </Text>
      {!selected ? (
        <StatusBadge label={status.label} variant={status.variant} size="sm" />
      ) : null}
    </Pressable>
  );
});

interface TruckPickerStripProps {
  trucks: Truck[];
  selectedTruckId: string | null;
  homeCityId?: string;
  onSelect: (truckId: string) => void;
}

function TruckPickerStrip({
  trucks,
  selectedTruckId,
  homeCityId,
  onSelect,
}: TruckPickerStripProps) {
  if (trucks.length === 0) {
    return (
      <AppCard variant="soft" style={styles.emptyTruckCard} padded>
        <Text style={styles.emptyTruckText}>Henüz kamyon yok. Filo ekranından kamyon edinebilirsin.</Text>
      </AppCard>
    );
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.truckPickerScrollContent}
    >
      {trucks.map((truck) => (
        <TruckPickerChip
          key={truck.id}
          truck={truck}
          homeCityId={homeCityId}
          selected={truck.id === selectedTruckId}
          onPress={() => onSelect(truck.id)}
        />
      ))}
    </ScrollView>
  );
}

function SelectedTruckCard({ truck, homeCityId }: { truck: Truck; homeCityId?: string }) {
  const normalized = normalizeTruckUpgrades(truck);
  const cityId = resolveTruckCityId(normalized, homeCityId);
  const condition = normalized.condition ?? 100;

  return (
    <AppCard variant="soft" style={styles.selectedTruckCard} padded>
      <View style={styles.selectedTruckTopRow}>
        <View style={styles.selectedTruckIcon}>
          <GameIcon name="truck" size={18} color={colors.accentBlue} />
        </View>
        <View style={styles.selectedTruckMain}>
          <Text style={styles.selectedTruckLabel}>Seçili Kamyon</Text>
          <Text style={styles.selectedTruckName} numberOfLines={1}>
            {normalized.name}
          </Text>
          <Text style={styles.selectedTruckMeta} numberOfLines={1}>
            {getCityName(cityId)} · {getTruckStatusShortLabel(normalized.status)}
          </Text>
          <Text style={styles.selectedTruckStats} numberOfLines={1}>
            Kondisyon %{Math.round(condition)} · {getEffectiveTruckCapacity(normalized).toFixed(1)} t ·{' '}
            {normalized.speed ?? 0} km/s
          </Text>
          <Text style={styles.selectedTruckUpgrades} numberOfLines={2}>
            {formatTruckUpgradeSummaryLine(normalized)}
          </Text>
        </View>
      </View>
    </AppCard>
  );
}

interface FleetUpgradeCardProps {
  truck: Truck | null;
  upgradeType: TruckUpgradeType;
  playerMoney: number;
  onUpgrade: (upgradeType: TruckUpgradeType) => void;
}

function FleetUpgradeCard({ truck, upgradeType, playerMoney, onUpgrade }: FleetUpgradeCardProps) {
  const title = TRUCK_UPGRADE_DISPLAY_NAMES[upgradeType];
  const benefit = TRUCK_UPGRADE_BENEFITS[upgradeType];
  const actionLabel = TRUCK_UPGRADE_ACTION_LABELS[upgradeType];

  if (!truck) {
    return (
      <AppCard style={styles.upgradeCard} padded>
        <View style={styles.upgradeCardTop}>
          <Text style={styles.upgradeTitle}>{title}</Text>
          <StatusBadge label="Lv.0 / 3" variant="blue" size="sm" />
        </View>
        <Text style={styles.upgradeBenefit}>{benefit}</Text>
        <View style={styles.upgradeMetaRow}>
          <Text style={styles.upgradeMetaLabel}>Mevcut etki</Text>
          <Text style={styles.upgradeMetaValue}>—</Text>
        </View>
        <ActionButton label={actionLabel} onPress={() => {}} disabled variant="secondary" compact />
        <Text style={styles.upgradeDisabledHint}>Kamyon seçilmedi</Text>
      </AppCard>
    );
  }

  const normalized = normalizeTruckUpgrades(truck);
  const currentLevel = normalized.upgrades?.[upgradeType] ?? 0;
  const isMaxLevel = currentLevel >= MAX_UPGRADE_LEVEL;
  const isLeased = (normalized.ownershipType ?? 'owned') === 'leased';
  const isIdle = normalized.status === 'idle';
  const cost = isMaxLevel ? 0 : getTruckUpgradeCost(normalized, upgradeType);
  const canAfford = playerMoney >= cost;
  const currentEffect = formatTruckUpgradeCurrentEffect(normalized, upgradeType);

  let disabledReason: string | null = null;
  if (isMaxLevel) {
    disabledReason = 'Maksimum seviye';
  } else if (isLeased) {
    disabledReason = 'Kiralık kamyon geliştirilemez';
  } else if (!isIdle) {
    disabledReason = 'Kamyon boşta olmalı';
  } else if (!canAfford) {
    disabledReason = 'Yetersiz bakiye';
  }

  return (
    <AppCard style={styles.upgradeCard} padded>
      <View style={styles.upgradeCardTop}>
        <Text style={styles.upgradeTitle}>{title}</Text>
        <StatusBadge label={`Lv.${currentLevel} / ${MAX_UPGRADE_LEVEL}`} variant="blue" size="sm" />
      </View>

      <Text style={styles.upgradeBenefit}>{benefit}</Text>

      <View style={styles.upgradeMetaRow}>
        <Text style={styles.upgradeMetaLabel}>Mevcut etki</Text>
        <Text style={styles.upgradeMetaValue}>{currentEffect}</Text>
      </View>

      {!isMaxLevel ? (
        <>
          <View style={styles.upgradeMetaRow}>
            <Text style={styles.upgradeMetaLabel}>Sonraki seviye</Text>
            <Text style={styles.upgradeMetaValue}>
              Lv.{currentLevel} → Lv.{currentLevel + 1}
            </Text>
          </View>
          <View style={styles.upgradeMetaRow}>
            <Text style={styles.upgradeMetaLabel}>Maliyet</Text>
            <Text style={[styles.upgradeMetaValue, styles.upgradeCost]}>{formatMoney(cost)}</Text>
          </View>
        </>
      ) : (
        <Text style={styles.maxLevelText}>Maksimum seviye</Text>
      )}

      <ActionButton
        label={actionLabel}
        onPress={() => onUpgrade(upgradeType)}
        disabled={!!disabledReason}
        variant="secondary"
        icon="upgrade"
        iconSize={13}
        compact
        style={styles.upgradeAction}
      />
      {disabledReason ? <Text style={styles.upgradeDisabledHint}>{disabledReason}</Text> : null}
    </AppCard>
  );
}

function CompanyPreviewCard({ item }: { item: CompanyPreviewItem }) {
  return (
    <AppCard style={styles.companyCard} padded>
      <View style={styles.companyCardTop}>
        <Text style={styles.companyCardTitle}>{item.title}</Text>
        <StatusBadge label="Yakında" variant="muted" size="sm" />
      </View>
      <Text style={styles.companyCardDescription}>{item.description}</Text>
      <View style={styles.companyLockedRow}>
        <GameIcon name="settings" size={14} color={colors.textMuted} />
        <Text style={styles.companyLockedText}>Bu geliştirme yakında eklenecek</Text>
      </View>
    </AppCard>
  );
}

export default function UpgradesScreen({
  truckId,
  onBack,
  backLabel = '‹ Geri',
}: UpgradesScreenProps) {
  const { scrollBottomPadding } = useTabBarLayout();
  const player = useGameStore((state) => state.player);
  const currentTime = useGameStore((state) => state.currentTime);
  const upgradeTruck = useGameStore((state) => state.upgradeTruck);
  const addNotification = useGameStore((state) => state.addNotification);
  const pendingUpgradeTruckId = useGameStore((state) => state.pendingUpgradeTruckId);
  const clearPendingUpgradeTruckId = useGameStore((state) => state.clearPendingUpgradeTruckId);

  const [activeTab, setActiveTab] = useState<UpgradesTab>('fleet');
  const [selectedTruckId, setSelectedTruckId] = useState<string | null>(truckId ?? pendingUpgradeTruckId ?? null);

  useEffect(() => {
    if (truckId) {
      setSelectedTruckId(truckId);
    } else if (pendingUpgradeTruckId) {
      setSelectedTruckId(pendingUpgradeTruckId);
      clearPendingUpgradeTruckId();
    }
  }, [truckId, pendingUpgradeTruckId, clearPendingUpgradeTruckId]);

  const trucks = player?.trucks ?? [];
  const homeCityId = player?.homeCityId;
  const playerMoney = player?.money ?? 0;

  const selectedTruck = useMemo(
    () => trucks.find((truck) => truck.id === selectedTruckId) ?? null,
    [trucks, selectedTruckId],
  );

  const handleUpgrade = useCallback(
    (upgradeType: TruckUpgradeType) => {
      if (!selectedTruck) {
        return;
      }
      try {
        upgradeTruck(selectedTruck.id, upgradeType);
        addNotification({
          time: currentTime,
          type: 'success',
          title: formatTruckUpgradeSuccessToast(upgradeType),
          message: `${selectedTruck.name} geliştirildi.`,
          autoDismissMs: 3000,
        });
      } catch (error) {
        const message = translateErrorMessage(error, 'Yetersiz bakiye');
        addNotification({
          time: currentTime,
          type: 'warning',
          title: message.includes('nakit') || message.includes('bakiye') ? 'Yetersiz bakiye' : 'Yükseltme başarısız',
          message,
          autoDismissMs: 3500,
        });
      }
    },
    [addNotification, currentTime, selectedTruck, upgradeTruck],
  );

  const bottomPadding = scrollBottomPadding + spacing.xl;

  return (
    <AppScreen scroll scrollBottomPadding={bottomPadding}>
      <View style={styles.topNav}>
        <Pressable style={styles.backButton} onPress={onBack}>
          <Text style={styles.backButtonText}>{backLabel}</Text>
        </Pressable>
      </View>

      <ScreenHeader
        title="Geliştirmeler"
        subtitle="Filo teknolojileri ve şirket yükseltmeleri"
        titleIcon="upgrade"
        compact
      />

      <View style={styles.cashStrip}>
        <GameIcon name="cash" size={16} color={colors.success} />
        <Text style={styles.cashLabel}>Nakit</Text>
        <Text style={styles.cashValue}>{formatMoney(playerMoney)}</Text>
      </View>

      <View style={styles.tabRow}>
        <TabButton label="Filo" active={activeTab === 'fleet'} onPress={() => setActiveTab('fleet')} />
        <TabButton
          label="Şirket"
          active={activeTab === 'company'}
          onPress={() => setActiveTab('company')}
        />
      </View>

      {activeTab === 'fleet' ? (
        <>
          {selectedTruck ? (
            <SelectedTruckCard truck={selectedTruck} homeCityId={homeCityId} />
          ) : (
            <AppCard variant="soft" style={styles.noTruckCard} padded>
              <Text style={styles.noTruckTitle}>Kamyon seçilmedi</Text>
              <Text style={styles.noTruckHint}>
                Aşağıdaki listeden geliştirmek istediğin kamyonu seç.
              </Text>
            </AppCard>
          )}

          <SectionTitle title="Kamyon Değiştir" compact />
          <TruckPickerStrip
            trucks={trucks}
            selectedTruckId={selectedTruckId}
            homeCityId={homeCityId}
            onSelect={setSelectedTruckId}
          />

          <SectionTitle title="Filo Geliştirmeleri" compact />
          <View style={styles.upgradeList}>
            {TRUCK_UPGRADE_TYPES.map((upgradeType) => (
              <FleetUpgradeCard
                key={upgradeType}
                truck={selectedTruck}
                upgradeType={upgradeType}
                playerMoney={playerMoney}
                onUpgrade={handleUpgrade}
              />
            ))}
          </View>
        </>
      ) : (
        <>
          <AppCard variant="soft" style={styles.companyIntroCard} padded>
            <Text style={styles.companyIntroTitle}>Şirket Geliştirmeleri</Text>
            <Text style={styles.companyIntroText}>
              Şirket geneli yetenek ağacı yakında eklenecek. Bu sürümde yalnızca önizleme
              gösterilir.
            </Text>
          </AppCard>
          <View style={styles.companyList}>
            {COMPANY_PREVIEW_ITEMS.map((item) => (
              <CompanyPreviewCard key={item.id} item={item} />
            ))}
          </View>
        </>
      )}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  topNav: {
    marginBottom: spacing.xs,
  },
  backButton: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  backButtonText: {
    color: colors.accentAmber,
    fontSize: 14,
    fontWeight: '700',
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
  tabRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  tabButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cardSoft,
    alignItems: 'center',
  },
  tabButtonActive: {
    borderColor: colors.accentAmber,
    backgroundColor: colors.accentAmberSoft,
  },
  tabButtonText: {
    ...typography.bodySmall,
    color: colors.textMuted,
    fontWeight: '700',
  },
  tabButtonTextActive: {
    color: colors.accentAmber,
  },
  selectedTruckCard: {
    marginBottom: spacing.sm,
    paddingVertical: spacing.sm,
  },
  selectedTruckTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  selectedTruckIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.accentBlueSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedTruckMain: {
    flex: 1,
    minWidth: 0,
  },
  selectedTruckLabel: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '700',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  selectedTruckName: {
    ...typography.cardTitle,
    fontSize: 15,
    marginTop: 1,
  },
  selectedTruckMeta: {
    ...typography.caption,
    marginTop: 2,
    lineHeight: 14,
  },
  selectedTruckStats: {
    ...typography.caption,
    marginTop: 2,
    lineHeight: 14,
    color: colors.textSecondary,
  },
  selectedTruckUpgrades: {
    ...typography.caption,
    marginTop: 4,
    lineHeight: 14,
    color: colors.accentAmber,
    fontWeight: '600',
  },
  noTruckCard: {
    marginBottom: spacing.sm,
    paddingVertical: spacing.sm,
  },
  noTruckTitle: {
    ...typography.cardTitle,
    fontSize: 15,
    marginBottom: 2,
  },
  noTruckHint: {
    ...typography.caption,
    lineHeight: 15,
  },
  truckPickerScrollContent: {
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  truckChip: {
    width: 148,
    minHeight: 88,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cardSoft,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    gap: 4,
  },
  truckChipSelected: {
    borderColor: colors.accentBlue,
    backgroundColor: colors.accentBlueSoft,
    borderWidth: 2,
  },
  truckChipSelectedBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.accentBlue,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 1,
    marginBottom: 2,
  },
  truckChipSelectedBadgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  truckChipName: {
    ...typography.bodySmall,
    fontWeight: '800',
  },
  truckChipMeta: {
    ...typography.caption,
    fontSize: 11,
    lineHeight: 13,
    flex: 1,
  },
  emptyTruckCard: {
    marginBottom: spacing.sm,
  },
  emptyTruckText: {
    ...typography.caption,
    lineHeight: 15,
  },
  upgradeList: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  upgradeCard: {
    gap: 6,
    paddingVertical: spacing.sm,
  },
  upgradeCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  upgradeTitle: {
    ...typography.cardTitle,
    fontSize: 15,
    flex: 1,
  },
  upgradeBenefit: {
    ...typography.caption,
    color: colors.textSecondary,
    lineHeight: 15,
  },
  upgradeMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  upgradeMetaLabel: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 11,
  },
  upgradeMetaValue: {
    ...typography.bodySmall,
    fontWeight: '700',
    fontSize: 12,
  },
  upgradeCost: {
    color: colors.accentAmber,
  },
  maxLevelText: {
    ...typography.caption,
    color: colors.success,
    fontWeight: '700',
    fontSize: 11,
  },
  upgradeAction: {
    marginTop: 2,
  },
  upgradeDisabledHint: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 11,
    textAlign: 'center',
    marginTop: -2,
  },
  companyIntroCard: {
    marginBottom: spacing.md,
  },
  companyIntroTitle: {
    ...typography.cardTitle,
    marginBottom: 4,
  },
  companyIntroText: {
    ...typography.caption,
    lineHeight: 16,
  },
  companyList: {
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  companyCard: {
    gap: spacing.sm,
  },
  companyCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  companyCardTitle: {
    ...typography.cardTitle,
    fontSize: 15,
    flex: 1,
  },
  companyCardDescription: {
    ...typography.caption,
    lineHeight: 16,
  },
  companyLockedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  companyLockedText: {
    ...typography.caption,
    color: colors.textMuted,
  },
});

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  ActionButton,
  AppCard,
  EmptyState,
  GameIcon,
  SectionTitle,
  StatusBadge,
} from '../ui';
import type { GameIconName } from '../../theme/icons';
import { CITIES_BY_ID } from '../../data/cities';
import { resolveTruckCityId } from '../../simulation/delivery';
import {
  getAttachedTrailer,
  getTrailerCapacityBonus,
  getTruckEffectiveCapacityTons,
} from '../../simulation/capacity';
import { calculateTruckUpgradeInvestmentValue } from '../../simulation/fleetManagement';
import {
  MAX_UPGRADE_LEVEL,
  TRUCK_UPGRADE_ACTION_LABELS,
  TRUCK_UPGRADE_BENEFITS,
  TRUCK_UPGRADE_DISPLAY_NAMES,
  TRUCK_UPGRADE_TYPES,
  formatTruckUpgradeCurrentEffect,
  formatTruckUpgradeNextEffect,
  formatTruckUpgradeSuccessToast,
  getTruckUpgradeCost,
  normalizeTruckUpgrades,
  type TruckUpgradeType,
} from '../../simulation/truckUpgrades';
import { useGameStore } from '../../store/gameStore';
import type { Trailer, Truck, TruckStatus } from '../../types/game';
import { colors, formatMoney, spacing, typography } from '../../theme';

const UPGRADE_ICONS: Record<TruckUpgradeType, GameIconName> = {
  engine: 'speedometer',
  fuelEfficiency: 'fuel',
  cargo: 'inventory',
  durability: 'maintenance',
};

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

function formatTruckUpgradeSummaryLine(truck: Truck): string {
  const normalized = normalizeTruckUpgrades(truck);
  const parts = TRUCK_UPGRADE_TYPES.map((type) => {
    const level = normalized.upgrades?.[type] ?? 0;
    if (level <= 0) return null;
    return `${UPGRADE_SUMMARY_LABELS[type]} Lv.${level}`;
  }).filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : 'Henüz geliştirme yok';
}

interface FleetUpgradesPanelProps {
  initialTruckId?: string | null;
  onUpgradeFeedback?: (message: { type: 'success' | 'error'; text: string }) => void;
}

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
    </Pressable>
  );
});

interface FleetUpgradeCardProps {
  truck: Truck | null;
  upgradeType: TruckUpgradeType;
  playerMoney: number;
  upgrading: boolean;
  onUpgrade: (upgradeType: TruckUpgradeType) => void;
}

const FleetUpgradeCard = React.memo(function FleetUpgradeCard({
  truck,
  upgradeType,
  playerMoney,
  upgrading,
  onUpgrade,
}: FleetUpgradeCardProps) {
  const title = TRUCK_UPGRADE_DISPLAY_NAMES[upgradeType];
  const benefit = TRUCK_UPGRADE_BENEFITS[upgradeType];
  const actionLabel = TRUCK_UPGRADE_ACTION_LABELS[upgradeType];
  const icon = UPGRADE_ICONS[upgradeType];

  if (!truck) {
    return (
      <AppCard style={styles.upgradeCard} padded>
        <View style={styles.upgradeCardTop}>
          <View style={styles.upgradeTitleRow}>
            <GameIcon name={icon} size={18} color={colors.accentBlue} />
            <Text style={styles.upgradeTitle}>{title}</Text>
          </View>
          <StatusBadge label={`Lv.0 / ${MAX_UPGRADE_LEVEL}`} variant="blue" size="sm" />
        </View>
        <Text style={styles.upgradeBenefit}>{benefit}</Text>
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
  const nextEffect = formatTruckUpgradeNextEffect(normalized, upgradeType);

  let disabledReason: string | null = null;
  if (upgrading) {
    disabledReason = 'İşlem devam ediyor';
  } else if (isMaxLevel) {
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
        <View style={styles.upgradeTitleRow}>
          <GameIcon name={icon} size={18} color={colors.accentBlue} />
          <Text style={styles.upgradeTitle}>{title}</Text>
        </View>
        <StatusBadge
          label={`Lv.${currentLevel} / ${MAX_UPGRADE_LEVEL}`}
          variant="blue"
          size="sm"
        />
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
            <Text style={styles.upgradeMetaValue}>{nextEffect}</Text>
          </View>
          <View style={styles.upgradeMetaRow}>
            <Text style={styles.upgradeMetaLabel}>Maliyet</Text>
            <Text style={[styles.upgradeMetaValue, styles.upgradeCost]}>
              {formatMoney(cost)}
            </Text>
          </View>
        </>
      ) : (
        <Text style={styles.maxLevelText}>Maksimum seviye</Text>
      )}

      <ActionButton
        label={isMaxLevel ? 'Maksimum Seviye' : actionLabel}
        onPress={() => onUpgrade(upgradeType)}
        disabled={!!disabledReason}
        variant="secondary"
        icon="upgrade"
        iconSize={13}
        compact
        style={styles.upgradeAction}
      />
      {disabledReason && !isMaxLevel ? (
        <Text style={styles.upgradeDisabledHint}>{disabledReason}</Text>
      ) : null}
    </AppCard>
  );
});

export default function FleetUpgradesPanel({
  initialTruckId,
  onUpgradeFeedback,
}: FleetUpgradesPanelProps) {
  const trucks = useGameStore((state) => state.player?.trucks ?? []);
  const homeCityId = useGameStore((state) => state.player?.homeCityId);
  const playerMoney = useGameStore((state) => state.player?.money ?? 0);
  const trailers = useGameStore((state) => state.player?.trailers ?? []);
  const currentTime = useGameStore((state) => state.currentTime);
  const upgradeTruck = useGameStore((state) => state.upgradeTruck);
  const addNotification = useGameStore((state) => state.addNotification);
  const pendingUpgradeTruckId = useGameStore((state) => state.pendingUpgradeTruckId);
  const clearPendingUpgradeTruckId = useGameStore(
    (state) => state.clearPendingUpgradeTruckId,
  );

  const [selectedTruckId, setSelectedTruckId] = useState<string | null>(
    initialTruckId ?? pendingUpgradeTruckId ?? trucks[0]?.id ?? null,
  );
  const [upgradingType, setUpgradingType] = useState<TruckUpgradeType | null>(null);
  const upgradeInFlightRef = useRef(false);

  useEffect(() => {
    if (initialTruckId) {
      setSelectedTruckId(initialTruckId);
      return;
    }
    if (pendingUpgradeTruckId) {
      setSelectedTruckId(pendingUpgradeTruckId);
      clearPendingUpgradeTruckId();
    }
  }, [initialTruckId, pendingUpgradeTruckId, clearPendingUpgradeTruckId]);

  useEffect(() => {
    if (selectedTruckId && trucks.some((truck) => truck.id === selectedTruckId)) {
      return;
    }
    setSelectedTruckId(trucks[0]?.id ?? null);
  }, [selectedTruckId, trucks]);

  const selectedTruck = useMemo(
    () => trucks.find((truck) => truck.id === selectedTruckId) ?? null,
    [trucks, selectedTruckId],
  );

  const fleetSummary = useMemo(() => {
    let totalLevels = 0;
    let totalInvestment = 0;
    for (const truck of trucks) {
      const normalized = normalizeTruckUpgrades(truck);
      totalLevels += normalized.upgradeLevel ?? 0;
      totalInvestment += calculateTruckUpgradeInvestmentValue(normalized);
    }
    return { totalLevels, totalInvestment };
  }, [trucks]);

  const handleUpgrade = useCallback(
    (upgradeType: TruckUpgradeType) => {
      if (!selectedTruck || upgradeInFlightRef.current) {
        return;
      }
      upgradeInFlightRef.current = true;
      setUpgradingType(upgradeType);
      try {
        upgradeTruck(selectedTruck.id, upgradeType);
        const message = `${selectedTruck.name} · ${formatTruckUpgradeSuccessToast(upgradeType)}`;
        addNotification({
          time: currentTime,
          type: 'success',
          title: formatTruckUpgradeSuccessToast(upgradeType),
          message,
          autoDismissMs: 3000,
        });
        onUpgradeFeedback?.({ type: 'success', text: message });
      } catch (error) {
        const text =
          error instanceof Error && error.message.includes('Yetersiz')
            ? 'Yetersiz bakiye'
            : error instanceof Error
              ? error.message
              : 'Yükseltme başarısız';
        onUpgradeFeedback?.({ type: 'error', text });
        addNotification({
          time: currentTime,
          type: 'warning',
          title: 'Yükseltme başarısız',
          message: text,
          autoDismissMs: 3500,
        });
      } finally {
        upgradeInFlightRef.current = false;
        setUpgradingType(null);
      }
    },
    [addNotification, currentTime, onUpgradeFeedback, selectedTruck, upgradeTruck],
  );

  if (trucks.length === 0) {
    return (
      <EmptyState
        title="Henüz kamyon yok"
        message="Geliştirmeleri kullanmak için önce filona kamyon ekle."
        icon="upgrade"
        compact
      />
    );
  }

  const normalizedSelected = selectedTruck ? normalizeTruckUpgrades(selectedTruck) : null;
  const attached =
    normalizedSelected && trailers
      ? getAttachedTrailer(normalizedSelected.id, trailers)
      : undefined;
  const totalCapacity = normalizedSelected
    ? getTruckEffectiveCapacityTons(normalizedSelected, trailers)
    : 0;
  const baseCapacity = normalizedSelected
    ? getTruckEffectiveCapacityTons(normalizedSelected, [])
    : 0;

  return (
    <View style={styles.panel}>
      <AppCard variant="soft" style={styles.summaryCard} padded>
        <Text style={styles.summaryTitle}>Filo Geliştirmeleri</Text>
        <Text style={styles.summarySubtitle}>
          Filonun verimliliğini, performansını ve operasyon kapasitesini geliştir.
        </Text>
        <View style={styles.summaryStatsRow}>
          <View style={styles.summaryStat}>
            <Text style={styles.summaryStatLabel}>Aktif seviye</Text>
            <Text style={styles.summaryStatValue}>{fleetSummary.totalLevels}</Text>
          </View>
          <View style={styles.summaryStat}>
            <Text style={styles.summaryStatLabel}>Toplam yatırım</Text>
            <Text style={styles.summaryStatValue}>
              {formatMoney(fleetSummary.totalInvestment)}
            </Text>
          </View>
        </View>
        {normalizedSelected ? (
          <Text style={styles.summaryBonusLine} numberOfLines={2}>
            {formatTruckUpgradeSummaryLine(normalizedSelected)}
          </Text>
        ) : null}
      </AppCard>

      {selectedTruck && normalizedSelected ? (
        <AppCard variant="soft" style={styles.selectedTruckCard} padded>
          <View style={styles.selectedTruckTopRow}>
            <View style={styles.selectedTruckIcon}>
              <GameIcon name="truck" size={18} color={colors.accentBlue} />
            </View>
            <View style={styles.selectedTruckMain}>
              <Text style={styles.selectedTruckLabel}>Seçili Kamyon</Text>
              <Text style={styles.selectedTruckName} numberOfLines={1}>
                {normalizedSelected.name}
              </Text>
              <Text style={styles.selectedTruckMeta} numberOfLines={1}>
                {getCityName(resolveTruckCityId(normalizedSelected, homeCityId))} ·{' '}
                {getTruckStatusShortLabel(normalizedSelected.status)}
              </Text>
              <Text style={styles.selectedTruckStats} numberOfLines={2}>
                Kondisyon %{Math.round(normalizedSelected.condition ?? 100)} · Kapasite{' '}
                {totalCapacity.toFixed(1)} t
              </Text>
              {attached ? (
                <Text style={styles.selectedTruckUpgrades} numberOfLines={1}>
                  Dorse: {attached.name} · +{getTrailerCapacityBonus(attached).toFixed(1)} t (
                  {baseCapacity.toFixed(1)} + {getTrailerCapacityBonus(attached).toFixed(1)})
                </Text>
              ) : null}
            </View>
          </View>
        </AppCard>
      ) : null}

      <SectionTitle title="Kamyon Seç" compact />
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
            onPress={() => setSelectedTruckId(truck.id)}
          />
        ))}
      </ScrollView>

      <SectionTitle title="Geliştirmeler" compact />
      <View style={styles.upgradeList}>
        {TRUCK_UPGRADE_TYPES.map((upgradeType) => (
          <FleetUpgradeCard
            key={upgradeType}
            truck={selectedTruck}
            upgradeType={upgradeType}
            playerMoney={playerMoney}
            upgrading={upgradingType === upgradeType}
            onUpgrade={handleUpgrade}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: spacing.sm,
  },
  summaryCard: {
    gap: 6,
  },
  summaryTitle: {
    ...typography.cardTitle,
    fontSize: 16,
  },
  summarySubtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    lineHeight: 16,
  },
  summaryStatsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: 4,
  },
  summaryStat: {
    flex: 1,
    minWidth: 0,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  summaryStatLabel: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 10,
  },
  summaryStatValue: {
    ...typography.bodySmall,
    fontWeight: '800',
    color: colors.accentBlue,
    marginTop: 2,
  },
  summaryBonusLine: {
    ...typography.caption,
    color: colors.accentAmber,
    fontWeight: '600',
    marginTop: 2,
  },
  selectedTruckCard: {
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
  },
  selectedTruckName: {
    ...typography.cardTitle,
    fontSize: 15,
    marginTop: 1,
  },
  selectedTruckMeta: {
    ...typography.caption,
    marginTop: 2,
  },
  selectedTruckStats: {
    ...typography.caption,
    marginTop: 2,
    color: colors.textSecondary,
  },
  selectedTruckUpgrades: {
    ...typography.caption,
    marginTop: 4,
    color: colors.accentAmber,
    fontWeight: '600',
  },
  truckPickerScrollContent: {
    gap: spacing.sm,
    paddingBottom: spacing.xs,
  },
  truckChip: {
    width: 148,
    minHeight: 72,
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
  },
  truckChipName: {
    ...typography.bodySmall,
    fontWeight: '800',
  },
  truckChipMeta: {
    ...typography.caption,
    fontSize: 11,
  },
  upgradeList: {
    gap: spacing.sm,
    paddingBottom: spacing.md,
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
  upgradeTitleRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minWidth: 0,
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
    flexShrink: 1,
    textAlign: 'right',
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
  },
});

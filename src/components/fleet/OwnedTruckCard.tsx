import React, { useCallback, useMemo, useState } from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { getTruckArtwork } from '../../assets/fleetAssets';
import { getTruckCatalogId } from '../../data/trucks';
import { VEHICLE_MARKETPLACE_ENABLED } from '../../config/backendRoadmap';
import AdRewardButton from '../monetization/AdRewardButton';
import { GameIcon, ProgressBar, StatusBadge } from '../ui';
import type { StatusBadgeVariant } from '../ui';
import { calculateTruckRepairCost, resolveTruckCityId } from '../../simulation/delivery';
import { getTruckEffectiveCapacityTons } from '../../simulation/capacity';
import { getAttachedTrailerForTruck } from '../../simulation/trailerAttachment';
import { isActiveLeasedTruck } from '../../simulation/dailyOperatingCosts';
import { isRentalReturnPending } from '../../simulation/rentalTruckLifecycle';
import {
  formatLeaseRemainingDays,
  formatTruckLeaseCostLabel,
  formatTruckLeaseFleetSummary,
} from '../../utils/truckLeasePresentation';
import { MAX_UPGRADE_LEVEL } from '../../simulation/truckUpgrades';
import {
  calculateDiscountedRepairCost,
  getActiveMaintenanceDiscountToken,
} from '../../simulation/adRewardGrants';
import { calculateTruckResaleValue, type TruckSellCheck } from '../../simulation/fleetManagement';
import {
  getTruckTransferBlockedReason,
  selectDriverForTransfer,
} from '../../simulation/truckTransfer';
import { useGameStore } from '../../store/gameStore';
import { colors, formatMoney } from '../../theme';
import { getCityName } from '../../utils/entityLookup';
import {
  formatFuelPercentLabel,
  getTruckFuelSnapshot,
  normalizeTruckFuel,
} from '../../utils/truckFuel';
import { getFuelWarningForJob } from '../../simulation/fuelWarnings';
import { detectVehicleStateIssue } from '../../domain/vehicleStateRecovery';
import VehicleRecoveryBanner from '../delivery/VehicleRecoveryBanner';
import type { Delivery, Driver, Trailer, Truck, TruckTransfer } from '../../types/game';
import type { MonetizationState } from '../../types/monetization';
import {
  FLEET_CARD_BG,
  FLEET_RENTAL_BADGE_BG,
  FLEET_RENTAL_BADGE_BORDER,
  FLEET_RENTAL_BADGE_TEXT,
  FLEET_TRUCK_CARD_MIN_HEIGHT,
  getFleetTruckColumnWidths,
  getTruckAccentBorder,
  stripLeaseSuffixFromTruckName,
} from './fleetTheme';

const MAINTENANCE_REQUIRED_THRESHOLD = 30;
const MAINTENANCE_RECOMMENDED_THRESHOLD = 70;
const REPAIR_HIDE_THRESHOLD = 95;
const MAX_TOTAL_UPGRADE_LEVEL = MAX_UPGRADE_LEVEL * 4;

function formatRemainingHours(currentTime: number, estimatedArrivalTime: number): string {
  const remaining = Math.max(0, estimatedArrivalTime - currentTime);
  const hrs = Math.floor(remaining);
  const mins = Math.round((remaining - hrs) * 60);
  if (hrs > 0) return `${hrs}s ${mins}dk`;
  return `${mins}dk`;
}

function getConditionColor(condition: number): string {
  if (condition >= 70) return colors.success;
  if (condition >= 35) return colors.accentAmber;
  return colors.danger;
}

function getTruckStatusPresentation(truck: Truck): { label: string; variant: StatusBadgeVariant } {
  if (isRentalReturnPending(truck)) {
    return { label: 'TESLİMAT SONRASI İADE', variant: 'amber' };
  }
  switch (truck.status) {
    case 'on_route':
      return { label: 'TESLİMATTA', variant: 'blue' };
    case 'transferring':
      return { label: 'TRANSFERDE', variant: 'info' };
    case 'maintenance':
      return { label: 'BAKIMDA', variant: 'danger' };
    case 'out_of_fuel':
      return { label: 'YAKIT BİTTİ', variant: 'danger' };
    default:
      return { label: 'BOŞTA', variant: 'success' };
  }
}

export interface OwnedTruckCardProps {
  truck: Truck;
  trailers: Trailer[];
  playerMoney: number;
  delivery?: Delivery;
  transfer?: TruckTransfer;
  drivers: Driver[];
  homeCityId?: string;
  monetization: MonetizationState;
  sellCheck: TruckSellCheck;
  onRepair: (truck: Truck) => void;
  onManageUpgrades: (truck: Truck) => void;
  onTransfer: (truck: Truck, targetCityId?: string) => void;
  onRefuel: (truck: Truck) => void;
  onRoadsideFuel: (jobId: string) => void;
  onSell: (truck: Truck) => void;
  onMarketplaceSell: (truck: Truck) => void;
  onShowSellBlocked: (reason: string) => void;
}

const OwnedTruckCard = React.memo(function OwnedTruckCard({
  truck,
  trailers,
  playerMoney,
  delivery,
  transfer,
  drivers,
  homeCityId,
  monetization,
  sellCheck,
  onRepair,
  onManageUpgrades,
  onTransfer,
  onRefuel,
  onRoadsideFuel,
  onSell,
  onMarketplaceSell,
  onShowSellBlocked,
}: OwnedTruckCardProps) {
  const { width: screenWidth } = useWindowDimensions();
  const [moreOpen, setMoreOpen] = useState(false);
  const layout = useMemo(() => getFleetTruckColumnWidths(screenWidth), [screenWidth]);

  const liveTruck = useGameStore(
    (state) => state.player?.trucks.find((candidate) => candidate.id === truck.id) ?? truck,
  );
  const isOnRoute = liveTruck.status === 'on_route';
  const isTransferring = liveTruck.status === 'transferring';
  const isIdle = liveTruck.status === 'idle';
  const isMaintenance = liveTruck.status === 'maintenance';
  const isOutOfFuel = liveTruck.status === 'out_of_fuel';
  const isLeased = isActiveLeasedTruck(liveTruck);
  const needsLiveTime = isOnRoute || isTransferring || isOutOfFuel || isLeased;
  const currentTime = useGameStore((state) => (needsLiveTime ? state.currentTime : 0));
  const warehouseTransfer = useGameStore((state) =>
    state.activeWarehouseStockTransfers?.find(
      (candidate) =>
        candidate.truckId === truck.id &&
        (candidate.status === 'active' ||
          candidate.status === 'pending' ||
          candidate.status === 'paused'),
    ),
  );
  const openVehicleRecovery = useGameStore((state) => state.openVehicleRecovery);
  const recoveryIssue = useMemo(
    () =>
      detectVehicleStateIssue({
        truck: liveTruck,
        currentTime,
        homeCityId,
        activeDelivery: delivery,
        activeTransfer: transfer,
        activeWarehouseTransfer: warehouseTransfer,
      }),
    [liveTruck, currentTime, homeCityId, delivery, transfer, warehouseTransfer],
  );

  const catalogId = getTruckCatalogId(liveTruck);
  const artwork = useMemo(() => getTruckArtwork(liveTruck), [liveTruck.id, liveTruck.catalogId]);
  const accentBorder = getTruckAccentBorder(catalogId);

  const truckCondition = liveTruck.condition ?? 100;
  const conditionColor = getConditionColor(truckCondition);
  const repairCost = calculateTruckRepairCost(liveTruck);
  const statusBadge = getTruckStatusPresentation(liveTruck);
  const displayName = stripLeaseSuffixFromTruckName(liveTruck.name);
  const showRepairButton = truckCondition < 100 && truckCondition < REPAIR_HIDE_THRESHOLD;
  const truckCityId = resolveTruckCityId(liveTruck, homeCityId);
  const truckCityName = getCityName(truckCityId);
  const hasIdleDriver = !!selectDriverForTransfer(liveTruck.id, drivers);
  const transferBlockedReason = getTruckTransferBlockedReason(liveTruck, hasIdleDriver);
  const canTransfer = transferBlockedReason == null;
  const showRecallIzmir = isIdle && (liveTruck.currentCityId ?? '').toLowerCase() !== 'izmir';
  const resaleValue = isLeased ? 0 : calculateTruckResaleValue(liveTruck);
  const displayValue = isLeased ? 0 : resaleValue > 0 ? resaleValue : liveTruck.purchasePrice ?? 0;
  const upgradeLevel = liveTruck.upgradeLevel ?? 0;
  const capacityTons = getTruckEffectiveCapacityTons(liveTruck, trailers);
  const capacityLabel = `${Math.round(capacityTons)} t`;
  const attachedTrailer = getAttachedTrailerForTruck(liveTruck.id, trailers);
  const fuelSnapshot = getTruckFuelSnapshot(liveTruck);
  const normalizedFuelTruck = normalizeTruckFuel(liveTruck);
  const fuelPercent = fuelSnapshot.percentage;
  const fuelJob = delivery ?? transfer ?? warehouseTransfer;
  const fuelWarning = getFuelWarningForJob(fuelJob, liveTruck);

  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.log('[FUEL_DEBUG][FLEET]', {
      source: 'OwnedTruckCard → useGameStore(player.trucks by id) ?? prop',
      id: liveTruck.id,
      name: liveTruck.name,
      propId: truck.id,
      fuel: normalizedFuelTruck.currentFuelL ?? null,
      capacity: normalizedFuelTruck.fuelTankCapacityL ?? null,
      percent: fuelPercent,
      status: liveTruck.status,
      deliveryId: delivery?.id ?? null,
      deliveryFuelConsumedL: delivery?.fuelConsumedL ?? null,
      deliveryFuelLitersAtStart: delivery?.fuelLitersAtStart ?? null,
    });
  }

  const maintenanceDiscountToken = getActiveMaintenanceDiscountToken(
    monetization,
    truck.id,
    currentTime,
  );
  const { finalCost: discountedRepairCost } = calculateDiscountedRepairCost(
    repairCost,
    maintenanceDiscountToken,
  );
  const effectiveRepairCost = maintenanceDiscountToken ? discountedRepairCost : repairCost;
  const canAffordEffectiveRepair = playerMoney >= effectiveRepairCost;
  const showMaintenanceAdOffer =
    showRepairButton && repairCost > 300 && !maintenanceDiscountToken && isIdle;

  const busyActions = isOnRoute || isTransferring || isMaintenance;
  const canManageUpgrades = !isLeased;
  const showSellInMore = !isLeased && (sellCheck.canSell || sellCheck.reason);

  const handleSellPress = useCallback(() => {
    if (!sellCheck.canSell) {
      onShowSellBlocked(sellCheck.reason ?? 'Kamyon satılamaz.');
      return;
    }
    onSell(liveTruck);
  }, [onShowSellBlocked, onSell, sellCheck, truck]);

  const handleMorePress = useCallback(() => {
    setMoreOpen((open) => !open);
  }, []);

  const routeHint = useMemo(() => {
    if (isOnRoute && delivery) {
      return `${getCityName(delivery.originCityId)} → ${getCityName(delivery.destinationCityId)} · ${formatRemainingHours(currentTime, delivery.estimatedArrivalTime)}`;
    }
    if (isTransferring && transfer) {
      return `${getCityName(transfer.fromCityId)} → ${getCityName(transfer.toCityId)} · ${formatRemainingHours(currentTime, transfer.estimatedArrivalAt)}`;
    }
    return null;
  }, [currentTime, delivery, isOnRoute, isTransferring, transfer]);

  const trailerLine = attachedTrailer
    ? `Dorse · ${attachedTrailer.name}`
    : 'Dorse bağlı değil';

  return (
    <View style={[styles.card, accentBorder, { minHeight: FLEET_TRUCK_CARD_MIN_HEIGHT }]}>
      <View style={styles.topRow}>
        <View style={[styles.artworkCol, { width: layout.artworkCol, height: layout.imageHeight }]}>
          {artwork ? (
            <Image
              source={artwork}
              style={[
                styles.artwork,
                {
                  width: layout.imageWidth,
                  height: layout.imageHeight,
                  transform: [{ scale: 1.08 }],
                },
              ]}
              resizeMode="contain"
            />
          ) : (
            <View style={[styles.artworkFallback, { width: layout.imageWidth, height: layout.imageHeight }]}>
              <GameIcon name="truck" size={34} color={colors.accentBlue} />
            </View>
          )}
        </View>

        <View style={styles.infoCol}>
          <Text style={styles.truckName} numberOfLines={1} ellipsizeMode="tail">
            {displayName}
          </Text>
          <View style={styles.badgeRow}>
            <View style={styles.cityBadge}>
              <GameIcon name="city" size={10} color="#39A0FF" />
              <Text style={styles.cityBadgeText} numberOfLines={1}>
                {truckCityName}
              </Text>
            </View>
            {isLeased ? (
              <View style={styles.rentalBadge}>
                <Text style={styles.rentalBadgeText}>KİRALIK</Text>
              </View>
            ) : null}
            <StatusBadge label={statusBadge.label} variant={statusBadge.variant} size="sm" />
          </View>
          <Text style={styles.trailerLine} numberOfLines={1}>
            {trailerLine}
          </Text>
          {routeHint ? (
            <Text style={styles.routeHint} numberOfLines={1}>
              {routeHint}
            </Text>
          ) : null}
        </View>

        <View style={[styles.valueCol, { width: layout.valueCol }]}>
          {!isLeased && displayValue > 0 ? (
            <>
              <Text style={styles.valueLabel}>Değer</Text>
              <Text style={styles.valueAmount} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>
                {formatMoney(displayValue)}
              </Text>
            </>
          ) : isLeased ? (
            <>
              <Text style={styles.valueLabel}>Kira</Text>
              <Text style={styles.leaseAmount} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.78}>
                {formatTruckLeaseFleetSummary(liveTruck, currentTime)}
              </Text>
            </>
          ) : null}
          {busyActions ? (
            <View style={styles.busyIconWrap}>
              <GameIcon
                name={isOnRoute ? 'route' : isTransferring ? 'distance' : 'repair'}
                size={14}
                color={colors.textMuted}
              />
            </View>
          ) : null}
        </View>
      </View>

      <View style={styles.featureRow}>
        <View style={styles.featurePill}>
          <Text style={styles.featureLabel}>Kapasite</Text>
          <Text style={styles.featureValue} numberOfLines={1}>
            {capacityLabel}
          </Text>
        </View>
        <View style={styles.featurePill}>
          <Text style={styles.featureLabel}>Yakıt</Text>
          <Text
            style={[
              styles.featureValue,
              fuelSnapshot.percentage <= 20 ? styles.fuelCritical : null,
            ]}
            numberOfLines={1}
          >
            {formatFuelPercentLabel(fuelSnapshot.percentage)}
          </Text>
        </View>
        <View style={styles.featurePill}>
          <Text style={styles.featureLabel}>Hız</Text>
          <Text style={styles.featureValue} numberOfLines={1}>
            {liveTruck.speed ?? 0} km/sa
          </Text>
        </View>
        <View style={styles.featurePill}>
          <Text style={styles.featureLabel}>Geliştirme</Text>
          <Text style={styles.featureValue} numberOfLines={1}>
            Lv. {upgradeLevel}/{MAX_TOTAL_UPGRADE_LEVEL}
          </Text>
        </View>
      </View>

      <Pressable
        style={styles.fuelDetail}
        onPress={() => onRefuel(liveTruck)}
        accessibilityRole="button"
        accessibilityLabel={`${liveTruck.name} yakıt detayını aç`}
      >
        <GameIcon
          name="fuel"
          size={15}
          color={fuelPercent <= 20 ? colors.danger : colors.accentBlue}
        />
        <View style={styles.fuelDetailText}>
          <Text style={styles.fuelDetailLabel}>Yakıt</Text>
          <Text style={styles.fuelDetailValue} numberOfLines={1} adjustsFontSizeToFit>
            {Math.round(normalizedFuelTruck.currentFuelL ?? 0)} /{' '}
            {Math.round(normalizedFuelTruck.fuelTankCapacityL ?? 0)} L · %{fuelPercent}
          </Text>
        </View>
        <Text style={styles.fuelDetailAction}>Yakıt Al</Text>
      </Pressable>

      {fuelWarning ? (
        <View
          style={[
            styles.fuelWarning,
            fuelWarning.key === 'out-of-fuel' && styles.fuelWarningDanger,
          ]}
        >
          <GameIcon
            name="warning"
            size={14}
            color={fuelWarning.key === 'out-of-fuel' ? colors.danger : colors.accentAmber}
          />
          <Text style={styles.fuelWarningText}>{fuelWarning.message}</Text>
          {fuelWarning.key === 'out-of-fuel' && fuelJob ? (
            <Pressable
              style={styles.roadsideButton}
              onPress={() => onRoadsideFuel(fuelJob.id)}
              accessibilityRole="button"
            >
              <Text style={styles.roadsideButtonText}>Acil Yakıt</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <VehicleRecoveryBanner
        issue={recoveryIssue}
        onRecover={() => openVehicleRecovery(liveTruck.id)}
      />

      <View style={styles.conditionBlock}>
        <View style={styles.conditionHeader}>
          <Text style={styles.conditionTitle}>Kondisyon</Text>
          <Text style={[styles.conditionPercent, { color: conditionColor }]}>
            {Math.round(truckCondition)}%
          </Text>
        </View>
        <ProgressBar progress={truckCondition / 100} color={conditionColor} height={6} />
      </View>

      <View style={styles.actionRow}>
        <Pressable
          style={[styles.actionBtn, styles.actionPrimary, (!canTransfer || busyActions) && styles.actionDisabled]}
          onPress={() => onTransfer(liveTruck)}
          disabled={!canTransfer || busyActions}
        >
          <GameIcon name="route" size={13} color={canTransfer && !busyActions ? '#FFFFFF' : colors.textMuted} />
          <Text style={[styles.actionPrimaryText, (!canTransfer || busyActions) && styles.actionDisabledText]} numberOfLines={1}>
            Yönlendir
          </Text>
        </Pressable>

        <View style={styles.repairActionWrap}>
          <Pressable
            style={[
              styles.actionBtn,
              styles.actionBtnInWrap,
              showRepairButton && truckCondition < MAINTENANCE_RECOMMENDED_THRESHOLD
                ? styles.actionAmber
                : styles.actionOutline,
              (!showRepairButton || !canAffordEffectiveRepair || busyActions) && styles.actionDisabled,
            ]}
            onPress={() => onRepair(liveTruck)}
            disabled={!showRepairButton || !canAffordEffectiveRepair || busyActions}
          >
            <GameIcon name="repair" size={13} color={colors.accentAmber} />
            <Text style={styles.actionOutlineText} numberOfLines={1}>
              Bakım
            </Text>
          </Pressable>
          {showMaintenanceAdOffer ? (
            <Text style={styles.repairAdCaption}>-%30 reklam</Text>
          ) : null}
        </View>

        <Pressable
          style={[styles.actionBtn, styles.actionOutline, (!canManageUpgrades || busyActions) && styles.actionDisabled]}
          onPress={() => onManageUpgrades(liveTruck)}
          disabled={!canManageUpgrades || busyActions}
        >
          <GameIcon name="upgrade" size={13} color={colors.accentBlue} />
          <Text style={[styles.actionOutlineText, styles.actionUpgradeText]} numberOfLines={1}>
            Geliştir
          </Text>
        </Pressable>

        <Pressable style={[styles.actionBtn, styles.actionNeutral]} onPress={handleMorePress}>
          <Text style={styles.moreDots}>•••</Text>
        </Pressable>
      </View>

      {transferBlockedReason ? (
        <Text style={styles.transferBlockedReason} numberOfLines={1}>
          Yönlendirme kullanılamıyor: {transferBlockedReason}
        </Text>
      ) : null}

      {moreOpen ? (
        <View style={styles.morePanel}>
          <Pressable style={styles.moreAction} onPress={() => onRefuel(liveTruck)}>
            <Text style={styles.moreActionText} numberOfLines={1}>
              Yakıt Detayı ve Dolum
            </Text>
          </Pressable>
          {showRecallIzmir && canTransfer ? (
            <Pressable style={styles.moreAction} onPress={() => onTransfer(liveTruck, 'izmir')}>
              <Text style={styles.moreActionText} numberOfLines={1}>
                İzmir'e Çağır
              </Text>
            </Pressable>
          ) : null}
          {showSellInMore ? (
            <Pressable style={styles.moreAction} onPress={handleSellPress}>
              <Text style={styles.moreActionText} numberOfLines={1}>
                {sellCheck.canSell ? 'Sat' : 'Satılamaz'}
              </Text>
            </Pressable>
          ) : null}
          {VEHICLE_MARKETPLACE_ENABLED && sellCheck.canSell && isIdle && !isLeased ? (
            <Pressable
              style={[styles.moreAction, styles.marketplaceAction]}
              onPress={() => onMarketplaceSell(liveTruck)}
            >
              <View style={styles.marketplaceActionRow}>
                <GameIcon name="truck" size={14} color={colors.info} />
                <View style={styles.marketplaceActionText}>
                  <Text style={styles.moreActionText} numberOfLines={1}>
                    Araç Sat
                  </Text>
                  <Text style={styles.marketplaceActionSubtitle} numberOfLines={1}>
                    Oyuncu pazarında ilan oluştur
                  </Text>
        </View>
      </View>
            </Pressable>
          ) : null}
          {showMaintenanceAdOffer ? (
            <AdRewardButton
              slotId="maintenance_discount"
              label="Reklam · %30 indirim"
              description="Sonraki bakımda en fazla $500 indirim uygulanır."
              context={{
                selectedTruckId: liveTruck.id,
                currentRepairCost: repairCost,
              }}
              variant="secondary"
            />
          ) : null}
          {isLeased ? (
            <Text style={styles.moreMeta} numberOfLines={2}>
              {formatTruckLeaseCostLabel(liveTruck)} · Kalan{' '}
              {formatLeaseRemainingDays(currentTime, liveTruck.leaseExpiresAt)}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
});

export default OwnedTruckCard;

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    padding: 10,
    marginBottom: 8,
    overflow: 'hidden',
    backgroundColor: FLEET_CARD_BG,
    borderWidth: 1,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  artworkCol: {
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  artwork: {
    backgroundColor: 'transparent',
  },
  artworkFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  infoCol: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 6,
    gap: 2,
  },
  truckName: {
    fontSize: 14.5,
    fontWeight: '800',
    color: '#F3F7FF',
    lineHeight: 17,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flexWrap: 'wrap',
  },
  cityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 22,
    paddingHorizontal: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(35,136,255,0.10)',
    maxWidth: '46%',
  },
  cityBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#39A0FF',
  },
  rentalBadge: {
    height: 22,
    paddingHorizontal: 7,
    borderRadius: 999,
    backgroundColor: FLEET_RENTAL_BADGE_BG,
    borderWidth: 1,
    borderColor: FLEET_RENTAL_BADGE_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rentalBadgeText: {
    fontSize: 8.5,
    fontWeight: '700',
    color: FLEET_RENTAL_BADGE_TEXT,
    lineHeight: 10,
  },
  trailerLine: {
    fontSize: 9.5,
    color: '#91A0B8',
    lineHeight: 11,
  },
  routeHint: {
    fontSize: 9,
    color: colors.textMuted,
    lineHeight: 10,
  },
  valueCol: {
    alignItems: 'flex-end',
    flexShrink: 0,
    gap: 2,
  },
  valueLabel: {
    fontSize: 8.5,
    color: '#74839B',
    lineHeight: 10,
  },
  valueAmount: {
    fontSize: 14,
    fontWeight: '800',
    color: '#11C96B',
    lineHeight: 16,
  },
  leaseAmount: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.accentAmber,
    lineHeight: 14,
  },
  busyIconWrap: {
    marginTop: 2,
  },
  featureRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 5,
  },
  featurePill: {
    flex: 1,
    minWidth: 0,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#0D1A2D',
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  featureLabel: {
    fontSize: 8,
    color: '#74839B',
    lineHeight: 10,
  },
  featureValue: {
    fontSize: 11,
    fontWeight: '700',
    color: '#F3F7FF',
    lineHeight: 13,
  },
  fuelCritical: {
    color: colors.danger,
  },
  fuelDetail: {
    minHeight: 44,
    marginTop: 6,
    paddingHorizontal: 10,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#0D1A2D',
    borderWidth: 1,
    borderColor: colors.border,
  },
  fuelDetailText: { flex: 1, minWidth: 0 },
  fuelDetailLabel: { fontSize: 8.5, color: colors.textMuted },
  fuelDetailValue: { fontSize: 11, fontWeight: '700', color: colors.textPrimary },
  fuelDetailAction: { fontSize: 10.5, fontWeight: '800', color: colors.accentBlue },
  fuelWarning: {
    minHeight: 44,
    marginTop: 6,
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.accentAmber,
    backgroundColor: colors.warningSoft,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  fuelWarningDanger: {
    borderColor: colors.danger,
    backgroundColor: colors.dangerSoft,
  },
  fuelWarningText: {
    flex: 1,
    minWidth: 0,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  roadsideButton: {
    minHeight: 44,
    paddingHorizontal: 9,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.danger,
  },
  roadsideButtonText: { fontSize: 9.5, fontWeight: '800', color: '#FFFFFF' },
  conditionBlock: {
    marginTop: 5,
    gap: 3,
  },
  conditionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  conditionTitle: {
    fontSize: 9.5,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  conditionPercent: {
    fontSize: 10.5,
    fontWeight: '800',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 6,
    alignItems: 'flex-start',
  },
  transferBlockedReason: {
    marginTop: 5,
    fontSize: 10,
    lineHeight: 13,
    color: colors.textMuted,
  },
  repairActionWrap: {
    flex: 1,
    minWidth: 0,
    alignItems: 'stretch',
  },
  actionBtn: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    height: 44,
    borderRadius: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingHorizontal: 3,
  },
  actionBtnInWrap: {
    flex: undefined,
    width: '100%',
  },
  actionPrimary: {
    backgroundColor: colors.accentBlue,
  },
  actionPrimaryText: {
    fontSize: 9.5,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  actionAmber: {
    backgroundColor: 'rgba(245,158,11,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.45)',
  },
  actionOutline: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(90,135,195,0.40)',
  },
  actionOutlineText: {
    fontSize: 9.5,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  actionUpgradeText: {
    color: colors.accentBlue,
  },
  repairAdCaption: {
    fontSize: 7.5,
    lineHeight: 9,
    color: colors.accentAmber,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 2,
  },
  actionNeutral: {
    backgroundColor: '#0D1A2D',
    borderWidth: 1,
    borderColor: 'rgba(70,120,190,0.22)',
  },
  moreDots: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
    lineHeight: 14,
    letterSpacing: 1,
  },
  actionDisabled: {
    opacity: 0.45,
  },
  actionDisabledText: {
    color: colors.textMuted,
  },
  morePanel: {
    marginTop: 5,
    gap: 5,
  },
  moreAction: {
    height: 34,
    borderRadius: 10,
    backgroundColor: '#0D1A2D',
    borderWidth: 1,
    borderColor: 'rgba(70,120,190,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  moreActionText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  marketplaceAction: {
    height: 48,
    alignItems: 'stretch',
    borderColor: colors.info,
    backgroundColor: colors.infoSoft,
  },
  marketplaceActionRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  marketplaceActionText: {
    flex: 1,
  },
  marketplaceActionSubtitle: {
    color: colors.textMuted,
    fontSize: 9,
    marginTop: 2,
  },
  moreMeta: {
    fontSize: 9,
    color: colors.textMuted,
    lineHeight: 12,
  },
});

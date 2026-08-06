import React, { memo, useMemo } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { getTruckArtwork } from '../../assets/fleetAssets';
import { stripLeaseSuffixFromTruckName } from '../fleet/fleetTheme';
import type { Delivery, Driver, Truck, TruckTransfer } from '../../types/game';
import { getCityName } from '../../utils/entityLookup';
import { formatFuelPercentLabel } from '../../utils/truckFuel';
import { getTruckTrackingMetrics } from '../../utils/truckTrackingMetrics';
import { getFuelWarningForJob } from '../../simulation/fuelWarnings';
import { areAdsFeatureEnabled } from '../../services/adProvider';
import { colors } from '../../theme';
import { GameIcon, StatusBadge, type StatusBadgeVariant } from '../ui';
import DeliveryBoostPanel from '../monetization/DeliveryBoostPanel';
import {
  MAP_BORDER,
  MAP_DELIVERY_PROGRESS_FILL,
  MAP_DELIVERY_PROGRESS_TRACK,
  MAP_MUTED,
  MAP_TITLE_COLOR,
  MAP_TRUCK_CARD_HEIGHT,
  MAP_TRUCK_CARD_HEIGHT_DELIVERY,
  MAP_TRUCK_CARD_RADIUS,
  MAP_SURFACE,
} from './mapTheme';
import { isActiveRunningDelivery, resolveTruckTrackingCityId } from './mapTruckLocation';

function getStatusBadge(status: Truck['status']): { label: string; variant: StatusBadgeVariant } {
  switch (status) {
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

function isLeasedTruck(truck: Truck): boolean {
  return (truck.ownershipType ?? 'owned') === 'leased' && !truck.leaseExpired;
}

function formatDeliveryRemaining(remainingHours: number): string {
  const hrs = Math.floor(remainingHours);
  const mins = Math.round((remainingHours - hrs) * 60);
  if (hrs > 0) return `${hrs} sa ${mins} dk kaldı`;
  return `${mins} dk kaldı`;
}

function buildStatusLine(
  truck: Truck,
  delivery: Delivery | undefined,
  transfer: TruckTransfer | undefined,
  currentTime: number | undefined,
): string {
  if ((truck.status === 'on_route' || truck.status === 'out_of_fuel') && delivery) {
    const parts: string[] = [];
    if (truck.status === 'out_of_fuel') {
      parts.push('Yakıt bitti');
    }
    if (typeof delivery.progress === 'number') {
      const pct = Math.round(Math.max(0, Math.min(1, delivery.progress)) * 100);
      parts.push(`%${pct} tamamlandı`);
    }
    if (currentTime != null && typeof delivery.estimatedArrivalTime === 'number') {
      const remaining = Math.max(0, delivery.estimatedArrivalTime - currentTime);
      parts.push(formatDeliveryRemaining(remaining));
    }
    if (parts.length > 0) return parts.join(' · ');
    return `${getCityName(delivery.destinationCityId)}'ya gidiyor`;
  }
  if (truck.status === 'transferring' && transfer) {
    return `${getCityName(transfer.toCityId)}'ya gidiyor`;
  }
  if (truck.status === 'maintenance') {
    return 'Bakımda';
  }
  if (truck.status === 'out_of_fuel') {
    return 'Yakıt bitti · araç bekliyor';
  }
  return 'Yeni iş için hazır';
}

function buildLocationLine(
  delivery: Delivery | undefined,
  cityName: string,
): string {
  if (isActiveRunningDelivery(delivery)) {
    return `${getCityName(delivery.originCityId)} → ${getCityName(delivery.destinationCityId)}`;
  }
  return cityName;
}

function fuelTone(percent: number): string {
  if (percent <= 20) return '#F87171';
  if (percent <= 40) return '#FBBF24';
  return '#E8EEF7';
}

function formatEtaHours(hours: number | null): string {
  if (hours == null || !Number.isFinite(hours) || hours < 0) return 'ETA bekleniyor';
  const totalMinutes = Math.max(0, Math.round(hours * 60));
  const wholeHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (wholeHours <= 0) return `ETA ${minutes} dk`;
  return `ETA ${wholeHours} sa ${minutes} dk`;
}

export interface MapTruckTrackingCardProps {
  truck: Truck;
  delivery?: Delivery;
  transfer?: TruckTransfer;
  driver?: Driver;
  homeCityId?: string;
  currentTime?: number;
  onPress?: () => void;
  onRoadsideFuel?: (jobId: string) => void;
}

function MapTruckTrackingCard({
  truck,
  delivery,
  transfer,
  driver,
  homeCityId,
  currentTime,
  onPress,
  onRoadsideFuel,
}: MapTruckTrackingCardProps) {
  const artwork = useMemo(() => getTruckArtwork(truck), [truck.id, truck.catalogId]);
  const badge = getStatusBadge(truck.status);
  const isLeased = isLeasedTruck(truck);
  const displayName = stripLeaseSuffixFromTruckName(truck.name);
  const activeDelivery = isActiveRunningDelivery(delivery) ? delivery : undefined;
  const cityId = resolveTruckTrackingCityId(truck, activeDelivery, homeCityId);
  const cityName = getCityName(cityId);
  const isActiveDelivery = activeDelivery != null;
  const locationLine = buildLocationLine(activeDelivery, cityName);
  const statusLine = buildStatusLine(truck, activeDelivery, transfer, currentTime);
  const showProgressBar = isActiveDelivery && typeof activeDelivery.progress === 'number';
  const progressPct = showProgressBar
    ? Math.round(Math.max(0, Math.min(1, activeDelivery.progress)) * 100)
    : 0;

  const metrics = useMemo(
    () =>
      getTruckTrackingMetrics({
        truck,
        delivery: activeDelivery,
        transfer,
        driver,
      }),
    [
      truck,
      truck.id,
      truck.currentFuelL,
      truck.fuelTankCapacityL,
      truck.capacity,
      truck.fuelConsumptionPerKm,
      truck.status,
      activeDelivery,
      transfer,
      driver,
    ],
  );
  const fuelJob = activeDelivery ?? transfer;
  const fuelWarning = getFuelWarningForJob(fuelJob, truck);
  const showDeliveryBoost =
    isActiveDelivery && activeDelivery != null && areAdsFeatureEnabled();

  const kmLabel = metrics.isMoving
    ? `${metrics.remainingDistanceKm} km`
    : '0 km';
  const speedLabel = metrics.isMoving
    ? `${metrics.currentSpeedKmh} km/sa`
    : '0 km/sa';
  const etaLabel = metrics.isMoving
    ? formatEtaHours(metrics.etaHours)
    : 'ETA beklemede';

  const CardContainer = View;

  return (
    <CardContainer style={[styles.card, showProgressBar && styles.cardDelivery]}>
      <TouchableOpacity
        style={styles.cardPressArea}
        onPress={onPress}
        activeOpacity={onPress ? 0.88 : 1}
        disabled={!onPress}
        accessibilityRole={onPress ? 'button' : undefined}
      >
      <View style={styles.cardRow}>
        <View style={styles.artworkBox}>
          {artwork ? (
            <Image source={artwork} style={styles.artwork} resizeMode="contain" />
          ) : (
            <GameIcon name="truck" size={28} color={MAP_MUTED} />
          )}
        </View>

        <View style={styles.mainCol}>
          <View style={styles.titleRow}>
            <Text style={styles.truckName} numberOfLines={1}>
              {displayName}
            </Text>
            {isLeased ? (
              <View style={styles.rentalBadge}>
                <Text style={styles.rentalBadgeText}>KİRALIK</Text>
              </View>
            ) : null}
          </View>
          <View style={styles.locationRow}>
            <GameIcon name="map" size={11} color={MAP_MUTED} />
            <Text style={[styles.cityLine, isActiveDelivery && styles.routeLine]} numberOfLines={1}>
              {locationLine}
            </Text>
          </View>
          <View style={styles.statusRow}>
            <View
              style={[
                styles.statusDot,
                truck.status === 'idle' ? styles.statusDotReady : styles.statusDotBusy,
              ]}
            />
            <Text style={styles.statusLine} numberOfLines={1}>
              {statusLine}
            </Text>
          </View>
        </View>

        <View style={styles.metricsCol}>
          <View style={styles.metricItem}>
            <GameIcon name="fuel" size={14} color={fuelTone(metrics.fuelPercent)} />
            <Text style={[styles.metricValue, { color: fuelTone(metrics.fuelPercent) }]}>
              {formatFuelPercentLabel(metrics.fuelPercent)}
            </Text>
          </View>
          <View style={styles.metricDivider} />
          <View style={styles.metricItem}>
            <GameIcon
              name={metrics.isMoving ? 'distance' : 'speedometer'}
              size={14}
              color={MAP_MUTED}
            />
            <Text style={styles.metricValue}>
              {metrics.isMoving ? kmLabel : speedLabel}
            </Text>
            {metrics.isMoving ? (
              <>
                <Text style={styles.metricSubValue}>{speedLabel}</Text>
                <Text style={styles.metricEtaValue}>{etaLabel}</Text>
              </>
            ) : null}
          </View>
        </View>

        <View style={styles.rightCol}>
          <StatusBadge label={badge.label} variant={badge.variant} size="sm" />
          <GameIcon name="chevronRight" size={16} color={MAP_MUTED} />
        </View>
      </View>

      {fuelWarning ? (
        <View
          style={[
            styles.fuelWarning,
            fuelWarning.key === 'out-of-fuel' && styles.fuelWarningDanger,
          ]}
        >
          <GameIcon
            name="warning"
            size={13}
            color={fuelWarning.key === 'out-of-fuel' ? colors.danger : colors.accentAmber}
          />
          <Text style={styles.fuelWarningText}>{fuelWarning.message}</Text>
          {fuelWarning.key === 'out-of-fuel' && fuelJob && onRoadsideFuel ? (
            <TouchableOpacity
              style={styles.roadsideButton}
              onPress={() => onRoadsideFuel(fuelJob.id)}
            >
              <Text style={styles.roadsideButtonText}>Acil Yakıt</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {showProgressBar ? (
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
        </View>
      ) : null}
      </TouchableOpacity>

      {showDeliveryBoost && activeDelivery ? (
        <DeliveryBoostPanel
          delivery={activeDelivery}
          truck={truck}
          compact
          currentGameTime={currentTime}
        />
      ) : null}
    </CardContainer>
  );
}

function arePropsEqual(prev: MapTruckTrackingCardProps, next: MapTruckTrackingCardProps): boolean {
  if (prev.truck.id !== next.truck.id) return false;
  if (prev.truck.status !== next.truck.status) return false;
  if (prev.truck.currentFuelL !== next.truck.currentFuelL) return false;
  if (prev.truck.fuelTankCapacityL !== next.truck.fuelTankCapacityL) return false;
  if (prev.truck.capacity !== next.truck.capacity) return false;
  if (prev.truck.fuelConsumptionPerKm !== next.truck.fuelConsumptionPerKm) return false;
  if (prev.truck.name !== next.truck.name) return false;
  if (prev.truck.catalogId !== next.truck.catalogId) return false;
  if (prev.truck.currentCityId !== next.truck.currentCityId) return false;
  if (prev.truck.ownershipType !== next.truck.ownershipType) return false;
  if (prev.truck.leaseExpired !== next.truck.leaseExpired) return false;
  if (prev.delivery !== next.delivery) return false;
  if (prev.transfer !== next.transfer) return false;
  if (prev.driver !== next.driver) return false;
  if (prev.homeCityId !== next.homeCityId) return false;
  if (prev.onPress !== next.onPress) return false;
  if (prev.onRoadsideFuel !== next.onRoadsideFuel) return false;
  if (next.delivery != null && prev.currentTime !== next.currentTime) return false;
  if (next.transfer != null && next.transfer.status === 'active' && prev.currentTime !== next.currentTime) {
    return false;
  }
  return true;
}

export default memo(MapTruckTrackingCard, arePropsEqual);

const styles = StyleSheet.create({
  card: {
    minHeight: MAP_TRUCK_CARD_HEIGHT,
    borderRadius: MAP_TRUCK_CARD_RADIUS,
    backgroundColor: MAP_SURFACE,
    borderWidth: 1,
    borderColor: MAP_BORDER,
    paddingHorizontal: 10,
    paddingVertical: 9,
    marginBottom: 8,
  },
  cardPressArea: {
    gap: 0,
  },
  cardDelivery: {
    minHeight: MAP_TRUCK_CARD_HEIGHT_DELIVERY + 52,
    paddingBottom: 8,
  },
  cardRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  artworkBox: {
    width: 64,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  artwork: {
    width: 64,
    height: 52,
  },
  mainCol: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
  },
  truckName: {
    flexShrink: 1,
    fontSize: 13.5,
    fontWeight: '800',
    color: MAP_TITLE_COLOR,
  },
  rentalBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: 'rgba(245,158,11,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.45)',
    flexShrink: 0,
  },
  rentalBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#F59E0B',
    letterSpacing: 0.3,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minWidth: 0,
  },
  cityLine: {
    flexShrink: 1,
    fontSize: 11,
    fontWeight: '600',
    color: MAP_MUTED,
  },
  routeLine: {
    color: '#7FA8CC',
    fontWeight: '700',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minWidth: 0,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    borderWidth: 1.5,
    flexShrink: 0,
  },
  statusDotReady: {
    borderColor: '#34D399',
    backgroundColor: 'transparent',
  },
  statusDotBusy: {
    borderColor: '#60A5FA',
    backgroundColor: 'rgba(96,165,250,0.35)',
  },
  statusLine: {
    flexShrink: 1,
    fontSize: 10.5,
    fontWeight: '600',
    color: '#7FA8CC',
  },
  metricsCol: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 6,
    flexShrink: 0,
  },
  metricItem: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    minWidth: 36,
  },
  metricDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    backgroundColor: 'rgba(148,163,184,0.28)',
    marginVertical: 2,
  },
  metricValue: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#E8EEF7',
    letterSpacing: 0.1,
  },
  metricSubValue: {
    fontSize: 8.5,
    fontWeight: '600',
    color: MAP_MUTED,
  },
  metricEtaValue: {
    maxWidth: 74,
    fontSize: 7.5,
    lineHeight: 10,
    fontWeight: '600',
    color: MAP_MUTED,
    textAlign: 'center',
  },
  rightCol: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 6,
    flexShrink: 0,
  },
  fuelWarning: {
    minHeight: 40,
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.accentAmber,
    backgroundColor: colors.warningSoft,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  fuelWarningDanger: {
    borderColor: colors.danger,
    backgroundColor: colors.dangerSoft,
  },
  fuelWarningText: {
    flex: 1,
    minWidth: 0,
    fontSize: 9.5,
    lineHeight: 12,
    fontWeight: '700',
    color: MAP_TITLE_COLOR,
  },
  roadsideButton: {
    minHeight: 44,
    paddingHorizontal: 8,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.danger,
  },
  roadsideButtonText: { fontSize: 9, fontWeight: '800', color: '#FFFFFF' },
  progressTrack: {
    height: 4,
    borderRadius: 999,
    backgroundColor: MAP_DELIVERY_PROGRESS_TRACK,
    overflow: 'hidden',
    marginTop: 6,
  },
  progressFill: {
    height: 4,
    borderRadius: 999,
    backgroundColor: MAP_DELIVERY_PROGRESS_FILL,
  },
});

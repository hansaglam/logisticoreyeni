import React, { memo, useMemo } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { getTruckArtwork } from '../../assets/fleetAssets';
import { stripLeaseSuffixFromTruckName } from '../fleet/fleetTheme';
import type { Delivery, Truck, TruckTransfer } from '../../types/game';
import { getCityName } from '../../utils/entityLookup';
import { GameIcon, StatusBadge, type StatusBadgeVariant } from '../ui';
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
  if (truck.status === 'on_route' && delivery) {
    const parts: string[] = [];
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

export interface MapTruckTrackingCardProps {
  truck: Truck;
  delivery?: Delivery;
  transfer?: TruckTransfer;
  homeCityId?: string;
  currentTime?: number;
  onPress?: () => void;
}

function MapTruckTrackingCard({
  truck,
  delivery,
  transfer,
  homeCityId,
  currentTime,
  onPress,
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
  const condition = Math.round(truck.condition ?? 100);
  const showProgressBar = isActiveDelivery && typeof activeDelivery.progress === 'number';
  const progressPct = showProgressBar
    ? Math.round(Math.max(0, Math.min(1, activeDelivery.progress)) * 100)
    : 0;

  const CardWrapper = onPress ? TouchableOpacity : View;

  return (
    <CardWrapper
      style={[styles.card, showProgressBar && styles.cardDelivery]}
      {...(onPress ? { onPress, activeOpacity: 0.88 } : {})}
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
          <Text style={[styles.cityLine, isActiveDelivery && styles.routeLine]} numberOfLines={1}>
            {locationLine}
          </Text>
          <Text style={styles.statusLine} numberOfLines={1}>
            {statusLine}
          </Text>
        </View>

        <View style={styles.rightCol}>
          <Text style={styles.statLine} numberOfLines={1}>
            Kond. {condition}%
          </Text>
          <StatusBadge label={badge.label} variant={badge.variant} size="sm" />
          <GameIcon name="chevronRight" size={16} color={MAP_MUTED} />
        </View>
      </View>

      {showProgressBar ? (
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
        </View>
      ) : null}
    </CardWrapper>
  );
}

function arePropsEqual(prev: MapTruckTrackingCardProps, next: MapTruckTrackingCardProps): boolean {
  if (prev.truck !== next.truck) return false;
  if (prev.delivery !== next.delivery) return false;
  if (prev.transfer !== next.transfer) return false;
  if (prev.homeCityId !== next.homeCityId) return false;
  if (prev.onPress !== next.onPress) return false;
  if (next.delivery != null && prev.currentTime !== next.currentTime) return false;
  return true;
}

export default memo(MapTruckTrackingCard, arePropsEqual);

const styles = StyleSheet.create({
  card: {
    height: MAP_TRUCK_CARD_HEIGHT,
    borderRadius: MAP_TRUCK_CARD_RADIUS,
    backgroundColor: MAP_SURFACE,
    borderWidth: 1,
    borderColor: MAP_BORDER,
    paddingHorizontal: 10,
    paddingVertical: 9,
    marginBottom: 8,
  },
  cardDelivery: {
    height: MAP_TRUCK_CARD_HEIGHT_DELIVERY,
    paddingBottom: 8,
  },
  cardRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  artworkBox: {
    width: 72,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  artwork: {
    width: 72,
    height: 56,
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
  cityLine: {
    fontSize: 11,
    fontWeight: '600',
    color: MAP_MUTED,
  },
  routeLine: {
    color: '#7FA8CC',
    fontWeight: '700',
  },
  statusLine: {
    fontSize: 10.5,
    fontWeight: '600',
    color: '#7FA8CC',
  },
  rightCol: {
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
    gap: 4,
    flexShrink: 0,
    minWidth: 72,
  },
  statLine: {
    fontSize: 10,
    fontWeight: '700',
    color: MAP_MUTED,
  },
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

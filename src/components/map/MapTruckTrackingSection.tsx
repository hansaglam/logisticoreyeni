import React, { memo, useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import type { Delivery, Driver, Truck, TruckTransfer } from '../../types/game';
import { getCityName } from '../../utils/entityLookup';
import { GameIcon } from '../ui';
import MapTruckTrackingCard from './MapTruckTrackingCard';
import {
  MAP_ACCENT,
  MAP_BORDER,
  MAP_MUTED,
  MAP_SPACING_PANEL_TO_TRACKING,
  MAP_SURFACE,
  MAP_TITLE_COLOR,
} from './mapTheme';

const MAX_PREVIEW = 3;

function truckTrackSortPriority(status: Truck['status']): number {
  switch (status) {
    case 'on_route':
      return 0;
    case 'transferring':
      return 1;
    case 'idle':
      return 2;
    case 'maintenance':
      return 3;
    default:
      return 4;
  }
}

function findDeliveryForTruck(truckId: string, deliveries: Delivery[]): Delivery | undefined {
  return deliveries.find(
    (delivery) =>
      delivery.truckId === truckId &&
      (delivery.status === 'preparing' ||
        delivery.status === 'on_route' ||
        delivery.status === 'paused'),
  );
}

function findTransferForTruck(truckId: string, transfers: TruckTransfer[]): TruckTransfer | undefined {
  return transfers.find(
    (transfer) =>
      transfer.truckId === truckId &&
      (transfer.status === 'active' || transfer.status === 'paused'),
  );
}

function findDriverForTruck(
  truck: Truck,
  delivery: Delivery | undefined,
  transfer: TruckTransfer | undefined,
  drivers: Driver[],
): Driver | undefined {
  const driverId = delivery?.driverId ?? transfer?.driverId;
  if (driverId) {
    return drivers.find((driver) => driver.id === driverId);
  }
  return drivers.find((driver) => driver.assignedTruckId === truck.id);
}

export interface MapTruckTrackingSectionProps {
  trucks: Truck[];
  drivers: Driver[];
  deliveries: Delivery[];
  transfers: TruckTransfer[];
  idleTruckCountByCity: Record<string, number>;
  homeCityId?: string;
  currentTime?: number;
  onOpenFleet: () => void;
  onTruckPress?: (truckId: string) => void;
  onRoadsideFuel?: (jobId: string) => void;
}

function MapTruckTrackingSection({
  trucks,
  drivers,
  deliveries,
  transfers,
  idleTruckCountByCity,
  homeCityId,
  currentTime,
  onOpenFleet,
  onTruckPress,
  onRoadsideFuel,
}: MapTruckTrackingSectionProps) {
  const sortedTrucks = useMemo(
    () =>
      [...trucks].sort(
        (a, b) => truckTrackSortPriority(a.status) - truckTrackSortPriority(b.status),
      ),
    [trucks],
  );

  const previewTrucks = sortedTrucks.slice(0, MAX_PREVIEW);
  const extraTruckCount = Math.max(0, sortedTrucks.length - previewTrucks.length);

  const idleCityChips = useMemo(
    () =>
      Object.entries(idleTruckCountByCity)
        .filter(([, count]) => count > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([cityId, count]) => ({
          cityId,
          label: `${getCityName(cityId)} ${count}`,
        })),
    [idleTruckCountByCity],
  );

  if (trucks.length === 0) {
    return null;
  }

  return (
    <View style={styles.section}>
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <GameIcon name="truck" size={18} color={MAP_ACCENT} />
          <View style={styles.headerTextCol}>
            <Text style={styles.title}>Kamyon Takip</Text>
            <Text style={styles.subtitle} numberOfLines={1}>
              Filonuzdaki araçların anlık durumu
            </Text>
          </View>
        </View>
        <TouchableOpacity style={styles.viewAllBtn} onPress={onOpenFleet} activeOpacity={0.85}>
          <Text style={styles.viewAllText}>Tümünü Gör</Text>
        </TouchableOpacity>
      </View>

      {idleCityChips.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipScroll}
          contentContainerStyle={styles.chipRow}
        >
          {idleCityChips.map((chip) => (
            <View key={chip.cityId} style={styles.chip}>
              <Text style={styles.chipText}>{chip.label}</Text>
            </View>
          ))}
        </ScrollView>
      ) : null}

      {previewTrucks.map((truck) => {
        const cardDelivery = findDeliveryForTruck(truck.id, deliveries);
        const cardTransfer = findTransferForTruck(truck.id, transfers);
        const isActiveJob = cardDelivery != null || cardTransfer != null;
        return (
          <MapTruckTrackingCard
            key={truck.id}
            truck={truck}
            delivery={cardDelivery}
            transfer={cardTransfer}
            driver={findDriverForTruck(truck, cardDelivery, cardTransfer, drivers)}
            homeCityId={homeCityId}
            currentTime={isActiveJob ? currentTime : undefined}
            onPress={onTruckPress ? () => onTruckPress(truck.id) : undefined}
            onRoadsideFuel={onRoadsideFuel}
          />
        );
      })}

      {extraTruckCount > 0 ? (
        <TouchableOpacity onPress={onOpenFleet} activeOpacity={0.85}>
          <Text style={styles.moreHint}>+{extraTruckCount} araç daha</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export default memo(MapTruckTrackingSection);

const styles = StyleSheet.create({
  section: {
    marginTop: MAP_SPACING_PANEL_TO_TRACKING,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 10,
  },
  headerLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 0,
  },
  headerTextCol: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    fontSize: 15,
    fontWeight: '800',
    color: MAP_TITLE_COLOR,
  },
  subtitle: {
    fontSize: 11,
    color: MAP_MUTED,
  },
  viewAllBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: MAP_BORDER,
    backgroundColor: MAP_SURFACE,
    flexShrink: 0,
  },
  viewAllText: {
    fontSize: 11,
    fontWeight: '800',
    color: MAP_ACCENT,
  },
  chipScroll: {
    marginHorizontal: -16,
    marginBottom: 10,
  },
  chipRow: {
    paddingHorizontal: 16,
    gap: 8,
    flexDirection: 'row',
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: MAP_SURFACE,
    borderWidth: 1,
    borderColor: MAP_BORDER,
  },
  chipText: {
    color: MAP_MUTED,
    fontSize: 10,
    fontWeight: '700',
  },
  moreHint: {
    color: MAP_ACCENT,
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 2,
    marginBottom: 4,
  },
});

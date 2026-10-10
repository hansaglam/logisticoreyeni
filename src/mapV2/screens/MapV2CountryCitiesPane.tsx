import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { MIN_TOUCH_TARGET } from '../../constants/layout';
import { colors, radius, spacing, typography } from '../../theme';
import type { GeoCityRecord } from '../geo/cityPackage';
import type { CityOperationViewModel } from '../gameplay/cityOperation';
import type { CityAvailabilityState } from '../gameplay/cityProgression';
import { isCityAvailabilityOpen } from '../gameplay/cityProgression';
import { resolveCityDisplayName } from '../presentation/cityDisplayName';
import { cityAvailabilityStatusLabel, mapV2ExperienceCopy } from '../presentation/mapV2ExperienceCopy';

type Props = {
  cities: GeoCityRecord[];
  selectedCityId: string | null;
  operationsByGeoCityId: Record<string, CityOperationViewModel>;
  availabilityByGeoCityId: Record<string, CityAvailabilityState>;
  onSelect: (geoCityId: string) => void;
  onInspect: (geoCityId: string) => void;
};

export default function MapV2CountryCitiesPane({
  cities,
  selectedCityId,
  operationsByGeoCityId,
  availabilityByGeoCityId,
  onSelect,
  onInspect,
}: Props) {
  return (
    <ScrollView contentContainerStyle={styles.list} accessibilityRole="list">
      {cities.map((city) => {
        const selected = city.geoCityId === selectedCityId;
        const name = resolveCityDisplayName(city, 'tr');
        const operation = operationsByGeoCityId[city.geoCityId];
        const availability = availabilityByGeoCityId[city.geoCityId] ?? 'UNLOCKED';
        const open = isCityAvailabilityOpen(availability);
        const status = !open
          ? cityAvailabilityStatusLabel(availability)
          : operation?.isHomeCity
            ? mapV2ExperienceCopy.cityHomeStatus
            : city.settlementClass === 'CAPITAL'
              ? mapV2ExperienceCopy.cityCapital
              : mapV2ExperienceCopy.statusUnlocked;
        const summary = open && operation
          ? `${mapV2ExperienceCopy.cityMetricWarehouse} ${operation.warehouseCount} · ${mapV2ExperienceCopy.cityMetricTruck} ${operation.ownedTruckCount}`
          : status;
        return (
          <Pressable
            key={city.geoCityId}
            onPress={() => {
              onSelect(city.geoCityId);
              if (open) onInspect(city.geoCityId);
            }}
            style={[styles.row, selected && styles.rowOn, !open && styles.rowLocked]}
            accessibilityRole="button"
            accessibilityLabel={`${name}, ${status}`}
          >
            <View style={[styles.dot, !open && styles.dotLocked]} />
            <View style={styles.meta}>
              <Text style={[styles.name, !open && styles.nameLocked]}>{name}</Text>
              <Text style={styles.class} numberOfLines={1}>
                {status}
                {open ? ` · ${summary}` : ''}
              </Text>
            </View>
            <Text style={styles.chevron} accessibilityElementsHidden>
              {open ? '›' : '○'}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.xs, paddingBottom: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
  },
  rowOn: { borderColor: colors.primary, backgroundColor: colors.accentBlueSoft },
  rowLocked: { backgroundColor: colors.surface2 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#5EEAD4' },
  dotLocked: { backgroundColor: '#4A5D70' },
  meta: { flex: 1, minWidth: 0 },
  name: { ...typography.body, color: colors.textPrimary, fontWeight: '700' },
  nameLocked: { color: colors.textSecondary },
  class: { ...typography.caption, color: colors.textMuted },
  chevron: { ...typography.sectionTitle, color: colors.primaryLight, paddingHorizontal: 4 },
});

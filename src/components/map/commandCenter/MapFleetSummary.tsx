import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MIN_TOUCH_TARGET } from '../../../constants/layout';
import type { FleetMapFilter, FleetSummaryCounts, MapFleetEntity } from '../../../mapV2/gameplay/mapV2FleetAdapter';
import { mapUiTheme } from './mapUiTheme';

const FILTERS: readonly { id: FleetMapFilter; label: string }[] = [
  { id: 'all', label: 'Tümü' },
  { id: 'available', label: 'Müsait' },
  { id: 'enroute', label: 'Yolda' },
  { id: 'problem', label: 'Sorunlu' },
];

export type MapFleetSummaryModel = {
  counts: FleetSummaryCounts;
  filter: FleetMapFilter;
  trucks: readonly MapFleetEntity[];
  clusterTrucks: readonly MapFleetEntity[];
  clusterCityId: string | null;
  cityName?: string | null;
  onFilter: (filter: FleetMapFilter) => void;
  onSelectTruck: (truckId: string) => void;
  onClearCluster: () => void;
};

function MapFleetSummary({ model }: { model: MapFleetSummaryModel }) {
  const rows = model.clusterCityId ? model.clusterTrucks : model.trucks;
  return (
    <View>
      <Metric label="Toplam araç" value={model.counts.total} />
      <Metric label="Müsait" value={model.counts.available} />
      <Metric label="Yolda" value={model.counts.enRoute} />
      <Metric label="Bakımda" value={model.counts.maintenance} />
      <Metric label="Yakıt bekliyor" value={model.counts.outOfFuel} />
      {model.cityName && model.counts.cityVehicleCount != null ? (
        <Text style={styles.cityContext}>
          {model.cityName}
          {'\n'}
          Bu şehirde {model.counts.cityVehicleCount} araç
        </Text>
      ) : null}
      <View style={styles.filters}>
        {FILTERS.map((filter) => {
          const selected = model.filter === filter.id;
          return (
            <Pressable
              key={filter.id}
              style={[styles.filter, selected ? styles.filterSelected : null]}
              onPress={() => model.onFilter(filter.id)}
              accessibilityRole="button"
              accessibilityLabel={filter.label}
              accessibilityState={{ selected }}
            >
              <Text style={[styles.filterLabel, selected ? styles.filterLabelSelected : null]}>{filter.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {model.clusterCityId ? (
        <Pressable style={styles.clear} onPress={model.onClearCluster} accessibilityRole="button" accessibilityLabel="Tümünü göster">
          <Text style={styles.clearLabel}>Tümünü göster</Text>
        </Pressable>
      ) : null}
      {rows.map((truck) => (
        <Pressable
          key={truck.truckId}
          style={styles.truck}
          onPress={() => model.onSelectTruck(truck.truckId)}
          accessibilityRole="button"
          accessibilityLabel={truck.accessibilityLabel}
        >
          <Text style={styles.truckName} numberOfLines={1}>
            {truck.displayName}
          </Text>
          <Text style={styles.truckMeta} numberOfLines={1}>
            {truck.locationLabel} · {truck.statusLabel}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

export default React.memo(MapFleetSummary);

const styles = StyleSheet.create({
  metric: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 3,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: mapUiTheme.border,
  },
  metricLabel: {
    flex: 1,
    color: mapUiTheme.textSecondary,
    fontSize: 11,
    fontWeight: '600',
  },
  metricValue: {
    color: mapUiTheme.textPrimary,
    fontSize: 13,
    fontWeight: '800',
  },
  cityContext: {
    color: mapUiTheme.cyanPrimary,
    fontSize: 11,
    fontWeight: '700',
    marginTop: mapUiTheme.space8,
  },
  filters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: mapUiTheme.space8,
  },
  filter: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: mapUiTheme.space8,
    marginRight: mapUiTheme.space4,
    marginBottom: mapUiTheme.space4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: mapUiTheme.border,
    borderRadius: mapUiTheme.smallRadius,
  },
  filterSelected: {
    borderColor: mapUiTheme.borderStrong,
    backgroundColor: mapUiTheme.surface,
  },
  filterLabel: {
    color: mapUiTheme.textSecondary,
    fontSize: 11,
    fontWeight: '700',
  },
  filterLabelSelected: {
    color: mapUiTheme.textPrimary,
  },
  truck: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: mapUiTheme.border,
  },
  truckName: {
    color: mapUiTheme.textPrimary,
    fontSize: 12,
    fontWeight: '800',
  },
  truckMeta: {
    color: mapUiTheme.textSecondary,
    fontSize: 10,
    fontWeight: '600',
  },
  clear: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
  },
  clearLabel: {
    color: mapUiTheme.textMuted,
    fontSize: 11,
    fontWeight: '700',
  },
});

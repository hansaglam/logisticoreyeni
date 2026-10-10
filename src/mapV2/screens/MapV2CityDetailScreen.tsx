import React, { useEffect, useRef } from 'react';
import { Animated, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ScreenHeader } from '../../components/ui';
import { MIN_TOUCH_TARGET } from '../../constants/layout';
import { colors, radius, spacing, typography } from '../../theme';
import { getCityName } from '../../utils/entityLookup';
import type { Delivery, Truck, Warehouse } from '../../types/game';
import type { CityOperationViewModel } from '../gameplay/cityOperation';
import { truckStatusCaption } from '../gameplay/cityOperation';
import { mapV2ExperienceCopy } from '../presentation/mapV2ExperienceCopy';

type Props = {
  model: CityOperationViewModel;
  countryTitle: string;
  warehouses: readonly Warehouse[];
  trucks: readonly Truck[];
  deliveries: readonly Delivery[];
  onBack: () => void;
  reduceMotion: boolean;
};

function warehouseCaption(warehouse: Warehouse): string {
  const type = warehouse.warehouseType;
  if (type === 'cold') return 'Soğuk depo';
  if (type === 'secure') return 'Güvenli depo';
  if (type === 'heavy') return 'Ağır yük deposu';
  return mapV2ExperienceCopy.cityWarehouseGameplay;
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.metric} accessibilityRole="text" accessibilityLabel={`${label} ${value}`}>
      <Text style={styles.metricValue}>{String(value)}</Text>
      <Text style={styles.metricLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function EmptyLine({ text }: { text: string }) {
  return <Text style={styles.empty}>{text}</Text>;
}

export default function MapV2CityDetailScreen({
  model,
  countryTitle,
  warehouses,
  trucks,
  deliveries,
  onBack,
  reduceMotion,
}: Props) {
  const fade = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) {
      fade.setValue(1);
      return;
    }
    Animated.timing(fade, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [fade, reduceMotion]);

  const status =
    model.operationalStatus === 'HOME' ? mapV2ExperienceCopy.cityHomeStatus : mapV2ExperienceCopy.cityOpsRole;

  return (
    <Animated.View style={[styles.root, { opacity: fade }]}>
      <ScreenHeader title={model.displayName} subtitle={`${countryTitle} · ${status}`} onBack={onBack} compact />
      <ScrollView contentContainerStyle={styles.body} accessibilityRole="scrollbar">
        <View style={styles.hero} accessibilityRole="summary">
          <Text style={styles.heroName}>{model.displayName}</Text>
          <Text style={styles.heroStatus}>{status}</Text>
          <View style={styles.metrics}>
            <Metric label={mapV2ExperienceCopy.cityHeroWarehouses} value={model.warehouseCount} />
            <Metric label={mapV2ExperienceCopy.cityHeroTrucks} value={model.ownedTruckCount} />
            <Metric label={mapV2ExperienceCopy.cityHeroDeliveries} value={model.activeDeliveryCount} />
          </View>
        </View>

        <Text style={styles.section}>{mapV2ExperienceCopy.citySectionSummary}</Text>
        <View style={styles.card}>
          <Text style={styles.rowText}>
            {status}
            {model.isHomeCity ? ` · ${mapV2ExperienceCopy.cityHomeStatus}` : ''}
          </Text>
          <Text style={styles.rowMuted}>
            {mapV2ExperienceCopy.cityMetricWarehouse} {model.warehouseCount} · {mapV2ExperienceCopy.cityMetricTruck}{' '}
            {model.ownedTruckCount} · {mapV2ExperienceCopy.cityMetricJobs} {model.activeDeliveryCount}
          </Text>
        </View>

        <Text style={styles.section}>{mapV2ExperienceCopy.citySectionWarehouses}</Text>
        <View style={styles.card}>
          {warehouses.length === 0 ? (
            <EmptyLine text={mapV2ExperienceCopy.cityEmptyWarehouses} />
          ) : (
            warehouses.map((warehouse) => (
              <View key={warehouse.id} style={styles.item} accessibilityRole="text">
                <Text style={styles.itemTitle}>{warehouseCaption(warehouse)}</Text>
                <Text style={styles.itemMeta}>{`${warehouse.capacityTons ?? warehouse.capacityTon ?? 0} t`}</Text>
              </View>
            ))
          )}
        </View>

        <Text style={styles.section}>{mapV2ExperienceCopy.citySectionFleet}</Text>
        <View style={styles.card}>
          {trucks.length === 0 ? (
            <EmptyLine text={mapV2ExperienceCopy.cityEmptyFleet} />
          ) : (
            trucks.map((truck) => (
              <View key={truck.id} style={styles.item} accessibilityRole="text">
                <Text style={styles.itemTitle}>{truck.name}</Text>
                <Text style={styles.itemMeta}>{truckStatusCaption(truck.status)}</Text>
              </View>
            ))
          )}
        </View>

        <Text style={styles.section}>{mapV2ExperienceCopy.citySectionJobs}</Text>
        <View style={styles.card}>
          {deliveries.length === 0 ? (
            <EmptyLine text={mapV2ExperienceCopy.cityEmptyJobs} />
          ) : (
            deliveries.map((delivery) => (
              <View key={delivery.id} style={styles.item} accessibilityRole="text">
                <Text style={styles.itemTitle}>
                  {getCityName(delivery.originCityId)} → {getCityName(delivery.destinationCityId)}
                </Text>
                <Text style={styles.itemMeta}>
                  {delivery.status === 'on_route'
                    ? 'Yolda'
                    : delivery.status === 'paused'
                      ? 'Duraklatıldı'
                      : 'Hazırlanıyor'}
                </Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { gap: spacing.sm, paddingBottom: spacing.lg },
  hero: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  heroName: { ...typography.dashboardTitle, color: colors.textPrimary },
  heroStatus: { ...typography.caption, color: colors.primaryLight },
  metrics: { flexDirection: 'row', gap: spacing.xs },
  metric: {
    flex: 1,
    backgroundColor: colors.surface2,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
  },
  metricValue: { ...typography.dashboardMetricValue, fontSize: 18 },
  metricLabel: { ...typography.dashboardMetricLabel },
  section: { ...typography.sectionTitle, color: colors.textPrimary, marginTop: spacing.xs },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  rowText: { ...typography.bodySmall, color: colors.textPrimary },
  rowMuted: { ...typography.caption, color: colors.textMuted },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    minHeight: 36,
  },
  itemTitle: { ...typography.bodySmall, color: colors.textPrimary, flex: 1 },
  itemMeta: { ...typography.caption, color: colors.textMuted },
  empty: { ...typography.bodySmall, color: colors.textMuted },
});

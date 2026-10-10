import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '../../components/ui';
import { MIN_TOUCH_TARGET } from '../../constants/layout';
import { colors, radius, spacing, typography } from '../../theme';
import type { GeoCityRecord } from '../geo/cityPackage';
import type { CityOperationViewModel } from '../gameplay/cityOperation';
import { COUNTRY_CORRIDOR_CONNECTED } from '../presentation/countryDashboardPaint';
import { mapV2ExperienceCopy } from '../presentation/mapV2ExperienceCopy';

type Props = {
  displayName: string;
  city: GeoCityRecord;
  gameplayCityId?: string;
  showDevFields: boolean;
  compactOps?: boolean;
  operation?: CityOperationViewModel | null;
  onClose: () => void;
  onInspect?: () => void;
};

function MiniMetric({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{String(value)}</Text>
      <Text style={styles.metricLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export default function MapV2CitySelectionPanel({
  displayName,
  city,
  gameplayCityId,
  showDevFields,
  compactOps = false,
  operation,
  onClose,
  onInspect,
}: Props) {
  const population =
    city.population != null && city.populationSourceField
      ? city.population.toLocaleString('tr-TR')
      : mapV2ExperienceCopy.cityPopulationUnknown;
  const status = operation?.isHomeCity
    ? mapV2ExperienceCopy.cityHomeStatus
    : mapV2ExperienceCopy.cityOpsRole;

  return (
    <View
      style={[styles.sheet, compactOps && styles.sheetCompact]}
      accessibilityRole="summary"
      accessibilityLabel={`${displayName}, ${status}`}
    >
      <View style={styles.topRow}>
        <View style={styles.titles}>
          <Text style={styles.name} accessibilityRole="header" numberOfLines={1}>
            {displayName}
          </Text>
          <Text style={styles.role} numberOfLines={1}>
            {compactOps ? status : `${mapV2ExperienceCopy.cityPopulation}: ${population}`}
          </Text>
        </View>
        <Pressable
          onPress={onClose}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={mapV2ExperienceCopy.closeSelection}
          style={styles.closeHit}
        >
          <Text style={styles.close}>{mapV2ExperienceCopy.closeSelection}</Text>
        </Pressable>
      </View>
      {compactOps && operation ? (
        <View style={styles.metrics}>
          <MiniMetric label={mapV2ExperienceCopy.cityMetricWarehouse} value={operation.warehouseCount} />
          <MiniMetric label={mapV2ExperienceCopy.cityMetricTruck} value={operation.ownedTruckCount} />
          <MiniMetric label={mapV2ExperienceCopy.cityMetricJobs} value={operation.activeDeliveryCount} />
        </View>
      ) : null}
      {onInspect && (!operation || operation.canInspect) ? (
        <ActionButton
          label={mapV2ExperienceCopy.cityInspect}
          onPress={onInspect}
          compact
          accessibilityLabel={mapV2ExperienceCopy.cityInspect}
          style={styles.inspect}
        />
      ) : null}
      {showDevFields && gameplayCityId ? (
        <Text style={styles.meta}>
          {mapV2ExperienceCopy.cityGameplayId}: {gameplayCityId}
        </Text>
      ) : null}
      {showDevFields ? (
        <>
          <Text style={styles.dev} selectable>
            {city.geoCityId}
          </Text>
          <Text style={styles.dev} selectable>
            NE {city.sourceFeatureId}
          </Text>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: colors.surface,
    borderColor: colors.primary,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.xs,
  },
  sheetCompact: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    gap: spacing.xs,
    borderLeftWidth: 3,
    borderLeftColor: COUNTRY_CORRIDOR_CONNECTED,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  titles: { flex: 1, minWidth: 0 },
  name: { ...typography.sectionTitle, color: colors.textPrimary },
  role: { ...typography.caption, color: colors.textMuted },
  closeHit: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
  close: { ...typography.caption, color: colors.primaryLight },
  metrics: { flexDirection: 'row', gap: spacing.xs },
  metric: {
    flex: 1,
    backgroundColor: colors.surface2,
    borderRadius: radius.sm,
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  metricValue: { ...typography.caption, color: colors.textPrimary, fontWeight: '800' },
  metricLabel: { ...typography.caption, color: colors.textMuted, fontSize: 10 },
  inspect: { alignSelf: 'flex-start', minHeight: MIN_TOUCH_TARGET },
  meta: { ...typography.bodySmall, color: colors.textSecondary },
  dev: { ...typography.caption, color: colors.textDisabled },
});

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import type { GameIconName } from '../../../theme/icons';
import { GameIcon } from '../../ui';
import type { MapCommandTelemetry } from './mapCommandTelemetry';
import { mapUiTheme } from './mapUiTheme';

interface MapBottomKpiBarProps {
  telemetry: MapCommandTelemetry;
  scroll: boolean;
}

const METRICS: Array<{ key: keyof MapCommandTelemetry; label: string; icon: GameIconName }> = [
  { key: 'activeDeliveries', label: 'Aktif teslimat', icon: 'contract' },
  { key: 'vehiclesOnRoad', label: 'Yoldaki araç', icon: 'route' },
  { key: 'availableVehicles', label: 'Müsait araç', icon: 'truck' },
  { key: 'warehouseCount', label: 'Depo', icon: 'warehouse' },
];

function MapBottomKpiBar({ telemetry, scroll }: MapBottomKpiBarProps) {
  const content = METRICS.map((metric) => (
    <View key={metric.key} style={styles.metric}>
      <GameIcon name={metric.icon} size={12} color={mapUiTheme.cyanPrimary} />
      <Text style={styles.value}>{telemetry[metric.key]}</Text>
      <Text style={styles.label} numberOfLines={1}>
        {metric.label}
      </Text>
    </View>
  ));

  if (scroll) {
    return (
      <ScrollView
        horizontal
        style={styles.bar}
        contentContainerStyle={styles.row}
        showsHorizontalScrollIndicator={false}
        bounces={false}
      >
        {content}
      </ScrollView>
    );
  }

  return <View style={[styles.bar, styles.row]}>{content}</View>;
}

export default React.memo(MapBottomKpiBar);

const styles = StyleSheet.create({
  bar: {
    height: mapUiTheme.bottomKpiHeight,
    flexGrow: 0,
    flexShrink: 0,
    backgroundColor: mapUiTheme.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: mapUiTheme.border,
  },
  row: {
    minHeight: mapUiTheme.bottomKpiHeight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: mapUiTheme.space8,
    gap: mapUiTheme.space8,
  },
  metric: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: mapUiTheme.space4,
  },
  label: {
    color: mapUiTheme.textMuted,
    fontSize: 10,
    fontWeight: '600',
    flexShrink: 1,
  },
  value: {
    color: mapUiTheme.textPrimary,
    fontSize: 13,
    fontWeight: '800',
  },
});

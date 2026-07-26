import React from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import type { GameIconName } from '../../theme/icons';
import { GameIcon } from '../ui';
import {
  MAP_BORDER,
  MAP_MUTED,
  MAP_SPACING_FILTERS_TO_STATS,
  MAP_STATS_HEIGHT,
  MAP_STATS_RADIUS,
  MAP_SURFACE,
  MAP_TITLE_COLOR,
} from './mapTheme';

export interface MapStatsStripProps {
  cityCount: number;
  routeCount: number;
  jobCount: number;
  activeCount: number;
  idleCount: number;
}

interface MetricItem {
  key: string;
  label: string;
  value: number;
  icon: GameIconName;
}

export default function MapStatsStrip({
  cityCount,
  routeCount,
  jobCount,
  activeCount,
  idleCount,
}: MapStatsStripProps) {
  const { width } = useWindowDimensions();
  const isCompact = width < 360;

  const metrics: MetricItem[] = [
    { key: 'city', label: 'Şehir', value: cityCount, icon: 'city' },
    { key: 'route', label: 'Rota', value: routeCount, icon: 'route' },
    { key: 'job', label: 'İş', value: jobCount, icon: 'contract' },
    { key: 'active', label: 'Aktif', value: activeCount, icon: 'play' },
    { key: 'idle', label: 'Boşta', value: idleCount, icon: 'time' },
  ];

  return (
    <View style={[styles.container, { marginTop: MAP_SPACING_FILTERS_TO_STATS }]}>
      {metrics.map((metric, index) => (
        <React.Fragment key={metric.key}>
          {index > 0 ? <View style={styles.separator} /> : null}
          <View style={styles.metric}>
            <GameIcon name={metric.icon} size={isCompact ? 11 : 12} color={MAP_MUTED} />
            <Text style={styles.metricLine} numberOfLines={1}>
              <Text style={[styles.label, isCompact && styles.labelCompact]}>{metric.label} </Text>
              <Text style={[styles.value, isCompact && styles.valueCompact]}>{metric.value}</Text>
            </Text>
          </View>
        </React.Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: MAP_STATS_HEIGHT,
    borderRadius: MAP_STATS_RADIUS,
    backgroundColor: MAP_SURFACE,
    borderWidth: 1,
    borderColor: MAP_BORDER,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  metric: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    minWidth: 0,
  },
  metricLine: {
    minWidth: 0,
    flexShrink: 1,
  },
  label: {
    fontSize: 10,
    color: MAP_MUTED,
    fontWeight: '600',
  },
  labelCompact: {
    fontSize: 9,
  },
  value: {
    fontSize: 13,
    fontWeight: '800',
    color: MAP_TITLE_COLOR,
  },
  valueCompact: {
    fontSize: 12,
  },
  separator: {
    width: 1,
    height: 28,
    backgroundColor: 'rgba(50,95,150,0.28)',
    flexShrink: 0,
  },
});

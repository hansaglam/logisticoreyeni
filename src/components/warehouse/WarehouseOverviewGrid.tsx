import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GameIcon, ProgressBar } from '../ui';
import type { GameIconName } from '../../theme/icons';
import { colors, formatMoney, typography } from '../../theme';
import type { WarehouseScreenOverview } from '../../utils/warehouseScreenViewModel';
import { getOccupancyBarColor } from './warehouseUiHelpers';
import { logWarehouseLayout } from './warehouseLayoutDebug';
import MiniProgressRing from './MiniProgressRing';
import { warehouseVisual } from './warehouseTheme';

interface WarehouseOverviewGridProps {
  overview: WarehouseScreenOverview;
  onViewTransfers?: () => void;
}

function formatCompactTons(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(1);
}

function MetricCard({
  label,
  value,
  helper,
  valueColor,
  accent,
  icon,
  onPress,
  trailing,
}: {
  label: string;
  value: string;
  helper?: string;
  valueColor: string;
  accent: string;
  icon: GameIconName;
  onPress?: () => void;
  trailing?: React.ReactNode;
}) {
  const content = (
    <View style={styles.cardInner}>
      <View style={styles.cardTop}>
        <View style={[styles.iconChip, { backgroundColor: `${accent}22` }]}>
          <GameIcon name={icon} size={13} color={accent} />
        </View>
        {trailing}
      </View>
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.value, { color: valueColor }]} numberOfLines={1}>
        {value}
      </Text>
      {helper ? (
        <Text style={styles.helper} numberOfLines={1}>
          {helper}
        </Text>
      ) : null}
    </View>
  );

  const cardStyle = [
    styles.card,
    { borderColor: `${accent}55`, borderLeftColor: accent, borderLeftWidth: 3 },
  ];

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={cardStyle}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value}`}
      >
        {content}
      </Pressable>
    );
  }

  return <View style={cardStyle}>{content}</View>;
}

export default function WarehouseOverviewGrid({
  overview,
  onViewTransfers,
}: WarehouseOverviewGridProps) {
  const barColor = getOccupancyBarColor(overview.occupancyPercent);
  const occupancy = overview.occupancyPercent / 100;

  return (
    <View
      style={styles.grid}
      onLayout={(event) => {
        logWarehouseLayout({
          overviewHeight: Math.round(event.nativeEvent.layout.height),
        });
      }}
    >
      <View style={styles.row}>
        <MetricCard
          label="Toplam Stok"
          value={formatMoney(overview.inventoryValue)}
          valueColor={warehouseVisual.accentGreen}
          accent={warehouseVisual.accentGreen}
          icon="inventory"
        />
        <MetricCard
          label="Kapasite"
          value={`${formatCompactTons(overview.usedCapacityTons)} / ${formatCompactTons(overview.totalCapacityTons)} t`}
          helper={`%${Math.round(overview.occupancyPercent)} dolu`}
          valueColor={barColor}
          accent={barColor}
          icon="warehouse"
          trailing={
            <MiniProgressRing
              progress={occupancy}
              size={36}
              strokeWidth={3.5}
              color={barColor}
              label={`%${Math.round(overview.occupancyPercent)}`}
            />
          }
        />
      </View>
      <View style={styles.row}>
        <MetricCard
          label="Günlük Gider"
          value={formatMoney(-Math.abs(overview.dailyOperatingCost))}
          valueColor={warehouseVisual.accentRed}
          accent={warehouseVisual.accentRed}
          icon="expense"
        />
        <MetricCard
          label="Transfer"
          value={`${overview.activeTransferCount} aktif`}
          helper={
            overview.activeTransferTons > 0
              ? `${formatCompactTons(overview.activeTransferTons)} t · Gör`
              : 'Görüntüle'
          }
          valueColor={warehouseVisual.accentBlue}
          accent={warehouseVisual.accentBlue}
          icon="truck"
          onPress={onViewTransfers}
        />
      </View>
      <View style={styles.capacityBar}>
        <ProgressBar progress={occupancy} color={barColor} height={3} trackColor="rgba(120,160,220,0.12)" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    gap: 8,
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  card: {
    flex: 1,
    minWidth: 0,
    minHeight: 88,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 16,
    backgroundColor: warehouseVisual.surfaceElevated,
    borderWidth: 1,
    justifyContent: 'center',
  },
  cardInner: {
    gap: 2,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  iconChip: {
    width: 24,
    height: 24,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '600',
    fontSize: 10,
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
  value: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  helper: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 10,
    marginTop: 1,
  },
  capacityBar: {
    marginTop: 2,
    paddingHorizontal: 2,
  },
});

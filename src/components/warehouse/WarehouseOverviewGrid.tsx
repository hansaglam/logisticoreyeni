import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GameIcon } from '../ui';
import type { GameIconName } from '../../theme/icons';
import { colors, formatMoney, typography } from '../../theme';
import type { WarehouseScreenOverview } from '../../utils/warehouseScreenViewModel';
import { getOccupancyBarColor } from './warehouseUiHelpers';
import { logWarehouseLayout } from './warehouseLayoutDebug';
import { warehouseLayout, warehouseVisual } from './warehouseTheme';

interface WarehouseOverviewGridProps {
  overview: WarehouseScreenOverview;
  onViewTransfers?: () => void;
}

function formatCompactTons(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(1);
}

function StatCell({
  label,
  value,
  sub,
  valueColor,
  icon,
  iconColor,
}: {
  label: string;
  value: string;
  sub?: string;
  valueColor: string;
  icon: GameIconName;
  iconColor: string;
}) {
  return (
    <View style={styles.statCell}>
      <View style={styles.statLabelRow}>
        <GameIcon name={icon} size={14} color={iconColor} />
        <Text style={styles.statLabel} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <Text style={[styles.statValue, { color: valueColor }]} numberOfLines={1}>
        {value}
      </Text>
      {sub ? (
        <Text style={styles.statSub} numberOfLines={1}>
          {sub}
        </Text>
      ) : null}
    </View>
  );
}

export default function WarehouseOverviewGrid({
  overview,
  onViewTransfers,
}: WarehouseOverviewGridProps) {
  const barColor = getOccupancyBarColor(overview.occupancyPercent);
  const transferLabel =
    overview.activeTransferCount > 0
      ? `${overview.activeTransferCount} aktif transfer`
      : '0 aktif transfer';

  return (
    <View
      style={styles.summaryCard}
      onLayout={(event) => {
        logWarehouseLayout({
          overviewHeight: Math.round(event.nativeEvent.layout.height),
        });
      }}
    >
      <Text style={styles.summaryTitle}>Depo Özeti</Text>

      <View style={styles.grid}>
        <StatCell
          label="Toplam stok"
          value={formatMoney(overview.inventoryValue)}
          valueColor={warehouseVisual.accentGreen}
          icon="inventory"
          iconColor={warehouseVisual.accentGreen}
        />
        <StatCell
          label="Kapasite"
          value={`${formatCompactTons(overview.usedCapacityTons)} / ${formatCompactTons(overview.totalCapacityTons)} t`}
          sub={`%${Math.round(overview.occupancyPercent)} doluluk`}
          valueColor={barColor}
          icon="warehouse"
          iconColor={warehouseVisual.accentBlue}
        />
        <StatCell
          label="Günlük gider"
          value={formatMoney(-Math.abs(overview.dailyOperatingCost))}
          valueColor={warehouseVisual.accentAmber}
          icon="expense"
          iconColor={warehouseVisual.accentAmber}
        />
        <Pressable
          onPress={onViewTransfers}
          disabled={!onViewTransfers}
          style={({ pressed }) => [styles.statCell, pressed && onViewTransfers && styles.statCellPressed]}
          accessibilityRole={onViewTransfers ? 'button' : undefined}
          accessibilityLabel={`Transfer: ${transferLabel}`}
        >
          <View style={styles.statLabelRow}>
            <GameIcon name="truck" size={14} color={warehouseVisual.accentBlue} />
            <Text style={styles.statLabel} numberOfLines={1}>
              Transfer
            </Text>
          </View>
          <Text style={[styles.statValue, { color: warehouseVisual.accentBlue }]} numberOfLines={1}>
            {overview.activeTransferCount}
          </Text>
          <Text style={styles.statSub} numberOfLines={1}>
            {overview.activeTransferTons > 0
              ? `${formatCompactTons(overview.activeTransferTons)} t yolda`
              : 'aktif yok'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  summaryCard: {
    backgroundColor: warehouseVisual.surfaceElevated,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: warehouseVisual.border,
    padding: warehouseLayout.cardPadding,
    marginBottom: warehouseLayout.sectionGap,
    gap: warehouseLayout.internalGap,
  },
  summaryTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: warehouseLayout.internalGap,
  },
  statCell: {
    width: '48%',
    flexGrow: 1,
    minWidth: '46%',
    backgroundColor: warehouseVisual.statTint,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: warehouseLayout.smallGap,
  },
  statCellPressed: {
    opacity: 0.88,
  },
  statLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statLabel: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    flex: 1,
    minWidth: 0,
  },
  statValue: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  statSub: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: '500',
  },
});

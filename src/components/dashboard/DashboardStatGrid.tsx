import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { GameIcon } from '../ui';
import { colors, formatRatioPercent, radius, typography } from '../../theme';

export interface DashboardStatTile {
  key: string;
  label: string;
  value: string;
  icon: React.ComponentProps<typeof GameIcon>['name'];
  color: string;
}

interface DashboardStatGridProps {
  tiles: DashboardStatTile[];
}

export default function DashboardStatGrid({ tiles }: DashboardStatGridProps) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.sectionLabel}>OPERASYON DURUMU</Text>
      <View style={styles.grid}>
        {tiles.map((tile) => (
          <View key={tile.key} style={styles.tile}>
            <View style={[styles.iconWrap, { backgroundColor: `${tile.color}24` }]}>
              <GameIcon name={tile.icon} size={14} color={tile.color} />
            </View>
            <Text style={styles.tileValue} numberOfLines={1}>
              {tile.value}
            </Text>
            <Text style={styles.tileLabel} numberOfLines={1} ellipsizeMode="tail">
              {tile.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function buildDashboardStatTiles(input: {
  idleTrucks: number;
  activeDeliveries: number;
  idleDrivers: number;
  warehouseFillRatio: number;
  idleTruckCitySummary?: string;
}): DashboardStatTile[] {
  const idleTruckLabel =
    input.idleTrucks > 0 && input.idleTruckCitySummary?.trim()
      ? `Boşta · ${input.idleTruckCitySummary.trim()}`
      : 'Boşta Kamyon';

  return [
    {
      key: 'idle-trucks',
      label: idleTruckLabel,
      value: `${input.idleTrucks}`,
      icon: 'truck',
      color: colors.success,
    },
    {
      key: 'active-deliveries',
      label: 'Aktif Teslimat',
      value: `${input.activeDeliveries}`,
      icon: 'route',
      color: colors.accentBlue,
    },
    {
      key: 'idle-drivers',
      label: 'Müsait Şoför',
      value: `${input.idleDrivers}`,
      icon: 'driver',
      color: colors.info,
    },
    {
      key: 'warehouse-fill',
      label: 'Depo Doluluk',
      value: formatRatioPercent(input.warehouseFillRatio),
      icon: 'warehouse',
      color: colors.accentAmber,
    },
  ];
}

const styles = StyleSheet.create({
  wrap: {
    gap: 8,
  },
  sectionLabel: {
    ...typography.caption,
    fontWeight: '800',
    color: colors.textMuted,
    letterSpacing: 0.6,
    fontSize: 10,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tile: {
    flexBasis: '23%',
    flexGrow: 1,
    minWidth: '22%',
    minHeight: 76,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  iconWrap: {
    width: 26,
    height: 26,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileValue: {
    ...typography.caption,
    fontWeight: '900',
    color: colors.textPrimary,
    fontSize: 13,
    textAlign: 'center',
  },
  tileLabel: {
    ...typography.caption,
    fontSize: 9.5,
    color: colors.textMuted,
    textAlign: 'center',
    fontWeight: '700',
  },
});

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import type { TabKey } from '../../navigation/tabTypes';
import { GameIcon } from '../ui';
import { colors, radius, spacing, typography } from '../../theme';

export type DashboardModuleKey = 'contracts' | 'market' | 'fleet' | 'warehouse';

interface DashboardModule {
  key: DashboardModuleKey;
  label: string;
  subtitle: string;
  icon: React.ComponentProps<typeof GameIcon>['name'];
  color: string;
  tab?: TabKey;
}

const MODULES: DashboardModule[] = [
  {
    key: 'contracts',
    label: 'İşler',
    subtitle: 'Sözleşmeler',
    icon: 'contract',
    color: colors.accentBlue,
    tab: 'contracts',
  },
  {
    key: 'market',
    label: 'Piyasa',
    subtitle: 'Fiyat & stok',
    icon: 'market',
    color: colors.success,
    tab: 'market',
  },
  {
    key: 'fleet',
    label: 'Filo',
    subtitle: 'Kamyon & şoför',
    icon: 'truck',
    color: colors.info,
    tab: 'fleet',
  },
  {
    key: 'warehouse',
    label: 'Depolar',
    subtitle: 'Stok yönetimi',
    icon: 'warehouse',
    color: colors.accentAmber,
  },
];

interface DashboardModuleGridProps {
  onNavigate: (tab: TabKey) => void;
  onOpenWarehouse?: () => void;
  contractsAvailable: number;
  contractsOpen?: number;
  marketOpportunities: number;
  idleTrucks: number;
  activeDeliveries: number;
  warehouseFillRatio: number;
}

interface ModuleStatusInput {
  contractsAvailable: number;
  contractsOpen?: number;
  marketOpportunities: number;
  idleTrucks: number;
  activeDeliveries: number;
  warehouseFillRatio: number;
}

function resolveModuleStatus(
  key: DashboardModuleKey,
  data: ModuleStatusInput,
): { label: string; color: string } {
  switch (key) {
    case 'contracts':
      if (data.contractsAvailable > 0) {
        return { label: `${data.contractsAvailable} uygun iş`, color: colors.success };
      }
      if ((data.contractsOpen ?? 0) > 0) {
        return { label: `${data.contractsOpen} iş ilanı`, color: colors.textMuted };
      }
      return { label: 'İş bekleniyor', color: colors.textMuted };
    case 'market':
      return data.marketOpportunities > 0
        ? { label: `${data.marketOpportunities} fırsat`, color: colors.success }
        : { label: 'Piyasa sakin', color: colors.textMuted };
    case 'fleet':
      if (data.idleTrucks > 0) {
        return { label: `${data.idleTrucks} boşta`, color: colors.success };
      }
      if (data.activeDeliveries > 0) {
        return { label: `${data.activeDeliveries} aktif`, color: colors.info };
      }
      return { label: '0 aktif', color: colors.textMuted };
    case 'warehouse': {
      const percent = Math.round(Math.min(1, Math.max(0, data.warehouseFillRatio)) * 100);
      return {
        label: `%${percent} dolu`,
        color: percent >= 85 ? colors.accentAmber : colors.textMuted,
      };
    }
    default:
      return { label: '', color: colors.textMuted };
  }
}

export default function DashboardModuleGrid({
  onNavigate,
  onOpenWarehouse,
  contractsAvailable,
  contractsOpen,
  marketOpportunities,
  idleTrucks,
  activeDeliveries,
  warehouseFillRatio,
}: DashboardModuleGridProps) {
  const handlePress = (module: DashboardModule) => {
    if (module.key === 'warehouse') {
      onOpenWarehouse?.();
      return;
    }
    if (module.tab) {
      onNavigate(module.tab);
    }
  };

  const statusData: ModuleStatusInput = {
    contractsAvailable,
    contractsOpen,
    marketOpportunities,
    idleTrucks,
    activeDeliveries,
    warehouseFillRatio,
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.sectionLabel}>ANA MODÜLLER</Text>
      <View style={styles.grid}>
        {MODULES.map((module) => {
          const status = resolveModuleStatus(module.key, statusData);
          return (
            <TouchableOpacity
              key={module.key}
              activeOpacity={0.75}
              style={styles.moduleTile}
              onPress={() => handlePress(module)}
            >
              <View style={[styles.iconWrap, { backgroundColor: `${module.color}18` }]}>
                <GameIcon name={module.icon} size={20} color={module.color} />
              </View>
              <Text style={styles.moduleLabel} numberOfLines={1}>
                {module.label}
              </Text>
              <Text style={styles.moduleSubtitle} numberOfLines={1}>
                {module.subtitle}
              </Text>
              {status.label ? (
                <Text
                  style={[styles.moduleStatus, { color: status.color }]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {status.label}
                </Text>
              ) : null}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
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
  moduleTile: {
    width: '48%',
    flexGrow: 1,
    minWidth: '46%',
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    gap: 3,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 1,
  },
  moduleLabel: {
    ...typography.cardTitle,
    fontSize: 13,
    color: colors.textPrimary,
  },
  moduleSubtitle: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 9.5,
  },
  moduleStatus: {
    ...typography.caption,
    fontSize: 9,
    fontWeight: '700',
    marginTop: 1,
  },
});

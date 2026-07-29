import React from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { TabKey } from '../../navigation/tabTypes';
import { radius, spacing } from '../../theme';
import { GameIcon } from '../ui';
import { TRUCK_LOCATION_EDUCATION_MESSAGE } from '../../utils/truckLocationUx';
import {
  DASHBOARD_MODULE_CARD_BG,
  DASHBOARD_MODULE_CARD_HEIGHT,
  DASHBOARD_MODULE_GAP,
} from './dashboardTheme';

export type DashboardModuleKey = 'market' | 'fleet' | 'warehouse';

interface ModuleTheme {
  iconColor: string;
  iconBackground: string;
  borderColor: string;
  shadowColor: string;
}

interface DashboardModule {
  key: DashboardModuleKey;
  label: string;
  icon: React.ComponentProps<typeof GameIcon>['name'];
  theme: ModuleTheme;
  tab?: TabKey;
}

const MODULES: DashboardModule[] = [
  {
    key: 'market',
    label: 'Market',
    icon: 'market',
    theme: {
      iconColor: '#2388FF',
      iconBackground: 'rgba(35, 136, 255, 0.16)',
      borderColor: 'rgba(35, 136, 255, 0.42)',
      shadowColor: '#2388FF',
    },
    tab: 'market',
  },
  {
    key: 'fleet',
    label: 'Filo',
    icon: 'truck',
    theme: {
      iconColor: '#28C6E8',
      iconBackground: 'rgba(40, 198, 232, 0.15)',
      borderColor: 'rgba(40, 198, 232, 0.38)',
      shadowColor: '#28C6E8',
    },
    tab: 'fleet',
  },
  {
    key: 'warehouse',
    label: 'Depolar',
    icon: 'warehouse',
    theme: {
      iconColor: '#FFAA00',
      iconBackground: 'rgba(255, 170, 0, 0.14)',
      borderColor: 'rgba(255, 170, 0, 0.40)',
      shadowColor: '#FFAA00',
    },
  },
];

interface DashboardModuleGridProps {
  onNavigate: (tab: TabKey) => void;
  onOpenWarehouse?: () => void;
  marketOpportunities: number;
  idleTrucks: number;
  activeDeliveries: number;
  warehouseFillRatio: number;
  showLocationHint?: boolean;
}

interface ModuleStatusInput {
  marketOpportunities: number;
  idleTrucks: number;
  activeDeliveries: number;
  warehouseFillRatio: number;
}

function resolveModuleStatus(key: DashboardModuleKey, data: ModuleStatusInput): string {
  switch (key) {
    case 'market':
      return data.marketOpportunities > 0
        ? `${data.marketOpportunities} fırsat`
        : 'Fiyat ve stok';
    case 'fleet':
      if (data.idleTrucks > 0) {
        return `${data.idleTrucks} boşta`;
      }
      if (data.activeDeliveries > 0) {
        return `${data.activeDeliveries} aktif`;
      }
      return '0 aktif';
    case 'warehouse': {
      const percent = Math.round(Math.min(1, Math.max(0, data.warehouseFillRatio)) * 100);
      return `%${percent} dolu`;
    }
    default:
      return '';
  }
}

interface ModuleCardProps {
  module: DashboardModule;
  statusLabel: string;
  onPress: () => void;
}

function ModuleCard({ module, statusLabel, onPress }: ModuleCardProps) {
  const { theme } = module;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.moduleTile,
        {
          borderColor: theme.borderColor,
          shadowColor: theme.shadowColor,
        },
        pressed && styles.moduleTilePressed,
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${module.label}, ${statusLabel}`}
    >
      <View
        style={[StyleSheet.absoluteFillObject, styles.accentTint, { backgroundColor: theme.iconColor }]}
        pointerEvents="none"
      />
      <View style={[styles.iconWrap, { backgroundColor: theme.iconBackground }]}>
        <GameIcon name={module.icon} size={17} color={theme.iconColor} />
      </View>
      <View style={styles.textColumn}>
        <Text
          style={styles.moduleLabel}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.82}
        >
          {module.label}
        </Text>
        <Text
          style={[styles.moduleStatus, { color: theme.iconColor }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.75}
        >
          {statusLabel}
        </Text>
      </View>
    </Pressable>
  );
}

export default function DashboardModuleGrid({
  onNavigate,
  onOpenWarehouse,
  marketOpportunities,
  idleTrucks,
  activeDeliveries,
  warehouseFillRatio,
  showLocationHint = false,
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
    marketOpportunities,
    idleTrucks,
    activeDeliveries,
    warehouseFillRatio,
  };

  const cards = MODULES.map((module) => (
    <ModuleCard
      key={module.key}
      module={module}
      statusLabel={resolveModuleStatus(module.key, statusData)}
      onPress={() => handlePress(module)}
    />
  ));

  return (
    <View style={styles.section}>
      <View style={styles.sectionAtmosphere} pointerEvents="none" />

      {showLocationHint ? (
        <View style={styles.hintStrip}>
          <View style={styles.hintIconWrap}>
            <GameIcon name="city" size={14} color="#39A0FF" />
          </View>
          <Text style={styles.hintText} numberOfLines={2}>
            {TRUCK_LOCATION_EDUCATION_MESSAGE}
          </Text>
        </View>
      ) : null}

      <View style={styles.grid}>{cards}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    width: '100%',
    position: 'relative',
  },
  sectionAtmosphere: {
    position: 'absolute',
    top: -6,
    left: -8,
    right: -8,
    bottom: -6,
    borderRadius: radius.xl,
    backgroundColor: 'rgba(40, 198, 232, 0.03)',
  },
  hintStrip: {
    height: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    backgroundColor: 'rgba(35, 136, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(35, 136, 255, 0.28)',
  },
  hintIconWrap: {
    width: 29,
    height: 29,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(35, 136, 255, 0.12)',
    flexShrink: 0,
  },
  hintText: {
    flex: 1,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '500',
    color: '#A9B6CC',
  },
  grid: {
    flexDirection: 'row',
    gap: DASHBOARD_MODULE_GAP,
    alignItems: 'stretch',
  },
  moduleTile: {
    flex: 1,
    minWidth: 0,
    height: DASHBOARD_MODULE_CARD_HEIGHT,
    justifyContent: 'space-between',
    padding: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    backgroundColor: DASHBOARD_MODULE_CARD_BG,
    overflow: 'hidden',
    ...Platform.select({
      android: { elevation: 1 },
      ios: {
        shadowOpacity: 0.06,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 1 },
      },
    }),
  },
  moduleTilePressed: {
    opacity: 0.94,
    transform: [{ scale: 0.985 }],
  },
  accentTint: {
    opacity: 0.035,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textColumn: {
    width: '100%',
    minWidth: 0,
    marginTop: spacing.xs,
  },
  moduleLabel: {
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '800',
    color: '#F3F7FF',
  },
  moduleStatus: {
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '600',
    marginTop: 1,
  },
});

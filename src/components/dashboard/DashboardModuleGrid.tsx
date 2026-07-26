import React from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import type { TabKey } from '../../navigation/tabTypes';
import { GameIcon } from '../ui';
import { TRUCK_LOCATION_EDUCATION_MESSAGE } from '../../utils/truckLocationUx';
import {
  DASHBOARD_MODULE_CARD_BG,
  DASHBOARD_MODULE_CARD_HEIGHT,
  DASHBOARD_MODULE_GAP,
  DASHBOARD_MODULE_NARROW_BREAKPOINT,
  DASHBOARD_MODULE_SCROLL_CARD_WIDTH,
} from './dashboardTheme';

export type DashboardModuleKey = 'contracts' | 'market' | 'fleet' | 'warehouse';

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
    key: 'contracts',
    label: 'İşler',
    icon: 'contract',
    theme: {
      iconColor: '#2388FF',
      iconBackground: 'rgba(35, 136, 255, 0.16)',
      borderColor: 'rgba(35, 136, 255, 0.42)',
      shadowColor: '#2388FF',
    },
    tab: 'contracts',
  },
  {
    key: 'market',
    label: 'Piyasa',
    icon: 'market',
    theme: {
      iconColor: '#11C96B',
      iconBackground: 'rgba(17, 201, 107, 0.15)',
      borderColor: 'rgba(17, 201, 107, 0.38)',
      shadowColor: '#11C96B',
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
  contractsAvailable: number;
  contractsOpen?: number;
  marketOpportunities: number;
  idleTrucks: number;
  activeDeliveries: number;
  warehouseFillRatio: number;
  showLocationHint?: boolean;
}

interface ModuleStatusInput {
  contractsAvailable: number;
  contractsOpen?: number;
  marketOpportunities: number;
  idleTrucks: number;
  activeDeliveries: number;
  warehouseFillRatio: number;
}

function resolveModuleStatus(key: DashboardModuleKey, data: ModuleStatusInput): string {
  switch (key) {
    case 'contracts':
      if (data.contractsAvailable > 0) {
        return `${data.contractsAvailable} uygun`;
      }
      if ((data.contractsOpen ?? 0) > 0) {
        return `${data.contractsOpen} ilan`;
      }
      return 'Bekleniyor';
    case 'market':
      return data.marketOpportunities > 0
        ? `${data.marketOpportunities} fırsat`
        : 'Fiyat & stok';
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
  scrollLayout?: boolean;
}

function ModuleCard({ module, statusLabel, onPress, scrollLayout }: ModuleCardProps) {
  const { theme } = module;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.moduleTile,
        scrollLayout && styles.moduleTileScroll,
        {
          borderColor: theme.borderColor,
          shadowColor: theme.shadowColor,
        },
        pressed && styles.moduleTilePressed,
      ]}
      onPress={onPress}
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
  contractsAvailable,
  contractsOpen,
  marketOpportunities,
  idleTrucks,
  activeDeliveries,
  warehouseFillRatio,
  showLocationHint = false,
}: DashboardModuleGridProps) {
  const { width } = useWindowDimensions();
  const useScrollLayout = width < DASHBOARD_MODULE_NARROW_BREAKPOINT;

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

  const cards = MODULES.map((module) => (
    <ModuleCard
      key={module.key}
      module={module}
      statusLabel={resolveModuleStatus(module.key, statusData)}
      onPress={() => handlePress(module)}
      scrollLayout={useScrollLayout}
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

      {useScrollLayout ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          {cards}
        </ScrollView>
      ) : (
        <View style={styles.grid}>{cards}</View>
      )}
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
    borderRadius: 20,
    backgroundColor: 'rgba(40, 198, 232, 0.03)',
  },
  hintStrip: {
    height: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 13,
    marginBottom: 8,
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
  scrollContent: {
    flexDirection: 'row',
    gap: DASHBOARD_MODULE_GAP,
    paddingRight: 2,
  },
  moduleTile: {
    flex: 1,
    minWidth: 0,
    height: DASHBOARD_MODULE_CARD_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
    paddingVertical: 8,
    borderRadius: 15,
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
  moduleTileScroll: {
    flex: 0,
    width: DASHBOARD_MODULE_SCROLL_CARD_WIDTH,
  },
  moduleTilePressed: {
    opacity: 0.94,
    transform: [{ scale: 0.985 }],
  },
  accentTint: {
    opacity: 0.035,
  },
  iconWrap: {
    width: 35,
    height: 35,
    borderRadius: 11,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textColumn: {
    flex: 1,
    minWidth: 0,
    marginLeft: 6,
    justifyContent: 'center',
  },
  moduleLabel: {
    fontSize: 12,
    lineHeight: 15,
    fontWeight: '800',
    color: '#F3F7FF',
  },
  moduleStatus: {
    fontSize: 9,
    lineHeight: 11,
    fontWeight: '600',
    marginTop: 2,
  },
});

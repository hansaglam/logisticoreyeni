import React, { useCallback, useMemo, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTabBarLayout } from '../../hooks/useTabBarLayout';
import { getContractAvailability } from '../../simulation/delivery';
import { useGameStore } from '../../store/gameStore';
import { TutorialTarget } from '../../tutorial/TutorialTarget';
import type { TutorialTargetId } from '../../tutorial/types';
import { isSafeAreaContextAvailable } from '../../utils/safeArea';
import { countActiveMarketAlerts } from '../../utils/marketAlerts';
import GameIcon from '../ui/GameIcon';
import type { TabDefinition, TabKey } from '../../navigation/tabTypes';
import { MAIN_TAB_KEYS } from '../../navigation/tabTypes';
import type { QuickAccessAction } from '../../navigation/quickAccessTypes';
import QuickAccessMenu from './QuickAccessMenu';
import { MARKET_ALARMS_ENABLED } from '../../config/backendRoadmap';

const TAB_TARGET_IDS: Partial<Record<TabKey, TutorialTargetId>> = {
  dashboard: 'tab-dashboard',
  map: 'tab-map',
  contracts: 'tab-contracts',
  market: 'tab-market',
};

const LEFT_TAB_KEYS: TabKey[] = ['dashboard', 'map'];
const RIGHT_TAB_KEYS: TabKey[] = ['contracts', 'market'];

const TAB_BAR_BG = '#071426';
const TAB_BAR_BORDER = 'rgba(35, 136, 255, 0.24)';
const TAB_ACTIVE_COLOR = '#2388FF';
const TAB_INACTIVE_ICON = '#8493AA';
const TAB_INACTIVE_LABEL = '#8694AA';

const TAB_BAR_PADDING_TOP = 8;
const TAB_BAR_PADDING_BOTTOM_MIN = 6;
const TAB_BAR_ROW_HEIGHT = 58;
const CENTER_BUTTON_SIZE = 58;
const CENTER_BUTTON_RING_SIZE = 61;
const CENTER_BUTTON_LIFT = 9;

function getGameTabBarHeight(bottomInset: number): number {
  return TAB_BAR_PADDING_TOP + TAB_BAR_ROW_HEIGHT + Math.max(bottomInset, TAB_BAR_PADDING_BOTTOM_MIN);
}

function isMainTabKey(tab: TabKey): boolean {
  return (MAIN_TAB_KEYS as readonly TabKey[]).includes(tab);
}

interface GameTabBarProps {
  tabs: TabDefinition[];
  activeTab: TabKey;
  onTabPress: (tab: TabKey) => void;
  onQuickAccess: (action: QuickAccessAction) => void;
}

function useTabBadges(): Partial<Record<TabKey, number>> {
  const contracts = useGameStore((state) => state.contracts);
  const trucks = useGameStore((state) => state.player.trucks);
  const drivers = useGameStore((state) => state.player.drivers);
  const trailers = useGameStore((state) => state.player.trailers);
  const homeCityId = useGameStore((state) => state.player.homeCityId);
  const playerReputation = useGameStore((state) => state.player.reputation ?? 0);
  const playerLevel = useGameStore(
    (state) => Math.max(1, state.player.level ?? state.player.companyLevel ?? 1),
  );
  const marketAlerts = useGameStore((state) => state.marketAlerts);

  return useMemo(() => {
    const badges: Partial<Record<TabKey, number>> = {};

    const playableCount = contracts.filter(
      (contract) =>
        contract.status === 'available' &&
        getContractAvailability(
          contract,
          trucks,
          drivers,
          playerLevel,
          0,
          playerReputation,
          homeCityId,
          trailers,
        ).canStart,
    ).length;
    if (playableCount > 0) {
      badges.contracts = playableCount;
    }

    const alertCount = MARKET_ALARMS_ENABLED
      ? countActiveMarketAlerts(marketAlerts ?? [])
      : 0;
    if (alertCount > 0) {
      badges.market = alertCount;
    }

    return badges;
  }, [contracts, trucks, drivers, trailers, homeCityId, playerReputation, playerLevel, marketAlerts]);
}

const TabBadge = React.memo(function TabBadge({ count }: { count: number }) {
  const label = count > 99 ? '99+' : String(count);
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>{label}</Text>
    </View>
  );
});

interface SideTabButtonProps {
  tab: TabDefinition;
  isActive: boolean;
  badgeCount?: number;
  onPress: () => void;
}

const SideTabButton = React.memo(function SideTabButton({ tab, isActive, badgeCount, onPress }: SideTabButtonProps) {
  const targetId = TAB_TARGET_IDS[tab.key];

  const button = (
    <TouchableOpacity
      style={styles.sideTabButton}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <View style={styles.iconWrap}>
        <GameIcon
          name={tab.icon}
          size={isActive ? 23 : 21}
          color={isActive ? TAB_ACTIVE_COLOR : TAB_INACTIVE_ICON}
        />
        {badgeCount && badgeCount > 0 ? <TabBadge count={badgeCount} /> : null}
      </View>
      <Text
        style={[styles.sideTabLabel, isActive && styles.sideTabLabelActive]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.85}
      >
        {tab.label}
      </Text>
      {isActive ? <View style={styles.activeIndicator} /> : null}
    </TouchableOpacity>
  );

  if (!targetId) {
    return <View style={styles.sideTabTarget}>{button}</View>;
  }

  return (
    <TutorialTarget
      id={targetId}
      onTutorialPress={onPress}
      style={styles.sideTabTarget}
    >
      {button}
    </TutorialTarget>
  );
});

interface GameTabBarContentProps extends GameTabBarProps {
  bottomInset: number;
  tabBarHeight: number;
  anchored?: boolean;
}

function GameTabBarContent({
  tabs,
  activeTab,
  onTabPress,
  onQuickAccess,
  bottomInset,
  tabBarHeight,
  anchored = true,
}: GameTabBarContentProps) {
  const [quickAccessOpen, setQuickAccessOpen] = useState(false);
  const badges = useTabBadges();

  const tabMap = useMemo(() => new Map(tabs.map((tab) => [tab.key, tab])), [tabs]);
  const leftTabs = LEFT_TAB_KEYS.map((key) => tabMap.get(key)).filter(Boolean) as TabDefinition[];
  const rightTabs = RIGHT_TAB_KEYS.map((key) => tabMap.get(key)).filter(Boolean) as TabDefinition[];

  const quickAccessPanelOffset = tabBarHeight + CENTER_BUTTON_LIFT + 8;
  const highlightedTab = isMainTabKey(activeTab) ? activeTab : null;
  const bottomPadding = Math.max(bottomInset, TAB_BAR_PADDING_BOTTOM_MIN);

  const handleTabPress = useCallback(
    (tab: TabKey) => {
      setQuickAccessOpen(false);
      onTabPress(tab);
    },
    [onTabPress],
  );

  const handleQuickAccessToggle = useCallback(() => {
    setQuickAccessOpen((open) => !open);
  }, []);

  const handleQuickAccessClose = useCallback(() => {
    setQuickAccessOpen(false);
  }, []);

  const handleQuickAccessAction = useCallback(
    (action: QuickAccessAction) => {
      setQuickAccessOpen(false);
      onQuickAccess(action);
    },
    [onQuickAccess],
  );

  return (
    <>
      <View
        style={[
          styles.tabBar,
          anchored && styles.tabBarAnchored,
          {
            minHeight: tabBarHeight,
            paddingBottom: bottomPadding,
          },
        ]}
      >
        <View style={styles.tabBarHighlight} pointerEvents="none" />
        <View style={styles.tabBarRow}>
          <View style={styles.sideGroup}>
            {leftTabs.map((tab) => (
              <SideTabButton
                key={tab.key}
                tab={tab}
                isActive={highlightedTab === tab.key}
                badgeCount={badges[tab.key]}
                onPress={() => handleTabPress(tab.key)}
              />
            ))}
          </View>

          <View style={styles.centerSlot}>
            <Pressable
              style={({ pressed }) => [
                styles.centerButton,
                quickAccessOpen && styles.centerButtonOpen,
                pressed && styles.centerButtonPressed,
              ]}
              onPress={handleQuickAccessToggle}
            >
              <View style={styles.centerButtonRing} pointerEvents="none" />
              <View style={[styles.centerButtonInner, quickAccessOpen && styles.centerButtonInnerOpen]}>
                <GameIcon name="quickAccess" size={26} color="#FFFFFF" />
              </View>
            </Pressable>
          </View>

          <View style={styles.sideGroup}>
            {rightTabs.map((tab) => (
              <SideTabButton
                key={tab.key}
                tab={tab}
                isActive={highlightedTab === tab.key}
                badgeCount={badges[tab.key]}
                onPress={() => handleTabPress(tab.key)}
              />
            ))}
          </View>
        </View>
      </View>

      <QuickAccessMenu
        visible={quickAccessOpen}
        bottomOffset={quickAccessPanelOffset}
        onClose={handleQuickAccessClose}
        onQuickAccess={handleQuickAccessAction}
      />
    </>
  );
}

function NativeGameTabBar(props: GameTabBarProps) {
  const tabBarHeight = getGameTabBarHeight(Platform.OS === 'android' ? 0 : TAB_BAR_PADDING_BOTTOM_MIN);

  if (Platform.OS === 'android') {
    return (
      <View style={styles.safeArea}>
        <GameTabBarContent
          {...props}
          bottomInset={0}
          tabBarHeight={tabBarHeight}
          anchored={false}
        />
      </View>
    );
  }

  return (
    <SafeAreaView edges={['bottom']} style={styles.safeArea}>
      <GameTabBarContent
        {...props}
        bottomInset={0}
        tabBarHeight={tabBarHeight}
        anchored={false}
      />
    </SafeAreaView>
  );
}

function FallbackGameTabBar(props: GameTabBarProps) {
  const { bottomInset } = useTabBarLayout();
  const tabBottomInset = Platform.OS === 'android' ? 0 : bottomInset;
  const tabBarHeight = getGameTabBarHeight(tabBottomInset);

  return (
    <GameTabBarContent
      {...props}
      bottomInset={tabBottomInset}
      tabBarHeight={tabBarHeight}
      anchored
    />
  );
}

export default function GameTabBar(props: GameTabBarProps) {
  if (isSafeAreaContextAvailable()) {
    return <NativeGameTabBar {...props} />;
  }
  return <FallbackGameTabBar {...props} />;
}

const styles = StyleSheet.create({
  safeArea: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  tabBar: {
    backgroundColor: TAB_BAR_BG,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: TAB_BAR_BORDER,
    borderBottomWidth: 0,
    overflow: 'visible',
    ...Platform.select({
      ios: {
        shadowColor: '#0F172A',
        shadowOpacity: 0.18,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: -2 },
      },
      android: {
        elevation: 3,
      },
    }),
  },
  tabBarAnchored: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  tabBarHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(74, 168, 255, 0.14)',
  },
  tabBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: TAB_BAR_ROW_HEIGHT,
    paddingTop: TAB_BAR_PADDING_TOP,
    paddingHorizontal: 4,
  },
  sideGroup: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
  },
  sideTabTarget: {
    flex: 1,
    maxWidth: 80,
    minWidth: 0,
  },
  sideTabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 6,
    paddingBottom: 2,
    minWidth: 0,
  },
  iconWrap: {
    width: 30,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sideTabLabel: {
    marginTop: 3,
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '500',
    color: TAB_INACTIVE_LABEL,
    letterSpacing: 0.15,
  },
  sideTabLabelActive: {
    color: TAB_ACTIVE_COLOR,
    fontWeight: '700',
  },
  activeIndicator: {
    width: 20,
    height: 2,
    borderRadius: 999,
    backgroundColor: TAB_ACTIVE_COLOR,
    marginTop: 2,
  },
  badge: {
    position: 'absolute',
    top: 0,
    right: -9,
    minWidth: 17,
    height: 17,
    borderRadius: 999,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FF5A59',
    borderWidth: 1.5,
    borderColor: TAB_BAR_BG,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '800',
    lineHeight: 11,
    includeFontPadding: false,
  },
  centerSlot: {
    width: CENTER_BUTTON_RING_SIZE + 4,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -CENTER_BUTTON_LIFT,
  },
  centerButton: {
    width: CENTER_BUTTON_RING_SIZE,
    height: CENTER_BUTTON_RING_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerButtonOpen: {
    transform: [{ scale: 1.01 }],
  },
  centerButtonPressed: {
    opacity: 0.94,
    transform: [{ scale: 0.96 }],
  },
  centerButtonRing: {
    position: 'absolute',
    width: CENTER_BUTTON_RING_SIZE,
    height: CENTER_BUTTON_RING_SIZE,
    borderRadius: CENTER_BUTTON_RING_SIZE / 2,
    borderWidth: 1,
    borderColor: 'rgba(74, 168, 255, 0.38)',
  },
  centerButtonInner: {
    width: CENTER_BUTTON_SIZE,
    height: CENTER_BUTTON_SIZE,
    borderRadius: CENTER_BUTTON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: TAB_ACTIVE_COLOR,
    ...Platform.select({
      ios: {
        shadowColor: TAB_ACTIVE_COLOR,
        shadowOpacity: 0.27,
        shadowRadius: 9,
        shadowOffset: { width: 0, height: 3 },
      },
      android: {
        elevation: 5,
      },
    }),
  },
  centerButtonInnerOpen: {
    backgroundColor: '#1A7FE8',
  },
});

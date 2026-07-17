import React, { useMemo, useState } from 'react';
import {
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  GAME_CENTER_BUTTON_LIFT,
  GAME_CENTER_BUTTON_SIZE,
  GAME_TAB_BAR_HEIGHT,
  TAB_BAR_TOP_PADDING,
} from '../../constants/layout';
import { useTabBarLayout } from '../../hooks/useTabBarLayout';
import { getContractAvailability } from '../../simulation/delivery';
import { useGameStore } from '../../store/gameStore';
import { TutorialTarget } from '../../tutorial/TutorialTarget';
import type { TutorialTargetId } from '../../tutorial/types';
import { colors, typography } from '../../theme';
import { countActiveMarketAlerts } from '../../utils/marketAlerts';
import { isSafeAreaContextAvailable } from '../../utils/safeArea';
import GameIcon from '../ui/GameIcon';
import type { TabDefinition, TabKey } from '../../navigation/tabTypes';
import { MAIN_TAB_KEYS } from '../../navigation/tabTypes';
import type { QuickAccessAction } from '../../navigation/quickAccessTypes';
import QuickAccessMenu from './QuickAccessMenu';

const TAB_TARGET_IDS: Partial<Record<TabKey, TutorialTargetId>> = {
  dashboard: 'tab-dashboard',
  map: 'tab-map',
  contracts: 'tab-contracts',
  market: 'tab-market',
};

const LEFT_TAB_KEYS: TabKey[] = ['dashboard', 'map'];
const RIGHT_TAB_KEYS: TabKey[] = ['contracts', 'market'];

function isMainTabKey(tab: TabKey): boolean {
  return (MAIN_TAB_KEYS as readonly TabKey[]).includes(tab);
}

const TAB_INACTIVE_COLOR = colors.textMuted;
const TAB_ACTIVE_COLOR = colors.info;

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
  const playerLevel = useGameStore(
    (state) => Math.max(1, state.player.level ?? state.player.companyLevel ?? 1),
  );
  const marketAlerts = useGameStore((state) => state.marketAlerts);

  return useMemo(() => {
    const badges: Partial<Record<TabKey, number>> = {};

    const playableCount = contracts.filter(
      (contract) =>
        contract.status === 'available' &&
        getContractAvailability(contract, trucks, drivers, playerLevel).canStart,
    ).length;
    if (playableCount > 0) {
      badges.contracts = playableCount;
    }

    const alertCount = countActiveMarketAlerts(marketAlerts ?? []);
    if (alertCount > 0) {
      badges.market = alertCount;
    }

    return badges;
  }, [contracts, trucks, drivers, playerLevel, marketAlerts]);
}

function TabBadge({ count }: { count: number }) {
  const label = count > 99 ? '99+' : String(count);
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>{label}</Text>
    </View>
  );
}

interface SideTabButtonProps {
  tab: TabDefinition;
  isActive: boolean;
  badgeCount?: number;
  onPress: () => void;
}

function SideTabButton({ tab, isActive, badgeCount, onPress }: SideTabButtonProps) {
  const targetId = TAB_TARGET_IDS[tab.key];

  const button = (
    <TouchableOpacity
      style={[styles.sideTabButton, isActive && styles.sideTabButtonActive]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <View style={styles.iconWrap}>
        <GameIcon
          name={tab.icon}
          size={23}
          color={isActive ? TAB_ACTIVE_COLOR : TAB_INACTIVE_COLOR}
        />
        {badgeCount && badgeCount > 0 ? <TabBadge count={badgeCount} /> : null}
      </View>
      <Text
        style={[styles.sideTabLabel, isActive && styles.sideTabLabelActive]}
        numberOfLines={1}
      >
        {tab.label}
      </Text>
      {isActive ? <View style={styles.activeGlowLine} /> : null}
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
}

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

  const quickAccessPanelOffset = tabBarHeight + GAME_CENTER_BUTTON_LIFT + 8;
  const highlightedTab = isMainTabKey(activeTab) ? activeTab : null;

  const handleTabPress = (tab: TabKey) => {
    setQuickAccessOpen(false);
    onTabPress(tab);
  };

  return (
    <>
      <View
        style={[
          styles.tabBar,
          anchored && styles.tabBarAnchored,
          {
            minHeight: tabBarHeight,
            paddingBottom: bottomInset,
          },
        ]}
      >
        <View style={styles.tabBarGlowTop} />
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
            <TouchableOpacity
              style={[styles.centerButton, quickAccessOpen && styles.centerButtonOpen]}
              activeOpacity={0.88}
              onPress={() => setQuickAccessOpen((open) => !open)}
            >
              <View style={[styles.centerButtonInner, quickAccessOpen && styles.centerButtonInnerOpen]}>
                <GameIcon name="quickAccess" size={22} color={colors.textPrimary} />
              </View>
            </TouchableOpacity>
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
        onClose={() => setQuickAccessOpen(false)}
        onQuickAccess={(action) => {
          setQuickAccessOpen(false);
          onQuickAccess(action);
        }}
      />
    </>
  );
}

function NativeGameTabBar(props: GameTabBarProps) {
  // Android immersive: alt sistem bar gizli — SafeArea bottom inset ekleme.
  if (Platform.OS === 'android') {
    return (
      <View style={styles.safeArea}>
        <GameTabBarContent
          {...props}
          bottomInset={0}
          tabBarHeight={GAME_TAB_BAR_HEIGHT}
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
        tabBarHeight={GAME_TAB_BAR_HEIGHT}
        anchored={false}
      />
    </SafeAreaView>
  );
}

function FallbackGameTabBar(props: GameTabBarProps) {
  const { bottomInset, tabBarHeight } = useTabBarLayout();
  const tabBottomInset = Platform.OS === 'android' ? 0 : bottomInset;

  return (
    <GameTabBarContent
      {...props}
      bottomInset={tabBottomInset}
      tabBarHeight={Platform.OS === 'android' ? GAME_TAB_BAR_HEIGHT : tabBarHeight}
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
    backgroundColor: 'rgba(11, 18, 32, 0.97)',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: 1,
    borderTopColor: 'rgba(56, 189, 248, 0.22)',
    overflow: 'visible',
    ...Platform.select({
      ios: {
        shadowColor: '#0F172A',
        shadowOpacity: 0.35,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: -3 },
      },
      android: {
        elevation: 12,
      },
    }),
  },
  tabBarAnchored: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  tabBarGlowTop: {
    position: 'absolute',
    top: 0,
    left: 32,
    right: 32,
    height: 1,
    backgroundColor: 'rgba(56, 189, 248, 0.4)',
  },
  tabBarRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    minHeight: GAME_TAB_BAR_HEIGHT,
    paddingTop: TAB_BAR_TOP_PADDING,
    paddingHorizontal: 4,
  },
  sideGroup: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-evenly',
  },
  sideTabTarget: {
    flex: 1,
    maxWidth: 80,
  },
  sideTabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 8,
    gap: 3,
    minHeight: 54,
  },
  sideTabButtonActive: {},
  iconWrap: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sideTabLabel: {
    ...typography.tabLabel,
    color: TAB_INACTIVE_COLOR,
    fontSize: 11,
    letterSpacing: 0.2,
  },
  sideTabLabelActive: {
    color: TAB_ACTIVE_COLOR,
    fontWeight: '700',
  },
  activeGlowLine: {
    width: 16,
    height: 2,
    borderRadius: 1,
    backgroundColor: TAB_ACTIVE_COLOR,
    marginTop: 1,
  },
  badge: {
    position: 'absolute',
    top: 0,
    right: -2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.danger,
    borderWidth: 1.5,
    borderColor: colors.surface,
  },
  badgeText: {
    color: '#FFF',
    fontSize: 9,
    fontWeight: '800',
    lineHeight: 11,
  },
  centerSlot: {
    width: GAME_CENTER_BUTTON_SIZE + 6,
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginBottom: GAME_CENTER_BUTTON_LIFT,
  },
  centerButton: {
    width: GAME_CENTER_BUTTON_SIZE,
    height: GAME_CENTER_BUTTON_SIZE,
    borderRadius: GAME_CENTER_BUTTON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerButtonOpen: {
    transform: [{ scale: 1.02 }],
  },
  centerButtonInnerOpen: {
    borderColor: 'rgba(56, 189, 248, 0.75)',
  },
  centerButtonInner: {
    width: GAME_CENTER_BUTTON_SIZE,
    height: GAME_CENTER_BUTTON_SIZE,
    borderRadius: GAME_CENTER_BUTTON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentBlue,
    borderWidth: 1.5,
    borderColor: 'rgba(56, 189, 248, 0.55)',
    ...Platform.select({
      ios: {
        shadowColor: colors.accentBlue,
        shadowOpacity: 0.35,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
      },
      android: {
        elevation: 6,
      },
    }),
  },
});

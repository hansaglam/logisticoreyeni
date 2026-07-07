import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  BASE_TAB_HEIGHT,
  TAB_ACTIVE_MIN_HEIGHT,
  TAB_BAR_TOP_PADDING,
  TAB_ITEM_MIN_HEIGHT,
} from '../constants/layout';
import { useTabBarLayout } from '../hooks/useTabBarLayout';
import { TutorialTarget } from '../tutorial/TutorialTarget';
import type { TutorialTargetId } from '../tutorial/types';
import { colors, typography } from '../theme';
import type { GameIconName } from '../theme/icons';
import { isSafeAreaContextAvailable } from '../utils/safeArea';
import GameIcon from './ui/GameIcon';

export type TabKey = 'dashboard' | 'map' | 'contracts' | 'fleet' | 'market' | 'more';

const TAB_TARGET_IDS: Record<TabKey, TutorialTargetId> = {
  dashboard: 'tab-dashboard',
  map: 'tab-map',
  contracts: 'tab-contracts',
  fleet: 'tab-fleet',
  market: 'tab-market',
  more: 'tab-more',
};

export interface TabDefinition {
  key: TabKey;
  label: string;
  icon: GameIconName;
}

interface BottomTabBarProps {
  tabs: TabDefinition[];
  activeTab: TabKey;
  onTabPress: (tab: TabKey) => void;
}

function TabButtons({ tabs, activeTab, onTabPress }: BottomTabBarProps) {
  return (
    <>
      {tabs.map((tab) => {
        const isActive = tab.key === activeTab;
        return (
          <TutorialTarget
            key={tab.key}
            id={TAB_TARGET_IDS[tab.key]}
            onTutorialPress={() => onTabPress(tab.key)}
            style={styles.tabTargetWrap}
          >
            <TouchableOpacity
              style={[
                styles.tabButton,
                isActive && styles.tabButtonActive,
                isActive && { minHeight: TAB_ACTIVE_MIN_HEIGHT },
              ]}
              onPress={() => onTabPress(tab.key)}
              activeOpacity={0.85}
            >
              <GameIcon
                name={tab.icon}
                size={18}
                color={isActive ? colors.accentBlue : colors.textMuted}
              />
              <Text
                style={[styles.tabLabel, isActive && styles.tabLabelActive]}
                numberOfLines={1}
              >
                {tab.label}
              </Text>
            </TouchableOpacity>
          </TutorialTarget>
        );
      })}
    </>
  );
}

function NativeBottomTabBar(props: BottomTabBarProps) {
  return (
    <SafeAreaView edges={['bottom']} style={styles.tabBar}>
      <View style={styles.tabBarRow}>
        <TabButtons {...props} />
      </View>
    </SafeAreaView>
  );
}

function FallbackBottomTabBar(props: BottomTabBarProps) {
  const { bottomInset, tabBarHeight } = useTabBarLayout();

  return (
    <View
      style={[
        styles.tabBar,
        {
          minHeight: tabBarHeight,
          paddingBottom: bottomInset,
        },
      ]}
    >
      <View style={styles.tabBarRow}>
        <TabButtons {...props} />
      </View>
    </View>
  );
}

export default function BottomTabBar(props: BottomTabBarProps) {
  if (isSafeAreaContextAvailable()) {
    return <NativeBottomTabBar {...props} />;
  }
  return <FallbackBottomTabBar {...props} />;
}

const styles = StyleSheet.create({
  tabBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.tabBarBg,
    borderTopWidth: 1,
    borderTopColor: colors.tabBarBorder,
  },
  tabBarRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    minHeight: BASE_TAB_HEIGHT,
    paddingTop: TAB_BAR_TOP_PADDING,
    paddingHorizontal: 4,
  },
  tabTargetWrap: {
    flex: 1,
  },
  tabButton: {
    flex: 1,
    minHeight: TAB_ITEM_MIN_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingVertical: 4,
    marginHorizontal: 2,
    gap: 3,
  },
  tabButtonActive: {
    backgroundColor: colors.accentBlueSoft,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.35)',
  },
  tabLabel: {
    ...typography.tabLabel,
    color: colors.textMuted,
  },
  tabLabelActive: {
    color: colors.accentBlue,
    fontWeight: '800',
  },
});

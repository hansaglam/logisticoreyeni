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
import { isSafeAreaContextAvailable } from '../utils/safeArea';
import { UI } from '../theme/ui';

export type TabKey = 'dashboard' | 'map' | 'contracts' | 'fleet' | 'market' | 'more';

interface TabDefinition {
  key: TabKey;
  label: string;
  icon: string;
}

interface BottomTabBarProps {
  tabs: TabDefinition[];
  activeTab: TabKey;
  onTabPress: (tab: TabKey) => void;
}

function TabButtons({
  tabs,
  activeTab,
  onTabPress,
}: BottomTabBarProps) {
  return (
    <>
      {tabs.map((tab) => {
        const isActive = tab.key === activeTab;
        return (
          <TouchableOpacity
            key={tab.key}
            style={[
              styles.tabButton,
              isActive && styles.tabButtonActive,
              isActive && { minHeight: TAB_ACTIVE_MIN_HEIGHT },
            ]}
            onPress={() => onTabPress(tab.key)}
            activeOpacity={0.85}
          >
            <Text style={[styles.tabIcon, isActive && styles.tabIconActive]}>{tab.icon}</Text>
            <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]} numberOfLines={1}>
              {tab.label}
            </Text>
          </TouchableOpacity>
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
    backgroundColor: UI.colors.tabBarBg,
    borderTopWidth: 1,
    borderTopColor: UI.colors.tabBarBorder,
  },
  tabBarRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    minHeight: BASE_TAB_HEIGHT,
    paddingTop: TAB_BAR_TOP_PADDING,
    paddingHorizontal: 2,
  },
  tabButton: {
    flex: 1,
    minHeight: TAB_ITEM_MIN_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingVertical: 4,
    marginHorizontal: 1,
  },
  tabButtonActive: {
    backgroundColor: UI.colors.primary,
  },
  tabIcon: {
    fontSize: 16,
    marginBottom: 2,
    opacity: 0.85,
  },
  tabIconActive: {
    opacity: 1,
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: UI.colors.textSecondary,
  },
  tabLabelActive: {
    color: '#0B1220',
    fontWeight: '800',
  },
});

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { GameIconName } from '../../theme/icons';
import { GameIcon } from '../ui';
import {
  SHOP_ACTIVE_TAB,
  SHOP_ACTIVE_TAB_BORDER,
  SHOP_TAB_ACTIVE_BG,
  SHOP_INACTIVE_TAB,
  SHOP_SEGMENT_BG,
  SHOP_SEGMENT_BORDER,
  SHOP_SPACING_HERO_TO_TABS,
  SHOP_TAB_CONTAINER_MIN_HEIGHT,
  SHOP_TAB_CONTAINER_PADDING,
  SHOP_TAB_CONTAINER_RADIUS,
  SHOP_TAB_GAP,
  SHOP_TAB_HEIGHT,
  SHOP_TAB_ICON_SIZE,
  SHOP_TAB_LABEL_SIZE,
  SHOP_TAB_RADIUS,
  type ShopCategory,
} from './shopTheme';

const SHOP_CATEGORIES: {
  key: ShopCategory;
  label: string;
  icon: GameIconName;
}[] = [
  { key: 'trucks', label: 'Kamyonlar', icon: 'truck' },
  { key: 'trailers', label: 'Dorseler', icon: 'trailer' },
  { key: 'drivers', label: 'Şoförler', icon: 'driver' },
];

export interface ShopCategoryTabsProps {
  activeCategory: ShopCategory;
  onChange: (category: ShopCategory) => void;
}

export default function ShopCategoryTabs({ activeCategory, onChange }: ShopCategoryTabsProps) {
  return (
    <View style={styles.container}>
      {SHOP_CATEGORIES.map((category) => {
        const isActive = category.key === activeCategory;
        return (
          <Pressable
            key={category.key}
            style={[styles.tab, isActive && styles.tabActive]}
            onPress={() => onChange(category.key)}
          >
            <GameIcon
              name={category.icon}
              size={SHOP_TAB_ICON_SIZE}
              color={isActive ? SHOP_ACTIVE_TAB : SHOP_INACTIVE_TAB}
            />
            <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]} numberOfLines={1}>
              {category.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: SHOP_SPACING_HERO_TO_TABS,
    minHeight: SHOP_TAB_CONTAINER_MIN_HEIGHT,
    borderRadius: SHOP_TAB_CONTAINER_RADIUS,
    padding: SHOP_TAB_CONTAINER_PADDING,
    backgroundColor: SHOP_SEGMENT_BG,
    borderWidth: 1,
    borderColor: SHOP_SEGMENT_BORDER,
    flexDirection: 'row',
    gap: SHOP_TAB_GAP,
  },
  tab: {
    flex: 1,
    height: SHOP_TAB_HEIGHT,
    borderRadius: SHOP_TAB_RADIUS,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: 'transparent',
  },
  tabActive: {
    backgroundColor: SHOP_TAB_ACTIVE_BG,
    borderWidth: 1,
    borderColor: SHOP_ACTIVE_TAB_BORDER,
  },
  tabLabel: {
    fontSize: SHOP_TAB_LABEL_SIZE,
    fontWeight: '600',
    color: SHOP_INACTIVE_TAB,
  },
  tabLabelActive: {
    color: SHOP_ACTIVE_TAB,
    fontWeight: '700',
  },
});

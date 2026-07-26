import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import type { GameIconName } from '../../theme/icons';
import { GameIcon } from '../ui';
import {
  SHOP_ACTIVE_TAB,
  SHOP_CARD_BG,
  SHOP_CHIP_BORDER,
  SHOP_INACTIVE_TAB,
} from './shopTheme';

export interface ShopFilterChipDef<T extends string> {
  key: T;
  label: string;
  icon?: GameIconName;
}

export interface ShopFilterChipsProps<T extends string> {
  filters: ShopFilterChipDef<T>[];
  activeFilter: T;
  onChange: (filter: T) => void;
}

export default function ShopFilterChips<T extends string>({
  filters,
  activeFilter,
  onChange,
}: ShopFilterChipsProps<T>) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {filters.map((filter) => {
        const isActive = filter.key === activeFilter;
        return (
          <Pressable
            key={filter.key}
            style={[styles.chip, isActive && styles.chipActive]}
            onPress={() => onChange(filter.key)}
          >
            {filter.icon ? (
              <GameIcon
                name={filter.icon}
                size={12}
                color={isActive ? '#39A0FF' : SHOP_INACTIVE_TAB}
              />
            ) : null}
            <Text style={[styles.chipLabel, isActive && styles.chipLabelActive]} numberOfLines={1}>
              {filter.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: 7,
    paddingVertical: 2,
    paddingRight: 16,
  },
  chip: {
    height: 38,
    paddingHorizontal: 12,
    borderRadius: 11,
    backgroundColor: SHOP_CARD_BG,
    borderWidth: 1,
    borderColor: SHOP_CHIP_BORDER,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  chipActive: {
    backgroundColor: 'rgba(35,136,255,0.12)',
    borderColor: SHOP_ACTIVE_TAB,
  },
  chipLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: SHOP_INACTIVE_TAB,
  },
  chipLabelActive: {
    color: '#39A0FF',
    fontWeight: '700',
  },
});

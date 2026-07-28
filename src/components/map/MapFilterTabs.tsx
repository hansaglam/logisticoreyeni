import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import type { GameIconName } from '../../theme/icons';
import { GameIcon } from '../ui';
import type { NetworkFilterKey } from './mapTypes';
import {
  MAP_ACCENT,
  MAP_ACCENT_BORDER,
  MAP_FILTER_CONTAINER_GAP,
  MAP_FILTER_TAB_HEIGHT,
  MAP_MUTED,
  MAP_SPACING_HEADER_TO_FILTERS,
  MAP_SURFACE,
} from './mapTheme';

const MAP_FILTERS: {
  key: NetworkFilterKey;
  label: string;
  icon: GameIconName;
}[] = [
  { key: 'all', label: 'Tümü', icon: 'dashboard' },
  { key: 'trucks', label: 'Kamyonlar', icon: 'truck' },
  { key: 'depots', label: 'Depolar', icon: 'warehouse' },
];

export interface MapFilterTabsProps {
  selectedFilter: NetworkFilterKey;
  onChange: (filter: NetworkFilterKey) => void;
}

export default function MapFilterTabs({ selectedFilter, onChange }: MapFilterTabsProps) {
  return (
    <View style={styles.row}>
      {MAP_FILTERS.map((filter) => {
        const isActive = filter.key === selectedFilter;
        return (
          <TouchableOpacity
            key={filter.key}
            style={[styles.tab, isActive && styles.tabActive]}
            onPress={() => onChange(filter.key)}
            activeOpacity={0.85}
          >
            <GameIcon
              name={filter.icon}
              size={16}
              color={isActive ? MAP_ACCENT : MAP_MUTED}
            />
            <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]} numberOfLines={1}>
              {filter.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    marginTop: MAP_SPACING_HEADER_TO_FILTERS,
    flexDirection: 'row',
    alignItems: 'center',
    gap: MAP_FILTER_CONTAINER_GAP,
  },
  tab: {
    height: MAP_FILTER_TAB_HEIGHT,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: MAP_SURFACE,
    borderWidth: 1,
    borderColor: 'rgba(50,95,150,0.32)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    flex: 1,
  },
  tabActive: {
    backgroundColor: 'rgba(35,136,255,0.10)',
    borderColor: MAP_ACCENT_BORDER,
  },
  tabLabel: {
    fontSize: 12.5,
    fontWeight: '700',
    color: MAP_MUTED,
  },
  tabLabelActive: {
    color: MAP_ACCENT,
  },
});

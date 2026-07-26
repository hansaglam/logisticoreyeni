import React, { useCallback, useEffect, useRef } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions } from 'react-native';

import type { GameIconName } from '../../theme/icons';
import { GameIcon } from '../ui';
import type { NetworkFilterKey } from './mapTypes';
import {
  MAP_ACCENT,
  MAP_ACCENT_BORDER,
  MAP_FILTER_CONTAINER_GAP,
  MAP_FILTER_TAB_HEIGHT,
  MAP_HORIZONTAL_PADDING,
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
  { key: 'routes', label: 'Rotalar', icon: 'route' },
  { key: 'opportunities', label: 'Fırsatlar', icon: 'market' },
];

export interface MapFilterTabsProps {
  selectedFilter: NetworkFilterKey;
  onChange: (filter: NetworkFilterKey) => void;
}

interface TabLayout {
  x: number;
  width: number;
}

export default function MapFilterTabs({ selectedFilter, onChange }: MapFilterTabsProps) {
  const scrollRef = useRef<ScrollView>(null);
  const tabLayouts = useRef<Partial<Record<NetworkFilterKey, TabLayout>>>({});
  const { width: screenWidth } = useWindowDimensions();
  const scrollViewportWidth = Math.max(0, screenWidth - MAP_HORIZONTAL_PADDING * 2);

  const scrollToFilter = useCallback(
    (filterKey: NetworkFilterKey) => {
      const layout = tabLayouts.current[filterKey];
      if (!layout || scrollViewportWidth <= 0) return;

      const paddingEnd = 16;
      const tabStart = layout.x;
      const tabEnd = layout.x + layout.width;
      let targetX = tabStart + layout.width / 2 - scrollViewportWidth / 2;
      targetX = Math.max(0, targetX);

      if (tabEnd - targetX > scrollViewportWidth - paddingEnd) {
        targetX = tabEnd - scrollViewportWidth + paddingEnd;
      }
      if (tabStart < targetX) {
        targetX = tabStart;
      }

      scrollRef.current?.scrollTo({ x: targetX, animated: true });
    },
    [scrollViewportWidth],
  );

  useEffect(() => {
    scrollToFilter(selectedFilter);
  }, [selectedFilter, scrollToFilter]);

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.scroll}
      contentContainerStyle={styles.row}
    >
      {MAP_FILTERS.map((filter) => {
        const isActive = filter.key === selectedFilter;
        return (
          <TouchableOpacity
            key={filter.key}
            style={[styles.tab, isActive && styles.tabActive]}
            onPress={() => onChange(filter.key)}
            onLayout={(event) => {
              const { x, width } = event.nativeEvent.layout;
              tabLayouts.current[filter.key] = { x, width };
            }}
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    marginTop: MAP_SPACING_HEADER_TO_FILTERS,
    marginHorizontal: -MAP_HORIZONTAL_PADDING,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: MAP_FILTER_CONTAINER_GAP,
    paddingHorizontal: MAP_HORIZONTAL_PADDING,
    paddingRight: MAP_HORIZONTAL_PADDING + 8,
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

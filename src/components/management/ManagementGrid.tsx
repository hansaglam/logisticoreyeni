import React, { useCallback, useMemo } from 'react';
import { ScrollView, StyleSheet, View, type ScrollView as ScrollViewType } from 'react-native';

import ManagementCard, { getManagementCardWidth } from './ManagementCard';
import { MANAGEMENT_GRID_GAP } from './managementTheme';
import type { ManagementItem } from './managementTypes';

export interface ManagementGridProps {
  items: ManagementItem[];
  contentWidth: number;
  disabled?: boolean;
  onItemPress: (id: ManagementItem['id']) => void;
  listHeaderComponent?: React.ReactElement | null;
  contentBottomPadding?: number;
  scrollEnabled?: boolean;
  scrollRef?: React.RefObject<ScrollViewType | null>;
}

function chunkPairs<T>(items: T[]): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += 2) {
    rows.push(items.slice(index, index + 2));
  }
  return rows;
}

export default function ManagementGrid({
  items,
  contentWidth,
  disabled = false,
  onItemPress,
  listHeaderComponent,
  contentBottomPadding = 0,
  scrollEnabled = true,
  scrollRef,
}: ManagementGridProps) {
  const cardWidth = getManagementCardWidth({
    containerWidth: contentWidth,
    gap: MANAGEMENT_GRID_GAP,
  });

  const rows = useMemo(() => chunkPairs(items), [items]);

  const renderCard = useCallback(
    (item: ManagementItem) => (
      <ManagementCard
        key={item.id}
        item={item}
        width={cardWidth}
        disabled={disabled}
        onPress={() => onItemPress(item.id)}
      />
    ),
    [cardWidth, disabled, onItemPress],
  );

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.scroll}
      contentContainerStyle={[
        styles.contentContainer,
        contentBottomPadding > 0 ? { paddingBottom: contentBottomPadding } : null,
      ]}
      scrollEnabled={scrollEnabled}
      showsVerticalScrollIndicator={scrollEnabled}
      indicatorStyle="white"
      bounces={scrollEnabled}
      keyboardShouldPersistTaps="handled"
      nestedScrollEnabled
    >
      {listHeaderComponent ?? null}
      <View style={styles.grid}>
        {rows.map((row, rowIndex) => (
          <View key={`management-row-${rowIndex}`} style={styles.columnRow}>
            {row.map((item) => renderCard(item))}
            {row.length === 1 ? <View style={{ width: cardWidth }} /> : null}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  contentContainer: {
    flexGrow: 0,
  },
  grid: {
    gap: 0,
  },
  columnRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: MANAGEMENT_GRID_GAP,
  },
});

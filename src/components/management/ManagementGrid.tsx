import React, { useCallback } from 'react';
import { FlatList, StyleSheet, type ListRenderItem } from 'react-native';

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
  listRef?: React.RefObject<FlatList<ManagementItem> | null>;
}

export default function ManagementGrid({
  items,
  contentWidth,
  disabled = false,
  onItemPress,
  listHeaderComponent,
  contentBottomPadding = 0,
  scrollEnabled = true,
  listRef,
}: ManagementGridProps) {
  const cardWidth = getManagementCardWidth({
    containerWidth: contentWidth,
    gap: MANAGEMENT_GRID_GAP,
  });

  const renderItem: ListRenderItem<ManagementItem> = useCallback(
    ({ item }) => (
      <ManagementCard
        item={item}
        width={cardWidth}
        disabled={disabled}
        onPress={() => onItemPress(item.id)}
      />
    ),
    [cardWidth, disabled, onItemPress],
  );

  return (
    <FlatList
      ref={listRef}
      data={items}
      key="management-grid-2col"
      keyExtractor={(item) => item.id}
      numColumns={2}
      style={styles.list}
      renderItem={renderItem}
      ListHeaderComponent={listHeaderComponent ?? undefined}
      columnWrapperStyle={styles.columnRow}
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
    />
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
  columnRow: {
    justifyContent: 'space-between',
    marginBottom: MANAGEMENT_GRID_GAP,
  },
  contentContainer: {
    flexGrow: 1,
  },
});

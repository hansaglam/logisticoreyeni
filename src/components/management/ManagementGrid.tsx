import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import ManagementCard, { getManagementCardWidth } from './ManagementCard';
import { MANAGEMENT_GRID_GAP } from './managementTheme';
import type { ManagementItem } from './managementTypes';

export interface ManagementGridProps {
  items: ManagementItem[];
  containerWidth: number;
  disabled?: boolean;
  onItemPress: (id: ManagementItem['id']) => void;
}

export default function ManagementGrid({
  items,
  containerWidth,
  disabled = false,
  onItemPress,
}: ManagementGridProps) {
  const cardWidth = useMemo(
    () => getManagementCardWidth({ containerWidth, gap: MANAGEMENT_GRID_GAP }),
    [containerWidth],
  );

  return (
    <View style={styles.grid}>
      {items.map((item) => (
        <ManagementCard
          key={item.id}
          item={item}
          width={cardWidth}
          disabled={disabled}
          onPress={() => onItemPress(item.id)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: MANAGEMENT_GRID_GAP,
    rowGap: MANAGEMENT_GRID_GAP,
  },
});

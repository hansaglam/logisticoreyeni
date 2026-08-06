import React from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, spacing } from '../../theme';

export default function MarketplaceListingSkeleton() {
  return (
    <View style={styles.card}>
      <View style={styles.thumb} />
      <View style={styles.body}>
        <View style={[styles.line, styles.lineWide]} />
        <View style={[styles.line, styles.lineMedium]} />
        <View style={styles.row}>
          <View style={[styles.line, styles.lineShort]} />
          <View style={[styles.line, styles.linePrice]} />
        </View>
      </View>
    </View>
  );
}

export function MarketplaceListingSkeletonList({ count = 3 }: { count?: number }) {
  return (
    <View style={styles.list}>
      {Array.from({ length: count }, (_, index) => (
        <MarketplaceListingSkeleton key={index} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
  card: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: 16,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  thumb: {
    width: 72,
    height: 72,
    borderRadius: 12,
    backgroundColor: colors.cardSoft,
  },
  body: { flex: 1, gap: spacing.sm, justifyContent: 'center' },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  line: {
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.cardSoft,
  },
  lineWide: { width: '72%' },
  lineMedium: { width: '48%' },
  lineShort: { width: '34%' },
  linePrice: { width: '28%' },
});

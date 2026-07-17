import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '../../theme';
import type { ProductPriceTrend } from '../../utils/productPriceTrend';
import MarketAnalysisChart from './MarketAnalysisChart';

interface ProductDetailTrendChartProps {
  trend: ProductPriceTrend;
}

function mapDirection(direction: ProductPriceTrend['direction']) {
  if (direction === 'up') return 'up' as const;
  if (direction === 'down') return 'down' as const;
  return 'stable' as const;
}

export default function ProductDetailTrendChart({ trend }: ProductDetailTrendChartProps) {
  const hasEnoughHistory =
    trend.prices.filter((value) => Number.isFinite(value) && value > 0).length >= 2;

  return (
    <View style={styles.container}>
      <Text style={styles.sectionLabel}>Son fiyat hareketleri</Text>

      {hasEnoughHistory ? (
        <MarketAnalysisChart
          data={trend.prices}
          trend={mapDirection(trend.direction)}
          currentTime={trend.chartCurrentTime}
        />
      ) : (
        <View style={styles.fallbackBox}>
          <Text style={styles.fallbackText}>Yeterli fiyat geçmişi yok</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.sm,
  },
  sectionLabel: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  fallbackBox: {
    backgroundColor: colors.cardSoft,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  fallbackText: {
    ...typography.caption,
    color: colors.textMuted,
  },
});

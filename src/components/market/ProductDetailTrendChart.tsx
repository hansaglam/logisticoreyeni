import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, formatMoney, spacing, typography } from '../../theme';
import { MARKET_PRICE_HISTORY_DISPLAY_POINTS } from '../../utils/marketPriceHistoryGenerator';
import type { ProductPriceTrend } from '../../utils/productPriceTrend';
import MiniTrendChart from './MiniTrendChart';

const CHART_HEIGHT = 148;

interface ProductDetailTrendChartProps {
  trend: ProductPriceTrend;
}

function mapDirection(direction: ProductPriceTrend['direction']) {
  if (direction === 'up') return 'up' as const;
  if (direction === 'down') return 'down' as const;
  return 'stable' as const;
}

export default function ProductDetailTrendChart({ trend }: ProductDetailTrendChartProps) {
  const { minPrice, maxPrice, hasEnoughHistory } = useMemo(() => {
    const prices = trend.prices.filter((value) => Number.isFinite(value) && value > 0);
    if (prices.length < 2) {
      return { minPrice: null, maxPrice: null, hasEnoughHistory: false };
    }
    return {
      minPrice: Math.min(...prices),
      maxPrice: Math.max(...prices),
      hasEnoughHistory: true,
    };
  }, [trend.prices]);

  return (
    <View style={styles.container}>
      <Text style={styles.sectionLabel}>
        Son {MARKET_PRICE_HISTORY_DISPLAY_POINTS} hareket
      </Text>

      {hasEnoughHistory ? (
        <>
          <MiniTrendChart
            data={trend.prices}
            trend={mapDirection(trend.direction)}
            variant="detail"
            height={CHART_HEIGHT}
            lineStyle="smooth"
            strokeWidth={2.1}
            showLastPoint
          />
          <View style={styles.rangeRow}>
            <Text style={styles.rangeText} numberOfLines={1}>
              En düşük: {formatMoney(minPrice ?? 0)}
            </Text>
            <Text style={styles.rangeText} numberOfLines={1}>
              En yüksek: {formatMoney(maxPrice ?? 0)}
            </Text>
          </View>
        </>
      ) : (
        <View style={styles.fallbackBox}>
          <MiniTrendChart
            data={
              trend.prices.length > 0
                ? (() => {
                    const last = trend.prices[trend.prices.length - 1];
                    return [last, last];
                  })()
                : [100, 100]
            }
            trend="stable"
            variant="detail"
            height={CHART_HEIGHT}
          />
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
  rangeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  rangeText: {
    ...typography.caption,
    color: colors.textMuted,
    flex: 1,
  },
  fallbackBox: {
    position: 'relative',
  },
  fallbackText: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
});

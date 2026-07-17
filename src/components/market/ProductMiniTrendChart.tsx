import React from 'react';
import { StyleSheet, View } from 'react-native';

import {
  MARKET_PRICE_HISTORY_MINI_POINTS,
  slicePriceHistoryForDisplay,
} from '../../utils/marketPriceHistoryGenerator';
import type { ProductPriceTrend } from '../../utils/productPriceTrend';
import MiniTrendChart, { type MiniTrendDirection } from './MiniTrendChart';

interface ProductMiniTrendChartProps {
  trend: ProductPriceTrend;
}

function mapDirection(direction: ProductPriceTrend['direction']): MiniTrendDirection {
  if (direction === 'up') return 'up';
  if (direction === 'down') return 'down';
  return 'stable';
}

export default function ProductMiniTrendChart({ trend }: ProductMiniTrendChartProps) {
  const chartData = slicePriceHistoryForDisplay(
    trend.prices,
    MARKET_PRICE_HISTORY_MINI_POINTS,
  );

  return (
    <View style={styles.container}>
      <MiniTrendChart
        data={chartData}
        trend={mapDirection(trend.direction)}
        height={36}
        lineStyle="smooth"
        strokeWidth={1.75}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    marginTop: 6,
    marginBottom: 4,
  },
});

import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import type { ProductPriceTrend } from '../../utils/productPriceTrend';
import { MARKET_MINI_CHART_HEIGHT } from './marketChartVisuals';
import MiniTrendChart, { type MiniTrendDirection } from './MiniTrendChart';

interface ProductMiniTrendChartProps {
  trend: ProductPriceTrend;
}

function mapDirection(direction: ProductPriceTrend['direction']): MiniTrendDirection {
  if (direction === 'up') return 'up';
  if (direction === 'down') return 'down';
  return 'stable';
}

function ProductMiniTrendChart({ trend }: ProductMiniTrendChartProps) {
  const chartData = useMemo(
    () => (trend.miniPrices.length >= 2 ? trend.miniPrices : trend.prices.slice(-12)),
    [trend.miniPrices, trend.prices],
  );

  return (
    <View style={styles.container}>
      <MiniTrendChart
        data={chartData}
        trend={mapDirection(trend.direction)}
        variant="mini"
        height={MARKET_MINI_CHART_HEIGHT}
      />
    </View>
  );
}

export default React.memo(ProductMiniTrendChart);

const styles = StyleSheet.create({
  container: {
    width: '100%',
    marginTop: 6,
    marginBottom: 4,
  },
});

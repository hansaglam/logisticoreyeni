import React from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import {
  formatMarketMovementHelper,
  resolveMarketMovementAccentColor,
  resolveMarketMovementIcon,
  type MarketMovementSummary,
} from '../../simulation/marketMovementSummary';
import { colors } from '../../theme';
import { formatUnitPrice, isFuelExpensiveForDisplay } from '../../theme/format';
import type { GameIconName } from '../../theme/icons';
import { GameIcon } from '../ui';
import { MARKET_METRIC_HEIGHT } from './marketTheme';

interface MarketMetricTileProps {
  label: string;
  value: string;
  helper?: string;
  icon: GameIconName;
  accentColor: string;
}

function MarketMetricTile({
  label,
  value,
  helper,
  icon,
  accentColor,
}: MarketMetricTileProps) {
  return (
    <View style={styles.metricTile}>
      <View style={[styles.metricIconWrap, { backgroundColor: `${accentColor}18` }]}>
        <GameIcon name={icon} size={16} color={accentColor} />
      </View>
      <View style={styles.metricTextBlock}>
        <Text
          style={styles.metricLabel}
          numberOfLines={2}
          adjustsFontSizeToFit
          minimumFontScale={0.82}
        >
          {label}
        </Text>
        <Text
          style={[styles.metricValue, { color: accentColor }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.78}
        >
          {value}
        </Text>
        {helper ? (
          <Text style={styles.metricHelper} numberOfLines={2}>
            {helper}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export interface MarketMetricStripProps {
  fuelPrice: number | null;
  movementSummary: MarketMovementSummary;
  opportunityCount: number;
}

export default function MarketMetricStrip({
  fuelPrice,
  movementSummary,
  opportunityCount,
}: MarketMetricStripProps) {
  const { width } = useWindowDimensions();
  const compactMovementHelper = width < 390;
  const movementAccent = resolveMarketMovementAccentColor(movementSummary);
  const movementHelper = formatMarketMovementHelper(
    movementSummary,
    compactMovementHelper,
  );

  return (
    <View style={styles.metricStrip}>
      <MarketMetricTile
        label="Yakıt Fiyatı"
        value={fuelPrice == null ? '—' : formatUnitPrice(fuelPrice, '/L')}
        icon="fuel"
        accentColor={
          fuelPrice == null
            ? colors.textMuted
            : isFuelExpensiveForDisplay(fuelPrice)
              ? colors.danger
              : colors.accentAmber
        }
      />
      <MarketMetricTile
        label="Hareket"
        value={String(movementSummary.total)}
        helper={movementHelper}
        icon={resolveMarketMovementIcon(movementSummary)}
        accentColor={movementAccent}
      />
      <MarketMetricTile
        label="Fırsatlar"
        value={String(opportunityCount)}
        helper={opportunityCount > 0 ? 'Aktif ticaret' : 'Sakin piyasa'}
        icon="contract"
        accentColor="#A78BFA"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  metricStrip: {
    flexDirection: 'row',
    gap: 11,
  },
  metricTile: {
    flex: 1,
    minWidth: 0,
    minHeight: MARKET_METRIC_HEIGHT,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cardSoft,
    paddingHorizontal: 8,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  metricIconWrap: {
    width: 29,
    height: 29,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  metricTextBlock: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  metricLabel: {
    fontSize: 9,
    lineHeight: 11,
    color: colors.textMuted,
    fontWeight: '600',
  },
  metricValue: {
    fontSize: 13,
    lineHeight: 15,
    fontWeight: '800',
  },
  metricHelper: {
    fontSize: 8.5,
    lineHeight: 11,
    color: colors.textMuted,
    fontWeight: '500',
    marginTop: 1,
  },
});

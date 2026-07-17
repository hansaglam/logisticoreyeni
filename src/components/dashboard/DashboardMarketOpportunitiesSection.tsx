import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { colors, formatMoney, radius, spacing, typography } from '../../theme';
import {
  formatMarketTradeOpportunityTitle,
  type MarketTradeOpportunity,
} from '../../utils/marketTradeOpportunities';

const TYPE_COLORS: Record<MarketTradeOpportunity['type'], string> = {
  buy: colors.success,
  sell: colors.accentAmber,
  watch: colors.info,
};

interface DashboardMarketOpportunitiesSectionProps {
  items: MarketTradeOpportunity[];
  onPressItem: (item: MarketTradeOpportunity) => void;
  onViewAll: () => void;
}

export default function DashboardMarketOpportunitiesSection({
  items,
  onPressItem,
  onViewAll,
}: DashboardMarketOpportunitiesSectionProps) {
  const preview = items.slice(0, 2);

  if (preview.length === 0) {
    return null;
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Text style={styles.sectionLabel}>PİYASA FIRSATLARI</Text>
        <TouchableOpacity activeOpacity={0.7} onPress={onViewAll}>
          <Text style={styles.viewAllText}>Piyasaya Git</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.list}>
        {preview.map((item) => {
          const accent = TYPE_COLORS[item.type];
          return (
            <TouchableOpacity
              key={item.id}
              activeOpacity={0.85}
              onPress={() => onPressItem(item)}
            >
              <View style={styles.card}>
                <View style={styles.cardTop}>
                  <Text style={[styles.typeLabel, { color: accent }]} numberOfLines={1}>
                    {item.label}
                  </Text>
                  {item.netProfit != null ? (
                    <Text
                      style={[
                        styles.profit,
                        { color: item.netProfit >= 0 ? colors.success : colors.danger },
                      ]}
                      numberOfLines={1}
                    >
                      {item.netProfit >= 0 ? '+' : ''}
                      {formatMoney(item.netProfit)}
                    </Text>
                  ) : null}
                </View>
                <Text style={styles.title} numberOfLines={1}>
                  {formatMarketTradeOpportunityTitle(item)}
                </Text>
                <Text style={styles.description} numberOfLines={2}>
                  {item.description}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionLabel: {
    ...typography.caption,
    fontWeight: '800',
    color: colors.textMuted,
    letterSpacing: 0.6,
    fontSize: 10,
  },
  viewAllText: {
    ...typography.caption,
    fontSize: 10.5,
    fontWeight: '700',
    color: colors.accentBlue,
  },
  list: {
    gap: spacing.sm,
  },
  card: {
    padding: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.14)',
    gap: 3,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  typeLabel: {
    ...typography.caption,
    fontWeight: '800',
    fontSize: 10,
  },
  title: {
    ...typography.bodySmall,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  description: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 10,
  },
  profit: {
    ...typography.caption,
    fontWeight: '800',
  },
});

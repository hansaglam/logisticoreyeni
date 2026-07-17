import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { getCityName, getProductName } from '../../utils/entityLookup';
import type { DashboardOpportunityItem } from '../../utils/dashboardOpportunities';
import { colors, formatMoney, radius, spacing, typography } from '../../theme';

function formatDuration(hours: number): string {
  const totalHours = Math.max(0, Math.round(hours));
  const days = Math.floor(totalHours / 24);
  const remainingHours = totalHours % 24;
  if (days > 0) return `${days}g ${remainingHours}s`;
  return `${remainingHours}s`;
}

function OpportunityBadge({
  label,
  textColor,
  backgroundColor,
  borderColor,
}: {
  label: string;
  textColor: string;
  backgroundColor: string;
  borderColor: string;
}) {
  return (
    <View style={[styles.badge, { backgroundColor, borderColor }]}>
      <Text style={[styles.badgeText, { color: textColor }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

interface DashboardOpportunitiesSectionProps {
  items: DashboardOpportunityItem[];
  onPressItem: (item: DashboardOpportunityItem) => void;
  onViewAll: () => void;
}

export default function DashboardOpportunitiesSection({
  items,
  onPressItem,
  onViewAll,
}: DashboardOpportunitiesSectionProps) {
  const preview = items.slice(0, 2);

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Text style={styles.sectionLabel}>FIRSATLAR</Text>
        <TouchableOpacity activeOpacity={0.7} onPress={onViewAll}>
          <Text style={styles.viewAllText}>Tümünü Gör</Text>
        </TouchableOpacity>
      </View>
      {preview.length > 0 ? (
        <View style={styles.list}>
          {preview.map((item) => {
            const { contract, badges, estimatedProfit } = item;
            const profitColor = estimatedProfit >= 0 ? colors.success : colors.danger;
            const visibleBadges = badges.slice(0, 2);

            return (
              <TouchableOpacity
                key={contract.id}
                activeOpacity={0.85}
                onPress={() => onPressItem(item)}
              >
                <View style={styles.card}>
                  <View style={styles.cardTop}>
                    <Text style={styles.route} numberOfLines={1}>
                      {getCityName(contract.originCityId)} → {getCityName(contract.destinationCityId)}
                    </Text>
                    <Text style={styles.payment} numberOfLines={1}>
                      {formatMoney(contract.payment)}
                    </Text>
                  </View>
                  <Text style={styles.meta} numberOfLines={1}>
                    {getProductName(contract.productId)} · {(contract.cargoWeight ?? contract.amount ?? 0).toFixed(1)} t ·{' '}
                    {formatDuration(contract.deadlineHours)}
                  </Text>
                  <View style={styles.cardBottom}>
                    {visibleBadges.length > 0 ? (
                      <View style={styles.badgeRow}>
                        {visibleBadges.map((badge) => (
                          <OpportunityBadge
                            key={badge.key}
                            label={badge.label}
                            textColor={badge.textColor}
                            backgroundColor={badge.backgroundColor}
                            borderColor={badge.borderColor}
                          />
                        ))}
                      </View>
                    ) : (
                      <View />
                    )}
                    <Text style={[styles.profit, { color: profitColor }]} numberOfLines={1}>
                      +{formatMoney(estimatedProfit)}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Şu an uygun fırsat yok.</Text>
        </View>
      )}
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
  list: {
    gap: spacing.sm,
  },
  card: {
    padding: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.14)',
    gap: 4,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  route: {
    ...typography.bodySmall,
    fontWeight: '800',
    flex: 1,
    minWidth: 0,
  },
  payment: {
    ...typography.caption,
    fontWeight: '900',
    color: colors.success,
  },
  meta: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 10,
  },
  cardBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
    gap: spacing.sm,
  },
  badgeRow: {
    flexDirection: 'row',
    flexShrink: 1,
    minWidth: 0,
    gap: 4,
  },
  badge: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    maxWidth: 130,
    flexShrink: 1,
  },
  badgeText: {
    ...typography.caption,
    fontSize: 9,
    fontWeight: '800',
  },
  profit: {
    ...typography.caption,
    fontWeight: '800',
  },
  empty: {
    paddingVertical: spacing.sm,
  },
  emptyText: {
    ...typography.caption,
    color: colors.textMuted,
  },
  viewAllText: {
    ...typography.caption,
    fontSize: 10.5,
    fontWeight: '700',
    color: colors.accentBlue,
  },
});

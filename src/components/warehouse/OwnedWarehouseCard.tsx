import React from 'react';
import {
  LayoutAnimation,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { GameIcon, ProgressBar, StatusBadge } from '../ui';
import { colors, formatMoney, typography } from '../../theme';
import type { OwnedWarehouseCardVm } from '../../utils/warehouseScreenViewModel';
import {
  getOccupancyBarColor,
  getStatusBadgeVariant,
  getTypeBadgeVariant,
} from './warehouseUiHelpers';
import { logWarehouseLayout } from './warehouseLayoutDebug';
import WarehouseStockRow from './WarehouseStockRow';
import { warehouseVisual } from './warehouseTheme';

interface OwnedWarehouseCardProps {
  card: OwnedWarehouseCardVm;
  expanded: boolean;
  onToggle: () => void;
  onManageStock: () => void;
  onTransfer: () => void;
  onUpgrade: () => void;
  onMore: () => void;
  onGoToMarket: () => void;
  onSellStock: (productId: string) => void;
  onTransferStock: (productId: string) => void;
  measureLayout?: boolean;
}

export default function OwnedWarehouseCard({
  card,
  expanded,
  onToggle,
  onManageStock,
  onTransfer,
  onUpgrade: _onUpgrade,
  onMore,
  onGoToMarket,
  onSellStock,
  onTransferStock,
  measureLayout = false,
}: OwnedWarehouseCardProps) {
  const barColor = getOccupancyBarColor(card.occupancyPercent);
  const typeVariant = getTypeBadgeVariant(card.type);
  const statusVariant = getStatusBadgeVariant(card.status);
  const accent = card.type === 'cold' ? warehouseVisual.accentPurple : warehouseVisual.accentBlue;
  const isEmpty = card.stocks.length === 0;

  const handleToggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    onToggle();
  };

  return (
    <View
      onLayout={
        measureLayout && !expanded
          ? (event) => {
              logWarehouseLayout({
                firstWarehouseCardHeight: Math.round(event.nativeEvent.layout.height),
              });
            }
          : undefined
      }
    >
      <View style={[styles.card, { borderLeftColor: accent }]}>
        <Pressable
          onPress={handleToggle}
          accessibilityRole="button"
          accessibilityLabel={`${card.cityName} deposunu ${expanded ? 'daralt' : 'genişlet'}`}
          style={styles.header}
        >
          <View style={[styles.iconWrap, { backgroundColor: `${accent}28` }]}>
            <GameIcon name="warehouse" size={16} color={accent} />
          </View>
          <View style={styles.headerMain}>
            <Text style={styles.title} numberOfLines={1}>
              {card.cityName}
            </Text>
            <View style={styles.badgeRow}>
              <StatusBadge
                label={card.type === 'cold' ? 'Soğuk' : 'Normal'}
                variant={typeVariant}
                size="sm"
              />
              <StatusBadge label={`Sv.${card.level}`} variant="amber" size="sm" />
              <StatusBadge label={card.statusLabel} variant={statusVariant} size="sm" />
            </View>
          </View>
          <GameIcon
            name={expanded ? 'chevronUp' : 'chevronDown'}
            size={16}
            color={colors.textMuted}
          />
        </Pressable>

        <View style={styles.metricsGrid}>
          <View style={styles.metricCell}>
            <Text style={styles.metricLabel}>Kapasite</Text>
            <Text style={styles.metricValue} numberOfLines={1}>
              {Math.round(card.usedTons)}/{Math.round(card.capacityTons)} t
            </Text>
          </View>
          <View style={styles.metricCell}>
            <Text style={styles.metricLabel}>Doluluk</Text>
            <Text style={[styles.metricValue, { color: barColor }]} numberOfLines={1}>
              %{Math.round(card.occupancyPercent)}
            </Text>
          </View>
          <View style={styles.metricCell}>
            <Text style={styles.metricLabel}>Gider</Text>
            <Text style={[styles.metricValue, { color: warehouseVisual.accentRed }]} numberOfLines={1}>
              {formatMoney(card.dailyCost)}
            </Text>
          </View>
          <View style={styles.metricCell}>
            <Text style={styles.metricLabel}>Stok</Text>
            <Text
              style={[styles.metricValue, { color: warehouseVisual.accentGreen }]}
              numberOfLines={1}
            >
              {formatMoney(card.inventoryValue)}
            </Text>
          </View>
        </View>

        <View style={styles.barWrap}>
          <ProgressBar
            progress={card.occupancyPercent / 100}
            color={barColor}
            height={5}
            trackColor="rgba(120,160,220,0.12)"
          />
        </View>

        {!expanded && isEmpty ? (
          <View style={styles.emptyHintRow}>
            <Text style={styles.emptyHint} numberOfLines={1}>
              Henüz stok yok · Piyasadan ürün al
            </Text>
            <Pressable onPress={onGoToMarket} hitSlop={8} accessibilityRole="button">
              <Text style={styles.marketLink}>Piyasa</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.actions}>
          <Pressable
            onPress={onManageStock}
            style={styles.primaryBtn}
            accessibilityRole="button"
            accessibilityLabel={`${card.cityName} deposunda stok yönet`}
          >
            <GameIcon name="inventory" size={14} color={colors.textPrimary} />
            <Text style={styles.primaryBtnText}>Stok</Text>
          </Pressable>
          <Pressable
            onPress={onTransfer}
            style={styles.transferBtn}
            accessibilityRole="button"
            accessibilityLabel={`${card.cityName} deposundan ürün taşı`}
          >
            <GameIcon name="truck" size={14} color={colors.textPrimary} />
            <Text style={styles.transferBtnText}>Taşı</Text>
          </Pressable>
          <Pressable
            onPress={onMore}
            style={styles.moreBtn}
            accessibilityRole="button"
            accessibilityLabel={`${card.cityName} deposu diğer işlemler`}
          >
            <GameIcon name="more" size={16} color={colors.textSecondary} />
          </Pressable>
        </View>

        {expanded ? (
          <View style={styles.expanded}>
            {card.upgradePreview.nextLevel != null && card.upgradePreview.upgradePrice != null ? (
              <View style={styles.upgradeBanner}>
                <GameIcon name="upgrade" size={12} color={warehouseVisual.accentAmber} />
                <Text style={styles.upgradeHint} numberOfLines={2}>
                  Sv.{card.upgradePreview.currentLevel} → {card.upgradePreview.nextLevel} ·{' '}
                  {Math.round(card.upgradePreview.currentCapacity)} →{' '}
                  {Math.round(card.upgradePreview.nextCapacity ?? 0)} t ·{' '}
                  {formatMoney(card.upgradePreview.upgradePrice)}
                </Text>
              </View>
            ) : null}

            {isEmpty ? (
              <View style={styles.emptyExpanded}>
                <Text style={styles.emptyExpandedText}>
                  Piyasadan ürün alarak stok oluştur.
                </Text>
                {card.type === 'cold' ? (
                  <Text style={styles.coldHint}>Soğuk zincir ürünleri burada saklanır.</Text>
                ) : null}
                <Pressable onPress={onGoToMarket} hitSlop={8}>
                  <Text style={styles.marketLink}>Piyasaya Git →</Text>
                </Pressable>
              </View>
            ) : (
              card.stocks.map((stock) => (
                <WarehouseStockRow
                  key={stock.productId}
                  stock={stock}
                  cityName={card.cityName}
                  onSell={() => onSellStock(stock.productId)}
                  onTransfer={() => onTransferStock(stock.productId)}
                />
              ))
            )}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    marginBottom: 10,
    overflow: 'hidden',
    paddingBottom: 10,
    backgroundColor: warehouseVisual.surfaceElevated,
    borderWidth: 1,
    borderColor: warehouseVisual.border,
    borderLeftWidth: 3,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 6,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerMain: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  title: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: '800',
    fontSize: 15,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  metricsGrid: {
    flexDirection: 'row',
    paddingHorizontal: 10,
    gap: 4,
  },
  metricCell: {
    flex: 1,
    minWidth: 0,
    backgroundColor: 'rgba(4, 10, 20, 0.45)',
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 6,
  },
  metricLabel: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  metricValue: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '800',
    fontSize: 11,
  },
  barWrap: {
    paddingHorizontal: 12,
    marginTop: 8,
    marginBottom: 6,
  },
  emptyHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    marginBottom: 4,
    gap: 8,
  },
  emptyHint: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 11,
    flex: 1,
  },
  marketLink: {
    ...typography.caption,
    color: warehouseVisual.accentBlue,
    fontWeight: '700',
    fontSize: 11,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
  },
  primaryBtn: {
    flex: 1,
    minHeight: 40,
    borderRadius: 12,
    backgroundColor: warehouseVisual.accentBlue,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  primaryBtnText: {
    color: colors.textPrimary,
    fontWeight: '800',
    fontSize: 13,
  },
  transferBtn: {
    flex: 1,
    minHeight: 40,
    borderRadius: 12,
    backgroundColor: warehouseVisual.accentAmber,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  transferBtnText: {
    color: '#1A1200',
    fontWeight: '800',
    fontSize: 13,
  },
  moreBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: warehouseVisual.border,
    backgroundColor: 'rgba(4, 10, 20, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  expanded: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingTop: 4,
  },
  upgradeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: warehouseVisual.softAmber,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginTop: 4,
    marginBottom: 4,
  },
  upgradeHint: {
    ...typography.caption,
    color: warehouseVisual.accentAmber,
    fontSize: 11,
    flex: 1,
    fontWeight: '600',
  },
  emptyExpanded: {
    paddingVertical: 8,
    gap: 4,
  },
  emptyExpandedText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    fontSize: 12,
  },
  coldHint: {
    ...typography.caption,
    color: warehouseVisual.accentPurple,
    fontWeight: '600',
  },
});

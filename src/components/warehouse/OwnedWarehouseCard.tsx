import React from 'react';
import {
  LayoutAnimation,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { GameIcon } from '../ui';
import { colors, formatMoney, typography } from '../../theme';
import type { OwnedWarehouseCardVm } from '../../utils/warehouseScreenViewModel';
import { getOccupancyBarColor } from './warehouseUiHelpers';
import { logWarehouseLayout } from './warehouseLayoutDebug';
import WarehouseStockRow from './WarehouseStockRow';
import { warehouseLayout, warehouseVisual } from './warehouseTheme';

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
  onUpgrade,
  onMore,
  onGoToMarket,
  onSellStock,
  onTransferStock,
  measureLayout = false,
}: OwnedWarehouseCardProps) {
  const barColor = getOccupancyBarColor(card.occupancyPercent);
  const accent = card.type === 'cold' ? warehouseVisual.accentPurple : warehouseVisual.accentBlue;
  const isEmpty = card.stocks.length === 0;
  const canUpgrade =
    card.upgradePreview.nextLevel != null && card.upgradePreview.upgradePrice != null;
  const atMaxLevel = !canUpgrade && card.upgradeHelperText != null;

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
      <View style={styles.card}>
        <Pressable
          onPress={handleToggle}
          accessibilityRole="button"
          accessibilityLabel={`${card.cityName} deposunu ${expanded ? 'daralt' : 'genişlet'}`}
          style={styles.header}
        >
          <View style={[styles.iconWrap, { backgroundColor: `${accent}22` }]}>
            <GameIcon name="warehouse" size={18} color={accent} />
          </View>
          <View style={styles.headerMain}>
            <Text style={styles.title} numberOfLines={1}>
              {card.cityName}
            </Text>
            <Text style={styles.subtitle} numberOfLines={1}>
              {card.typeLabel} · Sv.{card.level}
            </Text>
          </View>
          <GameIcon name="chevronRight" size={14} color={colors.textMuted} />
        </Pressable>

        <View style={styles.metricsRow}>
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
            <Text
              style={[styles.metricValue, { color: warehouseVisual.accentAmber }]}
              numberOfLines={1}
            >
              {formatMoney(card.dailyCost)}
            </Text>
          </View>
        </View>

        <View style={styles.stockRow}>
          <Text style={styles.stockLabel}>Stok değeri</Text>
          <Text
            style={[styles.stockValue, { color: warehouseVisual.accentGreen }]}
            numberOfLines={1}
          >
            {formatMoney(card.inventoryValue)}
          </Text>
        </View>

        {!expanded && isEmpty ? (
          <View style={styles.emptyHint}>
            <Text style={styles.emptyTitle}>Stok yok</Text>
            <Text style={styles.emptyText} numberOfLines={2}>
              Piyasadan ürün alarak depoyu kullanmaya başla.
            </Text>
            <Pressable
              onPress={onGoToMarket}
              style={styles.marketBtn}
              accessibilityRole="button"
              accessibilityLabel="Piyasaya git"
            >
              <Text style={styles.marketBtnText}>Piyasaya Git</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.actions}>
          <Pressable
            onPress={onManageStock}
            style={styles.primaryBtn}
            accessibilityRole="button"
            accessibilityLabel={`${card.cityName} stoklarını gör`}
          >
            <Text style={styles.primaryBtnText}>Stokları Gör</Text>
          </Pressable>
          <Pressable
            onPress={onTransfer}
            style={styles.secondaryBtn}
            accessibilityRole="button"
            accessibilityLabel={`${card.cityName} deposundan transfer`}
          >
            <Text style={styles.secondaryBtnText}>Transfer</Text>
          </Pressable>
          <Pressable
            onPress={onMore}
            style={styles.moreBtn}
            accessibilityRole="button"
            accessibilityLabel={`${card.cityName} diğer işlemler`}
          >
            <GameIcon name="more" size={16} color={colors.textMuted} />
          </Pressable>
        </View>

        {canUpgrade ? (
          <Pressable
            onPress={onUpgrade}
            disabled={card.upgradeDisabled}
            style={[styles.upgradeBtn, card.upgradeDisabled && styles.upgradeBtnDisabled]}
            accessibilityRole="button"
            accessibilityLabel={`${card.cityName} deposunu yükselt`}
          >
            <Text style={styles.upgradeText}>
              Sv.{card.upgradePreview.currentLevel} → Sv.{card.upgradePreview.nextLevel} · Yükselt
              {card.upgradePreview.upgradePrice != null
                ? ` · ${formatMoney(card.upgradePreview.upgradePrice)}`
                : ''}
            </Text>
            {card.upgradeDisabled && card.upgradeHelperText ? (
              <Text style={styles.upgradeHint} numberOfLines={1}>
                {card.upgradeHelperText}
              </Text>
            ) : null}
          </Pressable>
        ) : atMaxLevel ? (
          <Text style={styles.maxLevel}>Maksimum Seviye</Text>
        ) : null}

        {expanded ? (
          <View style={styles.expanded}>
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
    borderRadius: 14,
    marginBottom: warehouseLayout.cardGap,
    padding: warehouseLayout.cardPadding,
    gap: warehouseLayout.internalGap,
    backgroundColor: warehouseVisual.surfaceElevated,
    borderWidth: 1,
    borderColor: warehouseVisual.border,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: warehouseLayout.internalGap,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerMain: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '500',
  },
  metricsRow: {
    flexDirection: 'row',
    gap: warehouseLayout.smallGap,
  },
  metricCell: {
    flex: 1,
    minWidth: 0,
    backgroundColor: warehouseVisual.statTint,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 8,
    gap: 2,
  },
  metricLabel: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '600',
  },
  metricValue: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  stockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    gap: 8,
  },
  stockLabel: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  stockValue: {
    fontSize: 15,
    fontWeight: '800',
  },
  emptyHint: {
    backgroundColor: warehouseVisual.statTint,
    borderRadius: 10,
    padding: 10,
    gap: 4,
  },
  emptyTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  emptyText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 14,
  },
  marketBtn: {
    alignSelf: 'flex-start',
    marginTop: 2,
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: colors.accentBlueSoft,
  },
  marketBtnText: {
    ...typography.caption,
    color: colors.accentBlue,
    fontWeight: '700',
    fontSize: 11,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: warehouseLayout.internalGap,
  },
  primaryBtn: {
    flex: 1,
    minHeight: 44,
    minWidth: 0,
    borderRadius: 12,
    backgroundColor: warehouseVisual.accentBlue,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  primaryBtnText: {
    color: colors.textPrimary,
    fontWeight: '800',
    fontSize: 13,
  },
  secondaryBtn: {
    flex: 1,
    minHeight: 44,
    minWidth: 0,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: warehouseVisual.borderStrong,
    backgroundColor: 'rgba(4, 10, 20, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  secondaryBtnText: {
    color: colors.textPrimary,
    fontWeight: '700',
    fontSize: 13,
  },
  moreBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  upgradeBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    paddingVertical: 4,
    gap: 2,
  },
  upgradeBtnDisabled: {
    opacity: 0.55,
  },
  upgradeText: {
    ...typography.caption,
    color: warehouseVisual.accentAmber,
    fontWeight: '700',
    fontSize: 11,
    textAlign: 'center',
  },
  upgradeHint: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 10,
    textAlign: 'center',
  },
  maxLevel: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'center',
  },
  expanded: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingTop: warehouseLayout.internalGap,
    gap: 4,
  },
  emptyExpanded: {
    paddingVertical: 4,
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
  marketLink: {
    ...typography.caption,
    color: warehouseVisual.accentBlue,
    fontWeight: '700',
    fontSize: 11,
  },
});

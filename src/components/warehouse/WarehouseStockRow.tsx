import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ProductIcon, StatusBadge } from '../ui';
import { colors, formatMoney, typography } from '../../theme';
import type { WarehouseStockRowVm } from '../../utils/warehouseScreenViewModel';
import { getStockProfitTone } from '../../utils/warehouseScreenViewModel';
import { warehouseVisual } from './warehouseTheme';

interface WarehouseStockRowProps {
  stock: WarehouseStockRowVm;
  cityName: string;
  onSell: () => void;
  onTransfer: () => void;
}

export default function WarehouseStockRow({
  stock,
  cityName,
  onSell,
  onTransfer,
}: WarehouseStockRowProps) {
  const tone = getStockProfitTone(stock.unrealizedProfit);
  const profitColor =
    tone === 'profit'
      ? warehouseVisual.accentGreen
      : tone === 'loss'
        ? warehouseVisual.accentRed
        : colors.textMuted;
  const profitBadge =
    tone === 'profit' ? 'Kâr' : tone === 'loss' ? 'Zarar' : 'Nötr';
  const profitSign = stock.unrealizedProfit > 0 ? '+' : '';

  return (
    <View style={styles.row}>
      <View style={styles.top}>
        <View style={styles.iconWrap}>
          <ProductIcon productId={stock.productId} size={20} color={colors.info} />
        </View>
        <View style={styles.main}>
          <View style={styles.titleRow}>
            <Text style={styles.name} numberOfLines={1}>
              {stock.productName}
            </Text>
            {stock.needsCold ? (
              <StatusBadge label="Soğuk" variant="info" size="sm" />
            ) : null}
            <Text style={styles.qty}>{Math.round(stock.quantityTons)} t</Text>
          </View>
          <Text style={styles.meta} numberOfLines={1}>
            Alış {formatMoney(stock.averageBuyPrice)} · {cityName}{' '}
            {formatMoney(stock.currentPrice)}
          </Text>
          <View style={styles.profitRow}>
            <StatusBadge
              label={profitBadge}
              variant={tone === 'profit' ? 'success' : tone === 'loss' ? 'danger' : 'muted'}
              size="sm"
            />
            <Text style={[styles.profit, { color: profitColor }]} numberOfLines={1}>
              {profitSign}
              {formatMoney(stock.unrealizedProfit)}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.actions}>
        <Pressable
          onPress={onSell}
          style={styles.sellBtn}
          accessibilityRole="button"
          accessibilityLabel={`${stock.productName} stokunu sat`}
        >
          <Text style={styles.sellText}>Sat</Text>
        </Pressable>
        <Pressable
          onPress={onTransfer}
          style={styles.transferBtn}
          accessibilityRole="button"
          accessibilityLabel={`${stock.productName} stokunu taşı`}
        >
          <Text style={styles.transferText}>Taşı</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingVertical: 10,
    gap: 8,
  },
  top: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: colors.infoSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  main: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  name: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: '700',
    flex: 1,
    fontSize: 13,
  },
  qty: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    fontWeight: '700',
    fontSize: 12,
  },
  meta: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 11,
  },
  profitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  profit: {
    ...typography.bodySmall,
    fontWeight: '800',
    fontSize: 12,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  sellBtn: {
    flex: 1,
    minHeight: 40,
    borderRadius: 12,
    backgroundColor: warehouseVisual.accentBlue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sellText: {
    color: colors.textPrimary,
    fontWeight: '800',
    fontSize: 13,
  },
  transferBtn: {
    flex: 1,
    minHeight: 40,
    borderRadius: 12,
    backgroundColor: warehouseVisual.accentAmber,
    alignItems: 'center',
    justifyContent: 'center',
  },
  transferText: {
    color: '#1A1200',
    fontWeight: '800',
    fontSize: 13,
  },
});

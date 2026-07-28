import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GameIcon, ProductIcon, StatusBadge } from '../ui';
import { colors, formatMoney, typography } from '../../theme';
import type { WarehouseTransferCardVm } from '../../utils/warehouseScreenViewModel';
import MiniProgressRing from './MiniProgressRing';
import { warehouseVisual } from './warehouseTheme';

interface WarehouseTransferCardProps {
  item: WarehouseTransferCardVm;
  onDetail?: () => void;
}

export default function WarehouseTransferCard({ item, onDetail }: WarehouseTransferCardProps) {
  const progressColor = item.needsCold
    ? warehouseVisual.accentPurple
    : item.transfer.status === 'failed'
      ? warehouseVisual.accentRed
      : warehouseVisual.accentGreen;
  const profit =
    item.projectedNetProfit != null && Number.isFinite(item.projectedNetProfit)
      ? item.projectedNetProfit
      : null;

  return (
    <View style={[styles.card, { borderLeftColor: progressColor }]}>
      <View style={styles.header}>
        <View style={styles.iconWrap}>
          <ProductIcon productId={item.transfer.productId} size={20} color={colors.info} />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.route} numberOfLines={1}>
            {item.sourceCityName} → {item.destinationCityName}
          </Text>
          <Text style={styles.product} numberOfLines={1}>
            {item.productName} · {Math.round(item.transfer.quantityTons)} t
          </Text>
        </View>
        <MiniProgressRing
          progress={item.progressPercent / 100}
          size={42}
          strokeWidth={4}
          color={progressColor}
          label={`%${item.progressPercent}`}
        />
      </View>

      <View style={styles.metaRow}>
        <GameIcon name="truck" size={12} color={colors.textMuted} />
        <Text style={styles.meta} numberOfLines={1}>
          {item.truckName} · {item.trailerLabel}
        </Text>
      </View>
      <View style={styles.metaRow}>
        <GameIcon name="driver" size={12} color={colors.textMuted} />
        <Text style={styles.meta} numberOfLines={1}>
          {item.driverName} · {item.remainingKm} km kaldı
        </Text>
        {item.needsCold ? (
          <StatusBadge label="Soğuk Zincir" variant="info" size="sm" />
        ) : null}
      </View>

      {profit != null ? (
        <Text
          style={[
            styles.profit,
            {
              color:
                profit >= 0 ? warehouseVisual.accentGreen : warehouseVisual.accentRed,
            },
          ]}
          numberOfLines={1}
        >
          Tahmini net kâr: {profit >= 0 ? '+' : ''}
          {formatMoney(profit)}
        </Text>
      ) : (
        <Text style={styles.noProfit}>Piyasa tahmini oluşturulamadı.</Text>
      )}

      {onDetail ? (
        <Pressable
          onPress={onDetail}
          style={styles.detailBtn}
          accessibilityRole="button"
          accessibilityLabel={`${item.productName} transfer detayı`}
        >
          <Text style={styles.detailText}>Detay</Text>
          <GameIcon name="chevronRight" size={14} color={warehouseVisual.accentBlue} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    padding: 12,
    marginBottom: 8,
    gap: 4,
    backgroundColor: warehouseVisual.surfaceElevated,
    borderWidth: 1,
    borderColor: warehouseVisual.border,
    borderLeftWidth: 3,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: colors.infoSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  route: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: '800',
    fontSize: 14,
  },
  product: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    fontSize: 12,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  meta: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 11,
    flex: 1,
  },
  profit: {
    ...typography.bodySmall,
    fontWeight: '700',
    marginTop: 4,
    fontSize: 12,
  },
  noProfit: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 4,
    fontStyle: 'italic',
  },
  detailBtn: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    minHeight: 32,
  },
  detailText: {
    ...typography.caption,
    color: warehouseVisual.accentBlue,
    fontWeight: '700',
  },
});

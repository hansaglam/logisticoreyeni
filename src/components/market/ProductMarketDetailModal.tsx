import React, { useEffect, useMemo } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { getBottomInset } from '../../constants/layout';
import { useGameStore } from '../../store/gameStore';
import { colors, formatMoney, spacing, typography } from '../../theme';
import type { ProductId } from '../../types/game';
import {
  buildTradeProfitBreakdown,
  getTradeFeeSummaryLabel,
  getWarehouseFreeCapacityTon,
  normalizeWarehouse,
} from '../../simulation/trading';
import { buildMarketProductViewModel, getProductMarket } from '../../utils/marketProductViewModel';
import { getMarketStatusColorVariant } from '../../utils/marketStatusLabels';
import { useAppSafeAreaInsets } from '../AppSafeAreaProvider';
import { ActionButton, IconButton, ProductIcon, StatusBadge } from '../ui';
import ProductDetailTrendChart from './ProductDetailTrendChart';

const OVERLAY_OPACITY = 0.52;
const SHEET_RADIUS = 24;

export interface ProductMarketDetailModalProps {
  visible: boolean;
  cityId: string | null;
  productId: ProductId | null;
  onClose: () => void;
  onBuy: (productId: ProductId) => void;
  onSell: (productId: ProductId) => void;
  onCreateAlert: (productId: ProductId) => void;
}

export default function ProductMarketDetailModal({
  visible,
  cityId,
  productId,
  onClose,
  onBuy,
  onSell,
  onCreateAlert,
}: ProductMarketDetailModalProps) {
  const insets = useAppSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();

  const player = useGameStore((state) => state.player);
  const cities = useGameStore((state) => state.cities) ?? [];
  const products = useGameStore((state) => state.products) ?? [];
  const currentTime = useGameStore((state) => state.currentTime);

  const city = useMemo(
    () => (cityId ? cities.find((item) => item.id === cityId) ?? null : null),
    [cities, cityId],
  );

  const cityWarehouses = useMemo(() => {
    if (!city) return [];
    return (player?.warehouses ?? [])
      .filter((item) => item.cityId === city.id)
      .map((item) => normalizeWarehouse(item));
  }, [player?.warehouses, city]);

  const totalFreeCapacity = useMemo(
    () => cityWarehouses.reduce((sum, warehouse) => sum + getWarehouseFreeCapacityTon(warehouse), 0),
    [cityWarehouses],
  );

  const viewModel = useMemo(() => {
    if (!cityId || !productId) return null;
    return buildMarketProductViewModel({
      city,
      productId,
      currentTime,
      warehouses: cityWarehouses,
      totalFreeCapacity,
      playerMoney: player?.money ?? 0,
      products,
    });
  }, [
    city,
    cityId,
    productId,
    currentTime,
    cityWarehouses,
    totalFreeCapacity,
    player?.money,
    products,
  ]);

  useEffect(() => {
    if (!visible || !cityId || !productId) return;
    if (!city || !getProductMarket(city, productId)) {
      console.warn(
        `[ProductMarketDetailModal] Ürün veya şehir bulunamadı: city=${cityId}, product=${productId}`,
      );
      onClose();
    }
  }, [visible, cityId, productId, city, onClose]);

  if (!visible || !viewModel || !productId) {
    return null;
  }

  const sheetMaxHeight = Math.min(windowHeight * 0.8, 640);
  const profitColor =
    viewModel.profitLoss != null && viewModel.profitLoss >= 0
      ? colors.success
      : colors.danger;

  const profitBreakdown =
    viewModel.warehouseQuantity > 0
      ? buildTradeProfitBreakdown(
          viewModel.currentPrice,
          viewModel.averageBuyPrice,
          viewModel.warehouseQuantity,
        )
      : null;

  const handleBuy = () => {
    onClose();
    onBuy(productId);
  };

  const handleSell = () => {
    onClose();
    onSell(productId);
  };

  const handleAlert = () => {
    onClose();
    onCreateAlert(productId);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View
          style={[
            styles.sheet,
            {
              maxHeight: sheetMaxHeight,
              paddingBottom: getBottomInset(insets) + spacing.md,
            },
          ]}
        >
          <View style={styles.sheetHandle} />

          <View style={styles.headerRow}>
            <View style={styles.headerMain}>
              <View style={styles.titleRow}>
                <ProductIcon productId={productId} size={18} color={colors.info} />
                <Text style={styles.title} numberOfLines={1}>
                  {viewModel.productName} Piyasası
                </Text>
              </View>
              <Text style={styles.subtitle} numberOfLines={1}>
                {viewModel.cityName} · son fiyat hareketi
              </Text>
            </View>
            <IconButton icon="close" onPress={onClose} size={18} color={colors.textMuted} />
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            <View style={styles.priceSection}>
              <Text style={styles.bigPrice}>{formatMoney(viewModel.currentPrice)}</Text>
              <Text style={styles.priceUnit}>/ ton</Text>
            </View>

            <Text
              style={[styles.trendLine, { color: viewModel.trendColor }]}
              numberOfLines={1}
            >
              {viewModel.trendChangeLabel}
            </Text>

            <View style={styles.statusRow}>
              <StatusBadge
                label={viewModel.stockStatusLabel}
                variant={getMarketStatusColorVariant(viewModel.stockStatus)}
                size="sm"
              />
            </View>

            <ProductDetailTrendChart trend={viewModel.trend} />

            <View style={styles.commentaryCard}>
              <Text style={styles.infoTitle}>Piyasa Durumu</Text>
              <Text style={styles.commentaryText}>{viewModel.stockStatusDescription}</Text>
            </View>

            <View style={styles.infoCard}>
              <Text style={styles.infoTitle}>Depo Durumu</Text>
              {!viewModel.hasWarehouse ? (
                <Text style={styles.infoMuted}>Bu şehirde depo yok</Text>
              ) : viewModel.warehouseQuantity <= 0 ? (
                <Text style={styles.infoMuted}>Depoda stok yok</Text>
              ) : (
                <>
                  <Text style={styles.infoLine}>
                    Depoda: {viewModel.warehouseQuantity.toFixed(1)} t
                  </Text>
                  <Text style={styles.infoLine}>
                    Ortalama maliyet: {formatMoney(viewModel.averageBuyPrice)} / ton
                  </Text>
                  <Text style={styles.infoLine}>
                    Güncel satış geliri: {formatMoney(profitBreakdown?.sellRevenueAfterFee ?? 0)}
                  </Text>
                  {profitBreakdown ? (
                    <Text style={styles.infoMuted}>
                      İşlem gideri: {formatMoney(profitBreakdown.totalFees)}
                    </Text>
                  ) : null}
                  <Text style={styles.infoLine}>
                    Güncel değer: {formatMoney(viewModel.currentValue)}
                  </Text>
                  {viewModel.profitLoss != null ? (
                    <Text style={[styles.infoLine, { color: profitColor, fontWeight: '700' }]}>
                      Net kâr:{' '}
                      {viewModel.profitLoss >= 0
                        ? `+${formatMoney(viewModel.profitLoss)}`
                        : formatMoney(viewModel.profitLoss)}
                    </Text>
                  ) : null}
                  <Text style={styles.infoMuted}>{getTradeFeeSummaryLabel()}</Text>
                  <Text style={styles.infoMuted}>
                    Ürünler yalnızca bulunduğu şehirdeki depodan satılabilir.
                  </Text>
                </>
              )}
            </View>

            <View style={styles.commentaryCard}>
              <Text style={styles.infoTitle}>Piyasa Yorumu</Text>
              <Text style={styles.commentaryText}>{viewModel.commentary}</Text>
            </View>
          </ScrollView>

          <View style={styles.actionsRow}>
            <ActionButton
              label={viewModel.buyButtonLabel}
              onPress={handleBuy}
              variant="primary"
              icon="cash"
              disabled={viewModel.buyButtonDisabled}
              style={styles.actionButton}
            />
            {viewModel.canSell ? (
              <ActionButton
                label="Sat"
                onPress={handleSell}
                variant="secondary"
                icon="market"
                style={styles.actionButton}
              />
            ) : null}
            <ActionButton
              label="Alarm Kur"
              onPress={handleAlert}
              variant="secondary"
              icon="notification"
              style={styles.actionButton}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: `rgba(2, 8, 23, ${OVERLAY_OPACITY})`,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: SHEET_RADIUS,
    borderTopRightRadius: SHEET_RADIUS,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    marginBottom: spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  headerMain: {
    flex: 1,
    minWidth: 0,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  title: {
    ...typography.cardTitle,
    fontSize: 17,
    fontWeight: '800',
    color: colors.textPrimary,
    flex: 1,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    paddingBottom: spacing.sm,
  },
  priceSection: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
    marginBottom: 4,
  },
  bigPrice: {
    fontSize: 32,
    fontWeight: '800',
    color: colors.accentAmber,
    letterSpacing: -0.5,
  },
  priceUnit: {
    ...typography.bodySmall,
    color: colors.textMuted,
    fontWeight: '600',
  },
  trendLine: {
    ...typography.bodySmall,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  statusRow: {
    flexDirection: 'row',
    marginBottom: spacing.sm,
  },
  infoCard: {
    backgroundColor: colors.cardSoft,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    gap: 4,
  },
  commentaryCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    marginBottom: spacing.xs,
  },
  infoTitle: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '700',
    marginBottom: 4,
  },
  infoLine: {
    ...typography.bodySmall,
    color: colors.textPrimary,
  },
  infoMuted: {
    ...typography.bodySmall,
    color: colors.textMuted,
  },
  commentaryText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  actionButton: {
    flex: 1,
    minWidth: 0,
  },
});

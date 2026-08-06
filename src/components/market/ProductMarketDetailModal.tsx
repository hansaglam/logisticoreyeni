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

import { getBottomInset, getSafeModalMaxHeight } from '../../constants/layout';
import { useGameStore } from '../../store/gameStore';
import { colors, formatMoney, spacing, typography } from '../../theme';
import type { ProductId } from '../../types/game';
import {
  getTradeFeeSummaryLabel,
  getWarehouseFreeCapacityTon,
  normalizeWarehouse,
} from '../../simulation/trading';
import { buildMarketProductViewModel, getProductMarket } from '../../utils/marketProductViewModel';
import { getMarketStatusColorVariant } from '../../utils/marketStatusLabels';
import { resolveInventoryTradeProfit } from '../../utils/tradeDisplay';
import { useAppSafeAreaInsets } from '../AppSafeAreaProvider';
import AdRewardButton from '../monetization/AdRewardButton';
import { ActionButton, IconButton, ProductIcon, StatusBadge } from '../ui';
import ProductDetailTrendChart from './ProductDetailTrendChart';
import {
  formatMarketAnalysisUnlockLabel,
  getActiveMarketAnalysisUnlock,
} from '../../simulation/adRewardGrants';
import { buildDetailedMarketTrendCommentary } from '../../utils/detailedMarketAnalysis';

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

  const playerMoney = useGameStore((state) => state.player?.money ?? 0);
  const playerWarehouses = useGameStore((state) => state.player?.warehouses ?? []);
  const cities = useGameStore((state) => state.cities) ?? [];
  const products = useGameStore((state) => state.products) ?? [];
  const currentTime = useGameStore((state) => state.currentTime);
  const worldEvents = useGameStore((state) => state.worldEvents) ?? [];
  const getActiveWorldEventsValue = useGameStore((state) => state.getActiveWorldEventsValue);
  const monetization = useGameStore((state) => state.monetization);
  const activeWorldEvents = useMemo(
    () => getActiveWorldEventsValue(),
    [getActiveWorldEventsValue, worldEvents, currentTime],
  );

  const city = useMemo(
    () => (cityId ? cities.find((item) => item.id === cityId) ?? null : null),
    [cities, cityId],
  );

  const cityWarehouses = useMemo(() => {
    if (!visible || !city) return [];
    return playerWarehouses
      .filter((item) => item.cityId === city.id)
      .map((item) => normalizeWarehouse(item));
  }, [visible, playerWarehouses, city]);

  const totalFreeCapacity = useMemo(
    () => cityWarehouses.reduce((sum, warehouse) => sum + getWarehouseFreeCapacityTon(warehouse), 0),
    [cityWarehouses],
  );

  const viewModel = useMemo(() => {
    if (!visible || !cityId || !productId) return null;
    return buildMarketProductViewModel({
      city,
      productId,
      currentTime,
      warehouses: cityWarehouses,
      totalFreeCapacity,
      playerMoney,
      products,
      activeWorldEvents,
    });
  }, [
    visible,
    city,
    cityId,
    productId,
    currentTime,
    cityWarehouses,
    totalFreeCapacity,
    playerMoney,
    products,
    activeWorldEvents,
  ]);

  const marketAnalysisUnlock = useMemo(() => {
    if (!productId) return null;
    return getActiveMarketAnalysisUnlock(monetization, productId, currentTime);
  }, [monetization, productId, currentTime]);

  const detailedTrendCommentary = useMemo(() => {
    if (!viewModel) return '';
    return buildDetailedMarketTrendCommentary({
      productName: viewModel.productName,
      cityName: viewModel.cityName,
      trendDirection: viewModel.trendDirection,
      trendChangeLabel: viewModel.trendChangeLabel,
      stockStatusLabel: viewModel.stockStatusLabel,
      stockStatusDescription: viewModel.stockStatusDescription,
      eventLabel: viewModel.eventLabel,
      eventImpactLabel: viewModel.eventImpactLabel,
    });
  }, [viewModel]);

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

  const sheetMaxHeight = Math.min(getSafeModalMaxHeight(windowHeight, insets, 0.86), 640);
  const inventoryTrade =
    viewModel.warehouseQuantity > 0
      ? resolveInventoryTradeProfit(
          viewModel.displayPrice,
          viewModel.averageBuyPrice,
          viewModel.warehouseQuantity,
          viewModel.warehouseQuality,
        )
      : null;
  const profitDisplay = inventoryTrade?.display ?? null;
  const profitBreakdown = inventoryTrade?.breakdown ?? null;

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
              <Text style={styles.bigPrice}>{formatMoney(viewModel.displayPrice)}</Text>
              <Text style={styles.priceUnit}>/ ton</Text>
            </View>

            {viewModel.eventLabel ? (
              <View style={styles.eventCard}>
                <Text style={styles.eventTitle}>{viewModel.eventLabel}</Text>
                {viewModel.eventImpactLabel ? (
                  <Text style={styles.eventImpact}>
                    {viewModel.eventImpactLabel} fiyat etkisi
                  </Text>
                ) : null}
                {viewModel.eventDescription ? (
                  <Text style={styles.eventDescription}>{viewModel.eventDescription}</Text>
                ) : null}
              </View>
            ) : null}

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

            <View style={styles.detailedAnalysisCard}>
              <View style={styles.detailedAnalysisHeader}>
                <Text style={styles.infoTitle}>Detaylı 24s Trend Yorumu</Text>
                {marketAnalysisUnlock ? (
                  <StatusBadge
                    label={formatMarketAnalysisUnlockLabel(marketAnalysisUnlock, currentTime)}
                    variant="success"
                    size="sm"
                  />
                ) : null}
              </View>
              {marketAnalysisUnlock ? (
                <Text style={styles.commentaryText}>{detailedTrendCommentary}</Text>
              ) : (
                <>
                  <View style={styles.lockedOverlay}>
                    <Text style={styles.infoMuted}>
                      Reklam izleyerek 24 oyun saatliğine detaylı trend yorumunu aç.
                    </Text>
                  </View>
                  <AdRewardButton
                    slotId="market_analysis"
                    label="Reklam izle, 24 saatlik detaylı analiz aç"
                    context={{ selectedProductId: productId }}
                    variant="secondary"
                  />
                </>
              )}
            </View>

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
                  {profitDisplay ? (
                    <>
                      <Text
                        style={[styles.infoLine, { color: profitDisplay.color, fontWeight: '700' }]}
                      >
                        {profitDisplay.label}
                      </Text>
                      {profitDisplay.sublabel ? (
                        <Text style={styles.infoFeeHint}>{profitDisplay.sublabel}</Text>
                      ) : null}
                      {profitDisplay.feeNote ? (
                        <Text style={styles.infoFeeNote}>{profitDisplay.feeNote}</Text>
                      ) : null}
                    </>
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
            {viewModel.showSellButton ? (
              <ActionButton
                label={viewModel.sellButtonLabel}
                onPress={handleSell}
                variant="secondary"
                icon="market"
                disabled={viewModel.sellButtonDisabled}
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
  eventCard: {
    backgroundColor: colors.warningSoft,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.35)',
    padding: spacing.sm,
    marginBottom: spacing.sm,
    gap: 2,
  },
  eventTitle: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.accentAmber,
  },
  eventImpact: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  eventDescription: {
    ...typography.caption,
    color: colors.textSecondary,
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
  detailedAnalysisCard: {
    backgroundColor: colors.cardSoft,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.25)',
    padding: spacing.sm,
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  detailedAnalysisHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  lockedOverlay: {
    paddingVertical: 4,
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
  infoFeeHint: {
    ...typography.caption,
    color: colors.textMuted,
  },
  infoFeeNote: {
    ...typography.caption,
    color: colors.accentAmber,
    lineHeight: 18,
    marginTop: 2,
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

/**
 * LogistiCore - Ürün alım/satım modalı
 *
 * Bottom sheet tarzı popup — depo / piyasa ekranından kopmadan işlem.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';

import { tradingBalance } from '../config/balance';
import { getBottomInset } from '../constants/layout';
import {
  calculateTradeBuyCost,
  calculateTradeProfit,
  calculateTradeSellRevenue,
  getTradeQuantityPresets,
} from '../simulation/trading';
import {
  getRiskConfirmationMessage,
  getWarehouseTypeLabel,
  productNeedsColdStorage,
} from '../simulation/warehouseStorage';
import type { StorageSuitability } from '../simulation/warehouseStorage';
import { colors, spacing, typography } from '../theme';
import { useAppSafeAreaInsets } from './AppSafeAreaProvider';
import { IconButton, ProductIcon } from './ui';
import type { City, Product, WarehouseType } from '../types/game';

const OVERLAY_OPACITY = 0.52;
const SHEET_RADIUS = 22;
const SELL_SHEET_HEIGHT_RATIO = 0.68;
const BUY_SHEET_HEIGHT_RATIO = 0.78;

export type TradeProductModalMode = 'buy' | 'sell';

export interface TradeWarehouseOption {
  id: string;
  name: string;
  warehouseType: WarehouseType;
  freeCapacity: number;
  suitability: StorageSuitability;
  suitabilityLabel: string;
  warning?: string;
  disabled?: boolean;
}

export interface TradeProductModalProps {
  visible: boolean;
  mode: TradeProductModalMode;
  city: City | null;
  product: Product | null;
  currentPrice: number;
  availableStock: number;
  warehouseFreeCapacity?: number;
  cityWarehouses?: TradeWarehouseOption[];
  showColdWarehouseSuggestion?: boolean;
  inventoryQuantity?: number;
  averageBuyPrice?: number;
  inventoryQuality?: number;
  effectiveSellPrice?: number;
  playerCash?: number;
  onConfirm: (quantity: number, warehouseId?: string) => void;
  onClose: () => void;
  onOpenWarehouses?: () => void;
}

function formatMoney(value: number): string {
  const rounded = Math.round(Number.isFinite(value) ? value : 0);
  return `$${Math.abs(rounded)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

function formatTons(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return `${safe.toFixed(1)} ton`;
}

function getSuitabilityColor(suitability: StorageSuitability): string {
  switch (suitability) {
    case 'recommended':
      return colors.success;
    case 'usable':
    case 'risky':
      return colors.accentAmber;
    default:
      return colors.danger;
  }
}

function getWarehouseWarningText(warning: string | undefined, suitability: StorageSuitability): string | null {
  if (!warning) return null;
  if (suitability === 'risky' || suitability === 'usable') {
    return 'Bu ürün normal depoda değer kaybedebilir.';
  }
  return warning;
}

export default function TradeProductModal({
  visible,
  mode,
  city,
  product,
  currentPrice,
  availableStock,
  warehouseFreeCapacity = 0,
  cityWarehouses = [],
  showColdWarehouseSuggestion = false,
  inventoryQuantity = 0,
  averageBuyPrice = 0,
  inventoryQuality = 100,
  effectiveSellPrice,
  playerCash = 0,
  onConfirm,
  onClose,
  onOpenWarehouses,
}: TradeProductModalProps) {
  const insets = useAppSafeAreaInsets();
  const bottomInset = getBottomInset(insets);
  const { height: windowHeight } = useWindowDimensions();
  const [quantity, setQuantity] = useState<number>(tradingBalance.defaultTradeQuantity);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string | null>(null);

  const selectableWarehouses = useMemo(
    () => cityWarehouses.filter((warehouse) => !warehouse.disabled),
    [cityWarehouses],
  );

  const selectedWarehouse = useMemo(
    () => cityWarehouses.find((warehouse) => warehouse.id === selectedWarehouseId) ?? null,
    [cityWarehouses, selectedWarehouseId],
  );

  const selectedFreeCapacity = selectedWarehouse?.freeCapacity ?? warehouseFreeCapacity;

  const maxQuantity = useMemo(() => {
    if (mode === 'buy') {
      return Math.min(availableStock, selectedFreeCapacity, tradingBalance.maxTradeQuantity);
    }
    return Math.min(inventoryQuantity, tradingBalance.maxTradeQuantity);
  }, [mode, availableStock, selectedFreeCapacity, inventoryQuantity]);

  const presets = useMemo(() => getTradeQuantityPresets(maxQuantity), [maxQuantity]);

  useEffect(() => {
    if (!visible) return;
    const defaultQty = Math.min(
      mode === 'buy' ? tradingBalance.defaultTradeQuantity : inventoryQuantity,
      maxQuantity,
    );
    setQuantity(Math.max(tradingBalance.minTradeQuantity, defaultQty || tradingBalance.minTradeQuantity));
  }, [visible, mode, maxQuantity, inventoryQuantity, product?.id]);

  useEffect(() => {
    if (!visible || mode !== 'buy') return;
    const recommended = selectableWarehouses.find((warehouse) => warehouse.suitability === 'recommended');
    const fallback = selectableWarehouses[0];
    setSelectedWarehouseId(recommended?.id ?? fallback?.id ?? null);
  }, [visible, mode, selectableWarehouses, product?.id]);

  if (!city || !product) {
    return null;
  }

  const sellUnitPrice = effectiveSellPrice ?? currentPrice * (inventoryQuality / 100);
  const safePrice = Number.isFinite(currentPrice) ? currentPrice : 0;
  const safeAvailableStock = Number.isFinite(availableStock) ? availableStock : 0;
  const safeFreeCapacity = Number.isFinite(selectedFreeCapacity) ? selectedFreeCapacity : 0;
  const safeInventoryQty = Number.isFinite(inventoryQuantity) ? inventoryQuantity : 0;
  const safeAvgBuy = Number.isFinite(averageBuyPrice) ? averageBuyPrice : 0;
  const safeQuality = Number.isFinite(inventoryQuality) ? inventoryQuality : 100;
  const totalBuyCost = calculateTradeBuyCost(safePrice, quantity);
  const totalSellRevenue = calculateTradeSellRevenue(currentPrice, quantity, inventoryQuality);
  const estimatedProfit = calculateTradeProfit(
    currentPrice,
    averageBuyPrice,
    quantity,
    inventoryQuality,
  );
  const remainingCash = playerCash - totalBuyCost;
  const canConfirm =
    quantity >= tradingBalance.minTradeQuantity &&
    quantity <= maxQuantity &&
    (mode === 'sell' || (remainingCash >= 0 && selectedWarehouseId != null));

  const title = mode === 'buy' ? `${product.name} Satın Al` : `${product.name} Sat`;
  const sheetMaxHeight =
    windowHeight * (mode === 'buy' ? BUY_SHEET_HEIGHT_RATIO : SELL_SHEET_HEIGHT_RATIO);

  const adjustQuantity = (delta: number) => {
    setQuantity((current) => {
      const next = current + delta;
      return Math.max(tradingBalance.minTradeQuantity, Math.min(maxQuantity, next));
    });
  };

  const handleConfirmPress = () => {
    if (!canConfirm) return;

    if (mode === 'buy') {
      if (!selectedWarehouse || !selectedWarehouseId) return;

      if (
        selectedWarehouse.suitability === 'risky' ||
        selectedWarehouse.suitability === 'usable'
      ) {
        Alert.alert(
          'Depo uygun değil',
          getRiskConfirmationMessage(product, selectedWarehouse.warehouseType),
          [
            { text: 'Vazgeç', style: 'cancel' },
            {
              text: 'Yine de Satın Al',
              onPress: () => onConfirm(quantity, selectedWarehouseId),
            },
          ],
        );
        return;
      }

      onConfirm(quantity, selectedWarehouseId);
      return;
    }

    onConfirm(quantity);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <Pressable style={styles.overlayPressable} onPress={onClose} accessibilityRole="button" />

        <View
          style={[
            styles.sheet,
            { maxHeight: sheetMaxHeight, paddingBottom: bottomInset + spacing.sm },
          ]}
        >
          <View style={styles.handleWrap}>
            <View style={styles.handle} />
          </View>

          <View style={styles.header}>
            <View style={styles.headerSide}>
              <IconButton
                icon="close"
                onPress={onClose}
                size={18}
                color={colors.textMuted}
                backgroundColor="transparent"
                style={styles.closeButton}
              />
            </View>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {title}
            </Text>
            <View style={[styles.headerSide, styles.headerSideRight]}>
              <ProductIcon productId={product.id} size={20} color={colors.info} />
            </View>
          </View>

          <ScrollView
            style={styles.sheetScroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            <View style={styles.summaryCard}>
              <View style={styles.summaryGrid}>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryLabel}>Şehir</Text>
                  <Text style={styles.summaryValue} numberOfLines={1}>
                    {city.name}
                  </Text>
                </View>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryLabel}>Güncel fiyat</Text>
                  <Text style={styles.summaryValue}>{formatMoney(safePrice)} / ton</Text>
                </View>
                {mode === 'buy' ? (
                  <>
                    <View style={styles.summaryItem}>
                      <Text style={styles.summaryLabel}>Şehir stoğu</Text>
                      <Text style={styles.summaryValue}>{formatTons(safeAvailableStock)}</Text>
                    </View>
                    <View style={styles.summaryItem}>
                      <Text style={styles.summaryLabel}>Depo boş alan</Text>
                      <Text style={styles.summaryValue}>{formatTons(safeFreeCapacity)}</Text>
                    </View>
                  </>
                ) : (
                  <>
                    <View style={styles.summaryItem}>
                      <Text style={styles.summaryLabel}>Depodaki miktar</Text>
                      <Text style={styles.summaryValue}>{formatTons(safeInventoryQty)}</Text>
                    </View>
                    <View style={styles.summaryItem}>
                      <Text style={styles.summaryLabel}>Alış ort.</Text>
                      <Text style={styles.summaryValue}>{formatMoney(safeAvgBuy)} / ton</Text>
                    </View>
                    <View style={styles.summaryItem}>
                      <Text style={styles.summaryLabel}>Ürün kalitesi</Text>
                      <Text style={styles.summaryValue}>{Math.round(safeQuality)}%</Text>
                    </View>
                    <View style={styles.summaryItem}>
                      <Text style={styles.summaryLabel}>Satış fiyatı</Text>
                      <Text style={styles.summaryValue}>{formatMoney(sellUnitPrice)} / ton</Text>
                    </View>
                  </>
                )}
              </View>
            </View>

            {mode === 'buy' && showColdWarehouseSuggestion && productNeedsColdStorage(product) ? (
              <View style={styles.suggestionCard}>
                <Text style={styles.suggestionTitle}>Soğuk depo önerilir</Text>
                <Text style={styles.suggestionText} numberOfLines={2}>
                  {product.name} soğuk depoda daha iyi korunur. Normal depoda kalite zamanla düşebilir.
                </Text>
                {onOpenWarehouses ? (
                  <TouchableOpacity
                    style={styles.suggestionButton}
                    onPress={onOpenWarehouses}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.suggestionButtonText}>Soğuk Depo Aç</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}

            {mode === 'buy' ? (
              <>
                <Text style={styles.sectionTitle}>
                  {cityWarehouses.length === 1 ? 'Seçili Depo' : 'Depo Seç'}
                </Text>
                {cityWarehouses.length === 0 ? (
                  <Text style={styles.emptyWarehouseText}>
                    Bu şehirde depo yok. Önce depo açmalısın.
                  </Text>
                ) : cityWarehouses.length === 1 ? (
                  (() => {
                    const warehouse = cityWarehouses[0];
                    const badgeColor = getSuitabilityColor(warehouse.suitability);
                    const warningText = getWarehouseWarningText(warehouse.warning, warehouse.suitability);
                    return (
                      <View style={styles.singleWarehouseCard}>
                        <View style={styles.warehouseCardHeader}>
                          <Text style={styles.warehouseName}>{warehouse.name}</Text>
                          <View style={[styles.suitabilityBadge, { borderColor: badgeColor }]}>
                            <Text style={[styles.suitabilityBadgeText, { color: badgeColor }]}>
                              {warehouse.suitabilityLabel}
                            </Text>
                          </View>
                        </View>
                        <Text style={styles.warehouseMeta}>
                          {getWarehouseTypeLabel(warehouse.warehouseType)} · Boş:{' '}
                          {formatTons(warehouse.freeCapacity)}
                        </Text>
                        {warningText ? (
                          <Text style={styles.warehouseWarning}>{warningText}</Text>
                        ) : null}
                      </View>
                    );
                  })()
                ) : (
                  cityWarehouses.map((warehouse) => {
                    const active = warehouse.id === selectedWarehouseId;
                    const badgeColor = getSuitabilityColor(warehouse.suitability);
                    const warningText = getWarehouseWarningText(warehouse.warning, warehouse.suitability);
                    return (
                      <TouchableOpacity
                        key={warehouse.id}
                        style={[
                          styles.warehouseCard,
                          active && styles.warehouseCardActive,
                          warehouse.disabled && styles.warehouseCardDisabled,
                        ]}
                        onPress={() => !warehouse.disabled && setSelectedWarehouseId(warehouse.id)}
                        disabled={warehouse.disabled}
                        activeOpacity={0.85}
                      >
                        <View style={styles.warehouseCardHeader}>
                          <Text style={styles.warehouseName}>{warehouse.name}</Text>
                          <View style={[styles.suitabilityBadge, { borderColor: badgeColor }]}>
                            <Text style={[styles.suitabilityBadgeText, { color: badgeColor }]}>
                              {warehouse.suitabilityLabel}
                            </Text>
                          </View>
                        </View>
                        <Text style={styles.warehouseMeta}>
                          {getWarehouseTypeLabel(warehouse.warehouseType)} · Boş:{' '}
                          {formatTons(warehouse.freeCapacity)}
                        </Text>
                        {warningText ? (
                          <Text style={styles.warehouseWarning}>{warningText}</Text>
                        ) : null}
                      </TouchableOpacity>
                    );
                  })
                )}
              </>
            ) : null}

            <Text style={styles.sectionTitle}>Miktar seç</Text>
            <View style={styles.presetRow}>
              {presets.map((preset) => {
                const active = quantity === preset;
                const label = preset === maxQuantity ? 'Max' : `${preset}t`;
                return (
                  <TouchableOpacity
                    key={`${preset}-${maxQuantity}`}
                    style={[styles.presetChip, active && styles.presetChipActive]}
                    onPress={() => setQuantity(preset)}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.presetChipText, active && styles.presetChipTextActive]}>
                      {label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.stepperRow}>
              <TouchableOpacity
                style={styles.stepperButton}
                onPress={() => adjustQuantity(-5)}
                activeOpacity={0.85}
              >
                <Text style={styles.stepperButtonText}>-5t</Text>
              </TouchableOpacity>
              <Text style={styles.quantityValue}>{formatTons(quantity)}</Text>
              <TouchableOpacity
                style={styles.stepperButton}
                onPress={() => adjustQuantity(5)}
                activeOpacity={0.85}
              >
                <Text style={styles.stepperButtonText}>+5t</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.totalsCard}>
              {mode === 'buy' ? (
                <>
                  <Text style={styles.totalLine}>
                    Toplam maliyet: <Text style={styles.totalValue}>{formatMoney(totalBuyCost)}</Text>
                  </Text>
                  <Text style={styles.totalLine}>
                    Depoda kullanılacak alan:{' '}
                    <Text style={styles.totalValue}>{formatTons(quantity)}</Text>
                  </Text>
                  <Text style={styles.totalLine}>
                    Kalan nakit:{' '}
                    <Text
                      style={[
                        styles.totalValue,
                        remainingCash < 0 ? styles.totalValueDanger : null,
                      ]}
                    >
                      {formatMoney(remainingCash)}
                    </Text>
                  </Text>
                  {remainingCash < 0 ? (
                    <Text style={styles.cashWarning}>Nakit yetersiz</Text>
                  ) : null}
                </>
              ) : (
                <>
                  <Text style={styles.totalLine}>
                    Piyasa fiyatı: <Text style={styles.totalValue}>{formatMoney(safePrice)} / ton</Text>
                  </Text>
                  <Text style={styles.totalLine}>
                    Tahmini gelir: <Text style={styles.totalValue}>{formatMoney(totalSellRevenue)}</Text>
                  </Text>
                  <Text style={styles.totalLine}>
                    Tahmini kâr/zarar:{' '}
                    <Text
                      style={[
                        styles.totalValue,
                        estimatedProfit >= 0 ? styles.totalValueSuccess : styles.totalValueDanger,
                      ]}
                    >
                      {formatMoney(estimatedProfit)}
                    </Text>
                  </Text>
                </>
              )}
            </View>

            {mode === 'sell' && maxQuantity >= tradingBalance.minTradeQuantity ? (
              estimatedProfit < 0 ? (
                <Text style={styles.profitHintLoss}>Bu satış zarar ettirebilir.</Text>
              ) : (
                <Text style={styles.profitHintGain}>Bu satış kârlı görünüyor.</Text>
              )
            ) : null}

            {maxQuantity < tradingBalance.minTradeQuantity ? (
              <Text style={styles.softWarning}>
                {mode === 'buy'
                  ? 'Bu işlem için yeterli şehir stoğu veya depo kapasitesi yok.'
                  : 'Satılacak ürün bulunmuyor.'}
              </Text>
            ) : null}
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.confirmButton, !canConfirm && styles.confirmButtonDisabled]}
              onPress={handleConfirmPress}
              disabled={!canConfirm}
              activeOpacity={0.85}
            >
              <Text style={[styles.confirmButtonText, !canConfirm && styles.confirmButtonTextDisabled]}>
                {mode === 'buy' ? 'Satın Al' : 'Sat'}
              </Text>
            </TouchableOpacity>
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
    backgroundColor: `rgba(0, 0, 0, ${OVERLAY_OPACITY})`,
  },
  overlayPressable: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: SHEET_RADIUS,
    borderTopRightRadius: SHEET_RADIUS,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.borderStrong,
    overflow: 'hidden',
  },
  handleWrap: {
    alignItems: 'center',
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerSide: {
    width: 40,
    alignItems: 'flex-start',
  },
  headerSideRight: {
    alignItems: 'flex-end',
  },
  closeButton: {
    width: 32,
    height: 32,
    borderWidth: 0,
  },
  headerTitle: {
    ...typography.cardTitle,
    fontSize: 15,
    flex: 1,
    textAlign: 'center',
  },
  sheetScroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  summaryCard: {
    backgroundColor: colors.cardSoft,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  summaryItem: {
    width: '47%',
    minWidth: 0,
  },
  summaryLabel: {
    ...typography.caption,
    fontSize: 10,
    color: colors.textMuted,
    marginBottom: 2,
  },
  summaryValue: {
    ...typography.bodySmall,
    fontSize: 12,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  suggestionCard: {
    backgroundColor: 'rgba(245, 158, 11, 0.06)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.28)',
    padding: spacing.sm,
    marginBottom: spacing.md,
    gap: 6,
  },
  suggestionTitle: {
    color: colors.accentAmber,
    fontSize: 12,
    fontWeight: '700',
  },
  suggestionText: {
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 15,
  },
  suggestionButton: {
    alignSelf: 'flex-start',
    backgroundColor: colors.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  suggestionButtonText: {
    color: colors.textPrimary,
    fontSize: 11,
    fontWeight: '700',
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '800',
    marginBottom: spacing.sm,
  },
  emptyWarehouseText: {
    color: colors.textMuted,
    fontSize: 12,
    marginBottom: spacing.md,
  },
  singleWarehouseCard: {
    backgroundColor: colors.cardSoft,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.accentBlue,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  warehouseCard: {
    backgroundColor: colors.cardSoft,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  warehouseCardActive: {
    borderColor: colors.accentBlue,
    backgroundColor: colors.accentBlueSoft,
  },
  warehouseCardDisabled: {
    opacity: 0.45,
  },
  warehouseCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: 3,
  },
  warehouseName: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '700',
    flex: 1,
  },
  suitabilityBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  suitabilityBadgeText: {
    fontSize: 9,
    fontWeight: '700',
  },
  warehouseMeta: {
    color: colors.textMuted,
    fontSize: 11,
  },
  warehouseWarning: {
    color: colors.accentAmber,
    fontSize: 11,
    marginTop: 4,
    lineHeight: 14,
  },
  presetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  presetChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 11,
    paddingVertical: 6,
    backgroundColor: colors.cardSoft,
  },
  presetChipActive: {
    borderColor: colors.accentAmber,
    backgroundColor: colors.accentAmberSoft,
  },
  presetChipText: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
  },
  presetChipTextActive: {
    color: colors.accentAmber,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  stepperButton: {
    backgroundColor: colors.cardSoft,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 52,
    alignItems: 'center',
  },
  stepperButtonText: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '700',
  },
  quantityValue: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '800',
    minWidth: 88,
    textAlign: 'center',
  },
  totalsCard: {
    backgroundColor: colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: 5,
  },
  totalLine: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  totalValue: {
    color: colors.textPrimary,
    fontWeight: '700',
  },
  totalValueDanger: {
    color: colors.danger,
  },
  totalValueSuccess: {
    color: colors.success,
  },
  cashWarning: {
    color: colors.danger,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  profitHintLoss: {
    color: colors.danger,
    fontSize: 11,
    marginTop: spacing.sm,
    fontWeight: '600',
    opacity: 0.85,
  },
  profitHintGain: {
    color: colors.success,
    fontSize: 11,
    marginTop: spacing.sm,
    fontWeight: '600',
  },
  softWarning: {
    color: colors.accentAmber,
    fontSize: 11,
    marginTop: spacing.sm,
    fontWeight: '600',
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.card,
  },
  confirmButton: {
    backgroundColor: colors.accentAmber,
    borderRadius: 14,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmButtonDisabled: {
    backgroundColor: colors.cardSoft,
    borderWidth: 1,
    borderColor: colors.border,
  },
  confirmButtonText: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '800',
  },
  confirmButtonTextDisabled: {
    color: colors.textMuted,
  },
});

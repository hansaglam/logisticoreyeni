/**
 * LogistiCore - Ürün alım/satım modalı
 *
 * Bottom sheet — ProductMarketDetailModal ile aynı premium dark tasarım dili.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';

import { useAppDialog } from './AppDialogProvider';

import { tradingBalance } from '../config/balance';
import { getBottomInset } from '../constants/layout';
import {
  calculateTradeProfit,
  calculateTradeSellRevenue,
  getTradeBuyCashPreview,
  getTradeQuantityPresets,
} from '../simulation/trading';
import {
  getRiskConfirmationMessage,
  productNeedsColdStorage,
} from '../simulation/warehouseStorage';
import type { StorageSuitability } from '../simulation/warehouseStorage';
import { colors, spacing, typography } from '../theme';
import { formatMoney } from '../theme/format';
import { useAppSafeAreaInsets } from './AppSafeAreaProvider';
import { ActionButton, GameIcon, IconButton, ProductIcon } from './ui';
import type { City, Product, WarehouseType } from '../types/game';

const OVERLAY_OPACITY = 0.52;
const SHEET_RADIUS = 24;
const FOOTER_SUMMARY_HEIGHT = 72;
const FOOTER_BUTTON_HEIGHT = 52;
const FOOTER_EXTRA_PADDING = 16;

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

function formatQty(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return `${safe.toFixed(1)} t`;
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

function getWarehouseWarningText(
  warning: string | undefined,
  suitability: StorageSuitability,
): string | null {
  if (!warning) return null;
  if (suitability === 'risky' || suitability === 'usable') {
    return 'Bu ürün normal depoda değer kaybedebilir.';
  }
  return warning;
}

interface InfoCellProps {
  label: string;
  value: string;
}

function InfoCell({ label, value }: InfoCellProps) {
  return (
    <View style={styles.infoCell}>
      <Text style={styles.infoLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.infoValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

interface WarehousePickerCardProps {
  warehouse: TradeWarehouseOption;
  selected: boolean;
  onSelect?: () => void;
}

function WarehousePickerCard({ warehouse, selected, onSelect }: WarehousePickerCardProps) {
  const badgeColor = getSuitabilityColor(warehouse.suitability);
  const warningText = getWarehouseWarningText(warehouse.warning, warehouse.suitability);
  const isRisky = warehouse.suitability === 'risky' || warehouse.suitability === 'usable';

  const content = (
    <View style={[styles.warehouseCard, selected && styles.warehouseCardSelected]}>
      <View style={styles.warehouseTopRow}>
        <Text style={styles.warehouseName} numberOfLines={1}>
          {warehouse.name}
        </Text>
        {isRisky ? (
          <View style={[styles.riskBadge, { borderColor: badgeColor }]}>
            <Text style={[styles.riskBadgeText, { color: badgeColor }]}>Riskli</Text>
          </View>
        ) : (
          <View style={[styles.riskBadge, { borderColor: colors.success }]}>
            <Text style={[styles.riskBadgeText, { color: colors.success }]}>Uygun</Text>
          </View>
        )}
      </View>
      <Text style={styles.warehouseMeta} numberOfLines={1}>
        Boş: {formatQty(warehouse.freeCapacity)}
      </Text>
      {warningText ? (
        <Text style={styles.warehouseWarning} numberOfLines={2}>
          {warningText}
        </Text>
      ) : null}
    </View>
  );

  if (onSelect) {
    return (
      <TouchableOpacity
        onPress={onSelect}
        disabled={warehouse.disabled}
        activeOpacity={0.85}
        style={warehouse.disabled ? styles.warehouseDisabled : undefined}
      >
        {content}
      </TouchableOpacity>
    );
  }

  return content;
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
  playerCash = 0,
  onConfirm,
  onClose,
  onOpenWarehouses,
}: TradeProductModalProps) {
  const { showDialog } = useAppDialog();
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

  const footerHeight =
    FOOTER_SUMMARY_HEIGHT + FOOTER_BUTTON_HEIGHT + FOOTER_EXTRA_PADDING + bottomInset;

  useEffect(() => {
    if (!visible) return;
    const defaultQty = Math.min(
      mode === 'buy' ? tradingBalance.defaultTradeQuantity : inventoryQuantity,
      maxQuantity,
    );
    setQuantity(
      Math.max(tradingBalance.minTradeQuantity, defaultQty || tradingBalance.minTradeQuantity),
    );
  }, [visible, mode, maxQuantity, inventoryQuantity, product?.id]);

  useEffect(() => {
    if (!visible || mode !== 'buy') return;
    const recommended = selectableWarehouses.find(
      (warehouse) => warehouse.suitability === 'recommended',
    );
    const fallback = selectableWarehouses[0];
    setSelectedWarehouseId(recommended?.id ?? fallback?.id ?? null);
  }, [visible, mode, selectableWarehouses, product?.id]);

  if (!city || !product) {
    return null;
  }

  const safePrice = Number.isFinite(currentPrice) ? currentPrice : 0;
  const safeAvailableStock = Number.isFinite(availableStock) ? availableStock : 0;
  const safeFreeCapacity = Number.isFinite(selectedFreeCapacity) ? selectedFreeCapacity : 0;
  const safeInventoryQty = Number.isFinite(inventoryQuantity) ? inventoryQuantity : 0;
  const safeAvgBuy = Number.isFinite(averageBuyPrice) ? averageBuyPrice : 0;
  const buyCashPreview = getTradeBuyCashPreview({
    currentCash: playerCash,
    unitPrice: safePrice,
    quantity,
  });
  const totalBuyCost = buyCashPreview.totalCost;
  const totalSellRevenue = calculateTradeSellRevenue(currentPrice, quantity, inventoryQuality);
  const estimatedProfit = calculateTradeProfit(
    currentPrice,
    averageBuyPrice,
    quantity,
    inventoryQuality,
  );
  const remainingCapacity = Math.max(0, safeFreeCapacity - quantity);

  const canConfirm =
    quantity >= tradingBalance.minTradeQuantity &&
    quantity <= maxQuantity &&
    (mode === 'sell' || (buyCashPreview.canAfford && selectedWarehouseId != null));

  const confirmButton = (() => {
    const minQty = tradingBalance.minTradeQuantity;

    if (mode === 'sell') {
      if (safeInventoryQty < minQty) {
        return { label: 'Satılacak stok yok', disabled: true };
      }
      if (quantity < minQty || quantity > maxQuantity) {
        return { label: 'Miktar seç', disabled: true };
      }
      return { label: 'Sat', disabled: false };
    }

    if (cityWarehouses.length === 0) {
      return { label: 'Depo gerekli', disabled: true };
    }
    if (safeAvailableStock < minQty && safeFreeCapacity < minQty) {
      return { label: 'Stok yetersiz', disabled: true };
    }
    if (safeFreeCapacity < minQty) {
      return { label: 'Depo dolu', disabled: true };
    }
    if (safeAvailableStock < minQty) {
      return { label: 'Stok yetersiz', disabled: true };
    }
    if (!selectedWarehouseId) {
      return { label: 'Depo seç', disabled: true };
    }
    if (quantity > safeFreeCapacity) {
      return { label: 'Depo alanı yetersiz', disabled: true };
    }
    if (!buyCashPreview.canAfford) {
      return { label: 'Nakit yetersiz', disabled: true };
    }
    if (quantity < minQty || quantity > maxQuantity) {
      return { label: 'Miktar seç', disabled: true };
    }
    return { label: 'Satın Al', disabled: false };
  })();

  const title = mode === 'buy' ? `${product.name} Satın Al` : `${product.name} Sat`;
  const sheetMaxHeight = Math.min(windowHeight * 0.85, 680);

  const handleConfirmPress = () => {
    if (!canConfirm || confirmButton.disabled) return;

    if (mode === 'buy') {
      if (!selectedWarehouse || !selectedWarehouseId) return;

      if (
        selectedWarehouse.suitability === 'risky' ||
        selectedWarehouse.suitability === 'usable'
      ) {
        showDialog({
          title: 'Depo uygun değil',
          message: getRiskConfirmationMessage(product, selectedWarehouse.warehouseType),
          variant: 'warning',
          cancelLabel: 'Vazgeç',
          confirmLabel: 'Yine de Satın Al',
          onConfirm: () => onConfirm(quantity, selectedWarehouseId),
        });
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
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />

        <View style={[styles.sheet, { maxHeight: sheetMaxHeight }]}>
          <View style={styles.sheetHandle} />

          <View style={styles.headerRow}>
            <View style={styles.headerMain}>
              <View style={styles.titleRow}>
                <ProductIcon productId={product.id} size={18} color={colors.info} />
                <Text style={styles.title} numberOfLines={1}>
                  {title}
                </Text>
              </View>
              <Text style={styles.subtitle} numberOfLines={1}>
                {city.name} · {formatMoney(safePrice)} / ton
              </Text>
            </View>
            <IconButton icon="close" onPress={onClose} size={18} color={colors.textMuted} />
          </View>

          {mode === 'buy' ? (
            <View style={styles.cashRow}>
              <View style={styles.cashLeft}>
                <GameIcon name="cash" size={16} color={colors.accentBlue} />
                <View style={styles.cashTextCol}>
                  <Text style={styles.cashLabel}>Nakit</Text>
                  <Text style={styles.cashValue} numberOfLines={1} adjustsFontSizeToFit>
                    {formatMoney(buyCashPreview.currentCash)}
                  </Text>
                </View>
              </View>
              <View style={styles.cashRight}>
                <Text style={styles.cashLabel}>Satın alma sonrası</Text>
                <Text
                  style={[
                    styles.cashValue,
                    styles.cashRemaining,
                    !buyCashPreview.canAfford && styles.cashRemainingNegative,
                  ]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                >
                  {formatMoney(buyCashPreview.remainingCash)}
                </Text>
              </View>
            </View>
          ) : null}

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={[styles.scrollContent, { paddingBottom: footerHeight }]}
            showsVerticalScrollIndicator={false}
            bounces={false}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
          >
            <View style={styles.infoCard}>
              <View style={styles.infoGrid}>
                <InfoCell label="Şehir" value={city.name} />
                <InfoCell label="Fiyat" value={`${formatMoney(safePrice)} / ton`} />
                {mode === 'buy' ? (
                  <>
                    <InfoCell label="Şehir stoğu" value={formatQty(safeAvailableStock)} />
                    <InfoCell label="Boş alan" value={formatQty(safeFreeCapacity)} />
                  </>
                ) : (
                  <>
                    <InfoCell label="Depodaki miktar" value={formatQty(safeInventoryQty)} />
                    <InfoCell label="Ortalama alış" value={`${formatMoney(safeAvgBuy)} / ton`} />
                  </>
                )}
              </View>
            </View>

            {mode === 'buy' && showColdWarehouseSuggestion && productNeedsColdStorage(product) ? (
              <View style={styles.suggestionCard}>
                <View style={styles.suggestionMain}>
                  <Text style={styles.suggestionTitle}>Soğuk depo önerilir</Text>
                  <Text style={styles.suggestionText} numberOfLines={2}>
                    {product.name} normal depoda zamanla değer kaybedebilir.
                  </Text>
                </View>
                {onOpenWarehouses ? (
                  <TouchableOpacity
                    style={styles.suggestionButton}
                    onPress={onOpenWarehouses}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.suggestionButtonText}>Soğuk Depo Aç</Text>
                  </TouchableOpacity>
                ) : (
                  <View style={styles.suggestionBadge}>
                    <Text style={styles.suggestionBadgeText}>Gerekli</Text>
                  </View>
                )}
              </View>
            ) : null}

            {mode === 'buy' ? (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>
                  {cityWarehouses.length === 1 ? 'Seçili depo' : 'Depo seç'}
                </Text>
                {cityWarehouses.length === 0 ? (
                  <Text style={styles.emptyText}>Bu şehirde depo yok. Önce depo açmalısın.</Text>
                ) : cityWarehouses.length === 1 ? (
                  <WarehousePickerCard warehouse={cityWarehouses[0]} selected />
                ) : (
                  cityWarehouses.map((warehouse) => (
                    <WarehousePickerCard
                      key={warehouse.id}
                      warehouse={warehouse}
                      selected={warehouse.id === selectedWarehouseId}
                      onSelect={() => setSelectedWarehouseId(warehouse.id)}
                    />
                  ))
                )}
              </View>
            ) : null}

            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Miktar seç</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.presetRow}
              >
                {presets.map((preset) => {
                  const active = quantity === preset;
                  const label = preset === maxQuantity ? 'Max' : `${preset} t`;
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
              </ScrollView>
            </View>

            {maxQuantity < tradingBalance.minTradeQuantity ? (
              <Text style={styles.softWarning}>
                {mode === 'buy'
                  ? 'Bu işlem için yeterli şehir stoğu veya depo kapasitesi yok.'
                  : 'Satılacak ürün bulunmuyor.'}
              </Text>
            ) : null}
          </ScrollView>

          <View style={[styles.footer, { paddingBottom: bottomInset + spacing.sm }]}>
            <View style={styles.summaryBox}>
              {mode === 'buy' ? (
                <>
                  <Text style={styles.summaryLine} numberOfLines={1}>
                    Miktar: <Text style={styles.summaryValue}>{formatQty(quantity)}</Text>
                  </Text>
                  <Text style={styles.summaryLine} numberOfLines={1}>
                    Toplam maliyet:{' '}
                    <Text style={styles.summaryValue}>{formatMoney(totalBuyCost)}</Text>
                  </Text>
                  <Text style={styles.summaryLine} numberOfLines={1}>
                    Depoda kalacak boş alan:{' '}
                    <Text style={styles.summaryValue}>{formatQty(remainingCapacity)}</Text>
                  </Text>
                </>
              ) : (
                <>
                  <Text style={styles.summaryLine} numberOfLines={1}>
                    Miktar: <Text style={styles.summaryValue}>{formatQty(quantity)}</Text>
                  </Text>
                  <Text style={styles.summaryLine} numberOfLines={1}>
                    Toplam gelir:{' '}
                    <Text style={styles.summaryValue}>{formatMoney(totalSellRevenue)}</Text>
                  </Text>
                  <Text style={styles.summaryLine} numberOfLines={1}>
                    Kâr/Zarar:{' '}
                    <Text
                      style={[
                        styles.summaryValue,
                        estimatedProfit >= 0 ? styles.profitPositive : styles.profitNegative,
                      ]}
                    >
                      {formatMoney(estimatedProfit)}
                    </Text>
                  </Text>
                </>
              )}
            </View>

            <ActionButton
              label={confirmButton.label}
              onPress={handleConfirmPress}
              variant="primary"
              disabled={confirmButton.disabled || !canConfirm}
              fullWidth
              style={styles.confirmButton}
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
  cashRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cardSoft,
  },
  cashLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  cashRight: {
    flexShrink: 0,
    alignItems: 'flex-end',
    maxWidth: '48%',
  },
  cashTextCol: {
    flex: 1,
    minWidth: 0,
  },
  cashLabel: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '600',
  },
  cashValue: {
    ...typography.bodySmall,
    fontWeight: '800',
    color: colors.textPrimary,
    marginTop: 1,
  },
  cashRemaining: {
    color: colors.success,
  },
  cashRemainingNegative: {
    color: colors.danger,
  },
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    paddingBottom: spacing.sm,
  },
  infoCard: {
    backgroundColor: colors.cardSoft,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    marginBottom: spacing.sm,
  },
  infoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  infoCell: {
    width: '47%',
    minWidth: 0,
  },
  infoLabel: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '600',
    marginBottom: 2,
  },
  infoValue: {
    ...typography.bodySmall,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  suggestionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(245, 158, 11, 0.06)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.22)',
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: spacing.sm,
  },
  suggestionMain: {
    flex: 1,
    minWidth: 0,
  },
  suggestionTitle: {
    ...typography.caption,
    color: colors.accentAmber,
    fontWeight: '800',
    marginBottom: 2,
  },
  suggestionText: {
    ...typography.caption,
    color: colors.textMuted,
    lineHeight: 16,
  },
  suggestionButton: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  suggestionButtonText: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  suggestionBadge: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cardSoft,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  suggestionBadgeText: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '700',
  },
  section: {
    marginBottom: spacing.sm,
  },
  sectionLabel: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '800',
    marginBottom: spacing.xs,
  },
  emptyText: {
    ...typography.caption,
    color: colors.textMuted,
  },
  warehouseCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cardSoft,
    padding: spacing.sm,
    marginBottom: spacing.xs,
  },
  warehouseCardSelected: {
    borderColor: colors.accentBlue,
    backgroundColor: `${colors.accentBlue}12`,
  },
  warehouseDisabled: {
    opacity: 0.45,
  },
  warehouseTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: 2,
  },
  warehouseName: {
    ...typography.bodySmall,
    fontWeight: '800',
    color: colors.textPrimary,
    flex: 1,
  },
  riskBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  riskBadgeText: {
    fontSize: 9,
    fontWeight: '700',
  },
  warehouseMeta: {
    ...typography.caption,
    color: colors.textMuted,
  },
  warehouseWarning: {
    ...typography.caption,
    color: colors.accentAmber,
    marginTop: 4,
    lineHeight: 15,
  },
  presetRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingRight: spacing.xs,
  },
  presetChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: colors.cardSoft,
  },
  presetChipActive: {
    borderColor: colors.accentBlue,
    backgroundColor: `${colors.accentBlue}18`,
  },
  presetChipText: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '700',
  },
  presetChipTextActive: {
    color: colors.accentBlue,
  },
  softWarning: {
    ...typography.caption,
    color: colors.accentAmber,
    fontWeight: '600',
    marginTop: spacing.xs,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
    gap: spacing.xs,
    backgroundColor: colors.card,
  },
  summaryBox: {
    gap: 2,
  },
  summaryLine: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '600',
  },
  summaryValue: {
    color: colors.textPrimary,
    fontWeight: '800',
  },
  profitPositive: {
    color: colors.success,
  },
  profitNegative: {
    color: colors.danger,
  },
  confirmButton: {
    minHeight: FOOTER_BUTTON_HEIGHT,
  },
});

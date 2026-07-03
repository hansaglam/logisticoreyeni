/**
 * LogistiCore - Ürün alım/satım modalı
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { tradingBalance } from '../config/balance';
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
import { useAppSafeAreaInsets } from './AppSafeAreaProvider';
import type { City, Product, WarehouseType } from '../types/game';
import type { StorageSuitability } from '../simulation/warehouseStorage';

const COLORS = {
  background: '#050A12',
  card: '#0F172A',
  border: '#1E293B',
  primary: '#F59E0B',
  success: '#22C55E',
  warning: '#EAB308',
  danger: '#EF4444',
  muted: '#94A3B8',
  text: '#F8FAFC',
};

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
  const rounded = Math.round(value);
  return `$${Math.abs(rounded)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

function formatTons(value: number): string {
  return `${value.toFixed(1)} ton`;
}

function getSuitabilityColor(suitability: StorageSuitability): string {
  switch (suitability) {
    case 'recommended':
      return COLORS.success;
    case 'usable':
      return COLORS.warning;
    case 'risky':
      return COLORS.danger;
    default:
      return COLORS.muted;
  }
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
  const totalBuyCost = calculateTradeBuyCost(currentPrice, quantity);
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
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} activeOpacity={0.8}>
            <Text style={styles.closeText}>Kapat</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{title}</Text>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLine}>Şehir: {city.name}</Text>
            <Text style={styles.summaryLine}>Güncel fiyat: {formatMoney(currentPrice)} / ton</Text>
            {mode === 'buy' ? (
              <>
                <Text style={styles.summaryLine}>Şehir stoğu: {formatTons(availableStock)}</Text>
                <Text style={styles.summaryLine}>
                  Seçili depo boş kapasitesi: {formatTons(selectedFreeCapacity)}
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.summaryLine}>Depodaki miktar: {formatTons(inventoryQuantity)}</Text>
                <Text style={styles.summaryLine}>Alış ort.: {formatMoney(averageBuyPrice)} / ton</Text>
                <Text style={styles.summaryLine}>Ürün kalitesi: {Math.round(inventoryQuality)}%</Text>
                <Text style={styles.summaryLine}>
                  Kaliteye göre satış: {formatMoney(sellUnitPrice)} / ton
                </Text>
              </>
            )}
          </View>

          {mode === 'buy' && showColdWarehouseSuggestion && productNeedsColdStorage(product) ? (
            <View style={styles.suggestionCard}>
              <Text style={styles.suggestionTitle}>Soğuk depo önerilir</Text>
              <Text style={styles.suggestionText}>
                {product.name} soğuk depoda saklanmalı. Normal depoda saklarsan ürün zamanla bozulabilir
                ve satış fiyatı düşebilir.
              </Text>
              <TouchableOpacity
                style={styles.suggestionButton}
                onPress={onOpenWarehouses ?? onClose}
                activeOpacity={0.85}
              >
                <Text style={styles.suggestionButtonText}>
                  {onOpenWarehouses ? 'Soğuk Depo Aç' : 'Depoları Gör'}
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {mode === 'buy' ? (
            <>
              <Text style={styles.sectionTitle}>Depo Seç</Text>
              {cityWarehouses.length === 0 ? (
                <Text style={styles.emptyWarehouseText}>
                  Bu şehirde depo yok. Önce depo açmalısın.
                </Text>
              ) : (
                cityWarehouses.map((warehouse) => {
                  const active = warehouse.id === selectedWarehouseId;
                  const badgeColor = getSuitabilityColor(warehouse.suitability);
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
                      {warehouse.warning ? (
                        <Text style={styles.warehouseWarning}>{warehouse.warning}</Text>
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
                  <Text style={[styles.presetChipText, active && styles.presetChipTextActive]}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.stepperRow}>
            <TouchableOpacity style={styles.stepperButton} onPress={() => adjustQuantity(-5)} activeOpacity={0.85}>
              <Text style={styles.stepperButtonText}>-5t</Text>
            </TouchableOpacity>
            <Text style={styles.quantityValue}>{formatTons(quantity)}</Text>
            <TouchableOpacity style={styles.stepperButton} onPress={() => adjustQuantity(5)} activeOpacity={0.85}>
              <Text style={styles.stepperButtonText}>+5t</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.totalsCard}>
            {mode === 'buy' ? (
              <>
                <Text style={styles.totalLine}>Toplam maliyet: {formatMoney(totalBuyCost)}</Text>
                <Text style={styles.totalLine}>Depoda kullanılacak alan: {formatTons(quantity)}</Text>
                <Text style={[styles.totalLine, remainingCash < 0 && { color: COLORS.danger }]}>
                  Kalan nakit: {formatMoney(remainingCash)}
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.totalLine}>Piyasa fiyatı: {formatMoney(currentPrice)} / ton</Text>
                <Text style={styles.totalLine}>Tahmini gelir: {formatMoney(totalSellRevenue)}</Text>
                <Text
                  style={[
                    styles.totalLine,
                    { color: estimatedProfit >= 0 ? COLORS.success : COLORS.danger },
                  ]}
                >
                  Tahmini kâr/zarar: {formatMoney(estimatedProfit)}
                </Text>
              </>
            )}
          </View>

          {mode === 'sell' && estimatedProfit < 0 ? (
            <Text style={styles.lossWarning}>Bu satış zarar ettirebilir.</Text>
          ) : null}

          {maxQuantity < tradingBalance.minTradeQuantity ? (
            <Text style={styles.lossWarning}>
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
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '800',
  },
  headerSpacer: {
    width: 48,
  },
  closeText: {
    color: COLORS.muted,
    fontSize: 14,
    fontWeight: '600',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  summaryCard: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    marginBottom: 16,
    gap: 4,
  },
  summaryLine: {
    color: COLORS.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  suggestionCard: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.primary,
    padding: 14,
    marginBottom: 16,
    gap: 8,
  },
  suggestionTitle: {
    color: COLORS.primary,
    fontSize: 14,
    fontWeight: '800',
  },
  suggestionText: {
    color: COLORS.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  suggestionButton: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  suggestionButtonText: {
    color: '#0B1220',
    fontSize: 12,
    fontWeight: '800',
  },
  sectionTitle: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 10,
  },
  emptyWarehouseText: {
    color: COLORS.muted,
    fontSize: 13,
    marginBottom: 16,
  },
  warehouseCard: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    marginBottom: 10,
  },
  warehouseCardActive: {
    borderColor: COLORS.primary,
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
  },
  warehouseCardDisabled: {
    opacity: 0.45,
  },
  warehouseCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 4,
  },
  warehouseName: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
  },
  suitabilityBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  suitabilityBadgeText: {
    fontSize: 11,
    fontWeight: '800',
  },
  warehouseMeta: {
    color: COLORS.muted,
    fontSize: 12,
  },
  warehouseWarning: {
    color: COLORS.danger,
    fontSize: 12,
    marginTop: 6,
    lineHeight: 16,
  },
  presetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  presetChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: COLORS.card,
  },
  presetChipActive: {
    borderColor: COLORS.primary,
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
  },
  presetChipText: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  presetChipTextActive: {
    color: COLORS.primary,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    marginBottom: 16,
  },
  stepperButton: {
    backgroundColor: COLORS.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  stepperButtonText: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '800',
  },
  quantityValue: {
    color: COLORS.text,
    fontSize: 18,
    fontWeight: '800',
    minWidth: 90,
    textAlign: 'center',
  },
  totalsCard: {
    backgroundColor: '#111827',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    gap: 6,
  },
  totalLine: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '600',
  },
  lossWarning: {
    color: COLORS.danger,
    fontSize: 12,
    marginTop: 10,
    fontWeight: '600',
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  confirmButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmButtonDisabled: {
    backgroundColor: '#334155',
  },
  confirmButtonText: {
    color: '#0B1220',
    fontSize: 15,
    fontWeight: '800',
  },
  confirmButtonTextDisabled: {
    color: COLORS.muted,
  },
});

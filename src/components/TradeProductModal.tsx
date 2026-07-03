/**
 * LogistiCore - Ürün alım/satım modalı
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
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
import { useAppSafeAreaInsets } from './AppSafeAreaProvider';
import type { City, Product } from '../types/game';

const COLORS = {
  background: '#050A12',
  card: '#0F172A',
  border: '#1E293B',
  primary: '#F59E0B',
  success: '#22C55E',
  danger: '#EF4444',
  muted: '#94A3B8',
  text: '#F8FAFC',
};

export type TradeProductModalMode = 'buy' | 'sell';

export interface TradeProductModalProps {
  visible: boolean;
  mode: TradeProductModalMode;
  city: City | null;
  product: Product | null;
  currentPrice: number;
  availableStock: number;
  warehouseFreeCapacity?: number;
  inventoryQuantity?: number;
  averageBuyPrice?: number;
  playerCash?: number;
  onConfirm: (quantity: number) => void;
  onClose: () => void;
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

export default function TradeProductModal({
  visible,
  mode,
  city,
  product,
  currentPrice,
  availableStock,
  warehouseFreeCapacity = 0,
  inventoryQuantity = 0,
  averageBuyPrice = 0,
  playerCash = 0,
  onConfirm,
  onClose,
}: TradeProductModalProps) {
  const insets = useAppSafeAreaInsets();
  const [quantity, setQuantity] = useState<number>(tradingBalance.defaultTradeQuantity);

  const maxQuantity = useMemo(() => {
    if (mode === 'buy') {
      return Math.min(availableStock, warehouseFreeCapacity, tradingBalance.maxTradeQuantity);
    }
    return Math.min(inventoryQuantity, tradingBalance.maxTradeQuantity);
  }, [mode, availableStock, warehouseFreeCapacity, inventoryQuantity]);

  const presets = useMemo(() => getTradeQuantityPresets(maxQuantity), [maxQuantity]);

  useEffect(() => {
    if (!visible) return;
    const defaultQty = Math.min(
      mode === 'buy' ? tradingBalance.defaultTradeQuantity : inventoryQuantity,
      maxQuantity,
    );
    setQuantity(Math.max(tradingBalance.minTradeQuantity, defaultQty || tradingBalance.minTradeQuantity));
  }, [visible, mode, maxQuantity, inventoryQuantity, product?.id]);

  if (!city || !product) {
    return null;
  }

  const totalBuyCost = calculateTradeBuyCost(currentPrice, quantity);
  const totalSellRevenue = calculateTradeSellRevenue(currentPrice, quantity);
  const estimatedProfit = calculateTradeProfit(currentPrice, averageBuyPrice, quantity);
  const remainingCash = playerCash - totalBuyCost;
  const canConfirm =
    quantity >= tradingBalance.minTradeQuantity &&
    quantity <= maxQuantity &&
    (mode === 'sell' || remainingCash >= 0);

  const title = mode === 'buy' ? `${product.name} Satın Al` : `${product.name} Sat`;

  const adjustQuantity = (delta: number) => {
    setQuantity((current) => {
      const next = current + delta;
      return Math.max(tradingBalance.minTradeQuantity, Math.min(maxQuantity, next));
    });
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
                <Text style={styles.summaryLine}>Depo boş kapasitesi: {formatTons(warehouseFreeCapacity)}</Text>
              </>
            ) : (
              <>
                <Text style={styles.summaryLine}>Depodaki miktar: {formatTons(inventoryQuantity)}</Text>
                <Text style={styles.summaryLine}>Alış ort.: {formatMoney(averageBuyPrice)} / ton</Text>
              </>
            )}
          </View>

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
            onPress={() => canConfirm && onConfirm(quantity)}
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
  sectionTitle: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 10,
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

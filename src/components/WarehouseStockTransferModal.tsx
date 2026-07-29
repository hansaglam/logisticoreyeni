/**
 * Minimal depolar arası stok transferi sheet — domain V1.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { ActionButton, GameIcon, IconButton } from './ui';
import { useAppSafeAreaInsets } from './AppSafeAreaProvider';
import { tradingBalance } from '../config/balance';
import {
  buildWarehouseTransferPreview,
  getWarehouseEffectiveAvailableCapacityTons,
  getWarehouseStockTransferReasonMessage,
  listEligibleDestinationWarehouses,
  validateWarehouseStockTransfer,
} from '../simulation/warehouseStockTransfer';
import { selectDriverForTransfer } from '../simulation/truckTransfer';
import { resolveTruckCityId } from '../simulation/delivery';
import { getTruckEffectiveCapacityTons } from '../simulation/capacity';
import { useGameStore } from '../store/gameStore';
import { getSnapshotFuelPrice } from '../simulation/globalMarketSnapshot';
import { colors, formatMoney, spacing, typography } from '../theme';
import { getCityName, getProductName } from '../utils/entityLookup';
import { getTruckFuelReadiness } from '../utils/truckFuel';
import type { ProductId, Warehouse } from '../types/game';
import TruckRefuelSheet from './TruckRefuelSheet';

export interface WarehouseStockTransferModalProps {
  visible: boolean;
  sourceWarehouse: Warehouse | null;
  productId: ProductId | null;
  onClose: () => void;
  onStarted?: (message: string) => void;
  onError?: (message: string) => void;
}

function formatDuration(hours: number): string {
  const totalHours = Math.max(1, Math.round(hours));
  if (totalHours < 24) return `${totalHours} sa`;
  const days = Math.floor(totalHours / 24);
  const remaining = totalHours % 24;
  return remaining > 0 ? `${days}g ${remaining}s` : `${days}g`;
}

export default function WarehouseStockTransferModal({
  visible,
  sourceWarehouse,
  productId,
  onClose,
  onStarted,
  onError,
}: WarehouseStockTransferModalProps) {
  const insets = useAppSafeAreaInsets();
  const player = useGameStore((state) => state.player);
  const cities = useGameStore((state) => state.cities);
  const routes = useGameStore((state) => state.routes);
  const activeWarehouseStockTransfers = useGameStore(
    (state) => state.activeWarehouseStockTransfers,
  );
  const activeTransfers = useGameStore((state) => state.activeTransfers);
  const activeDeliveries = useGameStore((state) => state.activeDeliveries);
  const fuelPrice = useGameStore((state) =>
    getSnapshotFuelPrice(state.cachedGlobalEconomySnapshot, state.globalEconomy),
  );
  const startWarehouseStockTransfer = useGameStore((state) => state.startWarehouseStockTransfer);

  const [destinationWarehouseId, setDestinationWarehouseId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState<number>(tradingBalance.defaultTradeQuantity);
  const [selectedTruckId, setSelectedTruckId] = useState<string | null>(null);
  const [refuelVisible, setRefuelVisible] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setDestinationWarehouseId(null);
    setQuantity(tradingBalance.defaultTradeQuantity);
    setSelectedTruckId(null);
  }, [visible, sourceWarehouse?.id, productId]);

  const inventoryQty = useMemo(() => {
    if (!sourceWarehouse || !productId) return 0;
    return (
      sourceWarehouse.inventory?.find((item) => item.productId === productId)?.quantity ?? 0
    );
  }, [sourceWarehouse, productId]);

  const destinations = useMemo(() => {
    if (!sourceWarehouse || !productId || !player) return [];
    return listEligibleDestinationWarehouses({
      warehouses: player.warehouses,
      sourceWarehouseId: sourceWarehouse.id,
      productId,
      quantityTons: Math.min(quantity, inventoryQty),
      activeWarehouseStockTransfers,
    });
  }, [
    sourceWarehouse,
    productId,
    player,
    quantity,
    inventoryQty,
    activeWarehouseStockTransfers,
  ]);

  const idleTrucks = useMemo(() => {
    if (!sourceWarehouse || !player) return [];
    return (player.trucks ?? []).filter((truck) => {
      if (truck.status !== 'idle') return false;
      return resolveTruckCityId(truck, player.homeCityId) === sourceWarehouse.cityId;
    });
  }, [player, sourceWarehouse]);

  useEffect(() => {
    if (!selectedTruckId && idleTrucks[0]) {
      setSelectedTruckId(idleTrucks[0].id);
    }
  }, [idleTrucks, selectedTruckId]);

  const selectedTruck = idleTrucks.find((truck) => truck.id === selectedTruckId) ?? idleTrucks[0];
  const driver = selectedTruck
    ? selectDriverForTransfer(selectedTruck.id, player?.drivers)
    : undefined;

  const validation = useMemo(() => {
    if (!sourceWarehouse || !productId || !destinationWarehouseId || !player || !selectedTruck) {
      return null;
    }
    return validateWarehouseStockTransfer({
      sourceWarehouseId: sourceWarehouse.id,
      destinationWarehouseId,
      productId,
      quantityTons: quantity,
      truckId: selectedTruck.id,
      driverId: driver?.id,
      warehouses: player.warehouses,
      trucks: player.trucks,
      trailers: player.trailers ?? [],
      drivers: player.drivers,
      routes,
      activeWarehouseStockTransfers,
      activeTransfers,
      activeDeliveries,
      homeCityId: player.homeCityId,
      playerMoney: player.money,
      fuelPrice,
      skipFuelCheck: true,
    });
  }, [
    sourceWarehouse,
    productId,
    destinationWarehouseId,
    player,
    selectedTruck,
    driver?.id,
    quantity,
    routes,
    activeWarehouseStockTransfers,
    activeTransfers,
    activeDeliveries,
    fuelPrice,
  ]);

  const preview = useMemo(() => {
    if (!validation?.validated) return null;
    const destCity = cities.find(
      (city) => city.id === validation.validated!.destinationWarehouse.cityId,
    );
    return buildWarehouseTransferPreview({
      validated: validation.validated,
      destinationCity: destCity,
      trailers: player?.trailers ?? [],
    });
  }, [validation, cities, player?.trailers]);
  const fuelReadiness = useMemo(() => {
    if (!validation?.validated) return null;
    return getTruckFuelReadiness(
      validation.validated.truck,
      validation.validated.fuelLiters,
      fuelPrice ?? 0,
    );
  }, [fuelPrice, validation?.validated]);

  const quantityPresets = useMemo(() => {
    const maxQty = Math.min(inventoryQty, tradingBalance.maxTradeQuantity);
    const caps = selectedTruck
      ? getTruckEffectiveCapacityTons(selectedTruck, player?.trailers ?? [])
      : maxQty;
    const hardMax = Math.min(maxQty, caps);
    return [5, 10, 25, hardMax]
      .filter((value, index, arr) => value > 0 && value <= hardMax && arr.indexOf(value) === index)
      .sort((a, b) => a - b);
  }, [inventoryQty, selectedTruck, player?.trailers]);

  const handleStart = () => {
    if (!sourceWarehouse || !productId || !destinationWarehouseId) {
      onError?.('Hedef depo seçmelisin.');
      return;
    }
    const result = startWarehouseStockTransfer({
      sourceWarehouseId: sourceWarehouse.id,
      destinationWarehouseId,
      productId,
      quantityTons: quantity,
      truckId: selectedTruck?.id,
      driverId: driver?.id,
    });
    if (!result.success) {
      onError?.(
        result.message ??
          (result.reason ? getWarehouseStockTransferReasonMessage(result.reason) : 'Transfer başlatılamadı.'),
      );
      return;
    }
    onStarted?.(result.message ?? 'Stok transferi başladı.');
    onClose();
  };

  if (!visible || !sourceWarehouse || !productId) {
    return null;
  }

  const canStart = Boolean(
    validation?.success &&
      preview &&
      fuelReadiness?.canCompleteWithoutRefuel !== false,
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.title}>Ürünü Taşı</Text>
              <Text style={styles.subtitle} numberOfLines={1}>
                {getProductName(productId)} · {getCityName(sourceWarehouse.cityId)}
              </Text>
            </View>
            <IconButton icon="close" onPress={onClose} />
          </View>

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            <Text style={styles.sectionLabel}>Miktar (ton)</Text>
            <View style={styles.chipRow}>
              {quantityPresets.map((preset) => (
                <TouchableOpacity
                  key={preset}
                  style={[styles.chip, quantity === preset && styles.chipActive]}
                  onPress={() => setQuantity(preset)}
                >
                  <Text style={[styles.chipText, quantity === preset && styles.chipTextActive]}>
                    {preset}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.sectionLabel}>Hedef depo</Text>
            {destinations.length === 0 ? (
              <Text style={styles.emptyHint}>
                Uygun hedef depo yok (kapasite, soğuk zincir veya rota).
              </Text>
            ) : (
              destinations.map((warehouse) => {
                const free = getWarehouseEffectiveAvailableCapacityTons(
                  warehouse,
                  activeWarehouseStockTransfers,
                );
                const selected = warehouse.id === destinationWarehouseId;
                return (
                  <TouchableOpacity
                    key={warehouse.id}
                    style={[styles.optionCard, selected && styles.optionCardActive]}
                    onPress={() => setDestinationWarehouseId(warehouse.id)}
                  >
                    <GameIcon
                      name="warehouse"
                      size={16}
                      color={selected ? colors.accentBlue : colors.textMuted}
                    />
                    <View style={styles.optionText}>
                      <Text style={styles.optionTitle}>{getCityName(warehouse.cityId)}</Text>
                      <Text style={styles.optionMeta}>
                        Boş {free.toFixed(0)} ton · {warehouse.warehouseType ?? 'standard'}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })
            )}

            <Text style={styles.sectionLabel}>Kamyon</Text>
            {idleTrucks.length === 0 ? (
              <Text style={styles.emptyHint}>Bu şehirde boşta kamyon yok.</Text>
            ) : (
              idleTrucks.map((truck) => {
                const selected = truck.id === selectedTruck?.id;
                const capacity = getTruckEffectiveCapacityTons(truck, player?.trailers ?? []);
                return (
                  <TouchableOpacity
                    key={truck.id}
                    style={[styles.optionCard, selected && styles.optionCardActive]}
                    onPress={() => setSelectedTruckId(truck.id)}
                  >
                    <GameIcon
                      name="truck"
                      size={16}
                      color={selected ? colors.accentBlue : colors.textMuted}
                    />
                    <View style={styles.optionText}>
                      <Text style={styles.optionTitle}>{truck.name}</Text>
                      <Text style={styles.optionMeta}>Kapasite {capacity.toFixed(0)} ton</Text>
                    </View>
                  </TouchableOpacity>
                );
              })
            )}

            {preview ? (
              <View style={styles.summaryCard}>
                <Text style={styles.summaryTitle}>Özet</Text>
                <Text style={styles.summaryLine}>
                  {preview.sourceCity} → {preview.destinationCity} · {preview.distanceKm} km
                </Text>
                <Text style={styles.summaryLine}>
                  Süre {formatDuration(preview.estimatedDurationHours)} · Yakıt{' '}
                  {formatMoney(preview.fuelCost)} · Şoför {formatMoney(preview.driverCost)}
                </Text>
                <Text style={styles.summaryTotal}>
                  Toplam maliyet {formatMoney(preview.totalEstimatedCost)}
                </Text>
                {preview.projectedNetProfit != null ? (
                  <Text style={styles.summaryLine}>
                    Tahmini net kâr: {formatMoney(preview.projectedNetProfit)}
                  </Text>
                ) : (
                  <Text style={styles.summaryLine}>Piyasa tahmini oluşturulamadı.</Text>
                )}
              </View>
            ) : validation && !validation.success ? (
              <Text style={styles.errorText}>
                {validation.message ??
                  (validation.reason
                    ? getWarehouseStockTransferReasonMessage(validation.reason)
                    : 'Transfer uygun değil')}
              </Text>
            ) : null}
          </ScrollView>

          <View style={styles.footer}>
            {fuelReadiness && !fuelReadiness.canCompleteWithoutRefuel ? (
              <View style={styles.fuelWarning}>
                <Text style={styles.fuelWarningText}>
                  Bu rota için {Math.ceil(fuelReadiness.requiredFuelL)} L yakıt gerekiyor. Kamyonda{' '}
                  {Math.floor(fuelReadiness.currentFuelL)} L var.
                </Text>
                <View style={styles.fuelWarningActions}>
                  <ActionButton
                    label="Yakıt Al"
                    icon="fuel"
                    onPress={() => setRefuelVisible(true)}
                    compact
                    style={styles.fuelWarningButton}
                  />
                  <ActionButton
                    label="Vazgeç"
                    onPress={onClose}
                    variant="secondary"
                    compact
                    style={styles.fuelWarningButton}
                  />
                </View>
              </View>
            ) : null}
            <ActionButton
              label={
                fuelReadiness && !fuelReadiness.canCompleteWithoutRefuel
                  ? 'Yakıt gerekli'
                  : canStart
                    ? 'Transferi Başlat'
                    : 'Seçimleri tamamla'
              }
              onPress={handleStart}
              disabled={!canStart}
              variant="primary"
            />
          </View>
          <TruckRefuelSheet
            visible={refuelVisible}
            truck={selectedTruck ?? null}
            onClose={() => setRefuelVisible(false)}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(2, 8, 20, 0.72)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '88%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  headerText: { flex: 1, minWidth: 0 },
  title: { ...typography.sectionTitle, color: colors.textPrimary },
  subtitle: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  body: { maxHeight: 460 },
  bodyContent: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: 8 },
  sectionLabel: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '700',
    marginTop: 8,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: {
    borderColor: colors.accentBlue,
    backgroundColor: 'rgba(35,136,255,0.12)',
  },
  chipText: { color: colors.textMuted, fontWeight: '700' },
  chipTextActive: { color: colors.accentBlue },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  optionCardActive: {
    borderColor: colors.accentBlue,
    backgroundColor: 'rgba(35,136,255,0.10)',
  },
  optionText: { flex: 1, minWidth: 0 },
  optionTitle: { color: colors.textPrimary, fontWeight: '700' },
  optionMeta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  emptyHint: { color: colors.textMuted, fontSize: 13 },
  summaryCard: {
    marginTop: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 4,
  },
  summaryTitle: { color: colors.textPrimary, fontWeight: '800', marginBottom: 2 },
  summaryLine: { color: colors.textMuted, fontSize: 12.5 },
  summaryTotal: { color: colors.accentAmber, fontWeight: '800', marginTop: 4 },
  errorText: { color: colors.danger, fontSize: 13, marginTop: 8 },
  footer: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  fuelWarning: {
    padding: spacing.sm,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.accentAmber,
    backgroundColor: colors.warningSoft,
    gap: spacing.sm,
  },
  fuelWarningText: {
    ...typography.bodySmall,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  fuelWarningActions: { flexDirection: 'row', gap: spacing.sm },
  fuelWarningButton: { flex: 1, minHeight: 44 },
});

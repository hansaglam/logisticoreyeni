import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { useGameStore } from '../store/gameStore';
import { getSnapshotFuelPrice } from '../simulation/globalMarketSnapshot';
import { colors, spacing, typography } from '../theme';
import { formatMoney, formatMoneyDecimal, formatUnitPrice } from '../theme/format';
import {
  calculateTruckRefuelQuote,
  getTruckFuelPercent,
  getTruckRangeKm,
  normalizeTruckFuel,
} from '../utils/truckFuel';
import type { Truck } from '../types/game';
import { useAppSafeAreaInsets } from './AppSafeAreaProvider';
import { ActionButton, GameIcon, IconButton, ProgressBar } from './ui';

type RefuelChoice = '25' | '50' | 'full' | 'max';

export interface TruckRefuelSheetProps {
  visible: boolean;
  truck: Truck | null;
  onClose: () => void;
  onSuccess?: (message: string) => void;
}

const CHOICES: Array<{ id: RefuelChoice; label: string }> = [
  { id: '25', label: '25 L' },
  { id: '50', label: '50 L' },
  { id: 'full', label: 'Tam Doldur' },
  { id: 'max', label: 'Maksimum Al' },
];

function formatLiters(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1);
}

export default function TruckRefuelSheet({
  visible,
  truck,
  onClose,
  onSuccess,
}: TruckRefuelSheetProps) {
  const insets = useAppSafeAreaInsets();
  const liveTruck = useGameStore((state) =>
    truck ? state.player?.trucks.find((candidate) => candidate.id === truck.id) : undefined,
  );
  const cash = useGameStore((state) => state.player?.money ?? 0);
  const fuelPrice = useGameStore((state) =>
    getSnapshotFuelPrice(state.cachedGlobalEconomySnapshot, state.globalEconomy),
  );
  const refuelTruck = useGameStore((state) => state.refuelTruck);
  const [choice, setChoice] = useState<RefuelChoice>('25');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const transactionKeyRef = useRef('');

  const selectedTruck = liveTruck ?? truck;
  const normalizedTruck = useMemo(
    () => (selectedTruck ? normalizeTruckFuel(selectedTruck) : null),
    [selectedTruck],
  );

  useEffect(() => {
    if (!visible) return;
    setChoice('25');
    setErrorMessage(null);
    transactionKeyRef.current = '';
  }, [visible, truck?.id]);

  const tankCapacity = normalizedTruck?.fuelTankCapacityL ?? 0;
  const currentFuel = normalizedTruck?.currentFuelL ?? 0;
  const availableTankSpace = Math.max(0, tankCapacity - currentFuel);
  const requestedLiters = useMemo(() => {
    if (choice === '25') return 25;
    if (choice === '50') return 50;
    if (choice === 'full') return availableTankSpace;
    if (fuelPrice <= 0) return 0;
    return Math.min(availableTankSpace, Math.floor((cash / fuelPrice) * 1000) / 1000);
  }, [availableTankSpace, cash, choice, fuelPrice]);
  const quote = useMemo(
    () =>
      normalizedTruck
        ? calculateTruckRefuelQuote(normalizedTruck, requestedLiters, fuelPrice)
        : null,
    [normalizedTruck, requestedLiters, fuelPrice],
  );
  const fuelPercent = normalizedTruck ? getTruckFuelPercent(normalizedTruck) : 0;
  const rangeKm = normalizedTruck ? getTruckRangeKm(normalizedTruck) : 0;
  const tankFull = availableTankSpace <= 1e-6;
  const canSubmit = !!normalizedTruck && !!quote && quote.litersToAdd > 0 && fuelPrice > 0;

  const handleSubmit = () => {
    if (!normalizedTruck || !quote) return;
    if (!transactionKeyRef.current) {
      transactionKeyRef.current = `refuel:${normalizedTruck.id}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    }
    const result = refuelTruck({
      truckId: normalizedTruck.id,
      liters: quote.litersToAdd,
      expectedUnitPrice: quote.unitPrice,
      idempotencyKey: transactionKeyRef.current,
    });
    if (!result.success) {
      setErrorMessage(result.message);
      return;
    }
    setErrorMessage(null);
    onSuccess?.(result.message);
    onClose();
  };

  if (!selectedTruck) return null;

  const bottomPadding = Math.max(insets.bottom, 12) + spacing.md;
  const submitLabel = quote
    ? `${formatMoneyDecimal(quote.totalCost)} Öde ve Doldur`
    : 'Yakıt Al';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: bottomPadding }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.headerIcon}>
              <GameIcon name="fuel" size={20} color={colors.accentBlue} />
            </View>
            <View style={styles.headerText}>
              <Text style={styles.title}>Yakıt Al</Text>
              <Text style={styles.truckName} numberOfLines={1}>
                {selectedTruck.name}
              </Text>
            </View>
            <IconButton icon="close" onPress={onClose} />
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
            bounces
          >
            <View style={styles.fuelCard}>
              <View style={styles.fuelTopRow}>
                <Text style={styles.fuelAmount} numberOfLines={1} adjustsFontSizeToFit>
                  {formatLiters(currentFuel)} / {formatLiters(tankCapacity)} L
                </Text>
                <Text style={styles.fuelPercent}>%{fuelPercent}</Text>
              </View>
              <ProgressBar progress={fuelPercent / 100} height={7} color={colors.accentBlue} />
              <View style={styles.metricRow}>
                <View style={styles.metric}>
                  <Text style={styles.metricLabel}>Tahmini menzil</Text>
                  <Text style={styles.metricValue} numberOfLines={1} adjustsFontSizeToFit>
                    {Number.isFinite(rangeKm) ? `${Math.floor(rangeKm)} km` : 'Sınırsız'}
                  </Text>
                </View>
                <View style={styles.metric}>
                  <Text style={styles.metricLabel}>Canlı litre fiyatı</Text>
                  <Text style={styles.metricValue} numberOfLines={1} adjustsFontSizeToFit>
                    {formatUnitPrice(fuelPrice, '/L')}
                  </Text>
                </View>
                <View style={styles.metric}>
                  <Text style={styles.metricLabel}>Nakit</Text>
                  <Text style={styles.metricValue} numberOfLines={1} adjustsFontSizeToFit>
                    {formatMoney(cash)}
                  </Text>
                </View>
              </View>
            </View>

            <Text style={styles.sectionLabel}>Dolum miktarı</Text>
            <View style={styles.choiceGrid}>
              {CHOICES.map((item) => {
                const selected = item.id === choice;
                return (
                  <TouchableOpacity
                    key={item.id}
                    style={[styles.choice, selected && styles.choiceSelected]}
                    onPress={() => {
                      setChoice(item.id);
                      setErrorMessage(null);
                      transactionKeyRef.current = '';
                    }}
                    activeOpacity={0.84}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                  >
                    <Text
                      style={[styles.choiceText, selected && styles.choiceTextSelected]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                    >
                      {item.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {quote ? (
              <View style={styles.summaryCard}>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Alınacak</Text>
                  <Text style={styles.summaryValue}>{formatLiters(quote.litersToAdd)} L</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Birim fiyat</Text>
                  <Text style={styles.summaryValue}>{formatUnitPrice(quote.unitPrice, '/L')}</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Toplam</Text>
                  <Text style={styles.summaryValue}>{formatMoneyDecimal(quote.totalCost)}</Text>
                </View>
                <View style={styles.summaryDivider} />
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Yeni yakıt</Text>
                  <Text style={styles.summaryStrong} numberOfLines={1} adjustsFontSizeToFit>
                    {formatLiters(quote.newFuelL)} / {formatLiters(quote.fuelTankCapacityL)} L
                  </Text>
                </View>
              </View>
            ) : null}

            {tankFull ? <Text style={styles.infoText}>Yakıt deposu zaten dolu.</Text> : null}
            {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}
          </ScrollView>

          <ActionButton
            label={submitLabel}
            icon="fuel"
            onPress={handleSubmit}
            disabled={!canSubmit}
            fullWidth
            style={styles.submit}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(2, 8, 20, 0.74)',
  },
  sheet: {
    maxHeight: '91%',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
  },
  handle: {
    width: 42,
    height: 4,
    borderRadius: 999,
    backgroundColor: colors.borderStrong,
    alignSelf: 'center',
    marginBottom: spacing.sm,
  },
  header: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  headerIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.infoSoft,
  },
  headerText: { flex: 1, minWidth: 0 },
  title: { ...typography.sectionTitle, color: colors.textPrimary },
  truckName: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  scroll: { flexGrow: 0 },
  content: { paddingVertical: spacing.md, gap: spacing.md },
  fuelCard: {
    padding: spacing.md,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cardSoft,
    gap: spacing.sm,
  },
  fuelTopRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  fuelAmount: { flex: 1, fontSize: 20, fontWeight: '800', color: colors.textPrimary },
  fuelPercent: { fontSize: 18, fontWeight: '800', color: colors.accentBlue },
  metricRow: { flexDirection: 'row', gap: 6 },
  metric: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 7,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: colors.surface2,
  },
  metricLabel: { fontSize: 9, color: colors.textMuted },
  metricValue: { fontSize: 11, fontWeight: '700', color: colors.textPrimary, marginTop: 3 },
  sectionLabel: { ...typography.caption, color: colors.textMuted, fontWeight: '700' },
  choiceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: {
    width: '48.5%',
    minHeight: 46,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
  },
  choiceSelected: {
    borderColor: colors.accentBlue,
    backgroundColor: colors.infoSoft,
  },
  choiceText: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
  choiceTextSelected: { color: colors.accentBlue },
  summaryCard: {
    padding: spacing.md,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cardSoft,
    gap: 9,
  },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  summaryLabel: { flex: 1, minWidth: 0, fontSize: 12, color: colors.textMuted },
  summaryValue: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  summaryStrong: { maxWidth: '58%', fontSize: 14, fontWeight: '800', color: colors.success },
  summaryDivider: { height: 1, backgroundColor: colors.border },
  infoText: { ...typography.bodySmall, color: colors.textMuted, textAlign: 'center' },
  errorText: { ...typography.bodySmall, color: colors.danger, fontWeight: '700', textAlign: 'center' },
  submit: { minHeight: 50, marginTop: spacing.xs },
});

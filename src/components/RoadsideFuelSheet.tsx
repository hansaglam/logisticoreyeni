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
  calculateRoadsideFuelQuote,
  getRoadsideFuelLitersToDestination,
  type RoadsideFuelJob,
} from '../simulation/roadsideFuel';
import { IOS_STACKED_MODAL_PROPS } from '../utils/modalPresentation';
import { normalizeTruckFuel } from '../utils/truckFuel';
import { useAppSafeAreaInsets } from './AppSafeAreaProvider';
import { ActionButton, GameIcon, IconButton } from './ui';

type Choice = '25' | '50' | 'destination';

export interface RoadsideFuelSheetProps {
  visible: boolean;
  jobId: string | null;
  onClose: () => void;
  onSuccess?: (message: string) => void;
}

export default function RoadsideFuelSheet({
  visible,
  jobId,
  onClose,
  onSuccess,
}: RoadsideFuelSheetProps) {
  const insets = useAppSafeAreaInsets();
  const deliveries = useGameStore((state) => state.activeDeliveries);
  const transfers = useGameStore((state) => state.activeTransfers);
  const warehouseTransfers = useGameStore((state) => state.activeWarehouseStockTransfers);
  const trucks = useGameStore((state) => state.player?.trucks ?? []);
  const cash = useGameStore((state) => state.player?.money ?? 0);
  const fuelPrice = useGameStore((state) =>
    getSnapshotFuelPrice(state.cachedGlobalEconomySnapshot, state.globalEconomy),
  );
  const purchaseRoadsideFuel = useGameStore((state) => state.purchaseRoadsideFuel);
  const requestAssistance = useGameStore((state) => state.requestRoadsideFuelAssistance);
  const [choice, setChoice] = useState<Choice>('25');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [canRequestAssistance, setCanRequestAssistance] = useState(false);
  const lastJobIdRef = useRef<string | null>(jobId);
  if (jobId) lastJobIdRef.current = jobId;
  const shownRef = useRef(false);
  if (visible) shownRef.current = true;
  const transactionKeyRef = useRef('');

  const resolvedJobId = jobId ?? lastJobIdRef.current;
  const job = useMemo(
    () =>
      (deliveries.find((candidate) => candidate.id === resolvedJobId) ??
        transfers.find((candidate) => candidate.id === resolvedJobId) ??
        warehouseTransfers.find((candidate) => candidate.id === resolvedJobId)) as
        | RoadsideFuelJob
        | undefined,
    [deliveries, resolvedJobId, transfers, warehouseTransfers],
  );
  const truck = job ? trucks.find((candidate) => candidate.id === job.truckId) : undefined;

  if (typeof __DEV__ !== 'undefined' && __DEV__ && visible && truck) {
    console.log('[FUEL_DEBUG][MODAL_ROADSIDE]', {
      source: 'RoadsideFuelSheet → player.trucks.find(job.truckId)',
      id: truck.id,
      name: truck.name,
      jobId,
      jobTruckId: job?.truckId ?? null,
      fuel: truck.currentFuelL ?? null,
      capacity: truck.fuelTankCapacityL ?? null,
      status: truck.status,
      jobFuelLitersAtStart: job?.fuelLitersAtStart ?? null,
      jobFuelConsumedL: job?.fuelConsumedL ?? null,
    });
  }

  useEffect(() => {
    if (!visible) return;
    setChoice('25');
    setErrorMessage(null);
    setCanRequestAssistance(false);
    transactionKeyRef.current = '';
  }, [jobId, visible]);

  const targetLiters = job ? getRoadsideFuelLitersToDestination(job) : 0;
  const requestedLiters =
    choice === '25' ? 25 : choice === '50' ? 50 : Math.max(0, targetLiters);
  const quote = truck
    ? calculateRoadsideFuelQuote(truck, requestedLiters, fuelPrice)
    : null;

  const handlePurchase = () => {
    if (!resolvedJobId || !quote || !truck) return;
    if (!transactionKeyRef.current) {
      transactionKeyRef.current = `roadside:${resolvedJobId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    }
    const result = purchaseRoadsideFuel({
      jobId: resolvedJobId,
      liters: quote.litersToAdd,
      expectedUnitPrice: fuelPrice,
      idempotencyKey: transactionKeyRef.current,
    });
    if (!result.success) {
      setErrorMessage(result.message);
      setCanRequestAssistance(result.reason === 'insufficient-funds');
      return;
    }
    const verified = useGameStore.getState().player.trucks.find(
      (candidate) => candidate.id === truck.id,
    );
    const verifiedFuel = verified ? normalizeTruckFuel(verified).currentFuelL ?? 0 : null;
    if (verifiedFuel == null || Math.abs(verifiedFuel - quote.newFuelL) > 0.5) {
      setErrorMessage('Yakıt güncellemesi doğrulanamadı. Tekrar dene.');
      transactionKeyRef.current = '';
      return;
    }
    onSuccess?.(result.message);
    onClose();
  };

  const handleAssistance = () => {
    if (!jobId) return;
    const result = requestAssistance(jobId);
    if (!result.success) {
      setErrorMessage(result.message);
      return;
    }
    onSuccess?.(result.message);
    onClose();
  };

  if (!shownRef.current) return null;
  if (!job || !truck) {
    return (
      <Modal
        visible={visible}
        transparent
        animationType="slide"
        statusBarTranslucent
        onRequestClose={onClose}
        {...IOS_STACKED_MODAL_PROPS}
      />
    );
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
      {...IOS_STACKED_MODAL_PROPS}
    >
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) + spacing.md }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.emergencyIcon}>
              <GameIcon name="fuel" size={20} color={colors.danger} />
            </View>
            <View style={styles.headerText}>
              <Text style={styles.title}>Acil Yakıt</Text>
              <Text style={styles.subtitle} numberOfLines={1}>{truck.name} · rota üzerinde</Text>
            </View>
            <IconButton icon="close" onPress={onClose} />
          </View>

          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={styles.warning}>
              <Text style={styles.warningText}>Yakıt bitti. Araç rota üzerinde durdu.</Text>
              <Text style={styles.warningMeta}>
                İlerleme korunur; yakıt geldikten sonra araç kaldığı yerden devam eder.
              </Text>
            </View>

            <View style={styles.choiceRow}>
              {([
                ['25', '25 L'],
                ['50', '50 L'],
                ['destination', 'Hedefe Yetecek'],
              ] as Array<[Choice, string]>).map(([id, label]) => (
                <TouchableOpacity
                  key={id}
                  style={[styles.choice, choice === id && styles.choiceSelected]}
                  onPress={() => {
                    setChoice(id);
                    setErrorMessage(null);
                    setCanRequestAssistance(false);
                    transactionKeyRef.current = '';
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: choice === id }}
                >
                  <Text
                    style={[styles.choiceText, choice === id && styles.choiceTextSelected]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                  >
                    {label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {quote ? (
              <View style={styles.summary}>
                <View style={styles.row}><Text style={styles.label}>Yakıt</Text><Text style={styles.value}>{quote.litersToAdd.toFixed(1)} L</Text></View>
                <View style={styles.row}><Text style={styles.label}>Yol kenarı litre fiyatı</Text><Text style={styles.value}>{formatUnitPrice(quote.roadsideUnitPrice, '/L')}</Text></View>
                <View style={styles.row}><Text style={styles.label}>Yakıt bedeli</Text><Text style={styles.value}>{formatMoneyDecimal(quote.fuelCost)}</Text></View>
                <View style={styles.row}><Text style={styles.label}>Servis ücreti</Text><Text style={styles.value}>{formatMoneyDecimal(quote.serviceFee)}</Text></View>
                <View style={styles.divider} />
                <View style={styles.row}><Text style={styles.label}>Toplam</Text><Text style={styles.total}>{formatMoneyDecimal(quote.totalCost)}</Text></View>
                <View style={styles.row}><Text style={styles.label}>Nakit</Text><Text style={styles.value}>{formatMoney(cash)}</Text></View>
              </View>
            ) : null}

            {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
            {canRequestAssistance ? (
              <ActionButton
                label="Sınırlı Yol Yardımı İste"
                onPress={handleAssistance}
                variant="secondary"
                fullWidth
                style={styles.assistance}
              />
            ) : null}
          </ScrollView>

          <ActionButton
            label={quote ? `${formatMoneyDecimal(quote.totalCost)} Öde ve Devam Et` : 'Acil Yakıt Al'}
            icon="fuel"
            onPress={handlePurchase}
            disabled={!quote || quote.litersToAdd <= 0}
            fullWidth
            style={styles.submit}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(2,8,20,0.76)' },
  sheet: {
    maxHeight: '90%',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
  },
  handle: { width: 42, height: 4, borderRadius: 99, backgroundColor: colors.borderStrong, alignSelf: 'center' },
  header: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  emergencyIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.dangerSoft },
  headerText: { flex: 1, minWidth: 0 },
  title: { ...typography.sectionTitle, color: colors.textPrimary },
  subtitle: { ...typography.caption, color: colors.textMuted },
  content: { paddingVertical: spacing.md, gap: spacing.md },
  warning: { padding: spacing.md, borderRadius: 14, backgroundColor: colors.dangerSoft, borderWidth: 1, borderColor: colors.danger },
  warningText: { ...typography.bodySmall, color: colors.danger, fontWeight: '800' },
  warningMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 5 },
  choiceRow: { flexDirection: 'row', gap: 7 },
  choice: { flex: 1, minWidth: 0, minHeight: 46, paddingHorizontal: 5, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  choiceSelected: { borderColor: colors.accentBlue, backgroundColor: colors.infoSoft },
  choiceText: { fontSize: 10.5, fontWeight: '700', color: colors.textSecondary },
  choiceTextSelected: { color: colors.accentBlue },
  summary: { padding: spacing.md, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.cardSoft, gap: 9 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  label: { flex: 1, minWidth: 0, fontSize: 12, color: colors.textMuted },
  value: { fontSize: 12.5, fontWeight: '700', color: colors.textPrimary },
  total: { fontSize: 15, fontWeight: '800', color: colors.accentAmber },
  divider: { height: 1, backgroundColor: colors.border },
  error: { ...typography.bodySmall, color: colors.danger, textAlign: 'center', fontWeight: '700' },
  assistance: { minHeight: 46 },
  submit: { minHeight: 50, marginTop: spacing.xs },
});

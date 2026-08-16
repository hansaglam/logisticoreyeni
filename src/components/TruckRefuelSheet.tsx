import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { useGameStore } from '../store/gameStore';
import {
  isFuelPricePurchaseReady,
  resolveFuelPriceQuote,
} from '../simulation/fuelPriceQuote';
import { colors, spacing, typography } from '../theme';
import { formatMoney, formatMoneyDecimal, formatUnitPrice } from '../theme/format';
import type { GameIconName } from '../theme/icons';
import { IOS_STACKED_MODAL_PROPS } from '../utils/modalPresentation';
import {
  calculateTruckRefuelQuote,
  getTruckFuelPercent,
  getTruckRangeKm,
  normalizeTruckFuel,
} from '../utils/truckFuel';
import type { TruckRefuelReason } from '../utils/truckFuel';
import type { Truck } from '../types/game';
import { useAppSafeAreaInsets } from './AppSafeAreaProvider';
import { ActionButton, GameIcon, IconButton, ProgressBar } from './ui';

type RefuelChoice = '25' | '50' | 'full' | 'max';

export interface TruckRefuelSheetProps {
  visible: boolean;
  truck: Truck | null;
  /** When opened from insufficient-route flow, prefer covering at least this many liters. */
  preferredMinimumLiters?: number | null;
  onClose: () => void;
  onSuccess?: (message: string) => void;
  /** Overlay inside an already-open Modal — iOS cannot stack a second RN Modal. */
  embedded?: boolean;
  source?: 'job_assignment' | 'fleet' | 'transfer' | 'warehouse' | 'map';
}

const CHOICES: Array<{ id: RefuelChoice; label: string; icon: GameIconName }> = [
  { id: '25', label: '25 L', icon: 'fuel' },
  { id: '50', label: '50 L', icon: 'fuel' },
  { id: 'full', label: 'Tam Doldur', icon: 'refresh' },
  { id: 'max', label: 'Maksimum Al', icon: 'level' },
];

const REFUEL_ERROR_MESSAGES: Record<TruckRefuelReason, string> = {
  'insufficient-funds': 'Yakıt almak için yeterli nakdin yok.',
  'tank-full': 'Yakıt deposu zaten dolu.',
  'price-changed': 'Yakıt fiyatı güncellendi. Yeni toplamı kontrol et.',
  'truck-busy': 'Aktif görevdeki araç şehir istasyonundan yakıt alamaz.',
  'truck-not-found': 'Kamyon bulunamadı.',
  'invalid-quantity': 'Geçerli bir yakıt miktarı seç.',
  'market-unavailable': 'Yakıt fiyatına ulaşılamıyor.',
};

function formatLiters(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1);
}

export default function TruckRefuelSheet({
  visible,
  truck,
  preferredMinimumLiters = null,
  onClose,
  onSuccess,
  embedded = false,
  source,
}: TruckRefuelSheetProps) {
  const lastTruckRef = useRef<Truck | null>(truck);
  if (truck) lastTruckRef.current = truck;
  const displayTruck = truck ?? lastTruckRef.current;
  if (!displayTruck) return null;
  if (embedded && !visible) return null;
  // Android: unmount when closed. iOS must keep Modal mounted with visible=false
  // so native dismiss can finish; returning null here left fuel state stale.
  if (!visible && Platform.OS !== 'ios') return null;

  return (
    <TruckRefuelSheetContent
      visible={visible}
      truck={displayTruck}
      preferredMinimumLiters={preferredMinimumLiters}
      onClose={onClose}
      onSuccess={onSuccess}
      embedded={embedded}
      source={source}
    />
  );
}

function TruckRefuelSheetContent({
  visible,
  truck,
  preferredMinimumLiters = null,
  onClose,
  onSuccess,
  embedded = false,
  source,
}: TruckRefuelSheetProps) {
  const insets = useAppSafeAreaInsets();
  const liveTruck = useGameStore((state) =>
    truck ? state.player?.trucks.find((candidate) => candidate.id === truck.id) : undefined,
  );
  const cash = useGameStore((state) => state.player?.money ?? 0);
  const cachedSnapshot = useGameStore((state) => state.cachedGlobalEconomySnapshot);
  const cachedSnapshotTrusted = useGameStore(
    (state) => state.cachedGlobalEconomySnapshotTrusted === true,
  );
  const marketSyncStatus = useGameStore((state) => state.globalMarketSyncStatus);
  const marketLastSyncedAtMs = useGameStore((state) => state.globalMarketLastSyncedAtMs);
  const refreshMarketSnapshot = useGameStore((state) => state.refreshMarketSnapshot);
  const refuelTruck = useGameStore((state) => state.refuelTruck);
  const [choice, setChoice] = useState<RefuelChoice>('25');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshingPrice, setIsRefreshingPrice] = useState(false);
  const transactionKeyRef = useRef('');
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initializedTruckIdRef = useRef(truck?.id);
  const renderCountRef = useRef(0);
  const renderWarningSentRef = useRef(false);

  renderCountRef.current += 1;

  const fuelPriceQuote = useMemo(
    () =>
      resolveFuelPriceQuote({
        snapshot: cachedSnapshot,
        trusted: cachedSnapshotTrusted,
        syncStatus: marketSyncStatus,
        development: typeof __DEV__ !== 'undefined' && __DEV__,
        lastSyncedAtMs: marketLastSyncedAtMs,
      }),
    [cachedSnapshot, cachedSnapshotTrusted, marketLastSyncedAtMs, marketSyncStatus],
  );

  const selectedTruck = liveTruck ?? truck;
  const normalizedTruck = useMemo(
    () => (selectedTruck ? normalizeTruckFuel(selectedTruck) : null),
    [selectedTruck],
  );

  if (typeof __DEV__ !== 'undefined' && __DEV__ && visible && selectedTruck) {
    console.log('[FUEL_DEBUG][MODAL_CITY]', {
      source: source ?? 'TruckRefuelSheet → liveTruck from store by truck.id ?? prop',
      id: selectedTruck.id,
      name: selectedTruck.name,
      propId: truck?.id ?? null,
      usedLiveStore: Boolean(liveTruck),
      fuel: normalizedTruck?.currentFuelL ?? null,
      capacity: normalizedTruck?.fuelTankCapacityL ?? null,
      status: selectedTruck.status,
    });
  }

  const pricePerLiter = fuelPriceQuote.pricePerLiter;
  const priceReady = isFuelPricePurchaseReady(fuelPriceQuote);

  useEffect(() => {
    if (initializedTruckIdRef.current === truck?.id) return;
    initializedTruckIdRef.current = truck?.id;
    setChoice('25');
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsSubmitting(false);
    setIsRefreshingPrice(false);
    transactionKeyRef.current = '';
  }, [truck?.id]);

  useEffect(() => {
    if (!visible || preferredMinimumLiters == null || preferredMinimumLiters <= 0) return;
    if (preferredMinimumLiters <= 25) {
      setChoice('25');
    } else if (preferredMinimumLiters <= 50) {
      setChoice('50');
    } else {
      setChoice('full');
    }
  }, [preferredMinimumLiters, visible, truck?.id]);

  useEffect(
    () => () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    },
    [],
  );

  // Live fiyat geldiğinde stale action hatalarını temizle.
  useEffect(() => {
    if (fuelPriceQuote.source === 'live' && fuelPriceQuote.errorCode == null) {
      setErrorMessage((current) => (current == null ? current : null));
    }
  }, [fuelPriceQuote.source, fuelPriceQuote.errorCode, fuelPriceQuote.pricePerLiter]);

  const tankCapacity = normalizedTruck?.fuelTankCapacityL ?? 0;
  const currentFuel = normalizedTruck?.currentFuelL ?? 0;
  const availableTankSpace = Math.max(0, tankCapacity - currentFuel);
  const requestedLiters = useMemo(() => {
    if (!priceReady || pricePerLiter == null) return 0;
    if (choice === '25') return 25;
    if (choice === '50') return 50;
    if (choice === 'full') return availableTankSpace;
    if (pricePerLiter <= 0 || cash <= 0) return 0;
    return Math.min(availableTankSpace, Math.floor((cash / pricePerLiter) * 1000) / 1000);
  }, [availableTankSpace, cash, choice, pricePerLiter, priceReady]);

  const quote = useMemo(() => {
    if (!normalizedTruck || !priceReady || pricePerLiter == null) return null;
    return calculateTruckRefuelQuote(normalizedTruck, requestedLiters, pricePerLiter);
  }, [normalizedTruck, requestedLiters, pricePerLiter, priceReady]);

  const fuelPercent = normalizedTruck ? getTruckFuelPercent(normalizedTruck) : 0;
  const rangeKm = normalizedTruck ? getTruckRangeKm(normalizedTruck) : 0;
  const tankFull = availableTankSpace <= 1e-6;
  const hasUsableCash = cash > 0;
  const canAffordQuote = !!quote && cash >= quote.totalCost;
  const canSubmit =
    !!normalizedTruck &&
    !!quote &&
    quote.litersToAdd > 0 &&
    Number.isFinite(quote.totalCost) &&
    priceReady &&
    pricePerLiter != null &&
    pricePerLiter > 0 &&
    canAffordQuote &&
    !isSubmitting &&
    !isRefreshingPrice;

  useEffect(() => {
    if (
      typeof __DEV__ !== 'undefined' &&
      __DEV__ &&
      renderCountRef.current > 20 &&
      !renderWarningSentRef.current
    ) {
      renderWarningSentRef.current = true;
      console.warn('[truck-refuel-render-loop]', {
        renderCount: renderCountRef.current,
        isVisible: visible,
        truckIdPresent: Boolean(selectedTruck?.id),
        selectedLiters: requestedLiters,
        fillMode: choice,
        priceSource: fuelPriceQuote.source,
        totalFinite: quote == null || Number.isFinite(quote.totalCost),
      });
    }
  });

  const handleRefreshPrice = useCallback(async () => {
    setIsRefreshingPrice(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      await refreshMarketSnapshot();
    } finally {
      setIsRefreshingPrice(false);
      transactionKeyRef.current = '';
    }
  }, [refreshMarketSnapshot]);

  const handleSubmit = () => {
    if (!visible || !normalizedTruck || !quote || isSubmitting || !priceReady || pricePerLiter == null) {
      return;
    }
    setIsSubmitting(true);
    setSuccessMessage(null);
    if (!transactionKeyRef.current) {
      transactionKeyRef.current =
        `refuel:${normalizedTruck.id}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    }
    const result = refuelTruck({
      truckId: normalizedTruck.id,
      liters: quote.litersToAdd,
      expectedUnitPrice: quote.unitPrice,
      idempotencyKey: transactionKeyRef.current,
    });
    if (!result.success) {
      setErrorMessage(
        result.reason ? REFUEL_ERROR_MESSAGES[result.reason] : result.message,
      );
      setIsSubmitting(false);
      return;
    }

    // Re-read canonical fleet fuel before celebrating success (guards stale UI).
    const verified = useGameStore.getState().player.trucks.find(
      (candidate) => candidate.id === normalizedTruck.id,
    );
    const verifiedFuel = verified ? normalizeTruckFuel(verified).currentFuelL ?? 0 : null;
    if (verifiedFuel == null || Math.abs(verifiedFuel - quote.newFuelL) > 0.5) {
      setErrorMessage('Yakıt güncellemesi doğrulanamadı. Tekrar dene.');
      setIsSubmitting(false);
      transactionKeyRef.current = '';
      return;
    }

    setErrorMessage(null);
    setSuccessMessage(result.message);
    onSuccess?.(result.message);
    closeTimerRef.current = setTimeout(() => {
      setIsSubmitting(false);
      onClose();
    }, 450);
  };

  if (!selectedTruck) return null;

  const bottomPadding = Math.max(insets.bottom, 12) + spacing.sm;
  const submitLabel = isSubmitting
    ? 'Yakıt dolduruluyor...'
    : quote && priceReady
      ? `${formatMoneyDecimal(quote.totalCost)} Öde ve Doldur`
      : 'Yakıt Al';
  const priceDisplay =
    pricePerLiter != null && Number.isFinite(pricePerLiter)
      ? formatUnitPrice(pricePerLiter, '/L')
      : '—';

  const sheet = (
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: bottomPadding }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.headerIcon}>
              <GameIcon name="fuel" size={22} color={colors.accentBlue} />
            </View>
            <View style={styles.headerText}>
              <Text style={styles.title}>Yakıt Al</Text>
              <View style={styles.truckRow}>
                <GameIcon name="truck" size={12} color={colors.textMuted} />
                <Text style={styles.truckName} numberOfLines={1}>
                  {selectedTruck.name}
                </Text>
              </View>
            </View>
            <IconButton icon="close" onPress={onClose} />
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            <View style={styles.fuelCard}>
              <View style={styles.fuelTopRow}>
                <View style={styles.fuelIdentity}>
                  <View style={styles.fuelGaugeIcon}>
                    <GameIcon name="fuel" size={22} color={colors.accentBlue} />
                  </View>
                  <Text style={styles.fuelAmount} numberOfLines={1} adjustsFontSizeToFit>
                    {formatLiters(currentFuel)} / {formatLiters(tankCapacity)} L
                  </Text>
                </View>
                <Text style={styles.fuelPercent}>%{fuelPercent}</Text>
              </View>
              <ProgressBar progress={fuelPercent / 100} height={7} color={colors.accentBlue} />
              <View style={styles.metricRow}>
                <View style={styles.metric}>
                  <GameIcon name="distance" size={15} color={colors.warning} />
                  <Text style={styles.metricLabel}>Tahmini menzil</Text>
                  <Text style={[styles.metricValue, styles.rangeValue]} numberOfLines={1} adjustsFontSizeToFit>
                    {Number.isFinite(rangeKm) ? `${Math.floor(rangeKm)} km` : 'Sınırsız'}
                  </Text>
                </View>
                <View style={styles.metric}>
                  <GameIcon name="fuel" size={15} color={colors.warning} />
                  <Text style={styles.metricLabel}>{fuelPriceQuote.priceLabel}</Text>
                  <Text style={[styles.metricValue, styles.priceValue]} numberOfLines={1} adjustsFontSizeToFit>
                    {priceDisplay}
                  </Text>
                </View>
                <View style={styles.metric}>
                  <GameIcon name="cash" size={15} color={cash >= 0 ? colors.success : colors.danger} />
                  <Text style={styles.metricLabel}>Nakit</Text>
                  <Text
                    style={[
                      styles.metricValue,
                      { color: cash >= 0 ? colors.success : colors.danger },
                    ]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                  >
                    {formatMoney(cash)}
                  </Text>
                </View>
              </View>
            </View>

            {fuelPriceQuote.statusTone === 'amber' && fuelPriceQuote.statusMessage ? (
              <View style={styles.amberBanner}>
                <GameIcon name="warning" size={15} color={colors.warning} />
                <Text style={styles.amberBannerText}>{fuelPriceQuote.statusMessage}</Text>
              </View>
            ) : null}

            {fuelPriceQuote.statusTone === 'danger' && fuelPriceQuote.statusMessage ? (
              <View style={styles.dangerBanner}>
                <GameIcon name="warning" size={15} color={colors.danger} />
                <Text style={styles.dangerBannerText}>{fuelPriceQuote.statusMessage}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={styles.retryRow}
              onPress={() => {
                void handleRefreshPrice();
              }}
              disabled={isRefreshingPrice}
              accessibilityRole="button"
            >
              <GameIcon
                name="refresh"
                size={14}
                color={isRefreshingPrice ? colors.textMuted : colors.accentBlue}
              />
              <Text style={[styles.retryText, isRefreshingPrice && styles.retryTextDisabled]}>
                {isRefreshingPrice ? 'Fiyat yenileniyor...' : 'Fiyatı Yenile'}
              </Text>
            </TouchableOpacity>

            <View style={styles.sectionTitleRow}>
              <View style={styles.sectionLine} />
              <Text style={styles.sectionLabel}>DOLUM SEÇENEKLERİ</Text>
              <View style={styles.sectionLine} />
            </View>
            <View style={styles.choiceGrid}>
              {CHOICES.map((item) => {
                const selected = item.id === choice;
                const disabled = tankFull || !hasUsableCash || !priceReady;
                return (
                  <TouchableOpacity
                    key={item.id}
                    style={[
                      styles.choice,
                      selected && styles.choiceSelected,
                      disabled && styles.choiceDisabled,
                    ]}
                    onPress={() => {
                      setChoice(item.id);
                      setErrorMessage(null);
                      transactionKeyRef.current = '';
                    }}
                    disabled={disabled}
                    activeOpacity={0.84}
                    accessibilityRole="button"
                    accessibilityState={{ selected, disabled }}
                  >
                    <GameIcon
                      name={item.icon}
                      size={19}
                      color={selected ? colors.accentBlue : colors.textMuted}
                    />
                    <Text
                      style={[styles.choiceText, selected && styles.choiceTextSelected]}
                      numberOfLines={2}
                      adjustsFontSizeToFit
                    >
                      {item.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {quote && priceReady ? (
              <View style={styles.summaryCard}>
                <View style={styles.summaryTitleRow}>
                  <GameIcon name="contract" size={15} color={colors.accentBlue} />
                  <Text style={styles.summaryTitle}>İŞLEM ÖZETİ</Text>
                </View>
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
                  <Text style={[styles.summaryLabel, styles.summaryGreenLabel]}>Yeni yakıt</Text>
                  <Text style={styles.summaryStrong} numberOfLines={1} adjustsFontSizeToFit>
                    {formatLiters(quote.newFuelL)} / {formatLiters(quote.fuelTankCapacityL)} L
                  </Text>
                </View>
              </View>
            ) : null}

            {!priceReady ? (
              <Text style={styles.infoText}>Toplam: —</Text>
            ) : null}

            {tankFull ? <Text style={styles.infoText}>Yakıt deposu zaten dolu.</Text> : null}
            {!tankFull && priceReady && !hasUsableCash ? (
              <View style={styles.cashWarning}>
                <GameIcon name="warning" size={16} color={colors.warning} />
                <Text style={styles.cashWarningText}>
                  Normal yakıt alımı için yeterli kullanılabilir nakit yok.
                </Text>
              </View>
            ) : null}
            {!tankFull && priceReady && hasUsableCash && quote && !canAffordQuote ? (
              <Text style={styles.errorText}>Yakıt almak için yeterli nakdin yok.</Text>
            ) : null}
            {/* Action-level errors only; never also show price status danger twice */}
            {errorMessage && fuelPriceQuote.statusTone !== 'danger' ? (
              <Text style={styles.errorText}>{errorMessage}</Text>
            ) : null}
            {successMessage ? (
              <View style={styles.successFeedback}>
                <GameIcon name="success" size={16} color={colors.success} />
                <Text style={styles.successText}>{successMessage}</Text>
              </View>
            ) : null}
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
  );

  if (embedded) {
    return (
      <View style={styles.embeddedRoot} pointerEvents="box-none">
        {sheet}
      </View>
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
      {sheet}
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(2, 8, 20, 0.78)',
  },
  embeddedRoot: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 50,
  },
  sheet: {
    maxHeight: '89%',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 999,
    backgroundColor: colors.borderStrong,
    alignSelf: 'center',
    marginBottom: spacing.xs,
  },
  header: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  headerIcon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.accentBlue,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentBlueSoft,
  },
  headerText: { flex: 1, minWidth: 0 },
  title: { ...typography.sectionTitle, color: colors.textPrimary, fontSize: 20 },
  truckRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  truckName: { ...typography.caption, flex: 1, color: colors.textMuted },
  scroll: { flexGrow: 0 },
  content: { paddingVertical: spacing.sm, gap: spacing.sm },
  fuelCard: {
    padding: spacing.sm,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cardSoft,
    gap: spacing.sm,
  },
  fuelTopRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  fuelIdentity: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  fuelGaugeIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  fuelAmount: { flex: 1, fontSize: 21, fontWeight: '800', color: colors.textPrimary },
  fuelPercent: { fontSize: 20, fontWeight: '900', color: colors.accentBlue },
  metricRow: {
    minHeight: 62,
    flexDirection: 'row',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
    overflow: 'hidden',
  },
  metric: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    paddingVertical: 6,
    borderRightWidth: 1,
    borderRightColor: colors.divider,
  },
  metricLabel: { marginTop: 2, fontSize: 8.5, color: colors.textMuted, textAlign: 'center' },
  metricValue: { fontSize: 12, fontWeight: '800', color: colors.textPrimary, marginTop: 2 },
  rangeValue: { color: colors.warning },
  priceValue: { color: colors.warning },
  amberBanner: {
    minHeight: 40,
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: 'rgba(255, 170, 0, 0.36)',
    backgroundColor: colors.warningSoft,
  },
  amberBannerText: { ...typography.caption, flex: 1, color: colors.warning, lineHeight: 16 },
  dangerBanner: {
    minHeight: 40,
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: 'rgba(255, 80, 80, 0.35)',
    backgroundColor: colors.dangerSoft,
  },
  dangerBannerText: { ...typography.caption, flex: 1, color: colors.danger, lineHeight: 16 },
  retryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  retryText: { ...typography.caption, color: colors.accentBlue, fontWeight: '700' },
  retryTextDisabled: { color: colors.textMuted },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sectionLine: { flex: 1, height: 1, backgroundColor: colors.divider },
  sectionLabel: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '800',
    letterSpacing: 0.7,
  },
  choiceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: {
    width: '48.7%',
    minHeight: 54,
    paddingHorizontal: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
  },
  choiceSelected: {
    borderColor: colors.accentBlue,
    backgroundColor: colors.accentBlueSoft,
    shadowColor: colors.accentBlue,
    shadowOpacity: 0.24,
    shadowRadius: 5,
    elevation: 2,
  },
  choiceDisabled: { opacity: 0.5 },
  choiceText: { maxWidth: '72%', fontSize: 12, lineHeight: 15, fontWeight: '700', color: colors.textSecondary, textAlign: 'center' },
  choiceTextSelected: { color: colors.accentBlue },
  summaryCard: {
    padding: spacing.sm,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cardSoft,
    gap: 7,
  },
  summaryTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: 2 },
  summaryTitle: { ...typography.caption, color: colors.textMuted, fontWeight: '800', letterSpacing: 0.5 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  summaryLabel: { flex: 1, minWidth: 0, fontSize: 12, color: colors.textMuted },
  summaryGreenLabel: { color: colors.success },
  summaryValue: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  summaryStrong: { maxWidth: '60%', fontSize: 14, fontWeight: '900', color: colors.success },
  summaryDivider: { height: 1, borderStyle: 'dashed', borderWidth: 0.5, borderColor: colors.borderStrong },
  infoText: { ...typography.bodySmall, color: colors.textMuted, textAlign: 'center' },
  cashWarning: {
    minHeight: 42,
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: 'rgba(255, 170, 0, 0.36)',
    backgroundColor: colors.warningSoft,
  },
  cashWarningText: { ...typography.caption, flex: 1, color: colors.warning, lineHeight: 16 },
  errorText: { ...typography.bodySmall, color: colors.danger, fontWeight: '700', textAlign: 'center' },
  successFeedback: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderRadius: 10,
    backgroundColor: colors.successSoft,
  },
  successText: { ...typography.caption, color: colors.success, fontWeight: '800' },
  submit: { minHeight: 52, marginTop: spacing.xs },
});

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

import { getModalSheetPaddingBottom } from '../constants/layout';
import { ActionButton, GameIcon, IconButton } from './ui';
import { CITIES_BY_ID, CITY_IDS } from '../data/cities';
import { useAppSafeAreaInsets } from './AppSafeAreaProvider';
import {
  estimateTransferForRoute,
  resolveTransferRoute,
  selectDriverForTransfer,
} from '../simulation/truckTransfer';
import { resolveTruckCityId } from '../simulation/delivery';
import { calculateTransferFuelLiters, getTruckFuelReadiness } from '../utils/truckFuel';
import { useGameStore } from '../store/gameStore';
import { getSnapshotFuelPrice } from '../simulation/globalMarketSnapshot';
import { colors, formatMoney, spacing, typography } from '../theme';
import { formatCityLocative } from '../theme/format';
import type { Route, Truck } from '../types/game';
import TruckRefuelSheet from './TruckRefuelSheet';
import FuelRequirementModal from './FuelRequirementModal';

const TRANSFER_CITY_IDS = CITY_IDS;
const FOOTER_SUMMARY_HEIGHT = 72;
const FOOTER_BUTTON_HEIGHT = 48;

export interface TruckTransferModalProps {
  visible: boolean;
  truck: Truck | null;
  initialToCityId?: string;
  onClose: () => void;
  onStarted?: (message: string) => void;
  onError?: (message: string) => void;
}

function getCityName(cityId: string): string {
  return CITIES_BY_ID[cityId]?.name ?? 'Bilinmeyen şehir';
}

function formatTransferDuration(hours: number): string {
  const totalHours = Math.max(1, Math.round(hours));
  if (totalHours < 24) return `${totalHours} sa`;
  const days = Math.floor(totalHours / 24);
  const remaining = totalHours % 24;
  return remaining > 0 ? `${days}g ${remaining}s` : `${days}g`;
}

function resolveTransferButtonLabel(params: {
  hasDriver: boolean;
  hasSelection: boolean;
}): string {
  if (!params.hasDriver) return 'Müsait şoför yok';
  if (!params.hasSelection) return 'Hedef şehir seç';
  return 'Transferi Başlat';
}

interface CityTransferOption {
  cityId: string;
  cityName: string;
  route?: Route;
  disabled: boolean;
  durationHours: number;
  fuelCost: number;
  driverCost: number;
  totalCost: number;
}

export default function TruckTransferModal({
  visible,
  truck: truckProp,
  initialToCityId,
  onClose,
  onStarted,
  onError,
}: TruckTransferModalProps) {
  const insets = useAppSafeAreaInsets();
  const routes = useGameStore((state) => state.routes) ?? [];
  const drivers = useGameStore((state) => state.player?.drivers) ?? [];
  const trailers = useGameStore((state) => state.player?.trailers) ?? [];
  const playerMoney = useGameStore((state) => state.player?.money) ?? 0;
  const homeCityId = useGameStore((state) => state.player?.homeCityId);
  const fuelPrice = useGameStore((state) =>
    getSnapshotFuelPrice(state.cachedGlobalEconomySnapshot, state.globalEconomy),
  );
  const startTruckTransfer = useGameStore((state) => state.startTruckTransfer);
  const truck = useGameStore((state) =>
    truckProp ? state.player?.trucks.find((candidate) => candidate.id === truckProp.id) : undefined,
  ) ?? truckProp;

  const [selectedCityId, setSelectedCityId] = useState<string | null>(null);
  const [refuelVisible, setRefuelVisible] = useState(false);
  const [fuelRequirementVisible, setFuelRequirementVisible] = useState(false);

  const fromCityId = useMemo(() => {
    if (!truck) return 'izmir';
    return resolveTruckCityId(truck, homeCityId);
  }, [truck, homeCityId]);

  const assignedDriver = useMemo(() => {
    if (!truck) return undefined;
    return selectDriverForTransfer(truck.id, drivers);
  }, [truck, drivers]);
  const attachedTrailer = useMemo(
    () => trailers.find((trailer) => trailer.attachedTruckId === truck?.id),
    [trailers, truck?.id],
  );

  const cityOptions = useMemo((): CityTransferOption[] => {
    if (!truck || !assignedDriver) return [];

    return TRANSFER_CITY_IDS.map((cityId) => {
      const disabled = cityId === fromCityId;
      const route = disabled ? undefined : resolveTransferRoute(routes, fromCityId, cityId);
      if (!route) {
        return {
          cityId,
          cityName: getCityName(cityId),
          disabled: true,
          durationHours: 0,
          fuelCost: 0,
          driverCost: 0,
          totalCost: 0,
        };
      }

      const estimate = estimateTransferForRoute({
        truck,
        driver: assignedDriver,
        route,
        trailer: attachedTrailer,
        fuelPrice,
      });

      return {
        cityId,
        cityName: getCityName(cityId),
        route,
        disabled,
        ...estimate,
      };
    });
  }, [truck, assignedDriver, routes, fromCityId, fuelPrice, attachedTrailer]);

  const selectedOption = cityOptions.find((option) => option.cityId === selectedCityId);
  const fuelReadiness = useMemo(() => {
    if (!truck || !assignedDriver || !selectedOption?.route) return null;
    return getTruckFuelReadiness(
      truck,
      calculateTransferFuelLiters(truck, selectedOption.route, assignedDriver),
      fuelPrice ?? 0,
    );
  }, [assignedDriver, fuelPrice, selectedOption?.route, truck]);

  useEffect(() => {
    if (!visible) {
      setSelectedCityId(null);
      setFuelRequirementVisible(false);
      setRefuelVisible(false);
      return;
    }

    const preferred =
      initialToCityId && initialToCityId !== fromCityId ? initialToCityId : null;
    const firstSelectable = cityOptions.find((option) => !option.disabled && option.route);
    setSelectedCityId((current) => {
      const currentStillValid = cityOptions.some(
        (option) => option.cityId === current && !option.disabled && option.route,
      );
      return currentStillValid ? current : preferred ?? firstSelectable?.cityId ?? null;
    });
  }, [visible, initialToCityId, fromCityId, cityOptions]);

  const canStartBase =
    !!truck &&
    !!assignedDriver &&
    !!selectedOption &&
    !selectedOption.disabled &&
    !!selectedOption.route;
  const buttonLabel = resolveTransferButtonLabel({
    hasDriver: !!assignedDriver,
    hasSelection: !!selectedOption?.route,
  });

  const handleStart = () => {
    if (!truck || !selectedCityId) return;
    if (fuelReadiness?.canCompleteWithoutRefuel === false) {
      setFuelRequirementVisible(true);
      return;
    }

    const result = startTruckTransfer({
      truckId: truck.id,
      toCityId: selectedCityId,
      driverId: assignedDriver?.id,
    });

    if (result.success) {
      onStarted?.(result.message ?? 'Transfer başladı.');
      onClose();
      return;
    }

    onError?.(result.message ?? 'Transfer başlatılamadı.');
  };

  const footerBottomPadding = getModalSheetPaddingBottom(insets);
  const scrollBottomPadding = FOOTER_SUMMARY_HEIGHT + FOOTER_BUTTON_HEIGHT + footerBottomPadding + 24;

  return (
    <>
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.overlay}>
        <Pressable style={styles.overlayPressable} onPress={onClose} />

        <View style={styles.sheet}>
          <View style={styles.handleWrap}>
            <View style={styles.handle} />
          </View>

          <View style={styles.header}>
            <IconButton
              icon="close"
              onPress={onClose}
              size={20}
              color={colors.textPrimary}
              backgroundColor={colors.surface2}
              style={styles.closeButton}
            />
            <Text style={styles.headerTitle}>Kamyonu Yönlendir</Text>
            <View style={styles.headerSideSpacer} />
          </View>

          {truck ? (
            <Text style={styles.subtitle}>
              {truck.name} şu anda {formatCityLocative(fromCityId, getCityName(fromCityId))}.
            </Text>
          ) : null}

          {!assignedDriver ? (
            <View style={styles.warningCard}>
              <Text style={styles.warningText}>Boş transfer için müsait şoför gerekiyor.</Text>
            </View>
          ) : null}

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={[styles.scrollContent, { paddingBottom: scrollBottomPadding }]}
            showsVerticalScrollIndicator={false}
            bounces
          >
            {cityOptions.map((option) => {
              const isSelected = option.cityId === selectedCityId;
              const isDisabled = option.disabled || !option.route;

              return (
                <TouchableOpacity
                  key={option.cityId}
                  style={[
                    styles.cityCard,
                    isSelected && styles.cityCardSelected,
                    isDisabled && styles.cityCardDisabled,
                  ]}
                  onPress={() => {
                    if (!isDisabled) setSelectedCityId(option.cityId);
                  }}
                  disabled={isDisabled}
                  activeOpacity={0.85}
                >
                  <View style={styles.cityCardTop}>
                    <Text style={[styles.cityName, isDisabled && styles.cityNameDisabled]}>
                      {option.cityName}
                    </Text>
                    {isSelected ? <GameIcon name="success" size={16} color={colors.accentBlue} /> : null}
                  </View>

                  {option.disabled ? (
                    <Text style={styles.cityMetaMuted}>Mevcut konum</Text>
                  ) : option.route ? (
                    <>
                      <Text style={styles.cityMeta}>
                        {Math.round(option.route.distanceKm)} km ·{' '}
                        {formatTransferDuration(option.durationHours)}
                      </Text>
                      <Text style={styles.cityMeta}>
                        Yakıt {formatMoney(option.fuelCost)} · Şoför {formatMoney(option.driverCost)}
                      </Text>
                      <Text style={styles.cityCost}>Toplam {formatMoney(option.totalCost)}</Text>
                    </>
                  ) : (
                    <Text style={styles.cityMetaMuted}>Rota yok</Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <View style={[styles.footer, { paddingBottom: footerBottomPadding }]}>
            {selectedOption?.route ? (
              <View style={styles.summaryRow}>
                <View style={styles.summaryBlock}>
                  <Text style={styles.summaryLabel}>Seçili rota</Text>
                  <Text style={styles.summaryValue} numberOfLines={1}>
                    {getCityName(fromCityId)} → {selectedOption.cityName}
                  </Text>
                </View>
                <View style={styles.summaryBlock}>
                  <Text style={styles.summaryLabel}>Yakıt kullanımı</Text>
                  <Text style={styles.summaryValue}>Mevcut tanktan</Text>
                </View>
                <View style={styles.summaryBlock}>
                  <Text style={styles.summaryLabel}>Kalan nakit</Text>
                  <Text
                    style={[
                      styles.summaryValue,
                    ]}
                    numberOfLines={1}
                  >
                    {formatMoney(playerMoney)}
                  </Text>
                </View>
              </View>
            ) : null}

            <ActionButton
              label={
                fuelReadiness && !fuelReadiness.canCompleteWithoutRefuel
                  ? 'Yakıt gerekli'
                  : buttonLabel
              }
              onPress={handleStart}
              disabled={!canStartBase}
              icon="truck"
              fullWidth
              style={styles.startButton}
            />
          </View>
        </View>
      </View>
    </Modal>
    <FuelRequirementModal
      visible={fuelRequirementVisible}
      readiness={fuelReadiness}
      onCancel={() => setFuelRequirementVisible(false)}
      onBuyFuel={() => {
        setFuelRequirementVisible(false);
        setRefuelVisible(true);
      }}
    />
    <TruckRefuelSheet
      visible={refuelVisible}
      truck={truck}
      preferredMinimumLiters={fuelReadiness?.fuelDeficitL ?? null}
      onClose={() => setRefuelVisible(false)}
      onSuccess={() => setRefuelVisible(false)}
    />
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(2, 6, 23, 0.72)',
  },
  overlayPressable: {
    flex: 1,
  },
  sheet: {
    maxHeight: '88%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    overflow: 'hidden',
  },
  fuelWarning: {
    padding: spacing.sm,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.accentAmber,
    backgroundColor: colors.warningSoft,
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  fuelWarningText: {
    ...typography.bodySmall,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  fuelWarningActions: { flexDirection: 'row', gap: spacing.sm },
  fuelWarningButton: { flex: 1, minHeight: 44 },
  handleWrap: {
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 999,
    backgroundColor: colors.border,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  closeButton: {
    borderWidth: 1,
    borderColor: colors.border,
  },
  headerTitle: {
    ...typography.cardTitle,
    flex: 1,
    fontSize: 16,
    color: colors.textPrimary,
    fontWeight: '800',
    textAlign: 'center',
  },
  headerSideSpacer: {
    width: 40,
  },
  subtitle: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  warningCard: {
    backgroundColor: colors.accentAmberSoft,
    borderColor: colors.accentAmber,
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  warningText: {
    ...typography.caption,
    color: colors.accentAmber,
    fontWeight: '600',
  },
  scroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  scrollContent: {
    paddingBottom: 16,
  },
  cityCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface2,
  },
  cityCardSelected: {
    borderColor: colors.accentBlue,
    backgroundColor: colors.accentBlueSoft,
  },
  cityCardDisabled: {
    opacity: 0.45,
  },
  cityCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  cityName: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  cityNameDisabled: {
    color: colors.textMuted,
  },
  cityMeta: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
    lineHeight: 18,
  },
  cityMetaMuted: {
    ...typography.caption,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  cityCost: {
    ...typography.caption,
    color: colors.accentBlue,
    fontWeight: '800',
    fontSize: 13,
    marginTop: 6,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    marginHorizontal: -spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  summaryBlock: {
    flex: 1,
    minWidth: 0,
  },
  summaryLabel: {
    fontSize: 10,
    lineHeight: 14,
    color: colors.textMuted,
    fontWeight: '500',
    marginBottom: 2,
  },
  summaryValue: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textPrimary,
    fontWeight: '800',
  },
  summaryValueDanger: {
    color: colors.danger,
  },
  startButton: {
    minHeight: FOOTER_BUTTON_HEIGHT,
    borderRadius: 14,
    alignSelf: 'stretch',
  },
});

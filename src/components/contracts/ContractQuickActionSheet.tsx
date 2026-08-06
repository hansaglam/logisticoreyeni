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

import { getBottomInset, getSafeModalMaxHeight } from '../../constants/layout';
import type { ContractPreview } from '../../simulation/contractPreview';
import {
  buildContractPreview,
  CONTRACT_OPERATIONAL_PROFIT_DETAIL_HINT,
} from '../../simulation/contractPreview';
import {
  getContractCargoWeight,
  isTruckAtContractOrigin,
} from '../../simulation/delivery';
import { useGameStore } from '../../store/gameStore';
import {
  buildDriverOptions,
  buildTruckOptions,
  getDriverBadge,
  getTruckBadge,
  pickBestDriverOption,
  pickBestTruckOption,
  summarizeNoDriverMessage,
  summarizeNoTruckMessage,
  type DriverOption,
  type TruckOption,
} from '../../utils/assignmentOptions';
import { getContractAvailabilityLabel } from '../../utils/contractAvailabilityDisplay';
import { getCityName, getProductName } from '../../utils/entityLookup';
import { colors, formatMoney, formatRatioPercent, spacing, typography } from '../../theme';
import type { Contract, Driver, Truck } from '../../types/game';
import { useAppSafeAreaInsets } from '../AppSafeAreaProvider';
import TutorialOverlay from '../tutorial/TutorialOverlay';
import { TutorialTarget } from '../../tutorial/TutorialTarget';
import type { TutorialTargetId } from '../../tutorial/types';
import { ActionButton, GameIcon, IconButton, StatusBadge } from '../ui';
import AssignmentPickerSheet from './AssignmentPickerSheet';

const OVERLAY_OPACITY = 0.52;
const SHEET_RADIUS = 24;
const FOOTER_HEIGHT = 108;

export interface ContractQuickActionSheetProps {
  visible: boolean;
  contract: Contract | null;
  preview: ContractPreview | null;
  trucks: Truck[];
  drivers: Driver[];
  playerLevel?: number;
  playerMoney?: number;
  onClose: () => void;
  onStartDelivery: (truckId: string, driverId: string) => void;
  onOpenAdvancedAssignment?: () => void;
  onGoToFleet?: (subTab?: 'trucks' | 'drivers' | 'shop') => void;
}

function formatTimeLeft(hours: number): string {
  const totalMinutes = Math.max(0, Math.round(hours * 60));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h > 0) return `${h}s ${m}dk`;
  return `${m}dk`;
}

function getRiskVariant(level: ContractPreview['riskLevel']) {
  switch (level) {
    case 'high':
      return 'danger' as const;
    case 'medium':
      return 'warning' as const;
    default:
      return 'success' as const;
  }
}

interface MetricCardProps {
  label: string;
  value: string;
  tone?: 'default' | 'success' | 'muted';
}

function MetricCard({ label, value, tone = 'default' }: MetricCardProps) {
  const valueColor =
    tone === 'success' ? colors.success : tone === 'muted' ? colors.textMuted : colors.accentAmber;

  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.metricValue, { color: valueColor }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

interface TeamPickerCardProps {
  icon: 'truck' | 'driver';
  title: string;
  meta: string;
  badgeLabel: string;
  badgeVariant: 'success' | 'warning' | 'danger' | 'amber' | 'muted';
  emptyMessage?: string;
  showChange: boolean;
  selected: boolean;
  onPress: () => void;
  tutorialId?: TutorialTargetId;
}

function TeamPickerCard({
  icon,
  title,
  meta,
  badgeLabel,
  badgeVariant,
  emptyMessage,
  showChange,
  selected,
  onPress,
  tutorialId,
}: TeamPickerCardProps) {
  const content = (
    <Pressable
      onPress={onPress}
      style={[styles.teamCard, selected && styles.teamCardSelected]}
    >
      <View style={styles.teamCardTop}>
        <View style={styles.teamIconWrap}>
          <GameIcon name={icon} size={16} color={colors.accentBlue} />
        </View>
        <View style={styles.teamMain}>
          <Text style={styles.teamTitle} numberOfLines={1}>
            {title}
          </Text>
          {meta ? (
            <Text style={styles.teamMeta} numberOfLines={1}>
              {meta}
            </Text>
          ) : null}
        </View>
        {showChange ? (
          <View style={styles.changeHint}>
            <Text style={styles.changeText}>Değiştir</Text>
                  <GameIcon name="chevronRight" size={12} color={colors.textMuted} />
          </View>
        ) : null}
      </View>
      {emptyMessage ? (
        <Text style={styles.teamEmpty}>{emptyMessage}</Text>
      ) : (
        <StatusBadge label={badgeLabel} variant={badgeVariant} size="sm" />
      )}
    </Pressable>
  );

  if (tutorialId) {
    return <TutorialTarget id={tutorialId}>{content}</TutorialTarget>;
  }

  return content;
}

export default function ContractQuickActionSheet({
  visible,
  contract,
  preview,
  trucks,
  drivers,
  playerLevel = 1,
  playerMoney = 0,
  onClose,
  onStartDelivery,
  onOpenAdvancedAssignment,
  onGoToFleet,
}: ContractQuickActionSheetProps) {
  const insets = useAppSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const globalEconomy = useGameStore((state) => state.globalEconomy);
  const currentTime = useGameStore((state) => state.currentTime);
  const trailers = useGameStore((state) => state.player?.trailers ?? []);
  const homeCityId = useGameStore((state) => state.player?.homeCityId);
  const playerReputation = useGameStore((state) => state.player?.reputation ?? 0);

  const [selectedTruckId, setSelectedTruckId] = useState<string | null>(null);
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [pickerMode, setPickerMode] = useState<'truck' | 'driver' | null>(null);

  const cargoWeight = contract ? getContractCargoWeight(contract) : 0;
  const isExpired = contract ? currentTime >= (contract.expiresAt ?? 0) : false;

  const truckOptions = useMemo(
    () => buildTruckOptions(trucks, cargoWeight, contract?.originCityId ?? '', trailers),
    [trucks, cargoWeight, contract?.originCityId, trailers],
  );

  const driverOptions = useMemo(() => buildDriverOptions(drivers), [drivers]);

  const eligibleTrucks = truckOptions.filter((option) => option.selectable);
  const eligibleDrivers = driverOptions.filter((option) => option.selectable);

  const selectedTruckOption = truckOptions.find((option) => option.truck.id === selectedTruckId);
  const selectedDriverOption = driverOptions.find((option) => option.driver.id === selectedDriverId);

  const assignmentPreview = useMemo(() => {
    if (!contract) return null;
    return buildContractPreview({
      contract,
      globalEconomy: globalEconomy ?? undefined,
      trucks,
      trailers,
      drivers,
      companyLevel: playerLevel,
      truck: selectedTruckOption?.truck,
      driver: selectedDriverOption?.driver,
      playerReputation,
      homeCityId,
    });
  }, [
    contract,
    globalEconomy,
    trucks,
    trailers,
    drivers,
    playerLevel,
    selectedTruckOption?.truck,
    selectedDriverOption?.driver,
    playerReputation,
    homeCityId,
  ]);

  useEffect(() => {
    if (!visible || !contract) return;

    const bestTruck = pickBestTruckOption(truckOptions);
    const bestDriver = pickBestDriverOption(driverOptions);
    setSelectedTruckId(bestTruck?.truck.id ?? null);
    setSelectedDriverId(bestDriver?.driver.id ?? null);
    setDetailsExpanded(false);
    setPickerMode(null);
  }, [visible, contract?.id, truckOptions.length, driverOptions.length]);

  if (!visible || !contract || !preview) {
    return null;
  }

  const routeLine = `${getCityName(contract.originCityId)} → ${getCityName(contract.destinationCityId)}`;
  const subtitleLine = `${getProductName(contract.productId)} · ${cargoWeight.toFixed(1)} t · ${formatTimeLeft(contract.deadlineHours)}`;
  const sheetMaxHeight = Math.min(getSafeModalMaxHeight(windowHeight, insets, 0.88), 700);
  const bottomInset = getBottomInset(insets);

  const canStartBase =
    !isExpired &&
    preview.availability.canStart &&
    !!selectedTruckOption?.selectable &&
    !!selectedDriverOption?.selectable &&
    !!contract &&
    isTruckAtContractOrigin(selectedTruckOption!.truck, contract);

  const hasFuelFunds =
    assignmentPreview != null ? playerMoney >= assignmentPreview.estimatedFuelCost : true;

  const canStart = canStartBase && hasFuelFunds;

  const startDisabledReason = (() => {
    if (isExpired) return 'Bu sözleşmenin süresi doldu.';
    if (!preview.availability.canStart) {
      return (
        preview.availability.message ??
        getContractAvailabilityLabel(preview.availability.reason) ??
        'Bu iş şu anda alınamaz.'
      );
    }
    if (!selectedTruckOption) return 'Kamyon seç';
    if (!selectedTruckOption.selectable) return selectedTruckOption.label;
    if (!selectedDriverOption) return 'Şoför seç';
    if (!selectedDriverOption.selectable) return selectedDriverOption.label;
    if (!hasFuelFunds) return 'Nakit yetersiz';
    return 'Müsait ekip yok';
  })();

  const selectionSummary =
    canStartBase && selectedTruckOption && selectedDriverOption
      ? `${selectedTruckOption.truck.name} + ${selectedDriverOption.driver.name} hazır`
      : startDisabledReason;

  const noTruckMessage = summarizeNoTruckMessage(truckOptions, cargoWeight);
  const noDriverMessage = summarizeNoDriverMessage(driverOptions);

  const truckCardTitle = selectedTruckOption?.truck.name ?? 'Kamyon seç';
  const truckCardMeta = selectedTruckOption
    ? `${selectedTruckOption.truck.capacity ?? 0} t · ${selectedTruckOption.truck.speed ?? 0} km/h · Kondisyon %${Math.round(selectedTruckOption.truck.condition ?? 100)}`
    : '';
  const truckBadge = selectedTruckOption
    ? getTruckBadge(selectedTruckOption)
    : { label: 'SEÇİLMEDİ', variant: 'muted' as const };

  const driverCardTitle = selectedDriverOption?.driver.name ?? 'Şoför seç';
  const driverCardMeta = selectedDriverOption
    ? `Deneyim ${Math.round(selectedDriverOption.driver.experience ?? 0)} · Dikkat ${Math.round(selectedDriverOption.driver.attention ?? 0)} · Maaş ${formatMoney(selectedDriverOption.driver.salaryPerDay ?? 0)}/gün`
    : '';
  const driverBadge = selectedDriverOption
    ? getDriverBadge(selectedDriverOption)
    : { label: 'SEÇİLMEDİ', variant: 'muted' as const };

  const handleStart = () => {
    if (!selectedTruckId || !selectedDriverId || !canStart) return;
    onStartDelivery(selectedTruckId, selectedDriverId);
  };

  return (
    <>
      <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
        <View style={styles.overlay}>
          <Pressable style={styles.backdrop} onPress={onClose} />
          <View
            style={[
              styles.sheet,
              {
                maxHeight: sheetMaxHeight,
                paddingBottom: bottomInset,
              },
            ]}
          >
            <View style={styles.sheetHandle} />

            <View style={styles.headerRow}>
              <View style={styles.headerMain}>
                <Text style={styles.routeTitle} numberOfLines={1}>
                  {routeLine}
                </Text>
                <Text style={styles.routeSubtitle} numberOfLines={1}>
                  {subtitleLine}
                </Text>
              </View>
              <IconButton icon="close" onPress={onClose} size={18} color={colors.textMuted} />
            </View>

            <View style={styles.badgeRow}>
              {preview.isUrgent ? (
                <StatusBadge label="ACİL" variant="danger" size="sm" />
              ) : null}
              <StatusBadge
                label={preview.riskLabel}
                variant={getRiskVariant(preview.riskLevel)}
                size="sm"
              />
            </View>

            <ScrollView
              style={styles.scroll}
              contentContainerStyle={[
                styles.scrollContent,
                { paddingBottom: FOOTER_HEIGHT + spacing.sm },
              ]}
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              <View style={styles.metricsRow}>
                <MetricCard label="Ödeme" value={formatMoney(contract.payment)} />
                <MetricCard
                  label="İş kârı"
                  value={formatMoney(
                    assignmentPreview?.estimatedOperationalProfit ??
                      preview.estimatedOperationalProfit,
                  )}
                  tone={
                    (assignmentPreview?.estimatedOperationalProfit ??
                      preview.estimatedOperationalProfit) >= 0
                      ? 'success'
                      : 'default'
                  }
                />
                <MetricCard
                  label="Maliyet"
                  value={formatMoney(
                    assignmentPreview?.estimatedTripCost ?? preview.estimatedTripCost,
                  )}
                  tone="muted"
                />
              </View>

              <TouchableOpacity
                style={styles.detailsToggle}
                onPress={() => setDetailsExpanded((value) => !value)}
                activeOpacity={0.85}
              >
                <Text style={styles.detailsToggleText}>
                  {detailsExpanded ? 'Detayları Gizle' : 'Detayları Göster'}
                </Text>
                <GameIcon
                  name={detailsExpanded ? 'chevronUp' : 'chevronDown'}
                  size={14}
                  color={colors.textMuted}
                />
              </TouchableOpacity>

              {detailsExpanded ? (
                <View style={styles.detailsCard}>
                  <Text style={styles.detailLine}>
                    Marj: {formatRatioPercent(preview.estimatedMarginPercent)}
                  </Text>
                  <Text style={styles.detailLine}>
                    Yakıt:{' '}
                    {formatMoney(
                      assignmentPreview?.estimatedFuelCost ?? preview.estimatedFuelCost,
                    )}
                  </Text>
                  <Text style={styles.detailLine}>Risk: {preview.riskLabel}</Text>
                  <Text style={styles.detailLine}>
                    Aciliyet: {preview.isUrgent ? 'Acil' : 'Normal'}
                  </Text>
                  <Text style={styles.detailLine}>
                    Mesafe: {Math.round(contract.distanceKm)} km
                  </Text>
                  <Text style={styles.detailLine}>
                    Tahmini süre: {formatTimeLeft(preview.estimatedTravelHours)}
                  </Text>
                  <Text style={styles.detailHint}>{CONTRACT_OPERATIONAL_PROFIT_DETAIL_HINT}</Text>
                </View>
              ) : null}

              {!preview.availability.canStart && preview.availability.message ? (
                <View style={styles.warningCard}>
                  <Text style={styles.warningTitle}>
                    {preview.availability.title ?? 'Alınamaz'}
                  </Text>
                  <Text style={styles.warningMessage}>{preview.availability.message}</Text>
                </View>
              ) : null}

              <Text style={styles.sectionLabel}>Ekip</Text>

              <TeamPickerCard
                icon="truck"
                title={truckCardTitle}
                meta={truckCardMeta}
                badgeLabel={truckBadge.label}
                badgeVariant={truckBadge.variant}
                emptyMessage={noTruckMessage || undefined}
                showChange={eligibleTrucks.length > 1}
                selected={!!selectedTruckOption?.selectable}
                onPress={() => {
                  if (eligibleTrucks.length === 0) return;
                  if (eligibleTrucks.length === 1 && selectedTruckOption?.selectable) return;
                  setPickerMode('truck');
                }}
                tutorialId="assignment-truck-card"
              />

              <TeamPickerCard
                icon="driver"
                title={driverCardTitle}
                meta={driverCardMeta}
                badgeLabel={driverBadge.label}
                badgeVariant={driverBadge.variant}
                emptyMessage={noDriverMessage || undefined}
                showChange={eligibleDrivers.length > 1}
                selected={!!selectedDriverOption?.selectable}
                onPress={() => {
                  if (eligibleDrivers.length === 0) return;
                  if (eligibleDrivers.length === 1 && selectedDriverOption?.selectable) return;
                  setPickerMode('driver');
                }}
                tutorialId="assignment-driver-card"
              />

              {onOpenAdvancedAssignment ? (
                <TouchableOpacity
                  style={styles.advancedLink}
                  onPress={onOpenAdvancedAssignment}
                  activeOpacity={0.85}
                >
                  <Text style={styles.advancedLinkText}>Gelişmiş seçim</Text>
                  <GameIcon name="chevronRight" size={12} color={colors.accentBlue} />
                </TouchableOpacity>
              ) : null}

              {onGoToFleet && noTruckMessage ? (
                <ActionButton
                  label="Filo Mağazasına Git"
                  onPress={() => onGoToFleet('shop')}
                  variant="secondary"
                  style={styles.fleetButton}
                />
              ) : null}
              {onGoToFleet && noDriverMessage ? (
                <ActionButton
                  label="Şoför Havuzuna Git"
                  onPress={() => onGoToFleet('drivers')}
                  variant="secondary"
                  style={styles.fleetButton}
                />
              ) : null}
            </ScrollView>

            <View style={[styles.footer, { paddingBottom: spacing.sm }]}>
              <Text style={styles.footerSummary} numberOfLines={2}>
                {selectionSummary}
              </Text>
              <TutorialTarget
                id="assignment-start-button"
                onTutorialPress={handleStart}
              >
                <ActionButton
                  label="Teslimatı Başlat"
                  icon="truck"
                  onPress={handleStart}
                  disabled={!canStart}
                  fullWidth
                  variant="primary"
                  style={styles.startButton}
                />
              </TutorialTarget>
            </View>
          </View>
        </View>
        <TutorialOverlay layer="modal" />
      </Modal>

      <AssignmentPickerSheet
        visible={pickerMode != null}
        mode={pickerMode ?? 'truck'}
        truckOptions={truckOptions}
        driverOptions={driverOptions}
        selectedTruckId={selectedTruckId}
        selectedDriverId={selectedDriverId}
        onSelectTruck={setSelectedTruckId}
        onSelectDriver={setSelectedDriverId}
        onClose={() => setPickerMode(null)}
      />
    </>
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
    marginBottom: spacing.xs,
  },
  headerMain: {
    flex: 1,
    minWidth: 0,
  },
  routeTitle: {
    ...typography.cardTitle,
    fontSize: 18,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  routeSubtitle: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    paddingBottom: spacing.sm,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  metricCard: {
    flex: 1,
    minWidth: 0,
    backgroundColor: colors.cardSoft,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  metricLabel: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '700',
    marginBottom: 2,
  },
  metricValue: {
    ...typography.bodySmall,
    fontWeight: '800',
  },
  detailsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 6,
    marginBottom: spacing.xs,
  },
  detailsToggleText: {
    ...typography.caption,
    color: colors.accentBlue,
    fontWeight: '700',
  },
  detailsCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    gap: 4,
  },
  detailLine: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  detailHint: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 4,
    lineHeight: 16,
  },
  warningCard: {
    backgroundColor: colors.warningSoft,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.warning,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  warningTitle: {
    ...typography.bodySmall,
    fontWeight: '800',
    color: colors.warning,
    marginBottom: 4,
  },
  warningMessage: {
    ...typography.caption,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  sectionLabel: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '800',
    marginBottom: spacing.xs,
    marginTop: 2,
  },
  teamCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cardSoft,
    padding: spacing.sm,
    marginBottom: spacing.xs,
  },
  teamCardSelected: {
    borderColor: colors.accentBlue,
    backgroundColor: `${colors.accentBlue}12`,
  },
  teamCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: 6,
  },
  teamIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  teamMain: {
    flex: 1,
    minWidth: 0,
  },
  teamTitle: {
    ...typography.bodySmall,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  teamMeta: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },
  changeHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  changeText: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '700',
  },
  teamEmpty: {
    ...typography.caption,
    color: colors.warning,
    fontWeight: '600',
  },
  advancedLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: spacing.xs,
    marginTop: 2,
  },
  advancedLinkText: {
    ...typography.caption,
    color: colors.accentBlue,
    fontWeight: '700',
  },
  fleetButton: {
    marginTop: spacing.xs,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
    gap: spacing.xs,
  },
  footerSummary: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '600',
    textAlign: 'center',
  },
  startButton: {
    minHeight: 48,
  },
});

/**
 * LogistiCore - Sözleşme teslimat ekibi seçim modalı
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

import { CITIES_BY_ID } from '../data/cities';
import { PRODUCT_BY_ID } from '../data/products';
import { getContractAvailability, getContractCargoWeight } from '../simulation/delivery';
import { useAppSafeAreaInsets } from './AppSafeAreaProvider';
import type { Contract, Driver, ProductId, Truck } from '../types/game';

const COLORS = {
  background: '#050A12',
  card: '#0F172A',
  border: '#1E293B',
  selected: '#F59E0B',
  success: '#22C55E',
  warning: '#F59E0B',
  danger: '#EF4444',
  muted: '#94A3B8',
  text: '#F8FAFC',
};

const MIN_TRUCK_CONDITION = 30;
const LOW_CONDITION_WARNING = 50;

export type ContractAssignmentModalProps = {
  visible: boolean;
  contract: Contract | null;
  trucks: Truck[];
  drivers: Driver[];
  onClose: () => void;
  onConfirm: (truckId: string, driverId: string) => void;
  onGoToFleet?: (subTab?: 'trucks' | 'drivers' | 'shop') => void;
};

type TruckIssue = 'eligible' | 'on_route' | 'maintenance' | 'capacity' | 'condition_blocked' | 'condition_warning';

type DriverIssue = 'eligible' | 'on_route' | 'resting';

interface TruckOption {
  truck: Truck;
  issue: TruckIssue;
  label: string;
  selectable: boolean;
}

interface DriverOption {
  driver: Driver;
  issue: DriverIssue;
  label: string;
  selectable: boolean;
}

function formatMoney(value: number): string {
  const rounded = Math.round(value);
  return `$${Math.abs(rounded)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

function getCityName(cityId: string): string {
  return CITIES_BY_ID[cityId]?.name ?? cityId;
}

function getProductName(productId: string): string {
  return PRODUCT_BY_ID[productId as ProductId]?.name ?? 'Bilinmeyen yük';
}

function getTruckStatusLabel(status: Truck['status']): string {
  switch (status) {
    case 'idle':
      return 'Boşta';
    case 'on_route':
      return 'Yolda';
    case 'maintenance':
      return 'Bakım gerekli';
    default:
      return status;
  }
}

function getDriverStatusLabel(status: Driver['status']): string {
  switch (status) {
    case 'idle':
      return 'Boşta';
    case 'driving':
      return 'Yolda';
    case 'resting':
      return 'Dinleniyor';
    default:
      return status;
  }
}

function evaluateTruckOption(truck: Truck, cargoWeight: number): TruckOption {
  const capacity = truck.capacity ?? 0;
  const condition = truck.condition ?? 0;

  if (truck.status === 'on_route') {
    return { truck, issue: 'on_route', label: 'Şu anda teslimatta', selectable: false };
  }
  if (truck.status === 'maintenance') {
    return { truck, issue: 'maintenance', label: 'Bakım gerekli', selectable: false };
  }
  if (truck.status !== 'idle') {
    return { truck, issue: 'on_route', label: 'Müsait değil', selectable: false };
  }
  if (capacity < cargoWeight) {
    return {
      truck,
      issue: 'capacity',
      label: `${cargoWeight.toFixed(1)}t gerekli / ${capacity.toFixed(1)}t mevcut`,
      selectable: false,
    };
  }
  if (condition < MIN_TRUCK_CONDITION) {
    return {
      truck,
      issue: 'condition_blocked',
      label: 'Kondisyon çok düşük',
      selectable: false,
    };
  }
  if (condition < LOW_CONDITION_WARNING) {
    return {
      truck,
      issue: 'condition_warning',
      label: 'Kondisyon düşük, risk artar',
      selectable: true,
    };
  }
  return { truck, issue: 'eligible', label: 'Uygun', selectable: true };
}

function evaluateDriverOption(driver: Driver): DriverOption {
  if (driver.status === 'driving') {
    return { driver, issue: 'on_route', label: 'Şu anda teslimatta', selectable: false };
  }
  if (driver.status === 'resting') {
    return { driver, issue: 'resting', label: 'Dinleniyor', selectable: false };
  }
  if (driver.status !== 'idle') {
    return { driver, issue: 'on_route', label: 'Müsait değil', selectable: false };
  }
  return { driver, issue: 'eligible', label: 'Uygun', selectable: true };
}

function getIssueColor(issue: TruckIssue | DriverIssue): string {
  if (issue === 'eligible') return COLORS.success;
  if (issue === 'condition_warning') return COLORS.warning;
  return COLORS.danger;
}

export default function ContractAssignmentModal({
  visible,
  contract,
  trucks,
  drivers,
  onClose,
  onConfirm,
  onGoToFleet,
}: ContractAssignmentModalProps) {
  const insets = useAppSafeAreaInsets();
  const [selectedTruckId, setSelectedTruckId] = useState<string | null>(null);
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);

  const cargoWeight = useMemo(() => {
    if (!contract) return 0;
    return getContractCargoWeight(contract);
  }, [contract]);

  const availability = useMemo(() => {
    if (!contract) {
      return null;
    }
    return getContractAvailability(contract, trucks, drivers);
  }, [contract, trucks, drivers]);

  const truckOptions = useMemo(
    () => (trucks ?? []).map((truck) => evaluateTruckOption(truck, cargoWeight)),
    [trucks, cargoWeight],
  );

  const driverOptions = useMemo(
    () => (drivers ?? []).map((driver) => evaluateDriverOption(driver)),
    [drivers],
  );

  const eligibleTrucks = truckOptions.filter((option) => option.selectable);
  const eligibleDrivers = driverOptions.filter((option) => option.selectable);

  const selectedTruckOption = truckOptions.find((option) => option.truck.id === selectedTruckId);
  const selectedDriverOption = driverOptions.find((option) => option.driver.id === selectedDriverId);

  const canConfirm =
    !!selectedTruckOption?.selectable && !!selectedDriverOption?.selectable;

  useEffect(() => {
    if (!visible || !contract) return;

    const defaultTruck = eligibleTrucks.sort(
      (a, b) => (a.truck.capacity ?? 0) - (b.truck.capacity ?? 0),
    )[0];
    const defaultDriver = eligibleDrivers[0];

    setSelectedTruckId(defaultTruck?.truck.id ?? null);
    setSelectedDriverId(defaultDriver?.driver.id ?? null);
  }, [visible, contract?.id, eligibleTrucks.length, eligibleDrivers.length]);

  if (!contract) {
    return null;
  }

  const routeLabel = `${getCityName(contract.originCityId)} → ${getCityName(contract.destinationCityId)}`;
  const productLabel = `${getProductName(contract.productId)} · ${cargoWeight.toFixed(1)} ton · ${Math.round(contract.distanceKm)} km`;

  const renderWarningCard = () => {
    if (!availability || availability.canStart) {
      return null;
    }

    const showFleetButton =
      availability.reason === 'NO_TRUCKS' ||
      availability.reason === 'NO_IDLE_TRUCKS' ||
      availability.reason === 'CAPACITY_INSUFFICIENT';

    const showDriverButton =
      availability.reason === 'NO_DRIVERS' || availability.reason === 'NO_IDLE_DRIVERS';

    return (
      <View style={styles.warningCard}>
        <Text style={styles.warningTitle}>{availability.title ?? availability.buttonLabel}</Text>
        <Text style={styles.warningMessage}>{availability.message}</Text>
        {showFleetButton && onGoToFleet ? (
          <TouchableOpacity style={styles.warningButton} onPress={() => onGoToFleet('shop')} activeOpacity={0.85}>
            <Text style={styles.warningButtonText}>Filo / Mağaza</Text>
          </TouchableOpacity>
        ) : null}
        {showDriverButton && onGoToFleet ? (
          <TouchableOpacity
            style={styles.warningButton}
            onPress={() => onGoToFleet('drivers')}
            activeOpacity={0.85}
          >
            <Text style={styles.warningButtonText}>Şoför Havuzuna Git</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.closeButton} onPress={onClose} activeOpacity={0.8}>
            <Text style={styles.closeButtonText}>Kapat</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Teslimat Ekibi Seç</Text>
          <View style={styles.closeButtonPlaceholder} />
        </View>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryRoute}>{routeLabel}</Text>
          <Text style={styles.summaryMeta}>{productLabel}</Text>
          <Text style={styles.summaryPayment}>Ödeme: {formatMoney(contract.payment)}</Text>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {renderWarningCard()}

          <Text style={styles.sectionTitle}>Kamyon seç</Text>
          {truckOptions.length === 0 ? (
            <Text style={styles.emptyHint}>Filonda kamyon yok.</Text>
          ) : (
            truckOptions.map((option) => {
              const selected = option.truck.id === selectedTruckId;
              const accent = getIssueColor(option.issue);
              return (
                <Pressable
                  key={option.truck.id}
                  style={[
                    styles.optionCard,
                    selected && styles.optionCardSelected,
                    !option.selectable && styles.optionCardDisabled,
                  ]}
                  onPress={() => option.selectable && setSelectedTruckId(option.truck.id)}
                >
                  <View style={styles.optionHeaderRow}>
                    <Text style={styles.optionTitle}>{option.truck.name}</Text>
                    <Text style={[styles.optionBadge, { color: accent }]}>{option.label}</Text>
                  </View>
                  <Text style={styles.optionMeta}>
                    Kapasite {option.truck.capacity ?? 0}t · Hız {option.truck.speed} km/s · Kondisyon{' '}
                    {Math.round(option.truck.condition ?? 0)}%
                  </Text>
                  <Text style={styles.optionStatus}>Durum: {getTruckStatusLabel(option.truck.status)}</Text>
                </Pressable>
              );
            })
          )}

          <Text style={styles.sectionTitle}>Şoför seç</Text>
          {driverOptions.length === 0 ? (
            <Text style={styles.emptyHint}>Filonda şoför yok.</Text>
          ) : (
            driverOptions.map((option) => {
              const selected = option.driver.id === selectedDriverId;
              const accent = getIssueColor(option.issue);
              return (
                <Pressable
                  key={option.driver.id}
                  style={[
                    styles.optionCard,
                    selected && styles.optionCardSelected,
                    !option.selectable && styles.optionCardDisabled,
                  ]}
                  onPress={() => option.selectable && setSelectedDriverId(option.driver.id)}
                >
                  <View style={styles.optionHeaderRow}>
                    <Text style={styles.optionTitle}>{option.driver.name}</Text>
                    <Text style={[styles.optionBadge, { color: accent }]}>{option.label}</Text>
                  </View>
                  <Text style={styles.optionMeta}>
                    Deneyim {Math.round(option.driver.experience)} · Dikkat {Math.round(option.driver.attention)} ·
                    Maaş {formatMoney(option.driver.salaryPerDay)}/gün
                  </Text>
                  <Text style={styles.optionStatus}>Durum: {getDriverStatusLabel(option.driver.status)}</Text>
                </Pressable>
              );
            })
          )}
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.confirmButton, !canConfirm && styles.confirmButtonDisabled]}
            onPress={() => {
              if (selectedTruckId && selectedDriverId && canConfirm) {
                onConfirm(selectedTruckId, selectedDriverId);
              }
            }}
            disabled={!canConfirm}
            activeOpacity={0.85}
          >
            <Text style={[styles.confirmButtonText, !canConfirm && styles.confirmButtonTextDisabled]}>
              Teslimatı Başlat
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
    fontSize: 17,
    fontWeight: '800',
  },
  closeButton: {
    minWidth: 64,
  },
  closeButtonPlaceholder: {
    minWidth: 64,
  },
  closeButtonText: {
    color: COLORS.muted,
    fontSize: 14,
    fontWeight: '600',
  },
  summaryCard: {
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 8,
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
  },
  summaryRoute: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 4,
  },
  summaryMeta: {
    color: COLORS.muted,
    fontSize: 13,
    marginBottom: 6,
  },
  summaryPayment: {
    color: COLORS.selected,
    fontSize: 14,
    fontWeight: '700',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  sectionTitle: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '800',
    marginTop: 16,
    marginBottom: 10,
  },
  emptyHint: {
    color: COLORS.muted,
    fontSize: 13,
    marginBottom: 8,
  },
  warningCard: {
    backgroundColor: '#1C1410',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#7C2D12',
    padding: 12,
    marginTop: 8,
    marginBottom: 4,
  },
  warningTitle: {
    color: COLORS.warning,
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 6,
  },
  warningMessage: {
    color: COLORS.text,
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 6,
  },
  warningHint: {
    color: COLORS.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  warningButton: {
    marginTop: 10,
    alignSelf: 'flex-start',
    backgroundColor: COLORS.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.selected,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  warningButtonText: {
    color: COLORS.selected,
    fontSize: 12,
    fontWeight: '800',
  },
  optionCard: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    marginBottom: 8,
  },
  optionCardSelected: {
    borderColor: COLORS.selected,
    borderWidth: 2,
  },
  optionCardDisabled: {
    opacity: 0.72,
  },
  optionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  optionTitle: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '800',
    flex: 1,
  },
  optionBadge: {
    fontSize: 11,
    fontWeight: '800',
  },
  optionMeta: {
    color: COLORS.muted,
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 4,
  },
  optionStatus: {
    color: COLORS.muted,
    fontSize: 11,
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  confirmButton: {
    backgroundColor: COLORS.selected,
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

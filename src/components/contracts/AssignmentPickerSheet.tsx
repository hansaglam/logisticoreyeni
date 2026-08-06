import React from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { getBottomInset, getSafeModalMaxHeight } from '../../constants/layout';
import { getCityName } from '../../utils/entityLookup';
import {
  getDriverBadge,
  getTruckBadge,
  type DriverOption,
  type TruckOption,
} from '../../utils/assignmentOptions';
import { colors, formatMoney, spacing, typography } from '../../theme';
import { useAppSafeAreaInsets } from '../AppSafeAreaProvider';
import { IconButton, StatusBadge } from '../ui';

const OVERLAY_OPACITY = 0.52;
const SHEET_RADIUS = 20;

type PickerMode = 'truck' | 'driver';

export interface AssignmentPickerSheetProps {
  visible: boolean;
  mode: PickerMode;
  truckOptions?: TruckOption[];
  driverOptions?: DriverOption[];
  selectedTruckId?: string | null;
  selectedDriverId?: string | null;
  onSelectTruck?: (truckId: string) => void;
  onSelectDriver?: (driverId: string) => void;
  onClose: () => void;
}

function CompactTruckRow({
  option,
  selected,
  onPress,
}: {
  option: TruckOption;
  selected: boolean;
  onPress: () => void;
}) {
  const badge = getTruckBadge(option);
  const { truck } = option;
  const condition = Math.round(truck.condition ?? 100);

  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.row,
        selected && styles.rowSelected,
        !option.selectable && styles.rowDisabled,
      ]}
    >
      <View style={styles.rowMain}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {truck.name}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {truck.capacity ?? 0} t · {truck.speed ?? 0} km/h · Kondisyon %{condition} ·{' '}
          {getCityName(truck.currentCityId ?? truck.homeCityId ?? '')}
        </Text>
      </View>
      <StatusBadge label={badge.label} variant={badge.variant} size="sm" />
    </Pressable>
  );
}

function CompactDriverRow({
  option,
  selected,
  onPress,
}: {
  option: DriverOption;
  selected: boolean;
  onPress: () => void;
}) {
  const badge = getDriverBadge(option);
  const { driver } = option;

  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.row,
        selected && styles.rowSelected,
        !option.selectable && styles.rowDisabled,
      ]}
    >
      <View style={styles.rowMain}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {driver.name}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          Deneyim {Math.round(driver.experience ?? 0)} · Dikkat {Math.round(driver.attention ?? 0)}{' '}
          · {formatMoney(driver.salaryPerDay ?? 0)}/gün
        </Text>
      </View>
      <StatusBadge label={badge.label} variant={badge.variant} size="sm" />
    </Pressable>
  );
}

export default function AssignmentPickerSheet({
  visible,
  mode,
  truckOptions = [],
  driverOptions = [],
  selectedTruckId,
  selectedDriverId,
  onSelectTruck,
  onSelectDriver,
  onClose,
}: AssignmentPickerSheetProps) {
  const insets = useAppSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const sheetMaxHeight = Math.min(getSafeModalMaxHeight(windowHeight, insets, 0.62), 420);

  const sortedTruckOptions = [...truckOptions].sort((a, b) => {
    if (a.selectable !== b.selectable) return a.selectable ? -1 : 1;
    return a.truck.name.localeCompare(b.truck.name, 'tr');
  });

  const sortedDriverOptions = [...driverOptions].sort((a, b) => {
    if (a.selectable !== b.selectable) return a.selectable ? -1 : 1;
    return a.driver.name.localeCompare(b.driver.name, 'tr');
  });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View
          style={[
            styles.sheet,
            {
              maxHeight: sheetMaxHeight,
              paddingBottom: getBottomInset(insets) + spacing.md,
            },
          ]}
        >
          <View style={styles.sheetHandle} />
          <View style={styles.headerRow}>
            <View style={styles.headerMain}>
              <Text style={styles.title}>{mode === 'truck' ? 'Kamyon Seç' : 'Şoför Seç'}</Text>
            </View>
            <IconButton icon="close" onPress={onClose} size={18} color={colors.textMuted} />
          </View>

          <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
            {mode === 'truck'
              ? sortedTruckOptions.map((option) => (
                  <CompactTruckRow
                    key={option.truck.id}
                    option={option}
                    selected={option.truck.id === selectedTruckId}
                    onPress={() => {
                      if (!option.selectable) return;
                      onSelectTruck?.(option.truck.id);
                      onClose();
                    }}
                  />
                ))
              : sortedDriverOptions.map((option) => (
                  <CompactDriverRow
                    key={option.driver.id}
                    option={option}
                    selected={option.driver.id === selectedDriverId}
                    onPress={() => {
                      if (!option.selectable) return;
                      onSelectDriver?.(option.driver.id);
                      onClose();
                    }}
                  />
                ))}
          </ScrollView>
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
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  headerMain: {
    flex: 1,
  },
  title: {
    ...typography.cardTitle,
    fontSize: 16,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 10,
    paddingHorizontal: spacing.sm,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cardSoft,
    marginBottom: spacing.xs,
  },
  rowSelected: {
    borderColor: colors.accentBlue,
    backgroundColor: `${colors.accentBlue}18`,
  },
  rowDisabled: {
    opacity: 0.55,
  },
  rowMain: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    ...typography.bodySmall,
    fontWeight: '800',
    color: colors.textPrimary,
    marginBottom: 2,
  },
  rowMeta: {
    ...typography.caption,
    color: colors.textMuted,
  },
});

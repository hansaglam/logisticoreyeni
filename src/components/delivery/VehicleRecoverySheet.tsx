import React, { useEffect, useMemo } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  buildRecoveryOptions,
  detectVehicleStateIssue,
  emptyVehicleRecoveryUsage,
  type VehicleRecoveryActionId,
} from '../../domain/vehicleStateRecovery';
import { findActiveDeliveryForTruck } from '../../simulation/rentalTruckLifecycle';
import { useGameStore } from '../../store/gameStore';
import { colors, spacing, typography } from '../../theme';
import { ActionButton, GameIcon } from '../ui';

export default function VehicleRecoverySheet() {
  const truckId = useGameStore((state) => state.pendingVehicleRecoveryTruckId);
  const close = useGameStore((state) => state.closeVehicleRecovery);
  const resolveIssue = useGameStore((state) => state.resolveVehicleStateIssue);
  const currentTime = useGameStore((state) => state.currentTime);
  const homeCityId = useGameStore((state) => state.player?.homeCityId);
  const usage = useGameStore((state) => state.vehicleRecovery);
  const truck = useGameStore((state) =>
    truckId ? state.player.trucks.find((item) => item.id === truckId) ?? null : null,
  );
  const delivery = useGameStore((state) =>
    truckId ? findActiveDeliveryForTruck(truckId, state.activeDeliveries) : undefined,
  );
  const transfer = useGameStore((state) =>
    truckId
      ? (state.activeTransfers ?? []).find(
          (item) =>
            item.truckId === truckId && (item.status === 'active' || item.status === 'paused'),
        )
      : undefined,
  );
  const warehouseTransfer = useGameStore((state) =>
    truckId
      ? (state.activeWarehouseStockTransfers ?? []).find(
          (item) =>
            item.truckId === truckId &&
            (item.status === 'active' || item.status === 'pending' || item.status === 'paused'),
        )
      : undefined,
  );

  const issue = useMemo(() => {
    if (!truck) return null;
    return detectVehicleStateIssue({
      truck,
      currentTime,
      homeCityId,
      activeDelivery: delivery,
      activeTransfer: transfer,
      activeWarehouseTransfer: warehouseTransfer,
    });
  }, [truck, currentTime, homeCityId, delivery, transfer, warehouseTransfer]);

  const options = useMemo(
    () => (issue ? buildRecoveryOptions(issue, usage ?? emptyVehicleRecoveryUsage()) : []),
    [issue, usage],
  );

  useEffect(() => {
    if (truckId && (!truck || !issue)) {
      close();
    }
  }, [truckId, truck, issue, close]);

  if (!truckId || !truck || !issue) {
    return null;
  }

  const handleAction = (actionId: VehicleRecoveryActionId) => {
    resolveIssue(truck.id, actionId);
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={close} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <GameIcon name="repair" size={18} color={colors.warning} />
            <Text style={styles.title}>Araç kurtarma</Text>
          </View>
          <Text style={styles.truckName}>{truck.name}</Text>
          <Text style={styles.causeTitle}>{issue.title}</Text>
          <Text style={styles.causeBody}>{issue.cause}</Text>
          <ScrollView style={styles.list} bounces={false}>
            {options.map((option) => (
              <View key={option.id} style={styles.option}>
                <Text style={styles.optionLabel}>{option.label}</Text>
                <Text style={styles.optionDescription}>{option.description}</Text>
                <ActionButton
                  label={
                    option.free
                      ? 'Ücretsiz uygula'
                      : `Uygula · $${option.cashCost} · -${option.reputationCost} itibar`
                  }
                  onPress={() => handleAction(option.id)}
                  variant="secondary"
                />
              </View>
            ))}
          </ScrollView>
          <ActionButton label="Kapat" onPress={close} variant="secondary" />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(2, 8, 23, 0.55)',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
    maxHeight: '82%',
  },
  handle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    ...typography.cardTitle,
  },
  truckName: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  causeTitle: {
    ...typography.body,
    fontWeight: '800',
    color: colors.warning,
  },
  causeBody: {
    ...typography.caption,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  list: {
    maxHeight: 360,
  },
  option: {
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 6,
  },
  optionLabel: {
    ...typography.bodySmall,
    fontWeight: '800',
  },
  optionDescription: {
    ...typography.caption,
    color: colors.textSecondary,
    lineHeight: 17,
  },
});

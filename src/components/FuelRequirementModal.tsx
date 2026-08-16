import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '../theme';
import { IOS_STACKED_MODAL_PROPS } from '../utils/modalPresentation';
import type { TruckFuelReadiness } from '../utils/truckFuel';
import { ActionButton, GameIcon } from './ui';

export interface FuelRequirementModalProps {
  visible: boolean;
  readiness: TruckFuelReadiness | null;
  onCancel: () => void;
  onBuyFuel: () => void;
  /** Render as an overlay View inside an already-open Modal (required on iOS). */
  embedded?: boolean;
}

function formatLiters(value: number): string {
  return `${Math.max(0, Math.ceil(Number.isFinite(value) ? value : 0))} L`;
}

export default function FuelRequirementModal({
  visible,
  readiness,
  onCancel,
  onBuyFuel,
  embedded = false,
}: FuelRequirementModalProps) {
  if (!readiness || (!visible && embedded)) return null;

  const required = formatLiters(readiness.requiredFuelL);
  const current = formatLiters(readiness.currentFuelL);
  const deficit = formatLiters(readiness.fuelDeficitL);

  const body = (
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable
          accessibilityViewIsModal
          accessibilityLabel="Yakıt yetersiz"
          style={styles.card}
          onPress={() => {}}
        >
          <View style={styles.iconWrap}>
            <GameIcon name="fuel" size={27} color={colors.warning} />
            <View style={styles.warningDot}>
              <GameIcon name="warning" size={12} color={colors.background} />
            </View>
          </View>

          <Text style={styles.title}>Yakıt yetersiz</Text>
          <Text style={styles.message}>
            Bu rota için yaklaşık {required} yakıt gerekiyor.{'\n'}Aracında {current} var.
          </Text>

          <View style={styles.deficitBadge}>
            <GameIcon name="warning" size={15} color={colors.warning} />
            <Text style={styles.deficitBadgeText}>Eksik: {deficit}</Text>
          </View>

          <View style={styles.comparisonCard}>
            <View style={styles.metric}>
              <GameIcon name="fuel" size={17} color={colors.accentBlue} />
              <Text style={styles.metricLabel}>Gereken Yakıt</Text>
              <Text style={[styles.metricValue, styles.requiredValue]}>{required}</Text>
            </View>
            <View style={styles.metricDivider} />
            <View style={styles.metric}>
              <GameIcon name="fuel" size={17} color={colors.success} />
              <Text style={styles.metricLabel}>Mevcut Yakıt</Text>
              <Text style={[styles.metricValue, styles.currentValue]}>{current}</Text>
            </View>
            <View style={styles.metricDivider} />
            <View style={styles.metric}>
              <GameIcon name="warning" size={17} color={colors.danger} />
              <Text style={styles.metricLabel}>Eksik Yakıt</Text>
              <Text style={[styles.metricValue, styles.missingValue]}>{deficit}</Text>
            </View>
          </View>

          <View style={styles.infoCard}>
            <GameIcon name="alert" size={18} color={colors.info} />
            <Text style={styles.infoText}>
              Teslimatı başlatabilmek için yakıt satın almalısın.
            </Text>
          </View>

          <View style={styles.actions}>
            <ActionButton
              label="İptal"
              onPress={onCancel}
              variant="secondary"
              style={styles.action}
            />
            <ActionButton
              label="Yakıt Al"
              icon="fuel"
              onPress={onBuyFuel}
              style={styles.action}
            />
          </View>
        </Pressable>
      </Pressable>
  );

  if (embedded) {
    return (
      <View style={styles.embeddedRoot} pointerEvents="box-none">
        {body}
      </View>
    );
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onCancel}
      {...IOS_STACKED_MODAL_PROPS}
    >
      {body}
    </Modal>
  );
}

const styles = StyleSheet.create({
  embeddedRoot: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 40,
  },
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xl,
    backgroundColor: 'rgba(2, 7, 18, 0.8)',
  },
  card: {
    width: '100%',
    maxWidth: 408,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  iconWrap: {
    width: 58,
    height: 58,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255, 170, 0, 0.42)',
    backgroundColor: colors.warningSoft,
  },
  warningDot: {
    position: 'absolute',
    right: -2,
    bottom: 1,
    width: 21,
    height: 21,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.warning,
  },
  title: {
    ...typography.sectionTitle,
    marginTop: spacing.sm,
    color: colors.textPrimary,
    textAlign: 'center',
    fontSize: 21,
    fontWeight: '800',
  },
  message: {
    ...typography.bodySmall,
    marginTop: 5,
    paddingHorizontal: spacing.sm,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 19,
  },
  deficitBadge: {
    minHeight: 38,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.warning,
    backgroundColor: colors.warningSoft,
  },
  deficitBadgeText: {
    ...typography.bodySmall,
    color: colors.warning,
    fontWeight: '800',
  },
  comparisonCard: {
    minHeight: 72,
    marginTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cardSoft,
    overflow: 'hidden',
  },
  metric: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  metricDivider: {
    width: 1,
    height: 42,
    backgroundColor: colors.divider,
  },
  metricLabel: {
    marginTop: 2,
    fontSize: 9,
    color: colors.textMuted,
    textAlign: 'center',
  },
  metricValue: {
    marginTop: 1,
    fontSize: 15,
    fontWeight: '800',
  },
  requiredValue: { color: colors.accentBlue },
  currentValue: { color: colors.success },
  missingValue: { color: colors.danger },
  infoCard: {
    minHeight: 50,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
  },
  infoText: {
    ...typography.caption,
    flex: 1,
    color: colors.textSecondary,
    lineHeight: 17,
  },
  actions: {
    marginTop: spacing.md,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  action: {
    flex: 1,
    minHeight: 48,
    paddingHorizontal: spacing.sm,
  },
});

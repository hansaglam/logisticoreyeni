import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { buildDeliveryResultPresentation } from '../../domain/deliveryResultPresentation';
import type { DeliverySettlementRecord } from '../../domain/deliveryDelayDiagnostics';
import { getCityName } from '../../utils/entityLookup';
import { colors, spacing, typography } from '../../theme';
import { ActionButton } from '../ui';

export interface DeliveryResultSheetProps {
  visible: boolean;
  record: DeliverySettlementRecord | null;
  onDismiss: () => void;
}

export default function DeliveryResultSheet({
  visible,
  record,
  onDismiss,
}: DeliveryResultSheetProps) {
  if (!record) {
    return null;
  }

  const presentation = buildDeliveryResultPresentation(record);
  const routeLabel = `${getCityName(record.originCityId)} → ${getCityName(record.destinationCityId)}`;
  const negative = record.reputationDelta < 0;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <Pressable style={styles.overlay} onPress={onDismiss}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <Text style={styles.kicker}>{routeLabel}</Text>
          <Text style={[styles.title, negative && styles.titleNegative]}>{presentation.title}</Text>
          <Text style={styles.headline}>{presentation.headline}</Text>
          <Text style={[styles.reputation, negative ? styles.repNeg : styles.repPos]}>
            {presentation.reputationLine}
          </Text>
          {presentation.causeTitle ? (
            <>
              <Text style={styles.section}>{presentation.causeTitle}</Text>
              {presentation.causes.map((cause) => (
                <Text key={cause} style={styles.bullet}>
                  • {cause}
                </Text>
              ))}
            </>
          ) : null}
          {presentation.tips.length > 0 ? (
            <>
              <Text style={styles.section}>Bir sonraki teslimatta</Text>
              {presentation.tips.map((tip) => (
                <Text key={tip} style={styles.bullet}>
                  • {tip}
                </Text>
              ))}
            </>
          ) : null}
          <ActionButton label="Tamam" onPress={onDismiss} style={styles.action} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(2, 8, 23, 0.72)',
    justifyContent: 'flex-end',
  },
  sheet: {
    padding: spacing.lg,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    gap: 6,
  },
  kicker: {
    ...typography.caption,
    color: colors.textMuted,
  },
  title: {
    ...typography.sectionTitle,
    color: colors.textPrimary,
    fontWeight: '800',
  },
  titleNegative: {
    color: colors.danger,
  },
  headline: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    lineHeight: 19,
  },
  reputation: {
    ...typography.body,
    fontWeight: '800',
    marginTop: 2,
  },
  repPos: { color: colors.success },
  repNeg: { color: colors.danger },
  section: {
    ...typography.bodySmall,
    color: colors.textPrimary,
    fontWeight: '700',
    marginTop: 8,
  },
  bullet: {
    ...typography.caption,
    color: colors.textSecondary,
    lineHeight: 17,
  },
  action: {
    marginTop: spacing.md,
    minHeight: 46,
  },
});

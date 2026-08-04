import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { getModalSheetPaddingBottom, getSafeModalMaxHeight } from '../../constants/layout';
import type { OfflineProgressSummary } from '../../simulation/offlineProgression';
import { formatOfflineElapsedDuration } from '../../simulation/offlineProgression';
import { colors, formatMoney, spacing, typography } from '../../theme';
import { useAppSafeAreaInsets } from '../AppSafeAreaProvider';
import { ActionButton, GameIcon } from '../ui';

export interface OfflineProgressSummaryModalProps {
  visible: boolean;
  summary: OfflineProgressSummary | null;
  onDismiss: () => void;
}

function SummaryRow({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, valueColor ? { color: valueColor } : null]}>{value}</Text>
    </View>
  );
}

export default function OfflineProgressSummaryModal({
  visible,
  summary,
  onDismiss,
}: OfflineProgressSummaryModalProps) {
  const insets = useAppSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const sheetMaxHeight = getSafeModalMaxHeight(windowHeight, insets, 0.86);
  const sheetPaddingBottom = getModalSheetPaddingBottom(insets);

  if (!summary) {
    return null;
  }

  const elapsedLabel = formatOfflineElapsedDuration(summary.appliedMs);
  const cappedNote = summary.capped ? ' (24 saat sınırı uygulandı)' : '';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss} statusBarTranslucent>
      <Pressable style={styles.overlay} onPress={onDismiss}>
        <Pressable
          style={[styles.sheet, { maxHeight: sheetMaxHeight, paddingBottom: sheetPaddingBottom }]}
          onPress={() => {}}
        >
          <View style={styles.header}>
            <View style={styles.iconWrap}>
              <GameIcon name="dashboard" size={22} color={colors.accentBlue} />
            </View>
            <View style={styles.headerText}>
              <Text style={styles.title}>Sen yokken operasyon devam etti</Text>
              <Text style={styles.subtitle}>
                Geçen süre: {elapsedLabel}
                {cappedNote}
              </Text>
            </View>
          </View>

          <ScrollView
            style={styles.bodyScroll}
            contentContainerStyle={styles.body}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            <SummaryRow label="Tamamlanan teslimatlar" value={String(summary.completedDeliveries)} />
            {summary.completedTruckTransfers > 0 ? (
              <SummaryRow label="Ulaşan kamyonlar" value={String(summary.completedTruckTransfers)} />
            ) : null}
            {summary.completedWarehouseTransfers > 0 ? (
              <SummaryRow label="Tamamlanan depo transferleri" value={String(summary.completedWarehouseTransfers)} />
            ) : null}
            {summary.lateDeliveries > 0 ? (
              <SummaryRow
                label="Geciken teslimatlar"
                value={String(summary.lateDeliveries)}
                valueColor={colors.accentAmber}
              />
            ) : null}
            <SummaryRow label="Kazanç" value={formatMoney(summary.earnings)} valueColor={colors.success} />
            <SummaryRow label="Masraflar" value={formatMoney(summary.expenses)} valueColor={colors.danger} />
            <SummaryRow
              label="Net değişim"
              value={formatMoney(summary.netChange)}
              valueColor={summary.netChange >= 0 ? colors.success : colors.danger}
            />
            {Math.abs(summary.otherNetChange) >= 1 ? (
              <SummaryRow
                label="Diğer"
                value={formatMoney(summary.otherNetChange)}
                valueColor={summary.otherNetChange >= 0 ? colors.success : colors.danger}
              />
            ) : null}

            {summary.driverLevelUps.length > 0 ? (
              <View style={styles.noteBlock}>
                <Text style={styles.noteTitle}>Şoför gelişimi</Text>
                {summary.driverLevelUps.map((line) => (
                  <Text key={line} style={styles.noteText}>
                    {line}
                  </Text>
                ))}
              </View>
            ) : null}

            {summary.worldEventsUpdated ? (
              <Text style={styles.noteText}>Dünya olayları güncellendi.</Text>
            ) : null}
            {summary.marketUpdated ? (
              <Text style={styles.noteText}>Piyasa fiyatları yenilendi.</Text>
            ) : null}
            {summary.lateDeliveries > 0 ? (
              <Text style={styles.hintText}>
                Geciken teslimatlarda mevcut ceza ve itibar kuralları uygulandı.
              </Text>
            ) : null}
          </ScrollView>

          <ActionButton label="Tamam" onPress={onDismiss} variant="primary" fullWidth />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.58)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    gap: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: colors.accentBlueSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  bodyScroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  title: {
    ...typography.cardTitle,
    fontSize: 17,
  },
  subtitle: {
    ...typography.caption,
    marginTop: 4,
    lineHeight: 16,
  },
  body: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rowLabel: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    flex: 1,
  },
  rowValue: {
    ...typography.bodySmall,
    fontWeight: '800',
    flexShrink: 0,
    textAlign: 'right',
  },
  noteBlock: {
    marginTop: spacing.xs,
    gap: 2,
  },
  noteTitle: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  noteText: {
    ...typography.caption,
    color: colors.textSecondary,
    lineHeight: 16,
  },
  hintText: {
    ...typography.caption,
    color: colors.textMuted,
    lineHeight: 15,
    marginTop: spacing.xs,
  },
});

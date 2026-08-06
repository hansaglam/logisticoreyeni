import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { getModalSheetPaddingBottom } from '../../constants/layout';
import { AppCard, EmptyState, IconButton, StatusBadge } from '../ui';
import { useAppSafeAreaInsets } from '../AppSafeAreaProvider';
import { getWarehouseStockTransferReasonMessage } from '../../simulation/warehouseStockTransfer';
import { colors, formatMoney, typography } from '../../theme';
import { getCityName, getProductName } from '../../utils/entityLookup';
import type { WarehouseActionReason, WarehouseStockTransfer } from '../../types/game';
import type { WarehouseTransferCardVm } from '../../utils/warehouseScreenViewModel';
import { logWarehouseLayout } from './warehouseLayoutDebug';
import WarehouseTransferCard from './WarehouseTransferCard';

function formatHistoryReason(reason: WarehouseStockTransfer['failureReason']): string | null {
  if (!reason) return null;
  const mapped = getWarehouseStockTransferReasonMessage(reason as WarehouseActionReason);
  if (mapped && mapped !== 'Transfer başlatılamadı.') {
    return mapped;
  }
  return String(reason);
}

interface WarehouseTransfersSectionProps {
  activeTransfers: WarehouseTransferCardVm[];
  completedTransfers?: WarehouseStockTransfer[];
  onStartTransfer?: () => void;
  sectionRef?: (y: number) => void;
}

export default function WarehouseTransfersSection({
  activeTransfers,
  completedTransfers = [],
  onStartTransfer,
  sectionRef,
}: WarehouseTransfersSectionProps) {
  const insets = useAppSafeAreaInsets();
  const [historyOpen, setHistoryOpen] = useState(false);

  const historyItems = useMemo(
    () =>
      [...completedTransfers]
        .sort((a, b) => (b.settledAt ?? b.startedAt ?? 0) - (a.settledAt ?? a.startedAt ?? 0))
        .slice(0, 20),
    [completedTransfers],
  );

  return (
    <View
      style={styles.section}
      onLayout={(event) => sectionRef?.(event.nativeEvent.layout.y)}
    >
      {activeTransfers.length === 0 ? (
        <View
          style={styles.emptyRow}
          onLayout={(event) => {
            logWarehouseLayout({
              transferEmptyHeight: Math.round(event.nativeEvent.layout.height),
            });
          }}
        >
          <View style={styles.emptyIcon}>
            <StatusBadge label="0" variant="blue" size="sm" />
          </View>
          <View style={styles.emptyTextBlock}>
            <Text style={styles.emptyTitle}>Yoldaki Transferler</Text>
            <Text style={styles.emptyMeta} numberOfLines={1}>
              Henüz transfer yok
            </Text>
          </View>
          {onStartTransfer ? (
            <Pressable
              onPress={onStartTransfer}
              style={styles.startChip}
              accessibilityRole="button"
              accessibilityLabel="Yeni stok transferi başlat"
            >
              <Text style={styles.startChipText}>Başlat</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <>
          <View style={styles.activeHeader}>
            <Text style={styles.sectionTitle}>Yoldaki Transferler</Text>
            <StatusBadge label={`${activeTransfers.length} aktif`} variant="blue" size="sm" />
          </View>
          {activeTransfers.map((item) => (
            <WarehouseTransferCard key={item.transfer.id} item={item} />
          ))}
        </>
      )}

      {historyItems.length > 0 ? (
        <Pressable
          onPress={() => setHistoryOpen(true)}
          style={styles.historyLink}
          accessibilityRole="button"
          accessibilityLabel="Geçmiş transferleri gör"
        >
          <Text style={styles.historyText}>Geçmiş Transferler</Text>
        </Pressable>
      ) : null}

      <Modal
        visible={historyOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setHistoryOpen(false)}
      >
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setHistoryOpen(false)} />
          <View style={[styles.sheet, { paddingBottom: getModalSheetPaddingBottom(insets) }]}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Geçmiş Transferler</Text>
              <IconButton icon="close" onPress={() => setHistoryOpen(false)} />
            </View>
            <ScrollView contentContainerStyle={styles.sheetBody}>
              {historyItems.length === 0 ? (
                <EmptyState title="Kayıt yok" message="Tamamlanan transfer bulunamadı." icon="route" />
              ) : (
                historyItems.map((transfer) => {
                  const failed =
                    transfer.status === 'failed' || transfer.status === 'cancelled';
                  return (
                    <AppCard key={transfer.id} style={styles.historyCard} padded={false}>
                      <View style={styles.historyTop}>
                        <StatusBadge
                          label={failed ? 'Başarısız' : 'Tamamlandı'}
                          variant={failed ? 'danger' : 'success'}
                          size="sm"
                        />
                        <Text style={styles.historyProduct} numberOfLines={1}>
                          {getProductName(transfer.productId)} ·{' '}
                          {Math.round(transfer.quantityTons)} t
                        </Text>
                      </View>
                      <Text style={styles.historyMeta} numberOfLines={1}>
                        {getCityName(transfer.sourceCityId)} →{' '}
                        {getCityName(transfer.destinationCityId)}
                      </Text>
                      <Text style={styles.historyMeta} numberOfLines={1}>
                        Maliyet: {formatMoney(transfer.totalCost)}
                      </Text>
                      {failed && transfer.failureReason ? (
                        <Text style={styles.failureReason} numberOfLines={3}>
                          {formatHistoryReason(transfer.failureReason)}
                        </Text>
                      ) : null}
                      {failed ? (
                        <Text style={styles.rollbackNote}>Stok kaynak depoya iade edildi.</Text>
                      ) : null}
                    </AppCard>
                  );
                })
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: 12,
  },
  emptyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 72,
    maxHeight: 84,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(35, 136, 255, 0.28)',
    backgroundColor: '#0E1C34',
    borderLeftWidth: 3,
    borderLeftColor: colors.accentBlue,
    gap: 10,
  },
  emptyIcon: {
    width: 28,
    alignItems: 'center',
  },
  emptyTextBlock: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  emptyMeta: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 11,
  },
  startChip: {
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: colors.accentAmber,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startChipText: {
    ...typography.caption,
    color: '#1A1200',
    fontWeight: '800',
    fontSize: 12,
  },
  activeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  historyLink: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    minHeight: 36,
    justifyContent: 'center',
  },
  historyText: {
    ...typography.bodySmall,
    color: colors.accentBlue,
    fontWeight: '700',
    fontSize: 12,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '75%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    paddingTop: 12,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  sheetBody: {
    paddingHorizontal: 14,
    paddingBottom: 20,
    gap: 8,
  },
  historyCard: {
    padding: 12,
    borderRadius: 16,
    gap: 4,
  },
  historyTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  historyProduct: {
    ...typography.bodySmall,
    color: colors.textPrimary,
    fontWeight: '700',
    flex: 1,
  },
  historyMeta: {
    ...typography.caption,
    color: colors.textMuted,
  },
  failureReason: {
    ...typography.caption,
    color: colors.danger,
    marginTop: 4,
  },
  rollbackNote: {
    ...typography.caption,
    color: colors.accentAmber,
  },
});

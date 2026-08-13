import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { getModalSheetPaddingBottom } from '../../constants/layout';
import { AppCard, EmptyState, GameIcon, IconButton } from '../ui';
import { useAppSafeAreaInsets } from '../AppSafeAreaProvider';
import { getWarehouseStockTransferReasonMessage } from '../../simulation/warehouseStockTransfer';
import { colors, formatMoney, typography } from '../../theme';
import { getCityName, getProductName } from '../../utils/entityLookup';
import type { WarehouseActionReason, WarehouseStockTransfer } from '../../types/game';
import type { WarehouseTransferCardVm } from '../../utils/warehouseScreenViewModel';
import { logWarehouseLayout } from './warehouseLayoutDebug';
import { warehouseLayout, warehouseVisual } from './warehouseTheme';

function formatHistoryReason(reason: WarehouseStockTransfer['failureReason']): string | null {
  if (!reason) return null;
  const mapped = getWarehouseStockTransferReasonMessage(reason as WarehouseActionReason);
  if (mapped && mapped !== 'Transfer başlatılamadı.') {
    return mapped;
  }
  return String(reason);
}

function formatTransferEta(remainingKm: number): string {
  if (remainingKm <= 0) return 'varış yakın';
  if (remainingKm < 50) return `${remainingKm} km`;
  const hours = Math.floor(remainingKm / 80);
  const minutes = Math.round(((remainingKm % 80) / 80) * 60);
  if (hours <= 0) return `${minutes} dk`;
  if (minutes <= 0) return `${hours}s`;
  return `${hours}s ${minutes}dk`;
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

  const isEmpty = activeTransfers.length === 0;

  return (
    <View
      style={styles.section}
      onLayout={(event) => sectionRef?.(event.nativeEvent.layout.y)}
    >
      <View
        style={styles.compactCard}
        onLayout={(event) => {
          if (isEmpty) {
            logWarehouseLayout({
              transferEmptyHeight: Math.round(event.nativeEvent.layout.height),
            });
          }
        }}
      >
        <View style={styles.cardHeader}>
          <View style={styles.titleRow}>
            <GameIcon name="truck" size={14} color={warehouseVisual.accentBlue} />
            <Text style={styles.cardTitle}>Yoldaki Transferler</Text>
          </View>
          <Text style={styles.countBadge}>{activeTransfers.length}</Text>
        </View>

        {isEmpty ? (
          <View style={styles.emptyBody}>
            <Text style={styles.emptyMeta}>Henüz transfer yok</Text>
            {onStartTransfer ? (
              <Pressable
                onPress={onStartTransfer}
                style={styles.startBtn}
                accessibilityRole="button"
                accessibilityLabel="Yeni transfer başlat"
              >
                <Text style={styles.startBtnText}>Yeni Transfer</Text>
              </Pressable>
            ) : (
              <GameIcon name="chevronRight" size={14} color={colors.textMuted} />
            )}
          </View>
        ) : (
          <View style={styles.activeBody}>
            {activeTransfers.slice(0, 3).map((item) => (
              <Text key={item.transfer.id} style={styles.transferLine} numberOfLines={1}>
                {item.sourceCityName} → {item.destinationCityName} ·{' '}
                {formatTransferEta(item.remainingKm)}
              </Text>
            ))}
            {activeTransfers.length > 3 ? (
              <Text style={styles.moreTransfers}>
                +{activeTransfers.length - 3} transfer daha
              </Text>
            ) : null}
            {onStartTransfer ? (
              <Pressable
                onPress={onStartTransfer}
                style={styles.startBtnInline}
                accessibilityRole="button"
                accessibilityLabel="Yeni transfer başlat"
              >
                <Text style={styles.startBtnText}>Yeni Transfer</Text>
              </Pressable>
            ) : null}
          </View>
        )}
      </View>

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
                        <Text style={styles.historyStatus}>
                          {failed ? 'Başarısız' : 'Tamamlandı'}
                        </Text>
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
    marginBottom: warehouseLayout.sectionGap,
  },
  compactCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: warehouseVisual.border,
    backgroundColor: warehouseVisual.surfaceElevated,
    padding: warehouseLayout.cardPadding,
    gap: warehouseLayout.internalGap,
    minHeight: 64,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    minWidth: 0,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  countBadge: {
    fontSize: 14,
    fontWeight: '800',
    color: warehouseVisual.accentBlue,
    minWidth: 20,
    textAlign: 'right',
  },
  emptyBody: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    minHeight: 28,
  },
  emptyMeta: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 12,
    flex: 1,
    minWidth: 0,
  },
  activeBody: {
    gap: 4,
  },
  transferLine: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '500',
  },
  moreTransfers: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 11,
  },
  startBtn: {
    minHeight: 32,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: warehouseVisual.accentBlue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startBtnInline: {
    alignSelf: 'flex-start',
    marginTop: 4,
    minHeight: 32,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: warehouseVisual.accentBlue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startBtnText: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '800',
    fontSize: 11,
  },
  historyLink: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    minHeight: 32,
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
    borderRadius: 14,
    gap: 4,
  },
  historyTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  historyStatus: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '700',
    fontSize: 11,
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

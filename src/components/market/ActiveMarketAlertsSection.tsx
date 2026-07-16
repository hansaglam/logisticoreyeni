import React, { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import type { MarketPriceAlert } from '../../types/game';
import { getCityName, getProductName } from '../../utils/entityLookup';
import { formatMarketAlertCondition } from '../../utils/marketAlerts';
import { colors, radius, spacing, typography } from '../../theme';
import { GameIcon } from '../ui';

const MAX_VISIBLE_ALERTS = 3;
const CHIP_WIDTH = 168;

interface ActiveMarketAlertsSectionProps {
  alerts: MarketPriceAlert[];
  selectedCityId: string | null;
  onPressAlert: (alert: MarketPriceAlert) => void;
  onDeleteAlert: (alertId: string) => void;
}

function sortAlertsForDisplay(
  alerts: MarketPriceAlert[],
  selectedCityId: string | null,
): MarketPriceAlert[] {
  return [...alerts].sort((a, b) => {
    if (selectedCityId) {
      const aSelected = a.cityId === selectedCityId ? 0 : 1;
      const bSelected = b.cityId === selectedCityId ? 0 : 1;
      if (aSelected !== bSelected) {
        return aSelected - bSelected;
      }
    }
    return b.createdAt - a.createdAt;
  });
}

interface MarketAlertChipProps {
  alert: MarketPriceAlert;
  onPress: () => void;
  onDelete: () => void;
  fullWidth?: boolean;
}

function MarketAlertChip({ alert, onPress, onDelete, fullWidth = false }: MarketAlertChipProps) {
  const cityName = getCityName(alert.cityId);
  const productName = getProductName(alert.productId);
  const conditionLabel = formatMarketAlertCondition(alert);

  return (
    <TouchableOpacity
      style={[styles.alertChip, fullWidth && styles.alertChipFullWidth]}
      onPress={onPress}
      activeOpacity={0.88}
    >
      <View style={styles.alertChipTopRow}>
        <View style={styles.alertActiveDot} />
        <Text style={styles.alertChipLocation} numberOfLines={1} ellipsizeMode="tail">
          {cityName} · {productName}
        </Text>
        <TouchableOpacity
          onPress={onDelete}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          activeOpacity={0.7}
        >
          <GameIcon name="close" size={14} color={colors.textMuted} />
        </TouchableOpacity>
      </View>
      <Text style={styles.alertChipTarget} numberOfLines={1} ellipsizeMode="tail">
        Hedef: {conditionLabel}
      </Text>
    </TouchableOpacity>
  );
}

export default function ActiveMarketAlertsSection({
  alerts,
  selectedCityId,
  onPressAlert,
  onDeleteAlert,
}: ActiveMarketAlertsSectionProps) {
  const [showAllModal, setShowAllModal] = useState(false);

  const sortedAlerts = useMemo(
    () => sortAlertsForDisplay(alerts, selectedCityId),
    [alerts, selectedCityId],
  );

  const visibleAlerts = sortedAlerts.slice(0, MAX_VISIBLE_ALERTS);
  const hasMoreAlerts = sortedAlerts.length > MAX_VISIBLE_ALERTS;

  if (alerts.length === 0) {
    return (
      <Text style={styles.emptyHint}>
        Alarm kurmak için ürün kartındaki Alarm butonunu kullan.
      </Text>
    );
  }

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Aktif Alarmlar</Text>
        <Text style={styles.sectionSubtitle}>Takip ettiğin fiyat hedefleri</Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        nestedScrollEnabled
        contentContainerStyle={styles.chipRow}
      >
        {visibleAlerts.map((alert) => (
          <MarketAlertChip
            key={alert.id}
            alert={alert}
            onPress={() => onPressAlert(alert)}
            onDelete={() => onDeleteAlert(alert.id)}
          />
        ))}
      </ScrollView>

      {hasMoreAlerts ? (
        <TouchableOpacity
          style={styles.showAllButton}
          onPress={() => setShowAllModal(true)}
          activeOpacity={0.85}
        >
          <Text style={styles.showAllButtonText}>Tümünü Gör ({sortedAlerts.length})</Text>
        </TouchableOpacity>
      ) : null}

      <Modal
        visible={showAllModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowAllModal(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setShowAllModal(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Aktif Alarmlar</Text>
              <TouchableOpacity
                onPress={() => setShowAllModal(false)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <GameIcon name="close" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <ScrollView
              style={styles.modalScroll}
              contentContainerStyle={styles.modalChipList}
              showsVerticalScrollIndicator={false}
            >
              {sortedAlerts.map((alert) => (
                <MarketAlertChip
                  key={alert.id}
                  alert={alert}
                  fullWidth
                  onPress={() => {
                    onPressAlert(alert);
                    setShowAllModal(false);
                  }}
                  onDelete={() => onDeleteAlert(alert.id)}
                />
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: spacing.sm,
  },
  sectionHeader: {
    marginBottom: spacing.xs,
  },
  sectionTitle: {
    ...typography.caption,
    fontSize: 11,
    fontWeight: '800',
    color: colors.textSecondary,
  },
  sectionSubtitle: {
    ...typography.caption,
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 1,
  },
  chipRow: {
    gap: spacing.sm,
    paddingRight: spacing.sm,
  },
  alertChip: {
    width: CHIP_WIDTH,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.18)',
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  alertChipFullWidth: {
    width: '100%',
  },
  alertChipTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
    minWidth: 0,
  },
  alertActiveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.success,
    flexShrink: 0,
  },
  alertChipLocation: {
    ...typography.caption,
    fontSize: 11,
    fontWeight: '700',
    color: colors.textPrimary,
    flex: 1,
    minWidth: 0,
  },
  alertChipTarget: {
    ...typography.caption,
    fontSize: 10,
    color: colors.accentAmber,
    minWidth: 0,
  },
  showAllButton: {
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
    paddingVertical: 2,
  },
  showAllButtonText: {
    ...typography.caption,
    fontSize: 10,
    fontWeight: '700',
    color: colors.accentBlue,
  },
  emptyHint: {
    ...typography.caption,
    fontSize: 10,
    color: colors.textMuted,
    marginBottom: spacing.sm,
    lineHeight: 14,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 23, 0.72)',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  modalCard: {
    maxHeight: '70%',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  modalTitle: {
    ...typography.cardTitle,
    fontSize: 14,
  },
  modalScroll: {
    flexGrow: 0,
  },
  modalChipList: {
    gap: spacing.sm,
    paddingBottom: spacing.xs,
  },
});

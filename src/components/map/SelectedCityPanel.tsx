import React, { memo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { GameIcon } from '../ui';
import {
  MAP_ACCENT,
  MAP_BORDER,
  MAP_MUTED,
  MAP_PANEL_MIN_HEIGHT,
  MAP_PANEL_RADIUS,
  MAP_SPACING_MAP_TO_PANEL,
  MAP_SURFACE,
  MAP_TITLE_COLOR,
} from './mapTheme';

export interface SelectedCityPanelProps {
  cityName: string;
  truckCount: number;
  depotCount: number;
  jobCount: number;
  onViewJobs?: () => void;
  onOpenDepot?: () => void;
  onFocus?: () => void;
  onClose?: () => void;
}

function SelectedCityPanel({
  cityName,
  truckCount,
  depotCount,
  jobCount,
  onViewJobs,
  onOpenDepot,
  onFocus,
  onClose,
}: SelectedCityPanelProps) {
  const summaryParts: string[] = [`${truckCount} kamyon`];
  if (depotCount > 0) summaryParts.push(`${depotCount} depo`);
  if (jobCount > 0) summaryParts.push(`${jobCount} yeni iş`);

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={styles.titleCol}>
          <Text style={styles.cityName} numberOfLines={1}>
            {cityName}
          </Text>
          <Text style={styles.summary} numberOfLines={1}>
            {summaryParts.join(' · ')}
          </Text>
        </View>
        {onClose ? (
          <TouchableOpacity
            style={styles.closeBtn}
            onPress={onClose}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Şehir seçimini kapat"
          >
            <GameIcon name="close" size={16} color={MAP_MUTED} />
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={styles.actionsRow}>
        {onViewJobs ? (
          <TouchableOpacity style={styles.actionBtn} onPress={onViewJobs} activeOpacity={0.85}>
            <Text style={styles.actionText}>İşleri Gör</Text>
          </TouchableOpacity>
        ) : null}
        {onOpenDepot ? (
          <TouchableOpacity style={styles.actionBtn} onPress={onOpenDepot} activeOpacity={0.85}>
            <Text style={styles.actionText}>Depoya Git</Text>
          </TouchableOpacity>
        ) : null}
        {onFocus ? (
          <TouchableOpacity style={styles.actionBtnPrimary} onPress={onFocus} activeOpacity={0.85}>
            <Text style={styles.actionTextPrimary}>Odaklan</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

export default memo(SelectedCityPanel);

const styles = StyleSheet.create({
  container: {
    marginTop: MAP_SPACING_MAP_TO_PANEL,
    minHeight: MAP_PANEL_MIN_HEIGHT,
    borderRadius: MAP_PANEL_RADIUS,
    backgroundColor: MAP_SURFACE,
    borderWidth: 1,
    borderColor: MAP_BORDER,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  titleCol: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  cityName: {
    fontSize: 16,
    fontWeight: '800',
    color: MAP_TITLE_COLOR,
  },
  summary: {
    fontSize: 12,
    color: MAP_MUTED,
    fontWeight: '600',
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(8,20,38,0.55)',
  },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  actionBtn: {
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: MAP_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnPrimary: {
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(35,136,255,0.14)',
    borderWidth: 1,
    borderColor: MAP_ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: {
    fontSize: 12,
    fontWeight: '700',
    color: MAP_TITLE_COLOR,
  },
  actionTextPrimary: {
    fontSize: 12,
    fontWeight: '800',
    color: MAP_ACCENT,
  },
});

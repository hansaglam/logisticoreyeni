import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { GameIcon } from '../../ui';
import {
  getMapCommandModeDefinition,
  inspectorPanelForMode,
  type MapCommandMode,
  type MapInspectorPanel,
} from './mapCommandMode';
import type { MapCommandTelemetry } from './mapCommandTelemetry';
import { mapUiTheme } from './mapUiTheme';

interface MapContextualInspectorProps {
  mode: MapCommandMode;
  telemetry: MapCommandTelemetry;
  width: number;
  overlay: boolean;
  locationLabel?: string | null;
  onClose: () => void;
}

const PANEL_TITLE: Record<MapInspectorPanel, string> = {
  NONE: '',
  OVERVIEW: 'Operasyon özeti',
  CITY: 'Şehir',
  VEHICLE: 'Filo',
  CONTRACT: 'İşler',
  WAREHOUSE: 'Depolar',
  MARKET: 'Pazar',
  ALERT: 'Uyarı',
};

function MapContextualInspector({
  mode,
  telemetry,
  width,
  overlay,
  locationLabel,
  onClose,
}: MapContextualInspectorProps) {
  const panel = inspectorPanelForMode(mode);
  if (panel === 'NONE') {
    return null;
  }
  const definition = getMapCommandModeDefinition(mode);
  const readOnly = panel !== 'OVERVIEW' || definition.availability === 'foundation';

  return (
    <View
      style={[styles.panel, overlay ? styles.overlay : null, { width }]}
      accessibilityRole="summary"
    >
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1}>
          {PANEL_TITLE[panel]}
        </Text>
        <Pressable
          style={styles.close}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Özeti kapat"
          hitSlop={10}
        >
          <GameIcon name="close" size={14} color={mapUiTheme.textSecondary} />
        </Pressable>
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {locationLabel ? (
          <Text style={styles.location} numberOfLines={1}>
            {locationLabel}
          </Text>
        ) : null}
        {definition.availability === 'foundation' ? (
          <Text style={styles.note}>
            Demiryolu ağı temel katmanda. Üretim sevkiyatı bu ekranda açık değil.
          </Text>
        ) : null}
        {readOnly && definition.availability !== 'foundation' && panel !== 'OVERVIEW' ? (
          <Text style={styles.note}>Okunur özet. İşlemler sonraki harita fazında.</Text>
        ) : null}
        <Metric label="Aktif teslimat" value={telemetry.activeDeliveries} />
        <Metric label="Müsait araç" value={telemetry.availableVehicles} />
        <Metric label="Yoldaki araç" value={telemetry.vehiclesOnRoad} />
        <Metric label="Depo" value={telemetry.warehouseCount} />
      </ScrollView>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

export default React.memo(MapContextualInspector);

const styles = StyleSheet.create({
  panel: {
    alignSelf: 'stretch',
    minHeight: 0,
    flexShrink: 0,
    backgroundColor: mapUiTheme.surfaceElevated,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: mapUiTheme.border,
    paddingHorizontal: mapUiTheme.space8,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    zIndex: 2,
  },
  location: {
    color: mapUiTheme.cyanPrimary,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 4,
  },
  header: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: mapUiTheme.space4,
  },
  title: {
    flex: 1,
    color: mapUiTheme.textPrimary,
    fontSize: 13,
    fontWeight: '800',
  },
  close: {
    minWidth: 28,
    minHeight: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  scrollContent: {
    paddingBottom: mapUiTheme.space8,
    gap: mapUiTheme.space4,
  },
  note: {
    color: mapUiTheme.textMuted,
    fontSize: 10,
    lineHeight: 14,
  },
  metric: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: mapUiTheme.space8,
    paddingVertical: mapUiTheme.space2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: mapUiTheme.border,
  },
  metricLabel: {
    color: mapUiTheme.textSecondary,
    fontSize: 11,
    fontWeight: '600',
    flex: 1,
  },
  metricValue: {
    color: mapUiTheme.textPrimary,
    fontSize: 13,
    fontWeight: '800',
  },
});

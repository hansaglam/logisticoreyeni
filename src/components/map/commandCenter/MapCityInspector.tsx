import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MIN_TOUCH_TARGET } from '../../../constants/layout';
import type { CityOperationsSnapshot } from '../../../mapV2/gameplay/cityOperationsSelectors';
import type { CityQuickAction, MapV2CityGameplayLink } from '../../../mapV2/gameplay/mapV2CityGameplayAdapter';
import { mapUiTheme } from './mapUiTheme';

export type MapCityInspectorModel = {
  link: MapV2CityGameplayLink;
  snapshot: CityOperationsSnapshot | null;
  onAction: (action: CityQuickAction) => void;
  onClear: () => void;
};

const ACTIONS: readonly { action: CityQuickAction; label: string }[] = [
  { action: 'contracts', label: 'İşleri Gör' },
  { action: 'fleet', label: 'Filoyu Gör' },
  { action: 'warehouses', label: 'Depoyu Gör' },
  { action: 'market', label: 'Pazarı Gör' },
];

function MapCityInspector({
  model,
  width,
}: {
  model: MapCityInspectorModel;
  width: number;
}) {
  const { link, snapshot } = model;
  const columns = width >= 260;
  const contracts = snapshot?.availableContractCount ?? 0;
  const vehicles = snapshot?.vehicleCount ?? 0;
  const shipments = snapshot?.activeShipmentLinkCount ?? 0;
  return (
    <View>
      {snapshot?.isHomeCity ? <Text style={styles.state}>Merkez</Text> : null}
      {link.operationsAvailable ? (
        <>
          <Text style={styles.section}>Şehir operasyonları</Text>
          <Row label="Müsait işler" value={String(contracts)} />
          <Row label="Şehirdeki araçlar" value={String(vehicles)} />
          <Row label="Depo" value={snapshot?.warehouse.present ? 'Var' : 'Yok'} />
          {snapshot?.warehouse.present && snapshot.warehouse.level != null ? (
            <Row label="Depo seviyesi" value={String(snapshot.warehouse.level)} />
          ) : null}
          {snapshot?.warehouse.present && snapshot.warehouse.capacityTons != null ? (
            <Row label="Kapasite" value={`${snapshot.warehouse.capacityTons} t`} />
          ) : null}
          <Row label="Aktif sevkiyat" value={String(shipments)} />
        </>
      ) : (
        <Text style={styles.limited}>Operasyon ağına henüz bağlı değil</Text>
      )}
      <View style={[styles.actions, columns ? styles.actionsColumns : null]}>
        {ACTIONS.map((item) => (
          <Pressable
            key={item.action}
            style={[styles.action, columns ? styles.actionHalf : null]}
            disabled={!link.operationsAvailable}
            onPress={() => model.onAction(item.action)}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            accessibilityState={{ disabled: !link.operationsAvailable }}
          >
            <Text style={[styles.actionLabel, !link.operationsAvailable ? styles.actionDisabled : null]}>
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>
      <Pressable
        style={styles.clear}
        onPress={model.onClear}
        accessibilityRole="button"
        accessibilityLabel="Seçimi temizle"
      >
        <Text style={styles.clearLabel}>Seçimi temizle</Text>
      </Pressable>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

export default React.memo(MapCityInspector);

const styles = StyleSheet.create({
  state: {
    color: mapUiTheme.textMuted,
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
  },
  section: {
    color: mapUiTheme.textSecondary,
    fontSize: 10,
    fontWeight: '700',
    marginTop: mapUiTheme.space8,
    marginBottom: mapUiTheme.space2,
  },
  limited: {
    color: mapUiTheme.textMuted,
    fontSize: 11,
    lineHeight: 15,
    marginTop: mapUiTheme.space8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: mapUiTheme.space4,
    paddingVertical: 3,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: mapUiTheme.border,
  },
  rowLabel: {
    flex: 1,
    color: mapUiTheme.textSecondary,
    fontSize: 11,
    fontWeight: '600',
  },
  rowValue: {
    color: mapUiTheme.textPrimary,
    fontSize: 13,
    fontWeight: '800',
  },
  actions: {
    marginTop: mapUiTheme.space8,
    gap: mapUiTheme.space4,
  },
  actionsColumns: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  action: {
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: mapUiTheme.borderStrong,
    borderRadius: mapUiTheme.smallRadius,
    backgroundColor: mapUiTheme.surface,
    paddingHorizontal: mapUiTheme.space6,
  },
  actionHalf: {
    width: '48%',
  },
  actionLabel: {
    color: mapUiTheme.textPrimary,
    fontSize: 11,
    fontWeight: '700',
  },
  actionDisabled: {
    color: mapUiTheme.textMuted,
  },
  clear: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    marginTop: mapUiTheme.space4,
  },
  clearLabel: {
    color: mapUiTheme.textMuted,
    fontSize: 11,
    fontWeight: '700',
  },
});

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MIN_TOUCH_TARGET } from '../../../constants/layout';
import type { MapFleetEntity } from '../../../mapV2/gameplay/mapV2FleetAdapter';
import { formatStoredArrivalRemaining } from '../../../mapV2/gameplay/truckStatusPresentation';
import { mapUiTheme } from './mapUiTheme';

export type MapVehicleInspectorModel = {
  truck: MapFleetEntity;
  currentTime: number;
  onShowCity?: (gameplayCityId: string) => void;
  onShowRoute?: () => void;
  onClear: () => void;
};

function MapVehicleInspector({ model }: { model: MapVehicleInspectorModel }) {
  const { truck } = model;
  const eta = formatStoredArrivalRemaining(model.currentTime, truck.etaAt);
  const cityId = truck.gameplayCityId;
  return (
    <View>
      <Row label="Durum" value={truck.statusLabel} />
      <Row label="Konum" value={truck.locationLabel} />
      <Row label="Sürücü" value={truck.driverName ?? 'Atanmamış'} />
      {truck.fuelPercent != null ? <Row label="Yakıt" value={`${truck.fuelPercent}%`} /> : null}
      {truck.conditionPercent != null ? <Row label="Kondisyon" value={`${truck.conditionPercent}%`} /> : null}
      {truck.routeLabel ? <Row label="Aktif iş" value={eta ? `${truck.routeLabel} · ${eta}` : truck.routeLabel} /> : null}
      <View style={styles.actions}>
        {cityId && model.onShowCity ? (
          <Pressable
            style={styles.action}
            onPress={() => model.onShowCity?.(cityId)}
            accessibilityRole="button"
            accessibilityLabel="Şehri Göster"
          >
            <Text style={styles.actionLabel}>Şehri Göster</Text>
          </Pressable>
        ) : null}
        {truck.canEmphasizeRoute && model.onShowRoute ? (
          <Pressable style={styles.action} onPress={model.onShowRoute} accessibilityRole="button" accessibilityLabel="Rotayı Göster">
            <Text style={styles.actionLabel}>Rotayı Göster</Text>
          </Pressable>
        ) : null}
      </View>
      <Pressable style={styles.clear} onPress={model.onClear} accessibilityRole="button" accessibilityLabel="Seçimi temizle">
        <Text style={styles.clearLabel}>Seçimi temizle</Text>
      </Pressable>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

export default React.memo(MapVehicleInspector);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 3,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: mapUiTheme.border,
  },
  rowLabel: {
    color: mapUiTheme.textSecondary,
    fontSize: 11,
    fontWeight: '600',
    marginRight: mapUiTheme.space8,
  },
  rowValue: {
    flex: 1,
    color: mapUiTheme.textPrimary,
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'right',
  },
  actions: {
    marginTop: mapUiTheme.space8,
  },
  action: {
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: mapUiTheme.borderStrong,
    borderRadius: mapUiTheme.smallRadius,
    marginBottom: mapUiTheme.space4,
    paddingHorizontal: mapUiTheme.space6,
  },
  actionLabel: {
    color: mapUiTheme.textPrimary,
    fontSize: 11,
    fontWeight: '700',
  },
  clear: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
  },
  clearLabel: {
    color: mapUiTheme.textMuted,
    fontSize: 11,
    fontWeight: '700',
  },
});

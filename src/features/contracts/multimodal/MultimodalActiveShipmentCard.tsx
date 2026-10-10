import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors } from '../../../theme';
import { formatMoney } from '../../../theme/format';
import { getCityName } from '../../../utils/entityLookup';
import type { PersistedReadableMultimodalShipment } from '../../../domain/multimodalShipmentPersistence';
import { formatMultimodalDurationGameSeconds } from '../../../domain/presentation/multimodalRailOfferPresentation';

const RAIL_STEEL = '#8BA3B8';

export default function MultimodalActiveShipmentCard({
  shipment,
}: {
  shipment: PersistedReadableMultimodalShipment;
}) {
  const remaining = Math.max(
    0,
    (shipment.durationSnapshot?.totalDurationGameSeconds ?? 0) -
      (shipment.totalElapsedGameSeconds ?? 0),
  );
  const statusLabel =
    shipment.settlementState === 'SETTLED' || shipment.status === 'COMPLETED'
      ? 'Tamamlandı'
      : shipment.status === 'COMPLETED_UNSETTLED'
        ? 'Tamamlandı · ödeme bekliyor'
        : shipment.status === 'CANCELLED'
        ? 'İptal'
        : 'Devam ediyor';
  const payment = shipment.economicSnapshot?.playerPayment;
  return (
    <View style={styles.card}>
      <Text style={styles.route}>
        {getCityName(shipment.originCityId)} → {getCityName(shipment.destinationCityId)}
      </Text>
      <Text style={styles.meta}>Kamyon → Tren → Kamyon</Text>
      <Text style={styles.meta}>
        Aşama ·{' '}
        {shipment.settlementState === 'SETTLED' || shipment.status === 'COMPLETED'
          ? 'SETTLED'
          : shipment.executionStage ?? shipment.status}
      </Text>
      <Text style={styles.meta}>
        Kalan süre · {formatMultimodalDurationGameSeconds(remaining) ?? '—'}
      </Text>
      {typeof payment === 'number' ? (
        <Text style={styles.pay}>{formatMoney(payment)}</Text>
      ) : null}
      <Text style={styles.status}>{statusLabel}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#3D5166',
    borderLeftWidth: 3,
    borderLeftColor: RAIL_STEEL,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
    gap: 4,
  },
  route: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  meta: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  pay: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.success,
    marginTop: 4,
  },
  status: {
    fontSize: 12,
    fontWeight: '700',
    color: RAIL_STEEL,
  },
});

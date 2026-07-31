import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { getMarketplaceErrorMessage } from '../../domain/vehicleMarketplacePresentation';
import { colors, formatMoney, spacing } from '../../theme';
import type { VehicleMarketplaceListing } from '../../types/vehicleMarketplace';
import { EmptyState, GameIcon } from '../ui';
import VehicleListingCard, { getMarketplaceTruckName } from './VehicleListingCard';

export function MyVehicleListings({
  listings,
  cancellingId,
  onDetail,
  onCancel,
  onSellVehicle,
}: {
  listings: VehicleMarketplaceListing[];
  cancellingId: string | null;
  onDetail: (listing: VehicleMarketplaceListing) => void;
  onCancel: (listing: VehicleMarketplaceListing) => void;
  onSellVehicle: () => void;
}) {
  if (listings.length === 0) {
    return (
      <EmptyState
        title="Henüz satışa çıkardığın bir araç yok."
        message="Uygun ve boşta olan bir kamyonunu filodan satışa çıkarabilirsin."
        actionLabel="Araç Sat"
        onAction={onSellVehicle}
        icon="truck"
      />
    );
  }
  return (
    <View style={styles.list}>
      {listings.map((listing) => (
        <VehicleListingCard
          key={listing.id}
          listing={listing}
          ownListing
          cancelling={cancellingId === listing.id}
          onDetail={() => onDetail(listing)}
          onCancel={() => onCancel(listing)}
        />
      ))}
    </View>
  );
}

export function MarketplaceHistory({
  listings,
}: {
  listings: VehicleMarketplaceListing[];
}) {
  if (listings.length === 0) {
    return (
      <EmptyState
        title="Henüz pazar geçmişin yok."
        message="Satılan, iptal edilen veya süresi dolan ilanların burada görünür."
        icon="time"
      />
    );
  }
  return (
    <View style={styles.list}>
      {listings.map((listing) => {
        const fee = listing.askingPrice * listing.marketplaceFeeRate;
        return (
          <View key={listing.id} style={styles.historyCard}>
            <View style={styles.historyIcon}>
              <GameIcon
                name={listing.status === 'sold' ? 'success' : 'time'}
                size={20}
                color={listing.status === 'sold' ? colors.success : colors.textMuted}
              />
            </View>
            <View style={styles.historyMain}>
              <Text style={styles.historyTitle}>
                {getMarketplaceTruckName(listing.truckSnapshot.templateId)}
              </Text>
              <Text style={styles.historyMeta}>
                {listing.status === 'sold'
                  ? `Satıldı · ${listing.soldAt ? new Date(listing.soldAt).toLocaleString('tr-TR') : '—'}`
                  : listing.status === 'cancelled'
                    ? 'İlan iptal edildi'
                    : listing.status === 'expired'
                      ? 'İlan süresi doldu'
                      : getMarketplaceErrorMessage()}
              </Text>
            </View>
            <View style={styles.historyMoney}>
              <Text style={styles.historyPrice}>{formatMoney(listing.askingPrice)}</Text>
              {listing.status === 'sold' ? (
                <Text style={styles.historyNet}>Net {formatMoney(listing.askingPrice - fee)}</Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
  historyCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.card, borderRadius: 16, borderWidth: 1,
    borderColor: colors.border, padding: spacing.md,
  },
  historyIcon: {
    width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface2,
  },
  historyMain: { flex: 1, minWidth: 0 },
  historyTitle: { color: colors.textPrimary, fontSize: 13, fontWeight: '800' },
  historyMeta: { color: colors.textMuted, fontSize: 10, marginTop: 3 },
  historyMoney: { alignItems: 'flex-end' },
  historyPrice: { color: colors.accentAmber, fontSize: 13, fontWeight: '900' },
  historyNet: { color: colors.success, fontSize: 9, marginTop: 3 },
});

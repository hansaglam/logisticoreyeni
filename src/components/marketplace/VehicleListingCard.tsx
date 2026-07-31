import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { getTruckArtworkByTemplateId } from '../../assets/fleetAssets';
import { CITIES_BY_ID } from '../../data/cities';
import { findTruckMarketItem, STARTER_TRUCK } from '../../data/trucks';
import {
  getMarketplacePriceAssessment,
  getMarketplacePriceLabel,
  getUpgradeLevel,
} from '../../domain/vehicleMarketplacePresentation';
import { colors, formatMoney, spacing, typography } from '../../theme';
import type { VehicleMarketplaceListing } from '../../types/vehicleMarketplace';
import { ActionButton, StatusBadge } from '../ui';

export function getMarketplaceTruckName(templateId: string): string {
  if (templateId === STARTER_TRUCK.catalogId) return STARTER_TRUCK.name;
  return findTruckMarketItem(templateId)?.name ?? 'Bilinmeyen Model';
}

function remainingLabel(expiresAt: number): string {
  const hours = Math.max(0, Math.ceil((expiresAt - Date.now()) / 3_600_000));
  if (hours >= 24) return `${Math.ceil(hours / 24)} gün kaldı`;
  return `${hours} sa kaldı`;
}

export default function VehicleListingCard({
  listing,
  onDetail,
  onPurchase,
  ownListing = false,
  onCancel,
  cancelling = false,
}: {
  listing: VehicleMarketplaceListing;
  onDetail: () => void;
  onPurchase?: () => void;
  ownListing?: boolean;
  onCancel?: () => void;
  cancelling?: boolean;
}) {
  const snapshot = listing.truckSnapshot;
  const artwork = getTruckArtworkByTemplateId(snapshot.templateId);
  const assessment = getMarketplacePriceAssessment(
    listing.askingPrice,
    listing.recommendedPrice,
  );
  const badgeVariant = assessment === 'good' ? 'success' : assessment === 'high' ? 'warning' : 'blue';
  const fee = Math.max(0, listing.askingPrice * listing.marketplaceFeeRate);
  return (
    <View style={styles.card}>
      <View style={styles.top}>
        <View style={styles.artWrap}>
          {artwork ? <Image source={artwork} style={styles.art} resizeMode="contain" /> : null}
        </View>
        <View style={styles.main}>
          <Text style={styles.name} numberOfLines={1}>
            {snapshot.customName || getMarketplaceTruckName(snapshot.templateId)}
          </Text>
          {snapshot.customName ? (
            <Text style={styles.model} numberOfLines={1}>
              {getMarketplaceTruckName(snapshot.templateId)}
            </Text>
          ) : null}
          <Text style={styles.price}>{formatMoney(listing.askingPrice)}</Text>
          <StatusBadge label={getMarketplacePriceLabel(assessment)} variant={badgeVariant} />
        </View>
      </View>
      <View style={styles.metrics}>
        <Metric label="Kondisyon" value={`%${Math.round(snapshot.condition)}`} />
        <Metric label="Kilometre" value={`${Math.round(snapshot.totalMileageKm).toLocaleString('tr-TR')} km`} />
        <Metric label="Şehir" value={CITIES_BY_ID[snapshot.currentCityId]?.name ?? snapshot.currentCityId} />
        <Metric label="Upgrade" value={`Sv.${getUpgradeLevel(listing)}`} />
      </View>
      <View style={styles.secondary}>
        <Text style={styles.secondaryText}>Önerilen: {formatMoney(listing.recommendedPrice)}</Text>
        <Text style={styles.secondaryText}>{remainingLabel(listing.expiresAt)}</Text>
        <Text style={styles.seller} numberOfLines={1}>{listing.sellerDisplayName || 'Anonim satıcı'}</Text>
      </View>
      {ownListing ? (
        <View style={styles.ownerFinance}>
          <Text style={styles.ownerFinanceText}>Komisyon {formatMoney(fee)}</Text>
          <Text style={styles.net}>Net {formatMoney(listing.askingPrice - fee)}</Text>
        </View>
      ) : null}
      <View style={styles.actions}>
        <ActionButton label="Detay" onPress={onDetail} variant="secondary" compact style={styles.action} />
        {ownListing ? (
          <ActionButton
            label={cancelling ? 'İptal ediliyor…' : 'İptal Et'}
            onPress={onCancel ?? (() => undefined)}
            disabled={cancelling}
            variant="danger"
            compact
            style={styles.action}
          />
        ) : (
          <ActionButton label="Satın Al" onPress={onPurchase ?? (() => undefined)} compact style={styles.action} />
        )}
      </View>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.md,
  },
  top: { flexDirection: 'row', gap: spacing.md },
  artWrap: {
    width: 112, height: 82, borderRadius: 16, backgroundColor: colors.surface3,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  art: { width: 106, height: 72 },
  main: { flex: 1, minWidth: 0, alignItems: 'flex-start' },
  name: { ...typography.cardTitle, fontSize: 15 },
  model: { color: colors.textMuted, fontSize: 10, marginTop: 2 },
  price: { color: colors.accentAmber, fontSize: 20, fontWeight: '900', marginVertical: 4 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  metric: {
    width: '48.8%', backgroundColor: colors.surface2, borderRadius: 10,
    paddingHorizontal: spacing.sm, paddingVertical: 7,
  },
  metricLabel: { color: colors.textMuted, fontSize: 9 },
  metricValue: { color: colors.textSecondary, fontSize: 11, fontWeight: '700', marginTop: 2 },
  secondary: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  secondaryText: { color: colors.textMuted, fontSize: 10 },
  seller: { flex: 1, textAlign: 'right', color: colors.textSecondary, fontSize: 10 },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1, minHeight: 44 },
  ownerFinance: { flexDirection: 'row', justifyContent: 'space-between' },
  ownerFinanceText: { color: colors.textMuted, fontSize: 11 },
  net: { color: colors.success, fontSize: 11, fontWeight: '800' },
});

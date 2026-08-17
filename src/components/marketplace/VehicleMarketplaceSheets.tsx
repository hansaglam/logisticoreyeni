import React from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

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
import { ActionButton, GameIcon, ProgressBar, StatusBadge } from '../ui';
import { getMarketplaceTruckName } from './VehicleListingCard';

function SheetFrame({
  visible,
  onClose,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
          <View style={styles.handle} />
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function VehicleListingDetailSheet({
  listing,
  onClose,
  onPurchase,
  ownListing = false,
}: {
  listing: VehicleMarketplaceListing | null;
  onClose: () => void;
  onPurchase: () => void;
  ownListing?: boolean;
}) {
  if (!listing) return null;
  const snapshot = listing.truckSnapshot;
  const template =
    snapshot.templateId === STARTER_TRUCK.catalogId
      ? STARTER_TRUCK
      : findTruckMarketItem(snapshot.templateId);
  const artwork = getTruckArtworkByTemplateId(snapshot.templateId);
  const assessment = getMarketplacePriceAssessment(listing.askingPrice, listing.recommendedPrice);
  return (
    <SheetFrame visible onClose={onClose}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Araç Detayı</Text>
          <Text style={styles.subtitle}>{getMarketplaceTruckName(snapshot.templateId)}</Text>
        </View>
        <CloseButton onPress={onClose} />
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.heroArt}>
          {artwork ? <Image source={artwork} resizeMode="contain" style={styles.art} /> : null}
        </View>
        <View style={styles.priceRow}>
          <View>
            <Text style={styles.customName}>{snapshot.customName || getMarketplaceTruckName(snapshot.templateId)}</Text>
            <Text style={styles.price}>{formatMoney(listing.askingPrice)}</Text>
          </View>
          <StatusBadge
            label={getMarketplacePriceLabel(assessment)}
            variant={assessment === 'good' ? 'success' : assessment === 'high' ? 'warning' : 'blue'}
          />
        </View>
        <View style={styles.condition}>
          <View style={styles.rowBetween}>
            <Text style={styles.label}>Kondisyon</Text>
            <Text style={styles.value}>%{Math.round(snapshot.condition)}</Text>
          </View>
          <ProgressBar progress={snapshot.condition / 100} color={snapshot.condition >= 70 ? colors.success : colors.warning} height={7} />
        </View>
        <View style={styles.grid}>
          <Detail label="Kilometre" value={`${Math.round(snapshot.totalMileageKm).toLocaleString('tr-TR')} km`} />
          <Detail label="Yakıt" value={`${snapshot.currentFuelL.toFixed(0)} / ${snapshot.fuelTankCapacityL.toFixed(0)} L`} />
          <Detail label="Şehir" value={CITIES_BY_ID[snapshot.currentCityId]?.name ?? snapshot.currentCityId} />
          <Detail label="Upgrade" value={`Seviye ${getUpgradeLevel(listing)}`} />
          <Detail label="Kapasite" value={`${template?.capacity ?? 0} ton`} />
          <Detail label="Satıcı" value={listing.sellerDisplayName || 'Anonim'} />
        </View>
        <View style={styles.upgrades}>
          <Text style={styles.sectionTitle}>Geliştirmeler</Text>
          {Object.entries(snapshot.upgrades ?? {}).map(([key, level]) => (
            <View key={key} style={styles.rowBetween}>
              <Text style={styles.label}>{upgradeLabel(key)}</Text>
              <Text style={styles.value}>Sv.{level}</Text>
            </View>
          ))}
          {!snapshot.upgrades ? <Text style={styles.muted}>Geliştirme bulunmuyor.</Text> : null}
        </View>
        <View style={styles.rowBetween}>
          <Text style={styles.label}>Önerilen değer</Text>
          <Text style={styles.recommended}>{formatMoney(listing.recommendedPrice)}</Text>
        </View>
        <View style={styles.rowBetween}>
          <Text style={styles.label}>İlan bitişi</Text>
          <Text style={styles.value}>{new Date(listing.expiresAt).toLocaleString('tr-TR')}</Text>
        </View>
      </ScrollView>
      {!ownListing ? (
        <ActionButton
          label={`Satın Al · ${formatMoney(listing.askingPrice)}`}
          onPress={onPurchase}
          icon="truck"
          fullWidth
          style={styles.primaryAction}
        />
      ) : null}
    </SheetFrame>
  );
}

export function VehiclePurchaseConfirmSheet({
  listing,
  cash,
  fleetCount,
  fleetLimit,
  preparing,
  purchasing,
  onClose,
  onConfirm,
}: {
  listing: VehicleMarketplaceListing | null;
  cash: number;
  fleetCount: number;
  fleetLimit: number | null;
  preparing?: boolean;
  purchasing: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!listing) return null;
  const after = cash - listing.askingPrice;
  const canConfirm = !preparing && !purchasing && after >= 0;
  return (
    <SheetFrame visible onClose={purchasing || preparing ? () => undefined : onClose}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Araç satın alınacak</Text>
          <Text style={styles.subtitle}>{getMarketplaceTruckName(listing.truckSnapshot.templateId)}</Text>
        </View>
        {!purchasing && !preparing ? <CloseButton onPress={onClose} /> : null}
      </View>
      <View style={styles.confirmContent}>
        <ConfirmRow label="Araç fiyatı" value={formatMoney(listing.askingPrice)} accent />
        <ConfirmRow
          label={preparing ? 'Kullanılabilir nakit (sunucu)…' : 'Kullanılabilir nakit (sunucu)'}
          value={preparing ? '—' : formatMoney(cash)}
        />
        <ConfirmRow label="Satın alma sonrası" value={preparing ? '—' : formatMoney(after)} danger={!preparing && after < 0} />
        <ConfirmRow
          label="Filo"
          value={fleetLimit ? `${fleetCount} / ${fleetLimit} → ${fleetCount + 1} / ${fleetLimit}` : `${fleetCount} → ${fleetCount + 1}`}
        />
        <View style={styles.info}>
          <GameIcon name="lock" size={16} color={colors.info} />
          <Text style={styles.infoText}>Sahiplik ve ödeme güvenli sunucu işlemiyle tamamlanır.</Text>
        </View>
      </View>
      <ActionButton
        label={
          purchasing
            ? 'Satın alınıyor…'
            : preparing
              ? 'Nakit kontrol ediliyor…'
              : 'Satın Almayı Onayla'
        }
        onPress={onConfirm}
        disabled={!canConfirm}
        fullWidth
        icon="success"
        style={styles.primaryAction}
      />
      {purchasing || preparing ? <ActivityIndicator color={colors.accentBlue} style={styles.loading} /> : null}
    </SheetFrame>
  );
}

function CloseButton({ onPress }: { onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.close} onPress={onPress}>
      <GameIcon name="close" size={20} color={colors.textSecondary} />
    </TouchableOpacity>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detail}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function ConfirmRow({ label, value, accent, danger }: {
  label: string; value: string; accent?: boolean; danger?: boolean;
}) {
  return (
    <View style={styles.confirmRow}>
      <Text style={styles.confirmLabel}>{label}</Text>
      <Text style={[styles.confirmValue, accent && styles.accent, danger && styles.danger]}>{value}</Text>
    </View>
  );
}

function upgradeLabel(key: string): string {
  return ({ engine: 'Motor', fuelEfficiency: 'Yakıt Verimi', cargo: 'Kargo', durability: 'Dayanıklılık' } as Record<string, string>)[key] ?? key;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.74)', justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '91%', backgroundColor: colors.surface, borderTopLeftRadius: 26,
    borderTopRightRadius: 26, borderWidth: 1, borderColor: colors.borderStrong,
    paddingBottom: spacing.xl,
  },
  handle: { width: 42, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, alignSelf: 'center', marginTop: 8 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: spacing.lg, paddingBottom: spacing.md,
  },
  title: { ...typography.sectionTitle, fontSize: 17 },
  subtitle: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  close: {
    width: 44, height: 44, borderRadius: 14, backgroundColor: colors.cardSoft,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
  },
  content: { paddingHorizontal: spacing.lg, gap: spacing.md, paddingBottom: spacing.lg },
  heroArt: {
    height: 150, backgroundColor: colors.surface2, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  art: { width: '90%', height: 138 },
  priceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  customName: { color: colors.textPrimary, fontSize: 15, fontWeight: '800' },
  price: { color: colors.accentAmber, fontSize: 24, fontWeight: '900', marginTop: 3 },
  condition: { gap: 7 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md },
  label: { color: colors.textMuted, fontSize: 11 },
  value: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  recommended: { color: colors.success, fontSize: 13, fontWeight: '800' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  detail: { width: '48.8%', backgroundColor: colors.surface2, borderRadius: 12, padding: spacing.md },
  upgrades: { backgroundColor: colors.surface2, borderRadius: 14, padding: spacing.md, gap: spacing.sm },
  sectionTitle: { color: colors.textPrimary, fontSize: 12, fontWeight: '800' },
  muted: { color: colors.textMuted, fontSize: 11 },
  primaryAction: { marginHorizontal: spacing.lg, minHeight: 50 },
  confirmContent: { paddingHorizontal: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl },
  confirmRow: { flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.divider, paddingBottom: spacing.md },
  confirmLabel: { color: colors.textSecondary, fontSize: 13 },
  confirmValue: { color: colors.textPrimary, fontSize: 14, fontWeight: '800' },
  accent: { color: colors.accentAmber },
  danger: { color: colors.danger },
  info: { flexDirection: 'row', gap: spacing.sm, backgroundColor: colors.infoSoft, borderRadius: 12, padding: spacing.md },
  infoText: { flex: 1, color: colors.textSecondary, fontSize: 11, lineHeight: 16 },
  loading: { marginTop: spacing.sm },
});

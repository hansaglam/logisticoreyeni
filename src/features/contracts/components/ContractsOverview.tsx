import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { getActiveDeliveryDestinationCityIds } from '../../../utils/contractSorting';
import { getIdleTruckOriginCityIds } from '../../../simulation/delivery';
import { getCityName } from '../../../utils/entityLookup';
import {
  formatIdleTruckSummaryLine,
} from '../../../utils/truckLocationUx';
import { colors, formatMoney, spacing } from '../../../theme';
import type { Delivery, Truck } from '../../../types/game';

export type ContractsSegmentKey = 'available' | 'active' | 'completed';

export interface ContractsTabSegment {
  key: ContractsSegmentKey;
  label: string;
  count: number;
}

interface ContractsTabBarProps {
  segments: ContractsTabSegment[];
  activeKey: ContractsSegmentKey;
  onChange: (key: ContractsSegmentKey) => void;
}

export function ContractsTabBar({ segments, activeKey, onChange }: ContractsTabBarProps) {
  return (
    <View style={styles.tabBar}>
      {segments.map((segment, index) => {
        const isActive = segment.key === activeKey;
        return (
          <React.Fragment key={segment.key}>
            {index > 0 ? <View style={styles.tabDivider} /> : null}
            <TouchableOpacity
              style={styles.tabItem}
              onPress={() => onChange(segment.key)}
              activeOpacity={0.85}
            >
              <View style={styles.tabLabelRow}>
                <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>
                  {segment.label}
                </Text>
                {segment.count > 0 ? (
                  <View style={styles.tabBadge}>
                    <Text style={styles.tabBadgeText}>
                      {segment.count > 99 ? '99+' : segment.count}
                    </Text>
                  </View>
                ) : null}
              </View>
              {isActive ? <View style={styles.tabUnderline} /> : null}
            </TouchableOpacity>
          </React.Fragment>
        );
      })}
    </View>
  );
}

interface MarketFilterInfoCardProps {
  routeLine: string;
  exactCount: number;
  relatedCount: number;
  onClear: () => void;
}

export function MarketFilterInfoCard({
  routeLine,
  exactCount,
  relatedCount,
  onClear,
}: MarketFilterInfoCardProps) {
  const detailMessage =
    exactCount > 0
      ? 'Bu fırsatla tam eşleşen işler bulundu.'
      : relatedCount > 0
        ? 'Tam eşleşme yok, aynı rota/şehir/ürünle ilişkili işler gösteriliyor.'
        : 'Bu fırsata uygun iş şu anda yok. Yakın işler ve diğer sözleşmeler aşağıda gösteriliyor.';

  return (
    <View style={styles.marketFilterInfoCard}>
      <View style={styles.marketFilterInfoHeader}>
        <Text style={styles.marketFilterInfoTitle}>Piyasa fırsatına göre sıralanıyor</Text>
        <TouchableOpacity onPress={onClear} activeOpacity={0.85}>
          <Text style={styles.marketFilterClear}>Filtreyi temizle</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.marketFilterInfoRoute} numberOfLines={1}>
        {routeLine}
      </Text>
      <Text style={styles.marketFilterInfoMessage}>{detailMessage}</Text>
      <Text style={styles.marketFilterInfoHint}>
        Eşleşen ve yakın sözleşmeler üstte gösteriliyor.
      </Text>
    </View>
  );
}

interface ContractsSummaryStripProps {
  availableCount: number;
  activeCount: number;
  bestPayment: number;
  playableCount: number;
  trucks: Truck[];
}

export function ContractsSummaryStrip({
  availableCount,
  activeCount,
  bestPayment,
  playableCount,
  trucks,
}: ContractsSummaryStripProps) {
  const idleCount = (trucks ?? []).filter((truck) => truck.status === 'idle').length;
  const originCityIds = getIdleTruckOriginCityIds(trucks);
  const cityLabels = originCityIds.map((cityId) => getCityName(cityId)).join(', ');
  const originLine = formatIdleTruckSummaryLine(cityLabels, idleCount, playableCount);

  return (
    <View style={styles.summaryStrip}>
      <Text style={styles.compactStatText}>
        <Text style={styles.statValueSuccess}>{playableCount}</Text>
        {' uygun iş · '}
        <Text style={styles.statValueInfo}>{availableCount}</Text>
        {' iş ilanı · '}
        <Text style={styles.statValueAmber}>{activeCount}</Text>
        {' aktif · En yüksek '}
        <Text style={styles.statValueSuccess}>{formatMoney(bestPayment)}</Text>
      </Text>
      <Text style={styles.summarySubline} numberOfLines={2}>
        {originLine}
      </Text>
    </View>
  );
}

export function NextRouteHintCard({ deliveries }: { deliveries: Delivery[] }) {
  const destinationIds = [...getActiveDeliveryDestinationCityIds(deliveries)];
  if (destinationIds.length === 0) return null;

  const message =
    destinationIds.length === 1
      ? `Sıradaki rota önerileri: ${getCityName(destinationIds[0])}'a varacak kamyon için ${getCityName(destinationIds[0])} çıkışlı işler ayrıca öne çıkarılır.`
      : 'Sıradaki rota önerileri: Kamyonlarının varış şehirlerinden çıkan işler ayrıca öne çıkarılır.';

  return (
    <View style={styles.nextRouteHint}>
      <Text style={styles.nextRouteHintTitle}>Sıradaki rota önerileri</Text>
      <Text style={styles.nextRouteHintText} numberOfLines={2}>
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    flexDirection: 'row', alignItems: 'stretch', marginBottom: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.borderStrong,
  },
  tabItem: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm, paddingHorizontal: spacing.xs },
  tabDivider: { width: 1, backgroundColor: colors.borderStrong, marginVertical: spacing.sm },
  tabLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  tabLabel: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
  tabLabelActive: { color: colors.info, fontWeight: '800' },
  tabBadge: {
    minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.danger,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
  },
  tabBadgeText: { fontSize: 10, fontWeight: '800', color: colors.textPrimary },
  tabUnderline: {
    position: 'absolute', bottom: 0, left: spacing.sm, right: spacing.sm,
    height: 2, backgroundColor: colors.info, borderRadius: 1,
  },
  marketFilterInfoCard: {
    backgroundColor: colors.accentAmberSoft, borderWidth: 1, borderColor: colors.accentAmber,
    borderRadius: 10, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm,
    marginBottom: spacing.sm, gap: 4,
  },
  marketFilterInfoHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm,
  },
  marketFilterInfoTitle: { flex: 1, fontSize: 12, color: colors.textPrimary, fontWeight: '800' },
  marketFilterInfoRoute: { fontSize: 11, color: colors.textSecondary, fontWeight: '600' },
  marketFilterInfoMessage: { fontSize: 11, color: colors.accentAmber, fontWeight: '700', lineHeight: 15 },
  marketFilterInfoHint: { fontSize: 10, color: colors.textSecondary, fontWeight: '500' },
  marketFilterClear: { fontSize: 11, color: colors.accentAmber, fontWeight: '800' },
  summaryStrip: {
    marginBottom: spacing.sm, paddingVertical: 8, paddingHorizontal: spacing.sm,
    borderRadius: 10, backgroundColor: colors.cardSoft, borderWidth: 1,
    borderColor: colors.borderStrong, gap: 3,
  },
  compactStatText: { fontSize: 11, color: colors.textMuted, fontWeight: '600', textAlign: 'center' },
  statValueInfo: { color: colors.info, fontWeight: '800' },
  statValueAmber: { color: colors.accentAmber, fontWeight: '800' },
  statValueSuccess: { color: colors.success, fontWeight: '800' },
  summarySubline: { fontSize: 10, color: colors.textSecondary, fontWeight: '600', textAlign: 'center' },
  nextRouteHint: {
    marginBottom: spacing.sm, paddingVertical: 8, paddingHorizontal: spacing.sm,
    borderRadius: 10, backgroundColor: 'rgba(56, 189, 248, 0.08)', borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.25)',
  },
  nextRouteHintTitle: { fontSize: 10, fontWeight: '800', color: colors.info, marginBottom: 2 },
  nextRouteHintText: { fontSize: 11, color: colors.textSecondary, fontWeight: '600', lineHeight: 15 },
});

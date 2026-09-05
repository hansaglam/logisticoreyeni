import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GameIcon } from '../../../components/ui';
import {
  MARKET_SEGMENT_BG,
  MARKET_SEGMENT_BORDER,
  MARKET_SUMMARY_STRIP_HEIGHT,
  marketCityChipActive,
  marketCityChipInactive,
} from '../../../components/market/marketTheme';
import { formatMarketStockRiskCounter, getMarketStatusShortLabel } from '../../../utils/marketStatusLabels';
import { colors, formatMoney } from '../../../theme';
import type { GameIconName } from '../../../theme/icons';

export type MarketTab = 'products' | 'opportunities';
export type MarketMood = 'Sakin' | 'Hareketli' | 'Fırsatlı' | 'Kriz';

const MARKET_TABS: ReadonlyArray<{ key: MarketTab; label: string; icon: GameIconName }> = [
  { key: 'products', label: 'Ürünler', icon: 'inventory' },
  { key: 'opportunities', label: 'Fırsatlar', icon: 'reputation' },
];

export function MarketStatusSummary({
  mood,
  criticalCount,
  opportunityCount,
  syncCaption,
}: {
  mood: MarketMood;
  criticalCount: number;
  opportunityCount: number;
  syncCaption?: string | null;
}) {
  return (
    <View style={styles.worldStatusRow}>
      <GameIcon name="map" size={13} color={colors.textMuted} />
      <Text style={styles.worldStatusText} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.8}>
        <Text style={styles.worldStatusLabel}>Dünya Durumu</Text>
        {'  '}
        {mood} · {formatMarketStockRiskCounter(criticalCount)} · {opportunityCount} fırsat
      </Text>
      {syncCaption ? (
        <Text style={styles.worldStatusSync} numberOfLines={2}>
          {syncCaption}
        </Text>
      ) : null}
    </View>
  );
}

export function CompactCitySummary({
  cityName,
  shortages,
  surpluses,
  avgPrice,
}: {
  cityName: string;
  shortages: number;
  surpluses: number;
  avgPrice: number;
}) {
  return (
    <View style={styles.citySummaryStrip}>
      <View style={styles.citySummaryMetric}>
        <Text style={[styles.citySummaryValue, { color: colors.danger }]}>{shortages}</Text>
        <Text style={styles.citySummaryLabel} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.75}>
          {getMarketStatusShortLabel('Kıtlık')}
        </Text>
      </View>
      <View style={styles.citySummaryDivider} />
      <View style={styles.citySummaryMetric}>
        <Text style={[styles.citySummaryValue, { color: colors.success }]}>{surpluses}</Text>
        <Text style={styles.citySummaryLabel}>Stok Fazla</Text>
      </View>
      <View style={styles.citySummaryDivider} />
      <View style={styles.citySummaryMetric}>
        <Text style={[styles.citySummaryValue, { color: colors.accentAmber }]}>{formatMoney(avgPrice)}</Text>
        <Text style={styles.citySummaryLabel}>Ort. fiyat</Text>
      </View>
      <View style={styles.citySummaryTrendSlot}>
        <GameIcon name="market" size={16} color={colors.info} />
        <Text style={styles.citySummaryName} numberOfLines={1}>{cityName}</Text>
      </View>
    </View>
  );
}

export function MarketTabSegment({
  activeTab,
  onChange,
}: {
  activeTab: MarketTab;
  onChange: (tab: MarketTab) => void;
}) {
  return (
    <View style={styles.segmentContainer}>
      {MARKET_TABS.map((tab) => {
        const isActive = tab.key === activeTab;
        return (
          <Pressable
            key={tab.key}
            style={[styles.segmentTab, isActive && styles.segmentTabActive]}
            onPress={() => onChange(tab.key)}
          >
            <GameIcon name={tab.icon} size={15} color={isActive ? colors.accentBlue : colors.textMuted} />
            <Text style={[styles.segmentLabel, isActive && styles.segmentLabelActive]} numberOfLines={1}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function MarketCityChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const palette = selected ? marketCityChipActive : marketCityChipInactive;
  return (
    <Pressable
      onPress={onPress}
      style={[styles.cityChip, { backgroundColor: palette.backgroundColor, borderColor: palette.borderColor }]}
    >
      <Text
        style={[styles.cityChipLabel, { color: palette.textColor, fontWeight: selected ? '700' : '600' }]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  worldStatusRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, minHeight: 26, paddingHorizontal: 2 },
  worldStatusText: { flex: 1, minWidth: 0, fontSize: 10, lineHeight: 13, color: colors.textSecondary, fontWeight: '500' },
  worldStatusSync: { maxWidth: 118, fontSize: 8.5, lineHeight: 11, color: colors.textMuted, fontWeight: '500', textAlign: 'right', flexShrink: 0 },
  worldStatusLabel: { fontWeight: '700', color: colors.textPrimary },
  segmentContainer: {
    height: 42, borderRadius: 14, padding: 3, backgroundColor: MARKET_SEGMENT_BG,
    borderWidth: 1, borderColor: MARKET_SEGMENT_BORDER, flexDirection: 'row', gap: 3,
  },
  segmentTab: {
    flex: 1, height: 36, borderRadius: 11, borderWidth: 1, borderColor: 'transparent',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 6,
  },
  segmentTabActive: { backgroundColor: 'rgba(35,136,255,0.13)', borderColor: colors.accentBlue },
  segmentLabel: { fontSize: 11, fontWeight: '600', color: colors.textMuted },
  segmentLabelActive: { color: colors.accentBlue, fontWeight: '700' },
  citySummaryStrip: {
    flexDirection: 'row', alignItems: 'center', height: MARKET_SUMMARY_STRIP_HEIGHT,
    borderRadius: 14, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.cardSoft, paddingHorizontal: 11,
  },
  citySummaryMetric: { flex: 1, alignItems: 'center', minWidth: 0 },
  citySummaryDivider: { width: 1, height: 28, backgroundColor: 'rgba(70,120,190,0.22)' },
  citySummaryValue: { fontSize: 15, fontWeight: '800', lineHeight: 17 },
  citySummaryLabel: { fontSize: 8.5, color: colors.textMuted, marginTop: 2, lineHeight: 10 },
  citySummaryTrendSlot: { alignItems: 'center', justifyContent: 'center', paddingLeft: 6, minWidth: 44, maxWidth: 56 },
  citySummaryName: { fontSize: 8.5, fontWeight: '700', color: colors.textMuted, marginTop: 2, textAlign: 'center' },
  cityChip: {
    height: 34, paddingHorizontal: 13, borderRadius: 999, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  cityChipLabel: { fontSize: 10.5 },
});

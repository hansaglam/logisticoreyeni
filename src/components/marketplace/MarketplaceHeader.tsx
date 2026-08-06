import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppTutorialTarget } from '../tutorial/AppTutorialTarget';
import { colors, formatMoney, spacing, typography } from '../../theme';
import { GameIcon, IconButton } from '../ui';

export interface MarketplaceStats {
  activeListings: number;
  averagePrice: number | null;
  modelCount: number;
  myListings: number;
}

export default function MarketplaceHeader({
  stats,
  onBack,
  loading = false,
  onCreateListing,
  helpAction,
}: {
  stats: MarketplaceStats;
  onBack: () => void;
  loading?: boolean;
  onCreateListing?: () => void;
  helpAction?: React.ReactNode;
}) {
  const formatStat = (value: string) => (loading ? '—' : value);
  const items = [
    ['Aktif İlan', formatStat(String(stats.activeListings))],
    ['Ort. Fiyat', loading || stats.averagePrice == null ? '—' : formatMoney(stats.averagePrice)],
    ['Satıştaki Model', formatStat(String(stats.modelCount))],
    ['İlanlarım', formatStat(String(stats.myListings))],
  ];
  return (
    <>
      <View style={styles.hero}>
        <IconButton icon="back" onPress={onBack} color={colors.textPrimary} />
        <AppTutorialTarget tutorialId="vehicle-marketplace" targetId="marketplace-header" style={styles.heroText}>
          <Text style={styles.title}>Araç Pazarı</Text>
          <Text style={styles.subtitle}>
            Oyuncuların satışa çıkardığı kullanılmış araçları keşfet
          </Text>
        </AppTutorialTarget>
        <View style={styles.heroActions}>
          {helpAction ?? null}
          {onCreateListing ? (
            <AppTutorialTarget tutorialId="vehicle-marketplace" targetId="create-listing-button">
              <IconButton icon="truck" onPress={onCreateListing} color={colors.info} />
            </AppTutorialTarget>
          ) : (
            <View style={styles.icon}>
              <GameIcon name="truck" size={24} color={colors.info} />
            </View>
          )}
        </View>
      </View>
      <View style={styles.stats}>
        {items.map(([label, value], index) => (
          <View key={label} style={[styles.stat, index > 0 && styles.statBorder]}>
            <Text style={styles.statValue} numberOfLines={1}>{value}</Text>
            <Text style={styles.statLabel} numberOfLines={1}>{label}</Text>
          </View>
        ))}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  heroText: { flex: 1, minWidth: 0 },
  heroActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexShrink: 0,
  },
  title: { ...typography.screenTitle, fontSize: 22 },
  subtitle: { ...typography.screenSubtitle, fontSize: 11, marginTop: 2 },
  icon: {
    width: 44, height: 44, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.infoSoft, borderWidth: 1, borderColor: colors.borderStrong,
  },
  stats: {
    flexDirection: 'row',
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    paddingVertical: spacing.md,
    marginBottom: spacing.md,
  },
  stat: { flex: 1, alignItems: 'center', minWidth: 0, paddingHorizontal: 3 },
  statBorder: { borderLeftWidth: 1, borderLeftColor: colors.divider },
  statValue: { color: colors.textPrimary, fontSize: 12, fontWeight: '800' },
  statLabel: { color: colors.textMuted, fontSize: 9, marginTop: 3 },
});

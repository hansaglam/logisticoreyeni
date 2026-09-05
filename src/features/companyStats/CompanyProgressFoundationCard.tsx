import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppCard, GameIcon, ProgressBar, StatusBadge } from '../../components/ui';
import { colors, formatMoney, spacing, typography } from '../../theme';

export interface CompanyProgressFoundationCardProps {
  driverName: string;
  driverLevel: number;
  driverXpIntoLevel: number;
  driverXpForNextLevel: number;
  driverProgress: number;
  deliveriesCompleted: number;
  totalDistanceCompleted: number;
  deliveryRevenueEarned: number;
  historicalDataComplete: boolean;
}

/** Read-only internal foundation preview. No store subscription or action ownership. */
export default function CompanyProgressFoundationCard({
  driverName,
  driverLevel,
  driverXpIntoLevel,
  driverXpForNextLevel,
  driverProgress,
  deliveriesCompleted,
  totalDistanceCompleted,
  deliveryRevenueEarned,
  historicalDataComplete,
}: CompanyProgressFoundationCardProps) {
  return (
    <AppCard variant="soft" style={styles.card} padded={false}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <GameIcon name="driver" size={17} color={colors.accentBlue} />
          <Text style={styles.title}>Şoför Gelişimi</Text>
        </View>
        <StatusBadge label="V1.1" variant="info" size="sm" />
      </View>

      <View style={styles.driverRow}>
        <View style={styles.driverText}>
          <Text style={styles.driverName} numberOfLines={1}>{driverName}</Text>
          <Text style={styles.caption}>Seviye {driverLevel}</Text>
        </View>
        <Text style={styles.xpValue}>
          {driverXpForNextLevel > 0
            ? `${driverXpIntoLevel} / ${driverXpForNextLevel} XP`
            : 'Maksimum seviye'}
        </Text>
      </View>
      <ProgressBar progress={driverProgress} color={colors.accentBlue} height={6} />

      <View style={styles.statsRow}>
        <Stat label="Teslimat" value={String(deliveriesCompleted)} />
        <Stat label="Mesafe" value={`${Math.round(totalDistanceCompleted).toLocaleString('tr-TR')} km`} />
        <Stat label="Gelir" value={formatMoney(deliveryRevenueEarned)} />
      </View>
      {!historicalDataComplete ? (
        <Text style={styles.coverageNote}>Detaylı mesafe ve gelir istatistikleri V1.1’den itibaren tutulur.</Text>
      ) : null}
    </AppCard>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { ...typography.sectionTitle, fontSize: 14 },
  driverRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  driverText: { flex: 1, minWidth: 0 },
  driverName: { ...typography.bodySmall, fontWeight: '700' },
  caption: { ...typography.caption, marginTop: 1 },
  xpValue: { ...typography.caption, color: colors.accentBlue, fontWeight: '700' },
  statsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  stat: {
    flex: 1,
    minWidth: 0,
    paddingVertical: spacing.sm,
    paddingHorizontal: 4,
    alignItems: 'center',
    borderRadius: 10,
    backgroundColor: colors.cardSoft,
  },
  statLabel: { ...typography.caption, fontSize: 10 },
  statValue: { ...typography.bodySmall, fontWeight: '800', marginTop: 2 },
  coverageNote: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm },
});

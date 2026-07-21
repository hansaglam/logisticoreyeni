import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppCard } from '../ui';
import type { WorldEvent } from '../../types/game';
import { getPrimaryWorldEventLabel } from '../../simulation/worldEvents';
import { colors, spacing, typography } from '../../theme';

interface MarketWorldEventsStripProps {
  events: WorldEvent[];
}

export default function MarketWorldEventsStrip({ events }: MarketWorldEventsStripProps) {
  if (events.length === 0) {
    return (
      <AppCard variant="soft" style={styles.calmCard} padded>
        <Text style={styles.calmText}>Piyasa sakin — aktif olay yok</Text>
      </AppCard>
    );
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      nestedScrollEnabled
    >
      {events.map((event) => (
        <View key={event.id} style={styles.chip}>
          <Text style={styles.chipTitle} numberOfLines={1}>
            {getPrimaryWorldEventLabel(event)}
          </Text>
          <Text style={styles.chipSubtitle} numberOfLines={2}>
            {event.title}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: spacing.sm,
    paddingVertical: 2,
  },
  calmCard: {
    borderColor: colors.border,
  },
  calmText: {
    ...typography.caption,
    color: colors.textMuted,
  },
  chip: {
    minWidth: 140,
    maxWidth: 180,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 12,
    backgroundColor: colors.cardSoft,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.35)',
    gap: 2,
  },
  chipTitle: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.accentAmber,
  },
  chipSubtitle: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});

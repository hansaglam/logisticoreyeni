import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppCard, GameIcon } from '../ui';
import type { WorldEvent } from '../../types/game';
import { colors, spacing, typography } from '../../theme';

interface DashboardWorldEventsCardProps {
  headline: string;
  isCalm: boolean;
  topEvents: WorldEvent[];
  onPress: () => void;
}

export default function DashboardWorldEventsCard({
  headline,
  isCalm,
  topEvents,
  onPress,
}: DashboardWorldEventsCardProps) {
  return (
    <Pressable onPress={onPress}>
      <AppCard variant="soft" style={styles.card} padded>
        <View style={styles.row}>
          <GameIcon
            name={isCalm ? 'market' : 'alert'}
            size={18}
            color={isCalm ? colors.textSecondary : colors.accentAmber}
          />
          <View style={styles.textBlock}>
            <Text style={styles.title}>Piyasa Olayları</Text>
            <Text style={styles.subtitle}>{headline}</Text>
            {!isCalm
              ? topEvents.slice(0, 2).map((event) => (
                  <Text key={event.id} style={styles.eventLine} numberOfLines={1}>
                    {event.title}
                  </Text>
                ))
              : null}
          </View>
        </View>
      </AppCard>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderColor: 'rgba(56, 189, 248, 0.28)',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  textBlock: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    ...typography.bodySmall,
    fontWeight: '700',
    color: colors.accentBlue,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  eventLine: {
    ...typography.caption,
    color: colors.textMuted,
  },
});

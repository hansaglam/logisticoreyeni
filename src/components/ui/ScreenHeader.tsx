import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '../../theme';
import type { GameIconName } from '../../theme/icons';
import GameIcon from './GameIcon';
import IconButton from './IconButton';

const SIDE_SLOT_WIDTH = 48;

interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  rightAction?: React.ReactNode;
  titleIcon?: GameIconName;
  titleIconColor?: string;
  /** Gömülü alt ekranlar — daha az dikey alan */
  compact?: boolean;
}

export default function ScreenHeader({
  title,
  subtitle,
  onBack,
  rightAction,
  titleIcon,
  titleIconColor = colors.accentAmber,
  compact = false,
}: ScreenHeaderProps) {
  return (
    <View style={[styles.header, compact && styles.headerCompact]}>
      <View style={styles.sideSlot}>
        {onBack ? (
          <IconButton
            icon="back"
            onPress={onBack}
            size={compact ? 20 : 22}
            color={colors.textPrimary}
          />
        ) : null}
      </View>

      <View style={styles.center}>
        <View style={styles.titleRow}>
          {titleIcon && !compact ? (
            <GameIcon name={titleIcon} size={22} color={titleIconColor} />
          ) : null}
          <Text style={[styles.title, compact && styles.titleCompact]} numberOfLines={1}>
            {title}
          </Text>
        </View>
        {subtitle ? (
          <Text
            style={[styles.subtitle, compact && styles.subtitleCompact]}
            numberOfLines={2}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>

      <View style={styles.sideSlot}>{rightAction ?? null}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  sideSlot: {
    width: SIDE_SLOT_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 34,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 0,
    paddingHorizontal: spacing.xs,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    maxWidth: '100%',
  },
  title: {
    ...typography.screenTitle,
    fontSize: 22,
    textAlign: 'center',
  },
  subtitle: {
    ...typography.screenSubtitle,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  headerCompact: {
    marginBottom: 12,
  },
  titleCompact: {
    fontSize: 18,
    lineHeight: 22,
  },
  subtitleCompact: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
});

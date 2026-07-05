import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '../../theme';
import type { GameIconName } from '../../theme/icons';
import GameIcon from './GameIcon';
import IconButton from './IconButton';

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
      <View style={styles.left}>
        {onBack ? (
          <IconButton
            icon="back"
            onPress={onBack}
            size={compact ? 20 : 22}
            color={colors.textPrimary}
            style={styles.backButton}
          />
        ) : null}
        <View style={styles.titleBlock}>
          <View style={styles.titleRow}>
            {titleIcon && !compact ? (
              <GameIcon name={titleIcon} size={22} color={titleIconColor} />
            ) : null}
            <Text style={[styles.title, compact && styles.titleCompact]}>{title}</Text>
          </View>
          {subtitle ? (
            <Text style={[styles.subtitle, compact && styles.subtitleCompact]}>{subtitle}</Text>
          ) : null}
        </View>
      </View>
      {rightAction ? <View style={styles.right}>{rightAction}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  left: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginRight: spacing.md,
  },
  backButton: {
    marginRight: spacing.sm,
    marginTop: 2,
  },
  titleBlock: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    ...typography.screenTitle,
    fontSize: 22,
  },
  subtitle: {
    ...typography.screenSubtitle,
    marginTop: spacing.xs,
  },
  right: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    minHeight: 32,
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

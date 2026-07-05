import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '../../theme';
import type { GameIconName } from '../../theme/icons';
import GameIcon from './GameIcon';

export type StatusBadgeVariant =
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'muted'
  | 'amber'
  | 'blue';

export type StatusBadgeSize = 'sm' | 'md';

interface StatusBadgeProps {
  label: string;
  variant?: StatusBadgeVariant;
  size?: StatusBadgeSize;
  icon?: GameIconName;
}

const variantColors: Record<StatusBadgeVariant, { bg: string; text: string; border: string }> = {
  success: { bg: colors.successSoft, text: colors.success, border: colors.success },
  warning: { bg: colors.warningSoft, text: colors.warning, border: colors.warning },
  danger: { bg: colors.dangerSoft, text: colors.danger, border: colors.danger },
  info: { bg: colors.infoSoft, text: colors.info, border: colors.info },
  muted: { bg: colors.cardSoft, text: colors.textMuted, border: colors.border },
  amber: { bg: colors.accentAmberSoft, text: colors.accentAmber, border: colors.accentAmber },
  blue: { bg: colors.accentBlueSoft, text: colors.accentBlue, border: colors.accentBlue },
};

export default function StatusBadge({
  label,
  variant = 'muted',
  size = 'sm',
  icon,
}: StatusBadgeProps) {
  const palette = variantColors[variant];
  const isSmall = size === 'sm';
  const iconSize = isSmall ? 12 : 14;

  return (
    <View
      style={[
        styles.badge,
        isSmall ? styles.badgeSm : styles.badgeMd,
        icon ? styles.badgeWithIcon : null,
        {
          backgroundColor: palette.bg,
          borderColor: palette.border,
        },
      ]}
    >
      {icon ? <GameIcon name={icon} size={iconSize} color={palette.text} /> : null}
      <Text
        style={[
          isSmall ? styles.textSm : styles.textMd,
          { color: palette.text },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: radius.pill,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  badgeWithIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  badgeSm: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeMd: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  textSm: {
    ...typography.caption,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  textMd: {
    ...typography.bodySmall,
    fontWeight: '700',
  },
});

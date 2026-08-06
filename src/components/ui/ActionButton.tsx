import React from 'react';
import { StyleSheet, Text, TouchableOpacity, type StyleProp, type ViewStyle } from 'react-native';

import { MIN_TOUCH_TARGET } from '../../constants/layout';
import { colors, radius, spacing, typography } from '../../theme';
import type { GameIconName } from '../../theme/icons';
import GameIcon from './GameIcon';

export type ActionButtonVariant = 'primary' | 'secondary' | 'danger';

interface ActionButtonProps {
  label: string;
  onPress: () => void;
  variant?: ActionButtonVariant;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  fullWidth?: boolean;
  icon?: GameIconName;
  iconSize?: number;
  /** Mağaza kartları vb. için daha düşük profil buton */
  compact?: boolean;
  accessibilityLabel?: string;
}

type ButtonPalette = {
  backgroundColor: string;
  borderColor: string;
  textColor: string;
};

const variantStyles: Record<ActionButtonVariant, ButtonPalette> = {
  primary: {
    backgroundColor: colors.accentBlue,
    borderColor: colors.accentBlue,
    textColor: colors.textPrimary,
  },
  secondary: {
    backgroundColor: colors.cardSoft,
    borderColor: colors.borderStrong,
    textColor: colors.textPrimary,
  },
  danger: {
    backgroundColor: colors.dangerSoft,
    borderColor: colors.danger,
    textColor: colors.danger,
  },
};

/** Opacity yerine kontrastlı renk — disabled yazı/ikon okunabilir kalsın */
const disabledVariantStyles: Record<ActionButtonVariant, ButtonPalette> = {
  primary: {
    backgroundColor: '#1A2F4D',
    borderColor: 'rgba(147, 197, 253, 0.38)',
    textColor: '#B8D4F0',
  },
  secondary: {
    backgroundColor: '#0F172A',
    borderColor: 'rgba(148, 163, 184, 0.42)',
    textColor: '#CBD5E1',
  },
  danger: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderColor: 'rgba(252, 165, 165, 0.4)',
    textColor: '#FCA5A5',
  },
};

export default function ActionButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  style,
  fullWidth = false,
  icon,
  iconSize = 16,
  compact = false,
  accessibilityLabel,
}: ActionButtonProps) {
  const palette = disabled ? disabledVariantStyles[variant] : variantStyles[variant];

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={[
        styles.button,
        compact && styles.buttonCompact,
        fullWidth && styles.fullWidth,
        icon ? styles.buttonWithIcon : null,
        {
          backgroundColor: palette.backgroundColor,
          borderColor: palette.borderColor,
        },
        style,
      ]}
    >
      {icon ? <GameIcon name={icon} size={iconSize} color={palette.textColor} /> : null}
      <Text
        style={[styles.label, compact && styles.labelCompact, { color: palette.textColor }]}
        numberOfLines={2}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: radius.md,
    borderWidth: 1,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
  buttonWithIcon: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  label: {
    ...typography.buttonText,
  },
  buttonCompact: {
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
  },
  labelCompact: {
    fontSize: 12,
    fontWeight: '700',
  },
});

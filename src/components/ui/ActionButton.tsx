import React from 'react';
import { StyleSheet, Text, TouchableOpacity, type StyleProp, type ViewStyle } from 'react-native';

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
}

const variantStyles: Record<
  ActionButtonVariant,
  { backgroundColor: string; borderColor: string; textColor: string }
> = {
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
}: ActionButtonProps) {
  const palette = variantStyles[variant];
  const textColor = disabled ? colors.textDisabled : palette.textColor;
  const disabledOpacity = compact ? 0.38 : 0.45;

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.85}
      style={[
        styles.button,
        compact && styles.buttonCompact,
        fullWidth && styles.fullWidth,
        icon ? styles.buttonWithIcon : null,
        {
          backgroundColor: palette.backgroundColor,
          borderColor: palette.borderColor,
          opacity: disabled ? disabledOpacity : 1,
        },
        style,
      ]}
    >
      {icon ? <GameIcon name={icon} size={iconSize} color={textColor} /> : null}
      <Text style={[styles.label, compact && styles.labelCompact, { color: textColor }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: radius.md,
    borderWidth: 1,
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
    minHeight: 40,
  },
  labelCompact: {
    fontSize: 12,
    fontWeight: '700',
  },
});

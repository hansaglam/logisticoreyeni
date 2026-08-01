/**
 * Premium auth provider CTA — Google / Apple hesap bağlama.
 * İki varyant aynı boyut ve layout’ta; görsel ağırlık dengeli.
 */

import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { colors, radius, spacing, typography } from '../../theme';
import { MaterialCommunityIcons, type VectorIconName } from '../../theme/icons';

export type AuthProvider = 'google' | 'apple';
export type AuthProviderButtonVariant = 'primary' | 'secondary';

export interface AuthProviderButtonProps {
  provider: AuthProvider;
  label: string;
  onPress: () => void;
  variant?: AuthProviderButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}

const PROVIDER_ICON: Record<AuthProvider, VectorIconName> = {
  google: 'google',
  apple: 'apple',
};

type VariantPalette = {
  backgroundColor: string;
  borderColor: string;
  borderWidth: number;
  textColor: string;
  iconColor: string;
  iconBadgeBg: string;
  spinnerColor: string;
};

const variantPalettes: Record<AuthProviderButtonVariant, VariantPalette> = {
  primary: {
    backgroundColor: colors.primary,
    borderColor: colors.primaryLight,
    borderWidth: 1,
    textColor: '#FFFFFF',
    iconColor: '#4285F4',
    iconBadgeBg: '#FFFFFF',
    spinnerColor: '#FFFFFF',
  },
  secondary: {
    backgroundColor: colors.surface2,
    borderColor: colors.primaryLight,
    borderWidth: 1.5,
    textColor: colors.textPrimary,
    iconColor: colors.textPrimary,
    iconBadgeBg: 'rgba(255, 255, 255, 0.08)',
    spinnerColor: colors.primaryLight,
  },
};

const disabledPalettes: Record<AuthProviderButtonVariant, VariantPalette> = {
  primary: {
    backgroundColor: '#1A2F4D',
    borderColor: 'rgba(147, 197, 253, 0.28)',
    borderWidth: 1,
    textColor: '#A8C4DE',
    iconColor: '#6B8AAB',
    iconBadgeBg: 'rgba(255, 255, 255, 0.55)',
    spinnerColor: '#A8C4DE',
  },
  secondary: {
    backgroundColor: colors.surface,
    borderColor: 'rgba(57, 160, 255, 0.22)',
    borderWidth: 1.5,
    textColor: colors.textMuted,
    iconColor: colors.textMuted,
    iconBadgeBg: 'rgba(255, 255, 255, 0.04)',
    spinnerColor: colors.textMuted,
  },
};

export default function AuthProviderButton({
  provider,
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  style,
}: AuthProviderButtonProps) {
  const isDisabled = disabled || loading;
  const palette = isDisabled ? disabledPalettes[variant] : variantPalettes[variant];
  const iconName = PROVIDER_ICON[provider];

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: palette.backgroundColor,
          borderColor: palette.borderColor,
          borderWidth: palette.borderWidth,
          opacity: pressed && !isDisabled ? 0.92 : 1,
        },
        style,
      ]}
    >
      <View style={styles.iconSlot}>
        <View style={[styles.iconBadge, { backgroundColor: palette.iconBadgeBg }]}>
          {loading ? (
            <ActivityIndicator size="small" color={palette.spinnerColor} />
          ) : (
            <MaterialCommunityIcons name={iconName} size={18} color={palette.iconColor} />
          )}
        </View>
      </View>

      <Text
        style={[styles.label, { color: palette.textColor }]}
        numberOfLines={1}
        ellipsizeMode="tail"
      >
        {label}
      </Text>

      {/* Optik merkez: sağ tarafta ikon slotu kadar boşluk */}
      <View style={styles.iconSlot} pointerEvents="none" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignSelf: 'stretch',
    minHeight: 58,
    borderRadius: radius.button,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  iconSlot: {
    width: 36,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  iconBadge: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    ...typography.buttonText,
    flex: 1,
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.15,
  },
});

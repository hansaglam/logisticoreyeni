import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, shadows, spacing } from '../../theme';

export type AppCardVariant = 'default' | 'soft' | 'selected' | 'highlighted' | 'success' | 'danger';

interface AppCardProps {
  children: React.ReactNode;
  variant?: AppCardVariant;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
}

const variantStyles: Record<AppCardVariant, ViewStyle> = {
  default: {
    backgroundColor: colors.card,
    borderColor: colors.border,
  },
  soft: {
    backgroundColor: colors.cardSoft,
    borderColor: colors.border,
  },
  selected: {
    backgroundColor: colors.accentBlueSoft,
    borderColor: colors.accentBlue,
  },
  highlighted: {
    backgroundColor: colors.accentAmberSoft,
    borderColor: colors.accentAmber,
  },
  success: {
    backgroundColor: colors.successSoft,
    borderColor: colors.success,
  },
  danger: {
    backgroundColor: colors.dangerSoft,
    borderColor: colors.danger,
  },
};

export default function AppCard({
  children,
  variant = 'default',
  style,
  padded = true,
}: AppCardProps) {
  return (
    <View style={[styles.card, variantStyles[variant], padded && styles.padded, shadows.soft, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.card,
    borderWidth: 1,
    overflow: 'hidden',
  },
  padded: {
    padding: spacing.lg,
  },
});

import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { colors, spacing } from '../../theme';

interface MarketTutorialHelpButtonProps {
  onPress: () => void;
  disabled?: boolean;
}

export default function MarketTutorialHelpButton({
  onPress,
  disabled = false,
}: MarketTutorialHelpButtonProps) {
  return (
    <Pressable
      style={[styles.button, disabled && styles.buttonDisabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel="Piyasa eğitimi"
      hitSlop={8}
    >
      <Text style={styles.label}>?</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minWidth: 44,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: `${colors.info}44`,
    backgroundColor: `${colors.info}14`,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  label: {
    color: colors.info,
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 24,
  },
});

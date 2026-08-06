import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import AppTutorialHelpButton from '../tutorial/AppTutorialHelpButton';
import { TUTORIAL_HELP_LABELS } from '../../tutorial/app/definitions';

interface MarketTutorialHelpButtonProps {
  onPress: () => void;
  disabled?: boolean;
}

export default function MarketTutorialHelpButton({
  onPress,
  disabled = false,
}: MarketTutorialHelpButtonProps) {
  return (
    <AppTutorialHelpButton
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={TUTORIAL_HELP_LABELS.market}
    />
  );
}

// Keep styles export for any legacy references
const styles = StyleSheet.create({});

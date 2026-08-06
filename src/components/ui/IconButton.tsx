import React from 'react';
import { StyleSheet, TouchableOpacity, type StyleProp, type ViewStyle } from 'react-native';

import { MIN_TOUCH_TARGET } from '../../constants/layout';
import { colors, radius } from '../../theme';
import type { GameIconName } from '../../theme/icons';
import GameIcon from './GameIcon';

interface IconButtonProps {
  icon: GameIconName;
  onPress: () => void;
  size?: number;
  color?: string;
  backgroundColor?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

export default function IconButton({
  icon,
  onPress,
  size = 20,
  color = colors.textSecondary,
  backgroundColor = colors.cardSoft,
  disabled = false,
  style,
  accessibilityLabel,
}: IconButtonProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.button,
        {
          backgroundColor: disabled ? colors.surface2 : backgroundColor,
          borderColor: disabled ? colors.borderStrong : colors.border,
        },
        style,
      ]}
      hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
    >
      <GameIcon name={icon} size={size} color={disabled ? colors.textDisabled : color} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
});

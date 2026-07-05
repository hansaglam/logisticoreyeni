import React from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

import GameIcon from '../ui/GameIcon';
import { colors } from '../../theme';

interface IdleTruckCountBadgeProps {
  count: number;
  opacity?: number;
  prominent?: boolean;
  style?: ViewStyle;
}

export default function IdleTruckCountBadge({
  count,
  opacity = 1,
  prominent = false,
  style,
}: IdleTruckCountBadgeProps) {
  if (count <= 0) return null;

  return (
    <View
      style={[
        styles.badge,
        prominent && styles.badgeProminent,
        { opacity },
        style,
      ]}
      pointerEvents="none"
    >
      <GameIcon name="truck" size={prominent ? 13 : 12} color={colors.accentBlue} />
      <Text style={[styles.text, prominent && styles.textProminent]}>{count}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 999,
    backgroundColor: colors.accentBlueSoft,
    borderWidth: 1,
    borderColor: colors.accentBlue,
  },
  badgeProminent: {
    height: 22,
    paddingHorizontal: 7,
    borderWidth: 1.5,
  },
  text: {
    color: colors.accentBlue,
    fontSize: 10,
    fontWeight: '800',
    lineHeight: 12,
  },
  textProminent: {
    fontSize: 11,
    lineHeight: 13,
  },
});

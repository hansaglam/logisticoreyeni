import React from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

import {
  MAP_ACCENT,
  MAP_ACCENT_BORDER,
  MAP_SURFACE,
  MAP_TITLE_COLOR,
} from './mapTheme';

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
      <Text style={[styles.text, prominent && styles.textProminent]}>+{count}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 20,
    minWidth: 28,
    paddingHorizontal: 7,
    borderRadius: 999,
    backgroundColor: MAP_SURFACE,
    borderWidth: 1,
    borderColor: MAP_ACCENT_BORDER,
  },
  badgeProminent: {
    height: 22,
    minWidth: 30,
    paddingHorizontal: 8,
    borderWidth: 1.2,
  },
  text: {
    color: MAP_TITLE_COLOR,
    fontSize: 10,
    fontWeight: '800',
    lineHeight: 12,
  },
  textProminent: {
    color: MAP_ACCENT,
    fontSize: 11,
    lineHeight: 13,
  },
});

import React from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { GameIcon } from '../ui';
import { colors, spacing } from '../../theme';
import { TRUCK_LOCATION_EDUCATION_MESSAGE } from '../../utils/truckLocationUx';

interface TruckLocationHintRowProps {
  style?: ViewStyle;
}

export default function TruckLocationHintRow({ style }: TruckLocationHintRowProps) {
  return (
    <View style={[styles.root, style]}>
      <GameIcon name="city" size={14} color={colors.accentBlue} />
      <Text style={styles.text} numberOfLines={3}>
        {TRUCK_LOCATION_EDUCATION_MESSAGE}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    paddingVertical: 8,
    paddingHorizontal: spacing.sm,
    borderRadius: 10,
    backgroundColor: 'rgba(56, 189, 248, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.25)',
  },
  text: {
    flex: 1,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
    color: colors.textSecondary,
  },
});

import React from 'react';
import { StyleSheet, View } from 'react-native';

import {
  MAP_BORDER_ACCENT,
  MAP_CARD_RADIUS,
  MAP_SPACING_STATS_TO_MAP,
  MAP_VIEWPORT_BACKGROUND,
} from './mapTheme';

export interface TurkeyNetworkCardProps {
  children: React.ReactNode;
}

export default function TurkeyNetworkCard({ children }: TurkeyNetworkCardProps) {
  return (
    <View style={[styles.card, { marginTop: MAP_SPACING_STATS_TO_MAP }]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: MAP_CARD_RADIUS,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: MAP_BORDER_ACCENT,
    backgroundColor: MAP_VIEWPORT_BACKGROUND,
  },
});

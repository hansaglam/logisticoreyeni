import React from 'react';
import { Image, StyleSheet, type ImageStyle, type StyleProp } from 'react-native';

import { dashboardAssetFlags, dashboardAssets } from '../../assets/dashboardAssets';
import { DASHBOARD_CARD_GRID_OPACITY } from './dashboardTheme';

interface DashboardCardGridOverlayProps {
  style?: StyleProp<ImageStyle>;
}

/** Kart içi hafif grid dokusu — hero ve büyük CTA kartlarında kullanılır. */
export default function DashboardCardGridOverlay({ style }: DashboardCardGridOverlayProps) {
  if (!dashboardAssetFlags.useGridOverlay) {
    return null;
  }

  return (
    <Image
      source={dashboardAssets.gridOverlay}
      style={[styles.gridOverlay, style]}
      resizeMode="cover"
    />
  );
}

const styles = StyleSheet.create({
  gridOverlay: {
    ...StyleSheet.absoluteFillObject,
    opacity: DASHBOARD_CARD_GRID_OPACITY,
    backgroundColor: 'transparent',
  },
});

import React from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { dashboardAssetFlags, dashboardAssets } from '../../assets/dashboardAssets';
import { colors } from '../../theme';
import { DASHBOARD_BG_GRID_OPACITY, DASHBOARD_BG_SCRIM_OPACITY } from './dashboardTheme';

/**
 * Tam ekran dashboard arka planı.
 *
 * Katman sırası (alttan üste):
 * 1. düz lacivert zemin
 * 2. çok hafif grid (dekoratif)
 * 3. hafif scrim (okunabilirlik)
 * 4. alt vignette (derinlik)
 *
 * Port görseli yalnızca hero kartında, düşük opaklıkla kullanılır.
 */
export default function DashboardBackground() {
  return (
    <View style={styles.container} pointerEvents="none">
      <View style={styles.navyBase} />
      {dashboardAssetFlags.useGridOverlay ? (
        <Image
          source={dashboardAssets.gridOverlay}
          style={styles.gridImage}
          resizeMode="cover"
        />
      ) : null}
      <View style={styles.scrim} />
      <View style={styles.bottomVignette} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.background,
  },
  navyBase: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.background,
  },
  gridImage: {
    ...StyleSheet.absoluteFillObject,
    opacity: DASHBOARD_BG_GRID_OPACITY,
    backgroundColor: 'transparent',
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: `rgba(4, 10, 20, ${DASHBOARD_BG_SCRIM_OPACITY})`,
  },
  bottomVignette: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '34%',
    backgroundColor: 'rgba(2, 6, 14, 0.22)',
  },
});

import React from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { dashboardAssetFlags, dashboardAssets } from '../../assets/dashboardAssets';
import { colors } from '../../theme';
import {
  DASHBOARD_BG_BOTTOM_FADE_OPACITY,
  DASHBOARD_BG_LOWER_VIGNETTE_OPACITY,
  DASHBOARD_BG_PORT_OPACITY,
  DASHBOARD_BG_SCRIM_OPACITY,
} from './dashboardTheme';

/**
 * Tam ekran dashboard arka planı.
 *
 * Katman sırası (alttan üste):
 * 1. düz lacivert zemin
 * 2. port görseli — düşük opaklık, cover
 * 3. lacivert scrim (okunabilirlik)
 * 4. alt yarı vignette (kart alanı sakinleşir)
 * 5. alt fade (derinlik)
 */
export default function DashboardBackground() {
  return (
    <View style={styles.container} pointerEvents="none">
      <View style={styles.navyBase} />
      {dashboardAssetFlags.usePortBackground ? (
        <Image
          source={dashboardAssets.portBackground}
          style={styles.portImage}
          resizeMode="cover"
          accessibilityIgnoresInvertColors
        />
      ) : null}
      <View style={styles.scrim} />
      <View style={styles.lowerVignette} />
      <View style={styles.bottomFade} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.background,
    overflow: 'hidden',
  },
  navyBase: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.background,
  },
  portImage: {
    ...StyleSheet.absoluteFillObject,
    opacity: DASHBOARD_BG_PORT_OPACITY,
    backgroundColor: 'transparent',
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: `rgba(4, 10, 20, ${DASHBOARD_BG_SCRIM_OPACITY})`,
  },
  lowerVignette: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '50%',
    backgroundColor: `rgba(2, 6, 14, ${DASHBOARD_BG_LOWER_VIGNETTE_OPACITY})`,
  },
  bottomFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '24%',
    backgroundColor: `rgba(2, 6, 14, ${DASHBOARD_BG_BOTTOM_FADE_OPACITY})`,
  },
});

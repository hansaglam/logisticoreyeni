import React from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { dashboardAssetFlags, dashboardAssets } from '../../assets/dashboardAssets';
import { colors } from '../../theme';

/** Tam ekran dashboard arka planı — port görseli yalnızca hero kartında kullanılır. */
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
      <View style={styles.navyOverlay} />
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
    opacity: 0.04,
    backgroundColor: 'transparent',
  },
  navyOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(5, 11, 20, 0.68)',
  },
});

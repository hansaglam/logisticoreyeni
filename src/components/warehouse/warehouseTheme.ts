import { StyleSheet, type ViewStyle } from 'react-native';

import { colors } from '../../theme';

/** Depolar ekranı — referans dashboard görsel dili (yalnız UI) */
export const warehouseVisual = {
  surface: '#0A1528',
  surfaceElevated: '#0E1C34',
  border: 'rgba(35, 136, 255, 0.28)',
  borderStrong: 'rgba(35, 136, 255, 0.45)',
  accentGreen: colors.success,
  accentBlue: colors.accentBlue,
  accentAmber: colors.accentAmber,
  accentRed: colors.danger,
  accentPurple: colors.purple,
  softGreen: colors.successSoft,
  softBlue: colors.accentBlueSoft,
  softAmber: colors.accentAmberSoft,
  softRed: colors.dangerSoft,
  softPurple: colors.purpleSoft,
} as const;

export function accentSurface(accent: string): ViewStyle {
  return {
    backgroundColor: warehouseVisual.surfaceElevated,
    borderColor: accent,
    borderWidth: 1,
  };
}

export const warehouseCardStyles = StyleSheet.create({
  panel: {
    backgroundColor: warehouseVisual.surfaceElevated,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: warehouseVisual.border,
  },
  panelGlowBlue: {
    backgroundColor: warehouseVisual.surfaceElevated,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: warehouseVisual.borderStrong,
  },
});

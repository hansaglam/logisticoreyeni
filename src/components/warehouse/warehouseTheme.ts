import { StyleSheet, type ViewStyle } from 'react-native';

import { colors } from '../../theme';

/** Depolar ekranı — referans dashboard görsel dili (yalnız UI) */
export const warehouseVisual = {
  surface: '#0A1528',
  surfaceElevated: '#0E1C34',
  border: 'rgba(35, 136, 255, 0.22)',
  borderStrong: 'rgba(35, 136, 255, 0.35)',
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
  statTint: 'rgba(4, 10, 20, 0.42)',
} as const;

export const warehouseLayout = {
  pagePadding: 16,
  sectionGap: 16,
  cardPadding: 14,
  cardGap: 10,
  internalGap: 8,
  smallGap: 4,
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
    borderRadius: 14,
    borderWidth: 1,
    borderColor: warehouseVisual.border,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.textPrimary,
    letterSpacing: 0.1,
  },
  sectionMeta: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
  },
});

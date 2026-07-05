import { Platform, StatusBar } from 'react-native';

import { BASE_TAB_HEIGHT, EXTRA_BOTTOM_SPACE } from '../constants/layout';
import { colors, spacing, typography } from './index';

/**
 * Geriye dönük uyumluluk katmanı — mevcut ekranlar UI.colors kullanmaya devam edebilir.
 * Yeni kod doğrudan src/theme/index import etmeli.
 */
export const UI = {
  colors: {
    background: colors.background,
    card: colors.card,
    cardAlt: colors.cardSoft,
    border: colors.borderStrong,
    primary: colors.accentAmber,
    secondary: colors.info,
    success: colors.success,
    danger: colors.danger,
    text: colors.textPrimary,
    textSecondary: colors.textSecondary,
    textMuted: colors.textMuted,
    tabBarBg: colors.tabBarBg,
    tabBarBorder: colors.tabBarBorder,
  },
  spacing: {
    screen: spacing.lg,
    section: spacing.md,
    tabBarHeight: BASE_TAB_HEIGHT,
    screenBottomPad: BASE_TAB_HEIGHT + EXTRA_BOTTOM_SPACE,
  },
  typography: {
    title: typography.screenTitle.fontSize ?? 26,
    subtitle: typography.screenSubtitle.fontSize ?? 13,
    section: typography.sectionTitle.fontSize ?? 15,
  },
} as const;

export const STATUS_BAR_HEIGHT =
  Platform.OS === 'android' ? StatusBar.currentHeight ?? 24 : 0;

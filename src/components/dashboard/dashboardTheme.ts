import { Platform, StyleSheet, type ViewStyle } from 'react-native';

import { colors, radius, spacing } from '../../theme';

/** Negatif nakit kırmızı, sıfır/pozitif yeşil */
export function getDashboardMoneyColor(money: number): string {
  return money < 0 ? colors.danger : colors.success;
}

/** Dashboard arka plan katman opaklıkları */
export const DASHBOARD_BG_PORT_OPACITY = 0.14;
export const DASHBOARD_BG_SCRIM_OPACITY = 0.56;
export const DASHBOARD_BG_LOWER_VIGNETTE_OPACITY = 0.28;
export const DASHBOARD_BG_BOTTOM_FADE_OPACITY = 0.38;
export const DASHBOARD_HORIZONTAL_PADDING = 16;
export const DASHBOARD_SECTION_GAP = 11;
export const DASHBOARD_SECTION_GAP_TIGHT = 8;
export const DASHBOARD_SECTION_GAP_LARGE = 16;
export const DASHBOARD_NARROW_WIDTH = 370;
export const DASHBOARD_SPLIT_MIN_WIDTH = 390;

/** Yan yana olay / ödül kartları */
export const DASHBOARD_SPLIT_CARD_GAP = 10;
export const DASHBOARD_SPLIT_CARD_HEIGHT = 150;

/** Modül grid — üç eşit hızlı erişim kartı */
export const DASHBOARD_MODULE_CARD_HEIGHT = 92;
export const DASHBOARD_MODULE_GAP = spacing.sm;
export const DASHBOARD_MODULE_CARD_BG = '#081426';

/** Üst bölüm — resource bar / hero / alert */
export const DASHBOARD_RESOURCE_BAR_HEIGHT = 48;
export const DASHBOARD_RESOURCE_BAR_RADIUS = 15;
export const DASHBOARD_HERO_RADIUS = 19;
export const DASHBOARD_HERO_PADDING = 13;
export const DASHBOARD_ALERT_HEIGHT = 44;
export const DASHBOARD_ALERT_RADIUS = 13;
export const DASHBOARD_TOP_BAR_BG = '#081426';
export const DASHBOARD_TOP_BAR_BORDER = '#17385D';
export const DASHBOARD_HERO_BORDER = '#1A3B63';

/** Shared dashboard card surface */
export const dashboardCardStyle: ViewStyle = {
  backgroundColor: colors.surface,
  borderRadius: radius.cardLarge,
  borderWidth: 1,
  borderColor: colors.border,
  overflow: 'hidden',
};

export const dashboardCardElevation: ViewStyle = Platform.select({
  android: {
    elevation: 3,
  },
  ios: {
    shadowColor: '#000000',
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: {
      width: 0,
      height: 5,
    },
  },
  default: {},
}) as ViewStyle;

/** Hero kart — hafif derinlik */
export const dashboardHeroElevation: ViewStyle = Platform.select({
  android: {
    elevation: 2,
  },
  ios: {
    shadowColor: '#000000',
    shadowOpacity: 0.14,
    shadowRadius: 6,
    shadowOffset: {
      width: 0,
      height: 3,
    },
  },
  default: {},
}) as ViewStyle;

export const dashboardSectionSpacing: ViewStyle = {
  marginBottom: DASHBOARD_SECTION_GAP,
};

export const dashboardSplitLayout: ViewStyle = {
  flexDirection: 'row',
  gap: DASHBOARD_SECTION_GAP,
};

export const dashboardSectionGap = DASHBOARD_SECTION_GAP;

export const dashboardStyles = StyleSheet.create({
  cardPadded: {
    ...dashboardCardStyle,
    padding: 14,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
    letterSpacing: 0.15,
    flexShrink: 1,
    minWidth: 0,
  },
  sectionDivider: {
    height: 1,
    backgroundColor: colors.divider,
    marginVertical: 8,
  },
  sectionFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    minHeight: 34,
    paddingTop: 4,
  },
  sectionFooterText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.15,
  },
  countBadge: {
    height: 27,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.15,
  },
  splitRow: {
    flexDirection: 'row',
    gap: DASHBOARD_SECTION_GAP,
    alignItems: 'stretch',
  },
  splitCardsRow: {
    flexDirection: 'row',
    gap: DASHBOARD_SPLIT_CARD_GAP,
    alignItems: 'stretch',
  },
  splitColumn: {
    flexDirection: 'column',
    gap: DASHBOARD_SECTION_GAP,
  },
  splitItem: {
    flex: 1,
    minWidth: 0,
  },
  lowerSection: {
    gap: 10,
  },
});

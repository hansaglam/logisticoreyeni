import { Platform } from 'react-native';

export const BASE_TAB_HEIGHT = 68;
export const TAB_BAR_TOP_PADDING = 8;
/** Scroll içeriği ile tab bar arası ekstra boşluk */
export const SCROLL_BOTTOM_EXTRA = 120;
/** @deprecated use SCROLL_BOTTOM_EXTRA */
export const EXTRA_BOTTOM_SPACE = SCROLL_BOTTOM_EXTRA;
export const TAB_ITEM_MIN_HEIGHT = 52;
export const TAB_ACTIVE_MIN_HEIGHT = 54;

export const MIN_ANDROID_BOTTOM_INSET = 48;
export const MIN_IOS_BOTTOM_INSET = 10;

export function getBottomInset(insets: { bottom: number }): number {
  return Platform.OS === 'android'
    ? Math.max(insets.bottom, MIN_ANDROID_BOTTOM_INSET)
    : Math.max(insets.bottom, MIN_IOS_BOTTOM_INSET);
}

export function getTabBarHeight(bottomInset: number): number {
  return BASE_TAB_HEIGHT + bottomInset;
}

/** tabBarHeight + safeAreaBottom + ekstra — tüm scroll ekranları için standart */
export function getScrollBottomPadding(tabBarHeight: number, bottomInset = 0): number {
  return tabBarHeight + bottomInset + SCROLL_BOTTOM_EXTRA;
}

/** Tab bar yüksekliği bilinmiyorsa geçici fallback */
export const FALLBACK_SCROLL_BOTTOM_PADDING = 190;

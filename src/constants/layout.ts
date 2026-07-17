import { Platform } from 'react-native';

/** Oyun tarzı tab bar gövde yüksekliği (safe area hariç) */
export const GAME_TAB_BAR_HEIGHT = 80;
/** @deprecated use GAME_TAB_BAR_HEIGHT */
export const BASE_TAB_HEIGHT = GAME_TAB_BAR_HEIGHT;
export const TAB_BAR_TOP_PADDING = 8;
export const GAME_CENTER_BUTTON_SIZE = 64;
export const GAME_CENTER_BUTTON_LIFT = 12;
/** Scroll içeriği ile tab bar arası ekstra boşluk */
export const SCROLL_BOTTOM_EXTRA = 24;
/** @deprecated use SCROLL_BOTTOM_EXTRA */
export const EXTRA_BOTTOM_SPACE = SCROLL_BOTTOM_EXTRA;
export const TAB_ITEM_MIN_HEIGHT = 56;
export const TAB_ACTIVE_MIN_HEIGHT = 58;

/** Android immersive modda sistem nav bar gizli — alt inset kullanılmaz */
export const MIN_ANDROID_BOTTOM_INSET = 0;
export const MIN_IOS_BOTTOM_INSET = 10;

export function getBottomInset(insets: { bottom: number }): number {
  if (Platform.OS === 'android') {
    return MIN_ANDROID_BOTTOM_INSET;
  }
  return Math.max(insets.bottom, MIN_IOS_BOTTOM_INSET);
}

export function getTabBarHeight(bottomInset: number): number {
  return GAME_TAB_BAR_HEIGHT + bottomInset;
}

/** tabBarHeight + ekstra — tüm scroll ekranları için standart */
export function getScrollBottomPadding(tabBarHeight: number): number {
  return tabBarHeight + SCROLL_BOTTOM_EXTRA;
}

/** Tab bar yüksekliği bilinmiyorsa geçici fallback */
export const FALLBACK_SCROLL_BOTTOM_PADDING = GAME_TAB_BAR_HEIGHT + MIN_ANDROID_BOTTOM_INSET + SCROLL_BOTTOM_EXTRA;

import { Platform } from 'react-native';

export const BASE_TAB_HEIGHT = 68;
export const TAB_BAR_TOP_PADDING = 8;
export const EXTRA_BOTTOM_SPACE = 24;
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

export function getScrollBottomPadding(tabBarHeight: number): number {
  return tabBarHeight + EXTRA_BOTTOM_SPACE;
}

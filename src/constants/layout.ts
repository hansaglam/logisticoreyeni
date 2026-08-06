import { Platform } from 'react-native';

/** İkon + label + chrome (safe area hariç) */
export const VISUAL_TAB_BAR_HEIGHT = 72;
/** @deprecated use VISUAL_TAB_BAR_HEIGHT */
export const GAME_TAB_BAR_HEIGHT = VISUAL_TAB_BAR_HEIGHT;
/** @deprecated use VISUAL_TAB_BAR_HEIGHT */
export const BASE_TAB_HEIGHT = VISUAL_TAB_BAR_HEIGHT;

export const TAB_BAR_TOP_PADDING = 8;
export const TAB_BAR_CHROME_BOTTOM = 6;
export const GAME_CENTER_BUTTON_SIZE = 58;
export const GAME_CENTER_BUTTON_LIFT = 12;
export const TAB_BAR_BOTTOM = 0;

/** Scroll içeriği ile tab bar arası görsel nefes payı (12–20) */
export const SCREEN_CONTENT_GAP = 16;
/** @deprecated use SCREEN_CONTENT_GAP */
export const SCROLL_BOTTOM_EXTRA = SCREEN_CONTENT_GAP;
/** @deprecated use SCREEN_CONTENT_GAP */
export const EXTRA_BOTTOM_SPACE = SCREEN_CONTENT_GAP;

export const TAB_ITEM_MIN_HEIGHT = 56;
export const TAB_ACTIVE_MIN_HEIGHT = 58;
export const MIN_TOUCH_TARGET = 44;
export const MODAL_SHEET_EXTRA = 16;

/** Android immersive modda sistem nav bar gizli — alt inset kullanılmaz */
export const MIN_ANDROID_BOTTOM_INSET = 0;
/** Safe-area context yokken iOS fallback; canlı inset yerine geçmez */
export const MIN_IOS_BOTTOM_INSET = 10;

/** Platform-aware home-indicator / nav inset. Android always 0. */
export function getSafeBottom(insets: { bottom: number }): number {
  if (Platform.OS === 'android') {
    return MIN_ANDROID_BOTTOM_INSET;
  }
  return Math.max(0, insets.bottom);
}

/** @deprecated use getSafeBottom */
export function getBottomInset(insets: { bottom: number }): number {
  return getSafeBottom(insets);
}

export function getTotalBarHeight(safeBottom: number): number {
  return VISUAL_TAB_BAR_HEIGHT + safeBottom;
}

/** @deprecated use getTotalBarHeight */
export function getTabBarHeight(bottomInset: number): number {
  return getTotalBarHeight(bottomInset);
}

export function getContentBottomPadding(safeBottom: number): number {
  return getTotalBarHeight(safeBottom) + SCREEN_CONTENT_GAP;
}

/** tabBarHeight (total) + gap — tüm scroll ekranları için standart */
export function getScrollBottomPadding(tabBarHeight: number): number {
  return tabBarHeight + SCREEN_CONTENT_GAP;
}

/** Tab bar yüksekliği bilinmiyorsa geçici fallback */
export const FALLBACK_SCROLL_BOTTOM_PADDING =
  VISUAL_TAB_BAR_HEIGHT + MIN_ANDROID_BOTTOM_INSET + SCREEN_CONTENT_GAP;

export function getModalSheetPaddingBottom(
  insets: { bottom: number },
  extra: number = MODAL_SHEET_EXTRA,
): number {
  return getSafeBottom(insets) + extra;
}

export function getSafeModalMaxHeight(
  windowHeight: number,
  insets: { top: number; bottom: number },
  ratio = 0.88,
): number {
  const topPad = Platform.OS === 'ios' ? Math.max(insets.top, 12) : 12;
  const bottomPad = getSafeBottom(insets);
  const available = windowHeight - topPad - bottomPad - 24;
  return Math.max(280, Math.min(windowHeight * ratio, available));
}

import { Platform } from 'react-native';

/** Tab bar üst padding (gövde içinde) */
export const TAB_BAR_PADDING_TOP = 8;
/** @deprecated use TAB_BAR_PADDING_TOP */
export const TAB_BAR_TOP_PADDING = TAB_BAR_PADDING_TOP;
/** Home indicator yoksa minimum alt nefes payı */
export const TAB_BAR_PADDING_BOTTOM_MIN = 6;
/** @deprecated use TAB_BAR_PADDING_BOTTOM_MIN */
export const TAB_BAR_CHROME_BOTTOM = TAB_BAR_PADDING_BOTTOM_MIN;
/** İkon + etiket satırı yüksekliği (üst padding hariç) */
export const TAB_BAR_ROW_HEIGHT = 58;

/**
 * İkon + label + chrome (safe area hariç).
 * = üst padding + satır + minimum alt padding (8+58+6).
 */
export const VISUAL_TAB_BAR_HEIGHT =
  TAB_BAR_PADDING_TOP + TAB_BAR_ROW_HEIGHT + TAB_BAR_PADDING_BOTTOM_MIN;
/** @deprecated use VISUAL_TAB_BAR_HEIGHT */
export const GAME_TAB_BAR_HEIGHT = VISUAL_TAB_BAR_HEIGHT;
/** @deprecated use VISUAL_TAB_BAR_HEIGHT */
export const BASE_TAB_HEIGHT = VISUAL_TAB_BAR_HEIGHT;

export const GAME_CENTER_BUTTON_SIZE = 58;
export const GAME_CENTER_BUTTON_RING_SIZE = 61;
/** Merkez FAB'ın tab satırına göre yukarı kalkışı */
export const GAME_CENTER_BUTTON_LIFT = 9;
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

/** Sayfa yatay padding — AppScreen / metrik strip ile aynı token */
export const PAGE_HORIZONTAL_PADDING = 16;
/** Kart / chip satırları arası boşluk */
export const CARD_GAP = 12;
/** Yönetim paneli ile üst safe-area arası minimum nefes */
export const MANAGEMENT_PANEL_TOP_CLEARANCE = 8;

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

/** Tab bar içindeki gerçek alt padding (safe area veya minimum). */
export function getTabBarBottomPadding(bottomInset: number): number {
  return Math.max(bottomInset, TAB_BAR_PADDING_BOTTOM_MIN);
}

export function getTotalBarHeight(safeBottom: number): number {
  return VISUAL_TAB_BAR_HEIGHT + safeBottom;
}

/**
 * Toplam tab bar yüksekliği (safe area dahil).
 * @deprecated prefer getTotalBarHeight(getSafeBottom(insets))
 */
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

/**
 * Yönetim paneli kullanılabilir yüksekliği:
 * viewport oranı + tab bar üstü offset + üst safe clearance.
 */
export function getManagementPanelAvailableHeight(params: {
  windowHeight: number;
  topInset: number;
  bottomOffset: number;
  maxHeightRatio: number;
}): number {
  const topClearance =
    Math.max(params.topInset, 12) + MANAGEMENT_PANEL_TOP_CLEARANCE;
  const ratioCap = params.windowHeight * params.maxHeightRatio;
  const insetCap = params.windowHeight - params.bottomOffset - topClearance;
  return Math.max(200, Math.min(ratioCap, insetCap));
}

/**
 * Yatay metrik chip genişliği — ~2.2 kart görünür, taşma yok.
 */
export function getMetricChipWidth(windowWidth: number): number {
  const available =
    windowWidth - PAGE_HORIZONTAL_PADDING * 2 - CARD_GAP;
  return Math.max(112, Math.min(148, Math.floor(available / 2.2)));
}

import { useAppSafeAreaInsets } from '../components/AppSafeAreaProvider';
import {
  TAB_BAR_BOTTOM,
  VISUAL_TAB_BAR_HEIGHT,
  getContentBottomPadding,
  getSafeBottom,
  getTotalBarHeight,
} from '../constants/layout';
import { getScreenTopPadding } from '../utils/screenInsets';

export function useTabBarLayout() {
  const insets = useAppSafeAreaInsets();
  const safeBottom = getSafeBottom(insets);
  const visualBarHeight = VISUAL_TAB_BAR_HEIGHT;
  const totalBarHeight = getTotalBarHeight(safeBottom);
  const contentBottomPadding = getContentBottomPadding(safeBottom);
  const tabBarBottom = TAB_BAR_BOTTOM;
  const screenTopPadding = getScreenTopPadding(insets);

  return {
    safeBottom,
    visualBarHeight,
    totalBarHeight,
    contentBottomPadding,
    tabBarBottom,
    screenTopPadding,
    insets,
    /** @deprecated use safeBottom */
    bottomInset: safeBottom,
    /** @deprecated use totalBarHeight */
    tabBarHeight: totalBarHeight,
    /** @deprecated use contentBottomPadding */
    scrollBottomPadding: contentBottomPadding,
  };
}

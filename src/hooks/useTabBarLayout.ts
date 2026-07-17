import { useAppSafeAreaInsets } from '../components/AppSafeAreaProvider';
import {
  getBottomInset,
  getScrollBottomPadding,
  getTabBarHeight,
} from '../constants/layout';
import { getScreenTopPadding } from '../utils/screenInsets';

export function useTabBarLayout() {
  const insets = useAppSafeAreaInsets();
  const bottomInset = getBottomInset(insets);
  const tabBarHeight = getTabBarHeight(bottomInset);
  const scrollBottomPadding = getScrollBottomPadding(tabBarHeight);
  const screenTopPadding = getScreenTopPadding(insets);

  return {
    bottomInset,
    tabBarHeight,
    scrollBottomPadding,
    screenTopPadding,
    insets,
  };
}

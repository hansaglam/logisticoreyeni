import { useAppSafeAreaInsets } from '../components/AppSafeAreaProvider';
import {
  getBottomInset,
  getScrollBottomPadding,
  getTabBarHeight,
} from '../constants/layout';

export function useTabBarLayout() {
  const insets = useAppSafeAreaInsets();
  const bottomInset = getBottomInset(insets);
  const tabBarHeight = getTabBarHeight(bottomInset);
  const scrollBottomPadding = getScrollBottomPadding(tabBarHeight);

  return {
    bottomInset,
    tabBarHeight,
    scrollBottomPadding,
  };
}

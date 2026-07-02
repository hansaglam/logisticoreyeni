import { Platform, UIManager } from 'react-native';

import {
  MIN_ANDROID_BOTTOM_INSET,
  MIN_IOS_BOTTOM_INSET,
} from '../constants/layout';

export interface EdgeInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export function isSafeAreaContextAvailable(): boolean {
  return UIManager.getViewManagerConfig?.('RNCSafeAreaProvider') != null;
}

export function getFallbackInsets(): EdgeInsets {
  return {
    top: 0,
    bottom: Platform.OS === 'android' ? MIN_ANDROID_BOTTOM_INSET : MIN_IOS_BOTTOM_INSET,
    left: 0,
    right: 0,
  };
}

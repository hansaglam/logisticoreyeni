import { Platform } from 'react-native';

/** Android immersive modda status bar gizli — sabit kompakt üst boşluk */
export const ANDROID_SCREEN_TOP_PADDING = 18;
/** iOS notch üstüne ek nefes payı */
export const IOS_SCREEN_TOP_EXTRA = 8;

export function getScreenTopPadding(insets: { top: number }): number {
  if (Platform.OS === 'android') {
    return ANDROID_SCREEN_TOP_PADDING;
  }
  return Math.max(insets.top, 12) + IOS_SCREEN_TOP_EXTRA;
}

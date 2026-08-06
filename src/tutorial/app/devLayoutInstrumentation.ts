declare const __DEV__: boolean | undefined;

export function logLayoutDimensions(payload: {
  screen: string;
  targetId: string;
  windowWidth?: number;
  parentWidth?: number;
  wrapperWidth?: number;
  childWidth?: number;
  layoutMode?: string;
  wrapperAlignSelf?: string;
}): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    return;
  }
  if (process.env.EXPO_PUBLIC_DEBUG_TUTORIAL_LAYOUT !== '1') {
    return;
  }
  console.info('[layout-regression]', payload);
}

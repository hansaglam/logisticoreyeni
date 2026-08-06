import React, { useCallback, useEffect, useRef } from 'react';
import {
  Dimensions,
  InteractionManager,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type ViewProps,
} from 'react-native';

import type { TutorialLayoutRect } from '../../tutorial/types';
import { logLayoutDimensions } from '../../tutorial/app/devLayoutInstrumentation';
import {
  getTargetLayoutStyle,
  type TutorialTargetLayoutMode,
} from '../../tutorial/app/targetLayout';
import {
  registerMarketTutorialTarget,
  type MarketTutorialTargetId,
} from './marketTutorialTargetRegistry';

export interface MarketTutorialTargetProps extends ViewProps {
  id: MarketTutorialTargetId;
  layoutMode?: TutorialTargetLayoutMode;
  scrollIntoView?: () => void | Promise<void>;
  debugScreen?: string;
}

export function MarketTutorialTarget({
  id,
  layoutMode = 'preserve',
  scrollIntoView,
  debugScreen,
  children,
  style,
  onLayout,
  ...rest
}: MarketTutorialTargetProps) {
  const viewRef = useRef<View>(null);
  const scrollIntoViewRef = useRef(scrollIntoView);
  scrollIntoViewRef.current = scrollIntoView;
  const layoutModeStyle = getTargetLayoutStyle(layoutMode);

  useEffect(() => {
    const measure = () =>
      new Promise<TutorialLayoutRect | null>((resolve) => {
        const runMeasure = () => {
          const node = viewRef.current;
          if (!node) {
            resolve(null);
            return;
          }
          node.measureInWindow((x, y, width, height) => {
            if (
              !Number.isFinite(width) ||
              !Number.isFinite(height) ||
              width <= 0 ||
              height <= 0
            ) {
              resolve(null);
              return;
            }
            resolve({ x, y, width, height });
          });
        };

        InteractionManager.runAfterInteractions(() => {
          requestAnimationFrame(runMeasure);
        });
      });

    return registerMarketTutorialTarget(id, {
      measure,
      scrollIntoView: async () => {
        await scrollIntoViewRef.current?.();
      },
    });
  }, [id]);

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      if (debugScreen) {
        const { width } = event.nativeEvent.layout;
        logLayoutDimensions({
          screen: debugScreen,
          targetId: id,
          windowWidth: Dimensions.get('window').width,
          wrapperWidth: width,
          layoutMode,
          wrapperAlignSelf:
            layoutMode === 'stretch'
              ? 'stretch'
              : layoutMode === 'content'
                ? 'flex-start'
                : 'inherit',
        });
      }
      onLayout?.(event);
    },
    [debugScreen, id, layoutMode, onLayout],
  );

  return (
    <View
      ref={viewRef}
      collapsable={false}
      style={[styles.base, layoutModeStyle, style]}
      onLayout={handleLayout}
      {...rest}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    minWidth: 0,
  },
});

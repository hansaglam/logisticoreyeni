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
import { APP_TUTORIALS_ENABLED } from '../../tutorial/app/featureFlags';
import {
  getTargetLayoutStyle,
  type TutorialTargetLayoutMode,
} from '../../tutorial/app/targetLayout';
import type { AppTutorialId } from '../../tutorial/app/types';
import { registerAppTutorialTarget } from '../../tutorial/app/targetRegistry';

export interface AppTutorialTargetProps extends ViewProps {
  tutorialId: AppTutorialId;
  targetId: string;
  layoutMode?: TutorialTargetLayoutMode;
  scrollIntoView?: () => void | Promise<void>;
  /** Dev-only screen label for layout logging */
  debugScreen?: string;
}

export function AppTutorialTarget({
  tutorialId,
  targetId,
  layoutMode = 'preserve',
  scrollIntoView,
  debugScreen,
  children,
  style,
  onLayout,
  ...rest
}: AppTutorialTargetProps) {
  const viewRef = useRef<View>(null);
  const scrollIntoViewRef = useRef(scrollIntoView);
  scrollIntoViewRef.current = scrollIntoView;
  const layoutModeStyle = getTargetLayoutStyle(layoutMode);

  useEffect(() => {
    if (!APP_TUTORIALS_ENABLED) {
      return;
    }

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

    return registerAppTutorialTarget(tutorialId, targetId, {
      measure,
      scrollIntoView: async () => {
        await scrollIntoViewRef.current?.();
      },
    });
  }, [targetId, tutorialId]);

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      if (debugScreen) {
        const { width } = event.nativeEvent.layout;
        logLayoutDimensions({
          screen: debugScreen,
          targetId,
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
    [debugScreen, layoutMode, onLayout, targetId],
  );

  return (
    <View
      ref={APP_TUTORIALS_ENABLED ? viewRef : undefined}
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

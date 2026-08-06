import React, { useEffect, useRef } from 'react';
import { InteractionManager, View, type ViewProps } from 'react-native';

import type { TutorialLayoutRect } from '../../tutorial/types';
import type { AppTutorialId } from '../../tutorial/app/types';
import { registerAppTutorialTarget } from '../../tutorial/app/targetRegistry';

export interface AppTutorialTargetProps extends ViewProps {
  tutorialId: AppTutorialId;
  targetId: string;
  scrollIntoView?: () => void | Promise<void>;
}

export function AppTutorialTarget({
  tutorialId,
  targetId,
  scrollIntoView,
  children,
  style,
  ...rest
}: AppTutorialTargetProps) {
  const viewRef = useRef<View>(null);

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

    return registerAppTutorialTarget(tutorialId, targetId, {
      measure,
      scrollIntoView: scrollIntoView
        ? async () => {
            await scrollIntoView();
          }
        : undefined,
    });
  }, [scrollIntoView, targetId, tutorialId]);

  return (
    <View ref={viewRef} collapsable={false} style={style} {...rest}>
      {children}
    </View>
  );
}

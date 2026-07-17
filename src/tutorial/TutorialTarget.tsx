import React, { useEffect, useRef } from 'react';
import { InteractionManager, View, type ViewProps } from 'react-native';

import { ENABLE_SPOTLIGHT_TUTORIAL } from './featureFlags';
import type { TutorialTargetId } from './types';
import { registerTutorialTarget } from './tutorialTargetRegistry';

export interface TutorialTargetProps extends ViewProps {
  id: TutorialTargetId;
  onTutorialPress?: () => void | Promise<void>;
  scrollIntoView?: () => void | Promise<void>;
}

/** Spotlight kapalıyken sadece children render eder — layout style korunur. */
export function TutorialTarget({
  id,
  onTutorialPress,
  scrollIntoView,
  children,
  style,
  ...rest
}: TutorialTargetProps) {
  if (!ENABLE_SPOTLIGHT_TUTORIAL) {
    if (style) {
      return (
        <View style={style} {...rest}>
          {children}
        </View>
      );
    }
    return <>{children}</>;
  }

  return (
    <TutorialTargetMeasured
      id={id}
      onTutorialPress={onTutorialPress}
      scrollIntoView={scrollIntoView}
      style={style}
      {...rest}
    >
      {children}
    </TutorialTargetMeasured>
  );
}

function TutorialTargetMeasured({
  id,
  onTutorialPress,
  scrollIntoView,
  children,
  style,
  ...rest
}: TutorialTargetProps) {
  const viewRef = useRef<View>(null);

  useEffect(() => {
    const measure = () =>
      new Promise<import('./types').TutorialLayoutRect | null>((resolve) => {
        const runMeasure = () => {
          const node = viewRef.current;
          if (!node) {
            resolve(null);
            return;
          }
          node.measureInWindow((x, y, width, height) => {
            if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
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

    return registerTutorialTarget(id, {
      measure,
      onPress: onTutorialPress,
      scrollIntoView,
    });
  }, [id, onTutorialPress, scrollIntoView]);

  return (
    <View ref={viewRef} collapsable={false} style={style} {...rest}>
      {children}
    </View>
  );
}

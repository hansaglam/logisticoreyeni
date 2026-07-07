import React, { useEffect, useRef } from 'react';
import { View, type ViewProps } from 'react-native';

import type { TutorialTargetId } from './types';
import { registerTutorialTarget } from './tutorialTargetRegistry';

export interface TutorialTargetProps extends ViewProps {
  id: TutorialTargetId;
  onTutorialPress?: () => void | Promise<void>;
  scrollIntoView?: () => void | Promise<void>;
}

export function TutorialTarget({
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

import React, { useEffect, useRef } from 'react';
import { InteractionManager, StyleSheet, View, type ViewProps } from 'react-native';

import type { TutorialLayoutRect } from '../../tutorial/types';
import {
  registerMarketTutorialTarget,
  type MarketTutorialTargetId,
} from './marketTutorialTargetRegistry';

export interface MarketTutorialTargetProps extends ViewProps {
  id: MarketTutorialTargetId;
  scrollIntoView?: () => void | Promise<void>;
}

export function MarketTutorialTarget({
  id,
  scrollIntoView,
  children,
  style,
  ...rest
}: MarketTutorialTargetProps) {
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

    return registerMarketTutorialTarget(id, {
      measure,
      scrollIntoView: scrollIntoView
        ? async () => {
            await scrollIntoView();
          }
        : undefined,
    });
  }, [id, scrollIntoView]);

  return (
    <View ref={viewRef} collapsable={false} style={[styles.target, style]} {...rest}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  target: {
    alignSelf: 'flex-start',
  },
});

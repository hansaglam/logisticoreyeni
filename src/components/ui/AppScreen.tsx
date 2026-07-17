import React from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  type ScrollView as ScrollViewType,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useTabBarLayout } from '../../hooks/useTabBarLayout';
import { colors, spacing } from '../../theme';

interface AppScreenProps {
  children: React.ReactNode;
  scroll?: boolean;
  padding?: boolean;
  /** More menüsü alt ekranları — üst safe-area padding'i atlanır */
  embedded?: boolean;
  contentContainerStyle?: StyleProp<ViewStyle>;
  /** Tab bar üstü ekstra boşluk — verilmezse layout hook değeri kullanılır */
  scrollBottomPadding?: number;
  scrollRef?: React.RefObject<ScrollViewType | null>;
}

function resolveBottomPadding(
  scrollBottomPadding: number,
  contentContainerStyle?: StyleProp<ViewStyle>,
  override?: number,
): number {
  const flattened = StyleSheet.flatten(contentContainerStyle);
  const stylePadding =
    typeof flattened?.paddingBottom === 'number' ? flattened.paddingBottom : 0;
  const target = override ?? Math.max(scrollBottomPadding, stylePadding);
  return target;
}

export default function AppScreen({
  children,
  scroll = false,
  padding = true,
  embedded = false,
  contentContainerStyle,
  scrollBottomPadding: scrollBottomPaddingOverride,
  scrollRef,
}: AppScreenProps) {
  const { scrollBottomPadding: defaultScrollPadding, screenTopPadding } = useTabBarLayout();
  const bottomPadding = resolveBottomPadding(
    defaultScrollPadding,
    contentContainerStyle,
    scrollBottomPaddingOverride,
  );
  const topPadding = embedded ? 0 : screenTopPadding;

  const paddedStyle = padding
    ? [styles.paddedContent, embedded && styles.paddedContentEmbedded]
    : undefined;

  return (
    <View style={styles.root}>
      <View style={[styles.contentArea, { paddingTop: topPadding }]}>
        {scroll ? (
          <ScrollView
            ref={scrollRef}
            style={styles.scrollView}
            contentContainerStyle={[
              paddedStyle,
              contentContainerStyle,
              { paddingBottom: bottomPadding },
            ]}
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        ) : (
          <View
            style={[
              styles.flex,
              paddedStyle,
              contentContainerStyle,
              { paddingBottom: bottomPadding },
            ]}
          >
            {children}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  contentArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  paddedContent: {
    paddingHorizontal: spacing.lg,
  },
  paddedContentEmbedded: {
    paddingTop: 0,
  },
});

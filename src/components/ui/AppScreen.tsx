import React from 'react';
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  View,
  type ScrollView as ScrollViewType,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useTabBarLayout } from '../../hooks/useTabBarLayout';
import { colors, spacing } from '../../theme';
import { STATUS_BAR_HEIGHT } from '../../theme/ui';

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
  const { scrollBottomPadding: defaultScrollPadding } = useTabBarLayout();
  const bottomPadding = resolveBottomPadding(
    defaultScrollPadding,
    contentContainerStyle,
    scrollBottomPaddingOverride,
  );

  const paddedStyle = padding
    ? [styles.paddedContent, embedded && styles.paddedContentEmbedded]
    : undefined;

  return (
    <View style={[styles.root, embedded && styles.rootEmbedded]}>
      <SafeAreaView style={styles.safeArea}>
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
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
    paddingTop: STATUS_BAR_HEIGHT,
  },
  safeArea: {
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
    paddingTop: spacing.sm,
  },
  paddedContentEmbedded: {
    paddingTop: 0,
  },
  rootEmbedded: {
    paddingTop: 0,
  },
});

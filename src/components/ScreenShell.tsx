import React from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useTabBarLayout } from '../hooks/useTabBarLayout';
import { UI } from '../theme/ui';

interface ScreenShellProps {
  children: React.ReactNode;
  scroll?: boolean;
  loading?: boolean;
  loadingText?: string;
  contentStyle?: StyleProp<ViewStyle>;
}

export default function ScreenShell({
  children,
  scroll = true,
  loading = false,
  loadingText = 'Loading...',
  contentStyle,
}: ScreenShellProps) {
  const { scrollBottomPadding, screenTopPadding } = useTabBarLayout();

  if (loading) {
    return (
      <View style={[styles.root, { paddingTop: screenTopPadding }]}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>{loadingText}</Text>
        </View>
      </View>
    );
  }

  const content = (
    <View style={[styles.content, contentStyle]}>{children}</View>
  );

  return (
    <View style={[styles.root, { paddingTop: screenTopPadding }]}>
      {scroll ? (
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: scrollBottomPadding }]}
          showsVerticalScrollIndicator={false}
        >
          {content}
        </ScrollView>
      ) : (
        <View style={{ flex: 1, paddingBottom: scrollBottomPadding }}>{content}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: UI.colors.background,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: UI.spacing.screen,
  },
  content: {
    flex: 1,
    paddingHorizontal: UI.spacing.screen,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: UI.colors.textSecondary,
    fontSize: 16,
  },
});

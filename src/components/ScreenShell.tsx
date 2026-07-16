import React from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { STATUS_BAR_HEIGHT, UI } from '../theme/ui';
import { useTabBarLayout } from '../hooks/useTabBarLayout';

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
  const { scrollBottomPadding } = useTabBarLayout();

  if (loading) {
    return (
      <View style={styles.root}>
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.loadingContainer}>
            <Text style={styles.loadingText}>{loadingText}</Text>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  const content = (
    <View style={[styles.content, contentStyle]}>{children}</View>
  );

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safeArea}>
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
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: UI.colors.background,
    paddingTop: STATUS_BAR_HEIGHT,
  },
  safeArea: {
    flex: 1,
    backgroundColor: UI.colors.background,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: UI.spacing.screen,
    paddingTop: 8,
  },
  content: {
    flex: 1,
    paddingHorizontal: UI.spacing.screen,
    paddingTop: 8,
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

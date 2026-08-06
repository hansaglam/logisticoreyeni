import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { disableTutorialForSession, resetTutorialSessionDisables } from '../tutorial/app/controller';
import { resolveScreenTutorialId } from '../tutorial/app/screenMap';
import { colors, spacing, typography } from '../theme';

interface Props {
  screenName: string;
  children: React.ReactNode;
  onRetry?: () => void;
}

interface State {
  error: Error | null;
}

export default class ScreenErrorBoundary extends React.PureComponent<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    const tutorialId = resolveScreenTutorialId(this.props.screenName);
    if (tutorialId) {
      disableTutorialForSession(tutorialId);
    }

    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.error('[screen-runtime-error]', {
        screenId: this.props.screenName,
        tutorialId,
        message: error instanceof Error ? error.message : String(error),
        name: error instanceof Error ? error.name : 'Error',
        stack: error instanceof Error ? error.stack : undefined,
        componentStack: errorInfo.componentStack,
      });
    } else {
      console.warn('[screen-error-boundary]', {
        screen: this.props.screenName,
        message: error.message,
      });
    }
  }

  private retry = () => {
    const tutorialId = resolveScreenTutorialId(this.props.screenName);
    if (tutorialId) {
      disableTutorialForSession(tutorialId);
    }
    this.setState({ error: null });
    this.props.onRetry?.();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View style={styles.root}>
        <Text style={styles.title}>Ekran yüklenemedi</Text>
        <Text style={styles.message}>Bu ekran şu anda yüklenemedi.</Text>
        <Text style={styles.hint}>
          Tekrar deneyebilir veya başka bir bölüme geçebilirsin.
        </Text>
        <Pressable style={styles.button} onPress={this.retry} accessibilityRole="button">
          <Text style={styles.buttonText}>Tekrar Dene</Text>
        </Pressable>
      </View>
    );
  }
}

export { resetTutorialSessionDisables };

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.md,
    backgroundColor: colors.background,
  },
  title: {
    ...typography.cardTitle,
    color: colors.textPrimary,
  },
  message: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  hint: {
    ...typography.bodySmall,
    color: colors.textMuted,
    textAlign: 'center',
  },
  button: {
    minHeight: 44,
    paddingHorizontal: spacing.xl,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  buttonText: {
    ...typography.buttonText,
    color: '#FFFFFF',
  },
});

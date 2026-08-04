import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '../theme';

interface Props {
  screenName: string;
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

export default class ScreenErrorBoundary extends React.PureComponent<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error): void {
    console.warn('[screen-error-boundary]', {
      screen: this.props.screenName,
      message: error.message,
    });
  }

  private retry = () => {
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View style={styles.root}>
        <Text style={styles.title}>Ekran yüklenemedi</Text>
        <Text style={styles.message}>
          {this.props.screenName} ekranı geçici bir sorunla karşılaştı.
        </Text>
        <Pressable style={styles.button} onPress={this.retry} accessibilityRole="button">
          <Text style={styles.buttonText}>Tekrar Dene</Text>
        </Pressable>
      </View>
    );
  }
}

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

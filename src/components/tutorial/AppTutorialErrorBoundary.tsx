import React from 'react';

import {
  disableTutorialForSession,
  noop,
} from '../../tutorial/app/controller';
import { logAppTutorialDev } from '../../tutorial/app/logger';
import type { AppTutorialId } from '../../tutorial/app/types';
import { APP_TUTORIAL_VERSIONS } from '../../tutorial/app/versions';

interface Props {
  tutorialId: AppTutorialId;
  children: React.ReactNode;
  fallback?: React.ReactNode;
  onError?: () => void;
}

interface State {
  hasError: boolean;
}

export default class AppTutorialErrorBoundary extends React.PureComponent<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    disableTutorialForSession(this.props.tutorialId);
    logAppTutorialDev({
      tutorialId: this.props.tutorialId,
      action: 'target-missing',
      stepId: 'error-boundary',
      tutorialVersion: APP_TUTORIAL_VERSIONS[this.props.tutorialId] ?? 0,
    });
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.error('[tutorial-error-boundary]', {
        tutorialId: this.props.tutorialId,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        componentStack: errorInfo.componentStack,
      });
    }
    this.props.onError?.();
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? null;
    }
    return this.props.children;
  }
}

export { noop as tutorialNoop };

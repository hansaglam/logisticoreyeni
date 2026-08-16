/**
 * Defers opening AppDialog until after another RN Modal has fully closed.
 * Nested Modals (sheet + AppDialog) leave an invisible touch-blocking overlay
 * that freezes Araç Pazarı back navigation on iOS/Android.
 */

import { InteractionManager } from 'react-native';

import type { AppDialogAlertButton } from '../components/AppDialogProvider';

type ShowAlert = (
  title: string,
  message?: string,
  buttons?: AppDialogAlertButton[],
) => void;

const AFTER_MODAL_MS = 80;

export function showAlertAfterModalClose(
  showAlert: ShowAlert,
  title: string,
  message?: string,
  buttons?: AppDialogAlertButton[],
): void {
  InteractionManager.runAfterInteractions(() => {
    setTimeout(() => {
      showAlert(title, message, buttons);
    }, AFTER_MODAL_MS);
  });
}

export function logMarketplaceDev(
  phase: string,
  payload?: Record<string, unknown>,
): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return;
  if (payload) {
    console.info(`[Marketplace] ${phase}`, payload);
  } else {
    console.info(`[Marketplace] ${phase}`);
  }
}

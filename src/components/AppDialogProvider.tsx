/**
 * Global dialog provider — native Alert yerine AppDialog kullanımı için.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import AppDialog, {
  type AppDialogDetailRow,
  type AppDialogProps,
  type AppDialogVariant,
} from './ui/AppDialog';

export type { AppDialogDetailRow, AppDialogVariant };

export interface AppDialogAction {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'destructive';
}

export interface AppDialogOptions {
  title: string;
  message?: string;
  variant?: AppDialogVariant;
  details?: AppDialogDetailRow[];
  footerNote?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** Üç veya daha fazla seçenek için dikey buton listesi */
  actions?: AppDialogAction[];
  onConfirm?: () => void;
  onCancel?: () => void;
}

/** Alert.alert uyumluluğu için buton tanımı */
export interface AppDialogAlertButton {
  text: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
}

interface AppDialogContextValue {
  showDialog: (options: AppDialogOptions) => void;
  hideDialog: () => void;
  /** Tek/çift butonlu kısa yol — eski Alert.alert yerine */
  alert: (title: string, message?: string, buttons?: AppDialogAlertButton[]) => void;
}

const AppDialogContext = createContext<AppDialogContextValue | null>(null);

function resolveAlertButtons(
  buttons: AppDialogAlertButton[] | undefined,
  title: string,
  message: string | undefined,
): AppDialogOptions {
  if (!buttons || buttons.length === 0) {
    return {
      title,
      message,
      variant: 'info',
      confirmLabel: 'Tamam',
    };
  }

  if (buttons.length === 1) {
    return {
      title,
      message,
      variant: 'info',
      confirmLabel: buttons[0].text,
      onConfirm: buttons[0].onPress,
    };
  }

  const cancelButton =
    buttons.find((button) => button.style === 'cancel') ?? buttons[0];
  const confirmButton =
    buttons.find((button) => button.style === 'destructive') ??
    buttons.find((button) => button !== cancelButton) ??
    buttons[buttons.length - 1];
  const isDestructive = confirmButton.style === 'destructive';

  return {
    title,
    message,
    variant: isDestructive ? 'danger' : 'confirm',
    cancelLabel: cancelButton.text,
    confirmLabel: confirmButton.text,
    destructive: isDestructive,
    onCancel: cancelButton.onPress,
    onConfirm: confirmButton.onPress,
  };
}

export function AppDialogProvider({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [dialogProps, setDialogProps] = useState<AppDialogProps | null>(null);

  const hideDialog = useCallback(() => {
    setVisible(false);
    setDialogProps(null);
  }, []);

  const showDialog = useCallback(
    (options: AppDialogOptions) => {
      setDialogProps({
        visible: true,
        title: options.title,
        message: options.message,
        variant: options.variant ?? (options.destructive ? 'danger' : 'info'),
        details: options.details,
        footerNote: options.footerNote,
        confirmLabel: options.confirmLabel ?? 'Tamam',
        cancelLabel: options.cancelLabel,
        destructive: options.destructive ?? false,
        actions: options.actions,
        onConfirm: options.onConfirm,
        onCancel: options.onCancel,
        onDismiss: hideDialog,
      });
      setVisible(true);
    },
    [hideDialog],
  );

  const alert = useCallback(
    (title: string, message?: string, buttons?: AppDialogAlertButton[]) => {
      showDialog(resolveAlertButtons(buttons, title, message));
    },
    [showDialog],
  );

  const contextValue = useMemo<AppDialogContextValue>(
    () => ({
      showDialog,
      hideDialog,
      alert,
    }),
    [showDialog, hideDialog, alert],
  );

  return (
    <AppDialogContext.Provider value={contextValue}>
      {children}
      {dialogProps ? <AppDialog {...dialogProps} visible={visible} onDismiss={hideDialog} /> : null}
    </AppDialogContext.Provider>
  );
}

export function useAppDialog(): AppDialogContextValue {
  const context = useContext(AppDialogContext);
  if (!context) {
    throw new Error('useAppDialog must be used within AppDialogProvider');
  }
  return context;
}

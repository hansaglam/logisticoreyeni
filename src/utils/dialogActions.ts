export function runDialogActionAfterDismiss(
  dismiss: () => void,
  action: () => void,
): void {
  dismiss();
  action();
}

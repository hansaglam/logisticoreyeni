/**
 * Non-fatal startup / background error logging.
 * Optional network and reconcile work must never crash the process.
 */

export function describeUnknownError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack };
  }
  return { message: String(error) };
}

export function logStartupError(scope: string, error: unknown): void {
  const { message, stack } = describeUnknownError(error);
  console.error('[STARTUP_ERROR]', { scope, message, stack });
}

export function logUnhandledRejection(error: unknown): void {
  const { message, stack } = describeUnknownError(error);
  console.error('[UNHANDLED_REJECTION]', { message, stack });
}

export function logFatalJsException(error: unknown, isFatal: boolean): void {
  const { message, stack } = describeUnknownError(error);
  console.error('[FATAL]', { isFatal, message, stack });
}

export function logCloudSyncError(error: unknown): void {
  const { message, stack } = describeUnknownError(error);
  console.error('[CLOUD_SYNC_ERROR]', { message, stack });
}

export function logMarketplaceReconcileError(error: unknown): void {
  const { message, stack } = describeUnknownError(error);
  console.error('[MARKETPLACE_RECONCILE_ERROR]', { message, stack });
}

export function safeVoid(scope: string, work: Promise<unknown> | void): void {
  void Promise.resolve(work).catch((error) => {
    logStartupError(scope, error);
  });
}

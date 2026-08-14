import type { Firestore, Transaction } from 'firebase-admin/firestore';

export const DEFAULT_OUTER_TRANSACTION_ATTEMPTS = 3;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function jitteredBackoffMs(attempt: number): number {
  const base = 25 * 2 ** attempt;
  return base + Math.floor(Math.random() * base);
}

/**
 * Emulator contention can surface INVALID_ARGUMENT while in-flight txn reads are
 * invalidated before Firestore retries the callback.
 */
export function isTransientFirestoreTransactionError(error: unknown): boolean {
  const code = (error as { code?: number })?.code;
  if (code === 10 || code === 14 || code === 4) {
    return true;
  }
  if (code === 3) {
    const message = String((error as Error)?.message ?? '');
    return message.includes('Transaction is invalid or closed');
  }
  return false;
}

export async function runFirestoreTransactionWithRetry<T>(
  firestore: Firestore,
  operation: (transaction: Transaction) => Promise<T>,
  options?: {
    maxAttempts?: number;
    innerMaxAttempts?: number;
  },
): Promise<{ result: T; outerRetryCount: number }> {
  const maxAttempts = options?.maxAttempts ?? DEFAULT_OUTER_TRANSACTION_ATTEMPTS;
  let outerRetryCount = 0;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const result = await firestore.runTransaction(operation, {
        maxAttempts: options?.innerMaxAttempts,
      });
      return { result, outerRetryCount };
    } catch (error) {
      if (
        !isTransientFirestoreTransactionError(error) ||
        attempt === maxAttempts - 1
      ) {
        throw error;
      }
      outerRetryCount += 1;
      await sleep(jitteredBackoffMs(attempt));
    }
  }
  throw new Error('firestore-transaction-exhausted');
}

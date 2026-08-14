import type { Firestore } from 'firebase-admin/firestore';

import {
  buildCanonicalSnapshot,
  buildHistoryEntries,
  getMarketEpochFromServerTime,
  resolveWorkerConfigVersion,
  type WorkerGlobalEconomySnapshot,
} from './globalEconomyGenerator';
import {
  DEFAULT_OUTER_TRANSACTION_ATTEMPTS,
  runFirestoreTransactionWithRetry,
} from './firestoreTransactionUtils';

export const HISTORY_RETENTION_EPOCHS = 30 * 48;
const TRANSACTION_MAX_ATTEMPTS = 5;

export interface WorkerRunResult {
  epoch: number;
  configVersion: number;
  snapshotCreated: boolean;
  historyRecordsWritten: number;
  historyRecordsDeleted: number;
  retryCount: number;
  snapshot: WorkerGlobalEconomySnapshot;
}

export interface WorkerRunOptions {
  nowMs?: number;
  configVersion?: number;
  /** Emulator-only failpoint used to prove transaction rollback. */
  failAfterWritesForTest?: boolean;
  beforeTransactionWritesForTest?: (attempt: number) => Promise<void>;
}

function historyDocumentId(
  epoch: number,
  cityId: string,
  productId: string,
): string {
  return `${epoch}_${cityId}_${productId}`;
}

export async function runGlobalEconomyEpoch(
  firestore: Firestore,
  options: WorkerRunOptions = {},
): Promise<WorkerRunResult> {
  const nowMs = options.nowMs ?? Date.now();
  const epoch = getMarketEpochFromServerTime(nowMs);
  const configVersion =
    options.configVersion ?? resolveWorkerConfigVersion();
  const snapshotId = `${epoch}_${configVersion}`;
  const snapshotRef = firestore
    .collection('globalEconomySnapshots')
    .doc(snapshotId);
  const currentRef = firestore.collection('globalEconomy').doc('current');
  let transactionAttempts = 0;

  const { result, outerRetryCount } = await runFirestoreTransactionWithRetry(
    firestore,
    async (transaction) => {
      transactionAttempts += 1;
      const existing = await transaction.get(snapshotRef);
      if (existing.exists) {
        return {
          epoch,
          configVersion,
          snapshotCreated: false,
          historyRecordsWritten: 0,
          historyRecordsDeleted: 0,
          retryCount: Math.max(0, transactionAttempts - 1),
          snapshot: existing.data() as WorkerGlobalEconomySnapshot,
        };
      }

      const expiredEpoch = epoch - HISTORY_RETENTION_EPOCHS - 1;
      const expiredQuery = firestore
        .collection('globalMarketHistory')
        .where('epoch', '<=', expiredEpoch)
        .limit(350);
      const expiredDocuments = await transaction.get(expiredQuery);
      await options.beforeTransactionWritesForTest?.(transactionAttempts);
      const snapshot = buildCanonicalSnapshot(epoch, configVersion);
      const historyEntries = buildHistoryEntries(snapshot);

      transaction.create(snapshotRef, snapshot);
      for (const entry of historyEntries) {
        transaction.create(
          firestore
            .collection('globalMarketHistory')
            .doc(historyDocumentId(entry.epoch, entry.cityId, entry.productId)),
          entry,
        );
      }
      for (const expired of expiredDocuments.docs) {
        transaction.delete(expired.ref);
      }
      transaction.set(currentRef, {
        epoch,
        configVersion,
        snapshotVersion: snapshot.version,
        generatedAt: snapshot.generatedAt,
        validUntil: snapshot.validUntil,
        serverTimeMs: nowMs,
        snapshot,
      });

      if (options.failAfterWritesForTest) {
        throw new Error('TEST_FAIL_AFTER_WRITES');
      }

      return {
        epoch,
        configVersion,
        snapshotCreated: true,
        historyRecordsWritten: historyEntries.length,
        historyRecordsDeleted: expiredDocuments.size,
        retryCount: Math.max(0, transactionAttempts - 1),
        snapshot,
      };
    },
    {
      maxAttempts: DEFAULT_OUTER_TRANSACTION_ATTEMPTS,
      innerMaxAttempts: TRANSACTION_MAX_ATTEMPTS,
    },
  );
  return {
    ...result,
    retryCount: result.retryCount + outerRetryCount,
  };
}

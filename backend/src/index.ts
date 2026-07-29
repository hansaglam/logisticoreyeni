import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { runGlobalEconomyEpoch } from './globalEconomyWorker';

initializeApp();

export const generateGlobalEconomy = onSchedule(
  {
    schedule: '0,30 * * * *',
    timeZone: 'UTC',
    retryCount: 3,
    maxInstances: 1,
    timeoutSeconds: 120,
    memory: '256MiB',
  },
  async () => {
    const startedAt = Date.now();
    try {
      const result = await runGlobalEconomyEpoch(getFirestore(), {
        nowMs: startedAt,
      });
      logger.info('[global-economy-worker]', {
        epoch: result.epoch,
        configVersion: result.configVersion,
        snapshotCreated: result.snapshotCreated,
        historyRecordsWritten: result.historyRecordsWritten,
        historyRecordsDeleted: result.historyRecordsDeleted,
        durationMs: Date.now() - startedAt,
        retryCount: result.retryCount,
      });
    } catch (error) {
      logger.error('[global-economy-worker]', {
        durationMs: Date.now() - startedAt,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message }
            : String(error),
      });
      throw error;
    }
  },
);

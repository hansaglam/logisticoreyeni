/**
 * Dry-run migration audit for serverState bootstrap.
 * Does NOT write to production unless --apply is passed.
 *
 * Usage:
 *   npx tsx backend/scripts/migrateServerStateDryRun.ts
 *   npx tsx backend/scripts/migrateServerStateDryRun.ts --apply
 */
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

import { migrateLegacyServerStateTransaction } from '../src/serverState';

const apply = process.argv.includes('--apply');

initializeApp();
const firestore = getFirestore();

async function main() {
  const users = await firestore.collection('users').limit(500).get();
  const summary = {
    scanned: users.size,
    migrated: 0,
    suspicious: 0,
    rejected: 0,
    manualReview: 0,
    dryRun: !apply,
  };

  for (const userDoc of users.docs) {
    const uid = userDoc.id;
    const result = await migrateLegacyServerStateTransaction(
      firestore,
      uid,
      !apply,
    );
    if (result.ok && result.report) {
      if (result.report.migrated) summary.migrated += 1;
      if (result.report.suspicious) {
        summary.suspicious += 1;
        summary.manualReview += 1;
      }
      if (result.report.rejected) summary.rejected += 1;
      console.log(JSON.stringify(result.report));
    } else if (result.report?.reason === 'save-not-found') {
      summary.rejected += 1;
    }
  }

  console.log('[migrateServerStateDryRun-summary]', JSON.stringify(summary, null, 2));
}

void main().catch((error) => {
  console.error('[migrateServerStateDryRun] FAILED', error);
  process.exitCode = 1;
});

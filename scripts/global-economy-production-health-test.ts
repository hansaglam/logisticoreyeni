import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  firestoreGetDocument,
  firestoreRunQuery,
  getFirebaseCliAccessToken,
} from './productionFirebaseRead';

async function main(): Promise<void> {
const ROOT = resolve(__dirname, '..');
const rc = JSON.parse(readFileSync(resolve(ROOT, '.firebaserc'), 'utf8')) as {
  projects?: { default?: string };
};
const projectId = rc.projects?.default;
if (!projectId) throw new Error('FIREBASE_PROJECT_NOT_CONFIGURED');
const accessToken = await getFirebaseCliAccessToken();
const current = await firestoreGetDocument(projectId, 'globalEconomy/current', accessToken);
const epoch = Number(current.epoch);
const configVersion = Number(current.configVersion);
const snapshot = current.snapshot as Record<string, unknown> | undefined;
const generatedAt = Number(current.generatedAt ?? snapshot?.generatedAt);
const validUntil = Number(current.validUntil ?? snapshot?.validUntil);
const fuelPrice = Number(snapshot?.fuelPricePerLiter);
const movements = Array.isArray(snapshot?.marketMovements) ? snapshot.marketMovements : [];
const now = Date.now();
const problems: string[] = [];
if (!Number.isInteger(epoch) || epoch <= 0) problems.push('invalid-epoch');
if (!Number.isInteger(configVersion) || configVersion <= 0) problems.push('invalid-config-version');
if (!Number.isFinite(generatedAt) || generatedAt <= 0) problems.push('invalid-generated-at');
if (!Number.isFinite(validUntil) || validUntil < now - 30 * 60 * 1000) problems.push('stale-snapshot');
if (!Number.isFinite(fuelPrice) || fuelPrice <= 0 || fuelPrice > 100) problems.push('invalid-fuel-price');

const history = await firestoreRunQuery(projectId, {
  from: [{ collectionId: 'globalMarketHistory' }],
  where: {
    fieldFilter: {
      field: { fieldPath: 'epoch' },
      op: 'EQUAL',
      value: { integerValue: String(epoch) },
    },
  },
  limit: 500,
}, accessToken);
if (history.length !== movements.length) {
  problems.push(`history-count:${history.length}/${movements.length}`);
}
for (const row of history) {
  for (const key of ['epoch', 'configVersion', 'price', 'supply', 'demand', 'movementPercent']) {
    if (!Number.isFinite(Number(row[key]))) problems.push(`non-finite-history:${key}`);
  }
}

console.log('[global-economy-production-health]', {
  projectId,
  epoch,
  configVersion,
  generatedAt,
  validUntil,
  ageMinutes: Math.round((now - generatedAt) / 60000),
  fuelPrice,
  expectedHistoryRecords: movements.length,
  actualHistoryRecords: history.length,
  problems: [...new Set(problems)],
});
if (problems.length) process.exitCode = 1;
}

void main().catch((error) => {
  console.error('[global-economy-production-health] failed',
    error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

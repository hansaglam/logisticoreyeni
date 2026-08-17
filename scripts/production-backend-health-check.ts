import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { firestoreGetDocument, getFirebaseCliAccessToken } from './productionFirebaseRead';

async function main(): Promise<void> {
const ROOT = resolve(__dirname, '..');
const projectId = (JSON.parse(readFileSync(resolve(ROOT, '.firebaserc'), 'utf8')) as {
  projects?: { default?: string };
}).projects?.default;
if (projectId !== 'logisticore-53ab4') throw new Error(`UNEXPECTED_FIREBASE_PROJECT:${projectId}`);
const executable = resolve(ROOT, 'node_modules/firebase-tools/lib/bin/firebase.js');
const firebaseCliJson = (args: string[]) => {
  const result = spawnSync(process.execPath, [executable, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    input: 'y\n',
  });
  const stdout = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const jsonStart = stdout.indexOf('{');
  const jsonEnd = stdout.lastIndexOf('}');
  if (jsonStart < 0 || jsonEnd <= jsonStart) {
    throw new Error(`NO_JSON_IN_FIREBASE_CLI_OUTPUT:${stdout.slice(0, 160)}`);
  }
  return JSON.parse(stdout.slice(jsonStart, jsonEnd + 1)) as unknown;
};
const parsed = firebaseCliJson(['functions:list', '--json']) as {
  result?: Array<Record<string, unknown>>;
};
const functions = parsed.result ?? [];
const indexResult = firebaseCliJson(['firestore:indexes', '--json']) as {
  result?: { indexes?: Array<{ collectionGroup?: string; fields?: Array<{ fieldPath?: string }> }> };
};
const indexes = indexResult.result?.indexes ?? [];
const names = new Set(functions.map((item) => String(item.id ?? item.name ?? '')));
const required = [
  'generateGlobalEconomy',
  'expireVehicleMarketplace',
  'createVehicleListing',
  'cancelVehicleListing',
  'purchaseVehicleListing',
  'getVehicleMarketplaceListings',
  'getMyVehicleListings',
  'prepareVehicleMarketplaceAccountDeletion',
];
const missing = required.filter((name) => !names.has(name));
const wrongRegion = functions
  .filter((item) => required.includes(String(item.id ?? item.name ?? '')))
  .filter((item) => String(item.region ?? item.location ?? '') !== 'us-central1')
  .map((item) => String(item.id ?? item.name));
const token = await getFirebaseCliAccessToken();
const current = await firestoreGetDocument(projectId, 'globalEconomy/current', token);
const validUntil = Number(current.validUntil ?? (current.snapshot as Record<string, unknown> | undefined)?.validUntil);
const stale = !Number.isFinite(validUntil) || validUntil < Date.now() - 30 * 60 * 1000;
const requiredIndexGroups = ['globalMarketHistory', 'vehicleMarketplaceListings'];
const missingIndexGroups = requiredIndexGroups.filter(
  (group) => !indexes.some((index) => index.collectionGroup === group),
);
console.log('[production-backend-health]', {
  projectId,
  deployedFunctionCount: functions.length,
  missing,
  wrongRegion,
  globalEconomyEpoch: current.epoch,
  configVersion: current.configVersion,
  stale,
  marketplaceFunctionsActive: required.slice(2).every((name) => names.has(name)),
  cleanupWorkersActive: names.has('expireVehicleMarketplace'),
  deployedCompositeIndexCount: indexes.length,
  missingIndexGroups,
  authProviderConfig: 'not-readable-with-firebase-cli',
});
if (missing.length || wrongRegion.length || stale || missingIndexGroups.length) process.exitCode = 1;
}

void main().catch((error) => {
  console.error('[production-backend-health] failed',
    error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

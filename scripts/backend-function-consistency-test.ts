import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const REGION = 'us-central1';
const RUNTIME = 'nodejs20';
const REQUIRED = [
  'generateGlobalEconomy',
  'createVehicleListing',
  'cancelVehicleListing',
  'purchaseVehicleListing',
  'getVehicleMarketplaceListings',
  'getMyVehicleListings',
  'prepareVehicleMarketplaceAccountDeletion',
  'expireVehicleMarketplace',
] as const;

function unique(matches: Iterable<string>): string[] {
  return [...new Set(matches)].sort();
}

const backendSource = readFileSync(resolve(ROOT, 'backend/src/index.ts'), 'utf8');
const backendExports = unique(
  [...backendSource.matchAll(/export const\s+([A-Za-z0-9_]+)\s*=\s*on(?:Call|Schedule|Request|Document\w*)\b/g)]
    .map((match) => match[1]!),
);

const clientServiceSource = readFileSync(
  resolve(ROOT, 'src/services/vehicleMarketplaceService.ts'),
  'utf8',
);
const callableBlock = clientServiceSource.match(
  /VEHICLE_MARKETPLACE_CALLABLES\s*=\s*\{([\s\S]*?)\}\s*as const/,
)?.[1] ?? '';
const clientCallables = unique(
  [...callableBlock.matchAll(/:\s*['"]([A-Za-z0-9_]+)['"]/g)].map(
    (match) => match[1]!,
  ),
);

const missingExports = clientCallables.filter((name) => !backendExports.includes(name));
const missingRequired = REQUIRED.filter((name) => !backendExports.includes(name));
const securityProblems: string[] = [];
if (!backendSource.includes('request.auth.uid')) securityProblems.push('auth-uid-not-used');
if (/request\.data\.(?:uid|sellerUid|buyerUid)/.test(backendSource)) {
  securityProblems.push('uid-read-from-payload');
}
for (const marker of ['hasOnlyKeys', 'isBoundedId', 'Number.isFinite', 'hasActionEnvelope']) {
  if (!backendSource.includes(marker)) securityProblems.push(`missing-validation:${marker}`);
}
if (missingExports.length || missingRequired.length || securityProblems.length) {
  throw new Error(JSON.stringify({ missingExports, missingRequired, securityProblems }));
}

const firebaseExecutable = resolve(ROOT, 'node_modules/firebase-tools/lib/bin/firebase.js');
const raw = execFileSync(process.execPath, [firebaseExecutable, 'functions:list', '--json'], {
  cwd: ROOT,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});
const parsed = JSON.parse(raw) as { result?: Array<Record<string, unknown>> };
const deployed = parsed.result ?? [];
const deployedByName = new Map(
  deployed.map((entry) => [String(entry.id ?? entry.name ?? ''), entry]),
);
const missingDeployed = REQUIRED.filter((name) => !deployedByName.has(name));
const wrongRegion: string[] = [];
const wrongRuntime: string[] = [];
for (const name of REQUIRED) {
  const entry = deployedByName.get(name);
  if (!entry) continue;
  const region = String(entry.region ?? entry.location ?? '');
  const runtime = String(entry.runtime ?? '');
  if (region !== REGION) wrongRegion.push(`${name}:${region || 'unknown'}`);
  if (runtime !== RUNTIME) wrongRuntime.push(`${name}:${runtime || 'unknown'}`);
}

console.log('[backend-function-consistency]', {
  backendExports,
  clientCallables,
  deployed: [...deployedByName.keys()].sort(),
  missingDeployed,
  wrongRegion,
  wrongRuntime,
  securityProblems,
});

if (missingDeployed.length || wrongRegion.length || wrongRuntime.length) {
  process.exitCode = 1;
}

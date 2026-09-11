/**
 * Phase 7 Step 3.6 — Canary execution pack static regression (no deploy / no live writes).
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

let pass = 0;
let fail = 0;
function check(cond: boolean, label: string) {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${label}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${label}`);
  }
}

console.log('\n=== Season Close Canary Pack Regression ===\n');

const docs = read('docs/release-audit/V1_1_PHASE_7_SEASON_CLOSE_SNAPSHOT.md');
const index = read('backend/src/index.ts');
const close = read('backend/src/seasonClose.ts');
const firebaserc = read('.firebaserc');
const firebaseJson = read('firebase.json');
const appleDoc = read('docs/release-audit/APPLE_SIGNIN_SECRET_PREFLIGHT.md');

check(docs.includes('PHASE 7 STEP 3.6'), 'Step 3.6 docs section present');
check(docs.includes('CONTROLLED CANARY EXECUTION PACK'), 'canary pack titled');
check(docs.includes('DO NOT EXECUTE'), 'docs mark commands as not executed');
check(firebaserc.includes('logisticore-53ab4'), 'project default');
check(firebaseJson.includes('"runtime": "nodejs20"'), 'runtime nodejs20');
check(index.includes('export const finalizeWeeklySeasonClose'), 'scheduler export');
check(index.includes('export const ensureSeasonFinalizedCallable'), 'ensure export');
check(index.includes('export const getSeasonResult'), 'getSeasonResult export');
check(close.includes("process.env.SEASON_CLOSE_SNAPSHOT_ENABLED === 'true'"), 'flag via process.env');
check(appleDoc.includes('backend/.env'), 'repo documents backend/.env deploy env load');
check(existsSync(resolve(root, 'backend/scripts/inspectSeasonCloseCandidate.ts')), 'inspect script');
check(existsSync(resolve(root, 'backend/scripts/verifySeasonCloseSnapshot.ts')), 'verify script');
check(read('backend/scripts/inspectSeasonCloseCandidate.ts').includes('NEVER writes'), 'inspect read-only');
check(read('backend/scripts/verifySeasonCloseSnapshot.ts').includes('NEVER writes'), 'verify read-only');
check(
  !/\.collection\([^)]+\)\.(doc\([^)]+\)\.)?(set|add|create|update|delete)\(/.test(
    read('backend/scripts/inspectSeasonCloseCandidate.ts'),
  ),
  'inspect no firestore writes',
);
check(!read('backend/scripts/verifySeasonCloseSnapshot.ts').includes('finalizeSeason('), 'verify no finalize');
check(
  !/\.collection\([^)]+\)\.(doc\([^)]+\)\.)?(set|add|create|update|delete)\(/.test(
    read('backend/scripts/verifySeasonCloseSnapshot.ts'),
  ),
  'verify no firestore writes',
);
check(docs.includes('functions:finalizeWeeklySeasonClose'), 'deploy selector documented');
check(docs.includes('firestore:rules'), 'rules deploy documented');
check(docs.includes('EXPO_PUBLIC_ENABLE_SEASON_CLOSE_SNAPSHOT'), 'client flag remains off');
check(docs.includes('prepareVehicleMarketplaceAccountDeletion'), 'deletion function in scope');

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) process.exitCode = 1;
else console.log('✅ ALL PASS\n');

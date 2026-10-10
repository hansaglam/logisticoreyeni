/**
 * Step 29AL — immediate freeze-and-apply cutover regression.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const backend = readFileSync(join(root, 'backend/src/canonicalLegacyProgressionMigration.ts'), 'utf8');
const domain = readFileSync(join(root, 'src/domain/canonicalLegacyProgressionMigration.ts'), 'utf8');
const index = readFileSync(join(root, 'backend/src/index.ts'), 'utf8');
const progression = readFileSync(join(root, 'backend/src/canonicalCompanyProgression.ts'), 'utf8');
const issuance = readFileSync(join(root, 'backend/src/canonicalProductionRoadContractIssuance.ts'), 'utf8');
const rules = readFileSync(join(root, 'firestore.rules'), 'utf8');

assert.match(domain, /CANONICAL_PROGRESSION_IMMEDIATE_CUTOVER_ENV = 'CANONICAL_PROGRESSION_IMMEDIATE_CUTOVER'/);
assert.match(domain, /canonical-progression-immediate-cutover-v1/);
assert.match(domain, /FROZEN_AT_CUTOVER/);
assert.match(domain, /MIGRATION_SOURCE_PREEXISTING_FROZEN_REQUIRES_RESOLUTION/);
assert.match(domain, /PUBLIC_PROGRESSION_UI_SPLIT_BRAIN/);
assert.match(domain, /LEGACY_BASELINE_ATTESTED_NOT_EARNED/);
assert.match(domain, /SAVE_GAME_VERSION|LEGACY_PROGRESSION_MIGRATION_SUPPORTED_SAVE_VERSION = 6/);
assert.match(backend, /cutoverCanonicalLegacyProgressionMigration/);
assert.match(backend, /transaction\.get\(saveRef\)/);
assert.match(backend, /transaction\.create\(sourceRef/);
assert.match(backend, /transaction\.create\(migrationRef/);
assert.match(backend, /transaction\.create\(progressionRef/);
assert.match(backend, /MIGRATION_SOURCE_FREEZE_STATUS_AT_CUTOVER/);
assert.match(domain, /FROZEN_AT_CUTOVER/);
assert.doesNotMatch(backend, /serverState\.cash/);
assert.match(index, /cutoverCanonicalLegacyProgressionMigrationInternal/);
assert.match(index, /CANONICAL_PROGRESSION_IMMEDIATE_CUTOVER/);
assert.match(index, /hasOnlyCanonicalProgressionImmediateCutoverKeys/);
assert.match(progression, /canonicalCompanyProgressionPath/);
assert.match(issuance, /resolveCanonicalProgressionForIssuance/);
assert.doesNotMatch(issuance, /saves\/current/);
assert.match(rules, /allow write: if false/);

console.log('map-v2-legacy-progression-immediate-cutover-regression-test: PASS');

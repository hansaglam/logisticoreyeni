/**
 * Step 29AK — frozen migration source regression.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const backend = readFileSync(join(root, 'backend/src/canonicalLegacyProgressionMigration.ts'), 'utf8');
const domain = readFileSync(join(root, 'src/domain/canonicalLegacyProgressionMigration.ts'), 'utf8');
const index = readFileSync(join(root, 'backend/src/index.ts'), 'utf8');
const rules = readFileSync(join(root, 'firestore.rules'), 'utf8');

assert.match(backend, /freezeCanonicalProgressionMigrationSource/);
assert.match(backend, /MIGRATION_SOURCE_NOT_FROZEN/);
assert.match(backend, /MIGRATION_SOURCE_HASH_INTEGRITY_ERROR/);
assert.match(backend, /MIGRATION_SOURCE_REFREEZE_POLICY/);
assert.match(domain, /REFREEZE_FORBIDDEN/);
assert.match(backend, /transaction\.create\(sourceRef/);
assert.doesNotMatch(backend, /expectedSourceSnapshotHash/);
assert.doesNotMatch(backend, /canonicalCashTransactions/);
assert.match(domain, /canonical-progression-migration-source-freeze-v1/);
assert.match(domain, /SERVER_FROZEN_LEGACY_MIGRATION_SOURCE/);
assert.match(domain, /SERVER_ATTESTED_LEGACY_BASELINE/);
assert.match(domain, /LEGACY_PROGRESSION_MIGRATION_PUBLIC_ROLLOUT|LEGACY_MIGRATION_SOURCE_PUBLIC_CUTOVER_BLOCKED/);
assert.match(domain, /POST_FREEZE_SAVE_STILL_MUTABLE/);
assert.match(index, /freezeCanonicalProgressionMigrationSourceInternal/);
assert.match(index, /CANONICAL_PROGRESSION_MIGRATION/);
assert.match(rules, /canonicalProgressionMigrationSource\/\{sourceId\}/);
assert.match(rules, /allow write: if false/);
assert.doesNotMatch(index, /freezeCanonicalProgressionMigrationSourceInternal[\s\S]{0,400}startup/);

console.log('map-v2-legacy-save-authority-hardening-regression-test: PASS');

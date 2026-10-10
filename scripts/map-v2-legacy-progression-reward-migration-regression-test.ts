/**
 * Step 29AJ — static regression guard for legacy progression migration backend.
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

assert.match(backend, /previewCanonicalLegacyProgressionMigration/);
assert.match(backend, /applyCanonicalLegacyProgressionMigration/);
assert.match(backend, /transaction\.create\(migrationRef/);
assert.doesNotMatch(backend, /expectedSourceSnapshotHash/);
assert.doesNotMatch(backend, /transaction\.update\(/);
assert.doesNotMatch(backend, /transaction\.set\(/);
assert.match(domain, /CANONICAL_PROGRESSION_MIGRATION_APPLY_ALLOWED_KEYS = \['canonicalSchemaVersion'\]/);
assert.match(domain, /LEGACY_BASELINE_ATTESTED_NOT_EARNED/);
assert.doesNotMatch(backend, /canonicalCashTransactions/);
assert.doesNotMatch(backend, /financeLedger/);
assert.match(backend, /loadLegacyMigrationContext/);
assert.match(backend, /computeServerMigrationHashes/);
assert.match(backend, /buildNormalizedLegacyMigrationSnapshot/);
assert.doesNotMatch(backend, /transaction\.set\(.*saves\/current/);
assert.doesNotMatch(backend, /serverState\.cash/);

assert.match(domain, /CANONICAL_PROGRESSION_MIGRATION_FORBIDDEN_CLIENT_KEYS/);
assert.match(domain, /buildNormalizedLegacyMigrationSnapshot/);
assert.match(domain, /LEGACY_PROGRESSION_META_PLAYER_CONFLICT/);
assert.match(domain, /formatMigrationSnapshotHash/);
assert.match(domain, /LEGACY_MIGRATION_BASELINE/);

assert.match(index, /previewCanonicalLegacyProgressionMigrationInternal/);
assert.match(index, /applyCanonicalLegacyProgressionMigrationInternal/);
assert.match(index, /hasOnlyCanonicalProgressionMigrationPreviewKeys/);
assert.match(index, /CANONICAL_PROGRESSION_MIGRATION/);

assert.match(rules, /canonicalProgressionMigration/);
assert.match(rules, /canonicalProgressionMigrationReceipts/);
assert.match(rules, /allow write: if false/);

console.log('map-v2-legacy-progression-reward-migration-regression-test: PASS');

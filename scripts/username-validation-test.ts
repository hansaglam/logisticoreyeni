/**
 * Client username validation mirror test.
 * Run: npx tsx scripts/username-validation-test.ts
 */

import assert from 'node:assert/strict';

import {
  normalizeUsername,
  suggestUsernameFromDisplayName,
  validateUsernameFormat,
} from '../src/domain/usernameValidation';

console.log('\n=== Username Validation Test ===\n');

const a = validateUsernameFormat('Ethem_01');
const b = validateUsernameFormat('ETHEM_01');
assert.equal(a.ok, true);
assert.equal(b.ok, true);
if (a.ok && b.ok) {
  assert.equal(a.usernameNormalized, b.usernameNormalized);
}
assert.equal(normalizeUsername('Ethem_01'), 'ethem_01');
assert.equal(validateUsernameFormat('admin').ok, false);
assert.equal(validateUsernameFormat('ab').ok, false);
assert.equal(validateUsernameFormat('bad__x').ok, false);
assert.equal(suggestUsernameFromDisplayName('Ethem Sincar'), 'ethemsincar');

console.log('  ✓ case-insensitive normalize');
console.log('  ✓ reserved / invalid rejects');
console.log('  ✓ displayName suggestion');
console.log('\n✅ ALL PASS\n');

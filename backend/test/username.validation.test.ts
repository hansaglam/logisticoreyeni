/**
 * Username validation + normalization unit tests.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  normalizeUsername,
  suggestUsernameFromDisplayName,
  validateUsernameFormat,
} from '../src/usernameValidation';

describe('usernameValidation', () => {
  it('accepts turkish letters and normalizes case-insensitively', () => {
    const a = validateUsernameFormat('Ethem_01');
    const b = validateUsernameFormat('ETHEM_01');
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    if (a.ok && b.ok) {
      assert.equal(a.usernameNormalized, b.usernameNormalized);
      assert.equal(a.usernameNormalized, 'ethem_01');
    }
    assert.equal(normalizeUsername('İstanbul_Lojistik'), 'istanbul_lojistik');
  });

  it('rejects reserved, short, invalid, and inappropriate names', () => {
    assert.equal(validateUsernameFormat('ab').ok, false);
    assert.equal(validateUsernameFormat('admin').ok, false);
    assert.equal(validateUsernameFormat('_bad').ok, false);
    assert.equal(validateUsernameFormat('bad__name').ok, false);
    assert.equal(validateUsernameFormat('12345').ok, false);
    assert.equal(validateUsernameFormat('user@mail').ok, false);
    assert.equal(validateUsernameFormat('fuck_you').ok, false);
  });

  it('suggests username from Google display name without accepting email', () => {
    assert.equal(suggestUsernameFromDisplayName('Ethem Sincar'), 'ethemsincar');
    assert.equal(suggestUsernameFromDisplayName('user@gmail.com').includes('@'), false);
  });
});

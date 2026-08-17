import assert from 'node:assert/strict';
import test from 'node:test';

import { parseMarketplaceListRequest } from '../src/vehicleMarketplaceListRequest';

test('parseMarketplaceListRequest accepts limit-only payloads', () => {
  assert.deepEqual(parseMarketplaceListRequest({ limit: 20 }), { limit: 20 });
  assert.deepEqual(parseMarketplaceListRequest({ limit: 20, cursor: null }), { limit: 20 });
  assert.deepEqual(parseMarketplaceListRequest({ limit: 20, cursor: undefined }), {
    limit: 20,
  });
});

test('parseMarketplaceListRequest accepts valid cursor payloads', () => {
  assert.deepEqual(
    parseMarketplaceListRequest({
      limit: 10,
      cursor: { createdAt: 1_800_000_000_000, id: 'listing-1' },
    }),
    {
      limit: 10,
      cursor: { createdAt: 1_800_000_000_000, id: 'listing-1' },
    },
  );
});

test('parseMarketplaceListRequest rejects invalid cursor payloads', () => {
  assert.equal(parseMarketplaceListRequest({ limit: 20, cursor: {} }), null);
  assert.equal(parseMarketplaceListRequest({ limit: 20, cursor: { id: 'x' } }), null);
  assert.equal(parseMarketplaceListRequest({ limit: 20, extra: true }), null);
});

/**
 * Canonical multimodal authority — unit tests (no emulator required for economics;
 * in-memory Firestore for idempotent accept/complete/cancel).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';

import {
  acceptCanonicalMultimodalShipmentTransaction,
  cancelCanonicalMultimodalShipmentTransaction,
  hasOnlyAcceptKeys,
  reportCanonicalMultimodalShipmentCompletedTransaction,
} from '../src/canonicalMultimodalShipment';
import { computeCanonicalMultimodalRailAcceptance } from '../../src/domain/canonicalMultimodalRailEconomics';
import { generateRailMultimodalOffers } from '../../src/domain/multimodalRailOffer';
import { getTurkeyRoadTransferAccessArtifact } from '../../src/mapV2/world/multimodalRoadTransferAccessLoader';

function createMemoryFirestore(): Firestore & { dump: Map<string, Record<string, unknown>> } {
  const dump = new Map<string, Record<string, unknown>>();
  const firestore = {
    dump,
    doc(path: string) {
      return { path };
    },
    async runTransaction<T>(operation: (transaction: {
      get: (ref: { path: string }) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>;
      create: (ref: { path: string }, data: Record<string, unknown>) => void;
      update: (ref: { path: string }, data: Record<string, unknown>) => void;
    }) => Promise<T>) {
      return operation({
        async get(ref) {
          const data = dump.get(ref.path);
          return { exists: Boolean(data), data: () => data };
        },
        create(ref, data) {
          if (dump.has(ref.path)) {
            throw new Error('already-exists');
          }
          dump.set(ref.path, { ...data });
        },
        update(ref, data) {
          const current = dump.get(ref.path);
          if (!current) throw new Error('missing');
          dump.set(ref.path, { ...current, ...data });
        },
      });
    },
  };
  return firestore as unknown as Firestore & { dump: Map<string, Record<string, unknown>> };
}

const access = getTurkeyRoadTransferAccessArtifact();
const generated = generateRailMultimodalOffers({
  generationSeed: 'backend-canonical-v1',
  accessArtifact: access,
  playerLevel: 20,
});
assert.equal(generated.status, 'READY');
const offer = generated.offers[0]!;

test('hasOnlyAcceptKeys rejects client money fields', () => {
  assert.equal(
    hasOnlyAcceptKeys({
      generationSeed: 'x',
      originCityId: 'izmir',
      destinationCityId: 'ankara',
      productId: 'steel',
      cargoQuantity: 10,
      playerPayment: 1400,
    }),
    false,
  );
  assert.equal(
    hasOnlyAcceptKeys({
      generationSeed: 'x',
      originCityId: 'izmir',
      destinationCityId: 'ankara',
      productId: 'steel',
      cargoQuantity: 10,
      sourceOfferId: 'railOffer:x:izmir:ankara:steel:10',
      transportPattern: 'ROAD_RAIL_ROAD',
      playerLevel: 5,
      canonicalSchemaVersion: 1,
    }),
    true,
  );
});

test('accept is idempotent and conflict-safe; completion/cancel guards', async () => {
  const db = createMemoryFirestore();
  const request = {
    generationSeed: offer.generationSeed,
    originCityId: offer.originCityId,
    destinationCityId: offer.destinationCityId,
    productId: offer.cargo.productId,
    cargoQuantity: offer.cargo.quantity,
    sourceOfferId: offer.offerId,
    transportPattern: 'ROAD_RAIL_ROAD',
    playerLevel: 20,
    canonicalSchemaVersion: 1,
  };
  const first = await acceptCanonicalMultimodalShipmentTransaction(db, 'uid-a', request, 1000, {
    allowAcceptance: true,
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.receipt.alreadyAccepted, false);
  assert.equal(first.receipt.playerPayment, offer.playerPayment);
  const second = await acceptCanonicalMultimodalShipmentTransaction(db, 'uid-a', request, 2000, {
    allowAcceptance: true,
  });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.receipt.alreadyAccepted, true);
  assert.equal(second.receipt.acceptedAtMs, first.receipt.acceptedAtMs);
  assert.equal(db.dump.size, 1);

  const conflict = await acceptCanonicalMultimodalShipmentTransaction(
    db,
    'uid-a',
    { ...request, productId: offer.cargo.productId === 'steel' ? 'fruit' : 'steel' },
    3000,
    { allowAcceptance: true },
  );
  assert.equal(conflict.ok, false);
  if (!conflict.ok) {
    assert.equal(conflict.reason === 'CANONICAL_ACCEPTANCE_CONFLICT' || conflict.reason === 'OFFER_ID_MISMATCH', true);
  }

  const complete = await reportCanonicalMultimodalShipmentCompletedTransaction(
    db,
    'uid-a',
    first.receipt.shipmentId,
    4000,
  );
  assert.equal(complete.ok, true);
  const completeAgain = await reportCanonicalMultimodalShipmentCompletedTransaction(
    db,
    'uid-a',
    first.receipt.shipmentId,
    5000,
  );
  assert.equal(completeAgain.ok, true);
  if (completeAgain.ok) assert.equal(completeAgain.alreadyReported, true);

  const otherUser = await reportCanonicalMultimodalShipmentCompletedTransaction(
    db,
    'uid-b',
    first.receipt.shipmentId,
    6000,
  );
  assert.equal(otherUser.ok, false);

  const db2 = createMemoryFirestore();
  const accepted = await acceptCanonicalMultimodalShipmentTransaction(db2, 'uid-a', request, 1000, {
    allowAcceptance: true,
  });
  assert.equal(accepted.ok, true);
  if (!accepted.ok) return;
  const cancelled = await cancelCanonicalMultimodalShipmentTransaction(db2, 'uid-a', accepted.receipt.shipmentId, 7000);
  assert.equal(cancelled.ok, true);
  const completeCancelled = await reportCanonicalMultimodalShipmentCompletedTransaction(
    db2,
    'uid-a',
    accepted.receipt.shipmentId,
    8000,
  );
  assert.equal(completeCancelled.ok, false);
});

test('kill switch and unauthenticated compute', () => {
  const blocked = computeCanonicalMultimodalRailAcceptance({
    generationSeed: offer.generationSeed,
    originCityId: offer.originCityId,
    destinationCityId: offer.destinationCityId,
    productId: offer.cargo.productId,
    cargoQuantity: offer.cargo.quantity,
    allowAcceptance: false,
    accessArtifact: access,
  });
  assert.equal(blocked.status, 'FEATURE_DISABLED');
});

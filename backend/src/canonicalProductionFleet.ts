/**
 * Production canonical fleet mint helpers (Step 29L).
 * Not HTTPS callables. No cash mutation.
 */

import type { Firestore } from 'firebase-admin/firestore';

import { CANONICAL_FLEET_ASSETS_COLLECTION } from '../../src/domain/canonicalRoadFleet';
import {
  buildCanonicalFleetAssetFromCatalogPurchase,
  issueCanonicalStarterFleetAsset,
} from '../../src/domain/canonicalProductionFleet';
import { isAuthenticatedUid } from './canonicalCashTransaction';

function assetPath(uid: string, assetId: string): string {
  return `users/${uid}/${CANONICAL_FLEET_ASSETS_COLLECTION}/${assetId}`;
}

export async function persistCanonicalStarterFleetAssetTransaction(
  firestore: Firestore,
  uid: string,
  nowMs: number,
): Promise<{ ok: true; assetId: string; alreadyCreated: boolean } | { ok: false; reason: string }> {
  if (!isAuthenticatedUid(uid)) return { ok: false, reason: 'UNAUTHENTICATED' };
  const issued = issueCanonicalStarterFleetAsset({ uid, nowMs });
  if (!issued.ok) return issued;
  return firestore.runTransaction(async (transaction) => {
    const ref = firestore.doc(assetPath(uid, issued.asset.assetId));
    const snap = await transaction.get(ref);
    if (snap.exists) {
      const existing = snap.data() as { ownerUid?: string; catalogModelId?: string };
      if (existing.ownerUid !== uid) return { ok: false as const, reason: 'CANONICAL_TRUCK_NOT_OWNED' };
      return { ok: true as const, assetId: issued.asset.assetId, alreadyCreated: true };
    }
    transaction.create(ref, issued.asset);
    return { ok: true as const, assetId: issued.asset.assetId, alreadyCreated: false };
  });
}

export async function persistCanonicalCatalogFleetAssetTransaction(
  firestore: Firestore,
  uid: string,
  catalogModelId: string,
  purchaseId: string,
  nowMs: number,
  assetType?: 'TRUCK' | 'TRAILER',
): Promise<{ ok: true; assetId: string; alreadyCreated: boolean } | { ok: false; reason: string }> {
  if (!isAuthenticatedUid(uid)) return { ok: false, reason: 'UNAUTHENTICATED' };
  const built = buildCanonicalFleetAssetFromCatalogPurchase({
    uid,
    catalogModelId,
    purchaseId,
    nowMs,
    assetType,
  });
  if (!built.ok) return built;
  return firestore.runTransaction(async (transaction) => {
    const ref = firestore.doc(assetPath(uid, built.asset.assetId));
    const snap = await transaction.get(ref);
    if (snap.exists) {
      const existing = snap.data() as { ownerUid?: string; catalogModelId?: string };
      if (existing.ownerUid !== uid) return { ok: false as const, reason: 'CANONICAL_TRUCK_NOT_OWNED' };
      if (existing.catalogModelId !== built.asset.catalogModelId) {
        return { ok: false as const, reason: 'CANONICAL_FLEET_ASSET_CONFLICT' };
      }
      return { ok: true as const, assetId: built.asset.assetId, alreadyCreated: true };
    }
    transaction.create(ref, built.asset);
    return { ok: true as const, assetId: built.asset.assetId, alreadyCreated: false };
  });
}

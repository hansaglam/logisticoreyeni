/**
 * Canonical ROAD fleet assets (Map V2 Step 29J).
 * INTERNAL_TEST fixture bootstrap only. No cash mutation.
 */

import type { Firestore } from 'firebase-admin/firestore';

import {
  CANONICAL_FLEET_ASSETS_COLLECTION,
  buildInternalCanonicalFleetFixtureAssets,
  fleetAssetsConflict,
  isCanonicalRoadInternalFleetBootstrapAllowed,
  isValidCanonicalFleetAssetId,
  type CanonicalFleetAssetDocument,
} from '../../src/domain/canonicalRoadFleet';

export { hasOnlyCanonicalFleetBootstrapKeys } from '../../src/domain/canonicalRoadFleet';

function assetRef(uid: string, assetId: string): string {
  return `users/${uid}/${CANONICAL_FLEET_ASSETS_COLLECTION}/${assetId}`;
}

function isAuthenticatedUid(uid: string): boolean {
  return typeof uid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(uid);
}

export type BootstrapCanonicalFleetResult =
  | {
      ok: true;
      alreadyBootstrapped: boolean;
      assetIds: string[];
    }
  | { ok: false; reason: string };

export async function bootstrapInternalCanonicalFleetFixturesTransaction(
  firestore: Firestore,
  uid: string,
  nowMs: number,
  options?: { envValue?: string | null },
): Promise<BootstrapCanonicalFleetResult> {
  if (!isAuthenticatedUid(uid)) {
    return { ok: false, reason: 'UNAUTHENTICATED' };
  }
  if (!isCanonicalRoadInternalFleetBootstrapAllowed(options)) {
    return { ok: false, reason: 'FLEET_AUTHORITY_NOT_AVAILABLE' };
  }
  const assets = buildInternalCanonicalFleetFixtureAssets(uid, nowMs);
  if (assets.some((asset) => !isValidCanonicalFleetAssetId(asset.assetId))) {
    return { ok: false, reason: 'CANONICAL_TRUCK_ECONOMICS_INVALID' };
  }

  return firestore.runTransaction(async (transaction) => {
    const refs = assets.map((asset) => firestore.doc(assetRef(uid, asset.assetId)));
    const snaps = await Promise.all(refs.map((ref) => transaction.get(ref)));
    let alreadyBootstrapped = true;
    for (let i = 0; i < assets.length; i += 1) {
      const snap = snaps[i]!;
      const next = assets[i]!;
      if (!snap.exists) {
        alreadyBootstrapped = false;
        continue;
      }
      const existing = snap.data() as CanonicalFleetAssetDocument;
      if (existing.ownerUid !== uid) {
        return { ok: false as const, reason: 'CANONICAL_TRUCK_NOT_OWNED' };
      }
      if (fleetAssetsConflict(existing, next)) {
        return { ok: false as const, reason: 'CANONICAL_FLEET_ASSET_CONFLICT' };
      }
    }
    if (alreadyBootstrapped) {
      return {
        ok: true as const,
        alreadyBootstrapped: true,
        assetIds: assets.map((row) => row.assetId),
      };
    }
    for (let i = 0; i < assets.length; i += 1) {
      if (!snaps[i]!.exists) {
        transaction.create(refs[i]!, assets[i]!);
      }
    }
    return {
      ok: true as const,
      alreadyBootstrapped: false,
      assetIds: assets.map((row) => row.assetId),
    };
  });
}

export function canonicalFleetAssetPath(uid: string, assetId: string): string {
  return assetRef(uid, assetId);
}

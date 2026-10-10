/**
 * Server reads of canonical fleet runtime. No client city argument.
 */
import type { Firestore, Transaction } from 'firebase-admin/firestore';

import {
  CANONICAL_FLEET_RUNTIME_COLLECTION,
  isCanonicalFleetRuntimeAllowed,
  validateCanonicalFleetRuntimeState,
  type CanonicalFleetRuntimeState,
} from '../../src/domain/canonicalFleetRuntimeLocation';

export async function readEnabledCanonicalFleetRuntime(
  transaction: Transaction,
  firestore: Firestore,
  uid: string,
  assetId: string,
  envValue: string | null | undefined,
): Promise<
  | { enabled: false }
  | { enabled: true; ok: false; reason: 'FLEET_RUNTIME_LOCATION_UNAVAILABLE' }
  | { enabled: true; ok: true; state: CanonicalFleetRuntimeState; path: string }
> {
  if (!isCanonicalFleetRuntimeAllowed({ envValue })) return { enabled: false };
  const path = `users/${uid}/${CANONICAL_FLEET_RUNTIME_COLLECTION}/${assetId}`;
  const snap = await transaction.get(firestore.doc(path));
  const parsed = validateCanonicalFleetRuntimeState(snap.exists ? snap.data() : null);
  if (!parsed.ok) {
    return { enabled: true, ok: false, reason: 'FLEET_RUNTIME_LOCATION_UNAVAILABLE' };
  }
  return { enabled: true, ok: true, state: parsed.state, path };
}

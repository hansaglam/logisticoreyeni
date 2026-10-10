/**
 * Client wrappers for canonical ROAD contract issuance (Step 29G).
 * Not called from production Contracts UI. Gate default OFF.
 */

import { httpsCallable } from 'firebase/functions';

import {
  CANONICAL_ROAD_CONTRACT_SCHEMA_VERSION,
  resolveCanonicalRoadContractsGate,
} from '../domain/canonicalRoadContract';
import { waitForInitialAuthState } from './authService';
import { withCallableTimeout } from './callableServiceUtils';
import { getFirebaseFunctionsSafe, isFirebaseEnabled } from './firebase';

export const CANONICAL_ROAD_CONTRACT_CALLABLES = {
  getOrIssueCanonicalRoadContracts: 'getOrIssueCanonicalRoadContracts',
} as const;

export type GetOrIssueCanonicalRoadContractsResult =
  | {
      ok: true;
      batchId: string;
      issuedAtMs: number;
      expiresAtMs: number;
      alreadyIssued: boolean;
      contracts: Array<{
        contractId: string;
        originCityId: string;
        destinationCityId: string;
        productId: string;
        cargoAmount: number;
        payment: number;
        deadlineHours: number;
        distanceKm: number;
        tollCost: number;
        requiredLevel: number;
        status: string;
      }>;
    }
  | { ok: false; reason: string };

export async function getOrIssueCanonicalRoadContracts(input?: {
  refreshReason?: string;
}): Promise<GetOrIssueCanonicalRoadContractsResult> {
  if (resolveCanonicalRoadContractsGate() !== 'INTERNAL_TEST') {
    return { ok: false, reason: 'FEATURE_DISABLED' };
  }
  await waitForInitialAuthState();
  if (!isFirebaseEnabled()) {
    return { ok: false, reason: 'firebase-disabled' };
  }
  const functions = getFirebaseFunctionsSafe();
  if (!functions) {
    return { ok: false, reason: 'firebase-disabled' };
  }
  try {
    const call = httpsCallable<
      { canonicalSchemaVersion: number; refreshReason?: string },
      GetOrIssueCanonicalRoadContractsResult
    >(functions, CANONICAL_ROAD_CONTRACT_CALLABLES.getOrIssueCanonicalRoadContracts);
    const payload: { canonicalSchemaVersion: number; refreshReason?: string } = {
      canonicalSchemaVersion: CANONICAL_ROAD_CONTRACT_SCHEMA_VERSION,
    };
    if (input?.refreshReason) payload.refreshReason = input.refreshReason;
    const response = await withCallableTimeout(call(payload));
    const data = response.data;
    if (data && typeof data === 'object' && 'ok' in data) {
      return data;
    }
    return { ok: false, reason: 'malformed-response' };
  } catch {
    return { ok: false, reason: 'service-unavailable' };
  }
}

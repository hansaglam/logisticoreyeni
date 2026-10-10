/**
 * Client wrappers for canonical multimodal callables (Map V2 Step 29C).
 * Request bodies never include playerPayment / railCarrierCost.
 */

import { httpsCallable } from 'firebase/functions';

import { waitForInitialAuthState } from './authService';
import { withCallableTimeout } from './callableServiceUtils';
import {
  getFirebaseFunctionsSafe,
  isFirebaseEnabled,
} from './firebase';

export const CANONICAL_MULTIMODAL_CALLABLES = {
  acceptCanonicalMultimodalShipment: 'acceptCanonicalMultimodalShipment',
  reportCanonicalMultimodalShipmentCompleted: 'reportCanonicalMultimodalShipmentCompleted',
  cancelCanonicalMultimodalShipment: 'cancelCanonicalMultimodalShipment',
} as const;

export type CanonicalMultimodalAcceptRequest = {
  generationSeed: string;
  originCityId: string;
  destinationCityId: string;
  productId: string;
  cargoQuantity: number;
  sourceOfferId: string;
  transportPattern: 'ROAD_RAIL_ROAD';
  playerLevel: number;
  canonicalSchemaVersion: 1;
};

export type CanonicalMultimodalAcceptClientResult =
  | {
      ok: true;
      receipt: {
        shipmentId: string;
        canonicalSchemaVersion: number;
        acceptedAtMs: number;
        sourceOfferId: string;
        playerPayment: number;
        railCarrierCost: number;
        estimatedRoadOperatingCost?: number;
        expectedGrossMargin?: number;
        currency: string;
        policyVersions: {
          railTariffPolicyVersion: string;
          offerEconomicsPolicyVersion: string;
        };
        canonicalRecordVersion: number;
        alreadyAccepted: boolean;
      };
    }
  | { ok: false; reason: string };

function functionsOrNull() {
  if (!isFirebaseEnabled()) return null;
  return getFirebaseFunctionsSafe();
}

export async function acceptCanonicalMultimodalShipment(
  input: CanonicalMultimodalAcceptRequest,
): Promise<CanonicalMultimodalAcceptClientResult> {
  await waitForInitialAuthState();
  const functions = functionsOrNull();
  if (!functions) {
    return { ok: false, reason: 'firebase-disabled' };
  }
  try {
    const call = httpsCallable<CanonicalMultimodalAcceptRequest, CanonicalMultimodalAcceptClientResult>(
      functions,
      CANONICAL_MULTIMODAL_CALLABLES.acceptCanonicalMultimodalShipment,
    );
    const response = await withCallableTimeout(call(input));
    const data = response.data;
    if (data && typeof data === 'object' && 'ok' in data) {
      return data;
    }
    return { ok: false, reason: 'malformed-response' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown';
    if (message.includes('callable-timeout') || message.includes('deadline-exceeded')) {
      return { ok: false, reason: 'timeout' };
    }
    return { ok: false, reason: 'service-unavailable' };
  }
}

export async function reportCanonicalMultimodalShipmentCompleted(input: {
  shipmentId: string;
}): Promise<{ ok: boolean; reason?: string; alreadyReported?: boolean }> {
  await waitForInitialAuthState();
  const functions = functionsOrNull();
  if (!functions) return { ok: false, reason: 'firebase-disabled' };
  try {
    const call = httpsCallable<{ shipmentId: string }, { ok: boolean; reason?: string; alreadyReported?: boolean }>(
      functions,
      CANONICAL_MULTIMODAL_CALLABLES.reportCanonicalMultimodalShipmentCompleted,
    );
    const response = await withCallableTimeout(call({ shipmentId: input.shipmentId }));
    return response.data;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown';
    if (message.includes('callable-timeout')) return { ok: false, reason: 'timeout' };
    return { ok: false, reason: 'service-unavailable' };
  }
}

export async function cancelCanonicalMultimodalShipment(input: {
  shipmentId: string;
}): Promise<{ ok: boolean; reason?: string }> {
  await waitForInitialAuthState();
  const functions = functionsOrNull();
  if (!functions) return { ok: false, reason: 'firebase-disabled' };
  try {
    const call = httpsCallable<{ shipmentId: string }, { ok: boolean; reason?: string }>(
      functions,
      CANONICAL_MULTIMODAL_CALLABLES.cancelCanonicalMultimodalShipment,
    );
    const response = await withCallableTimeout(call({ shipmentId: input.shipmentId }));
    return response.data;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown';
    if (message.includes('callable-timeout')) return { ok: false, reason: 'timeout' };
    return { ok: false, reason: 'service-unavailable' };
  }
}

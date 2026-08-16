/**
 * Temporary Marketplace sell/load probes. DEV-only. Do not use for authorization.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Truck } from '../types/game';
import { getFirebaseAuthSafe } from '../services/firebase';
import { SAVE_STORAGE_KEY } from '../storage/saveGame';

function isDev(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__;
}

export async function peekLocalSaveOwnerUid(): Promise<string | null> {
  try {
    const json = await AsyncStorage.getItem(SAVE_STORAGE_KEY);
    if (!json) return null;
    const parsed = JSON.parse(json) as { ownerUid?: unknown };
    return typeof parsed.ownerUid === 'string' ? parsed.ownerUid : null;
  } catch {
    return null;
  }
}

export async function logMarketplaceSellLocal(truck: Truck): Promise<void> {
  if (!isDev()) return;
  const uid = getFirebaseAuthSafe()?.currentUser?.uid ?? null;
  const saveOwnerUid = await peekLocalSaveOwnerUid();
  console.info('[MARKETPLACE_SELL][LOCAL]', {
    uid,
    saveOwnerUid,
    vehicleId: truck.id,
    name: truck.name,
    modelId: truck.catalogId ?? truck.id,
    ownerUid: null,
    isRental: (truck.ownershipType ?? 'owned') === 'leased',
    status: truck.status,
    marketplaceStatus: truck.status,
  });
}

export function logMarketplaceSellAuthoritativeLookup(input: {
  uid: string | null;
  requestedVehicleId: string;
  availableVehicleIds: string[];
  source: string;
}): void {
  if (!isDev()) return;
  const match = input.availableVehicleIds.includes(input.requestedVehicleId);
  console.info('[MARKETPLACE_SELL][AUTHORITATIVE_LOOKUP]', {
    uid: input.uid,
    requestedVehicleId: input.requestedVehicleId,
    availableVehicleIds: input.availableVehicleIds,
    source: input.source,
  });
  console.info('[MARKETPLACE_SELL][MATCH]', match);
}

export function logMarketplaceLoadError(payload: {
  code: string | null;
  message: string | null;
  callableName?: string;
  field?: string;
  detail?: string;
  backendReason?: string | null;
}): void {
  if (!isDev()) return;
  console.warn('[MARKETPLACE_LOAD_ERROR]', payload);
}

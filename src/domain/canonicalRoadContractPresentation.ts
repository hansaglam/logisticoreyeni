/**
 * Adapter: canonical ROAD contract snapshot → runtime Contract (Step 29G).
 * Does not mutate money. Authority is SERVER_CANONICAL metadata, not HUD cash.
 */

import type { Contract, ProductId } from '../types/game';
import type { CanonicalRoadContractSnapshot } from './canonicalRoadEconomics';

export type RoadContractAuthority = 'LOCAL_LEGACY' | 'SERVER_CANONICAL';

export type CanonicalRoadContractView = {
  authority: RoadContractAuthority;
  contract: Contract;
  sourceCanonicalContractId: string;
};

export function toRuntimeRoadContract(
  snapshot: CanonicalRoadContractSnapshot,
  input?: { createdAtGameHours?: number },
): CanonicalRoadContractView {
  const createdAt = input?.createdAtGameHours ?? 0;
  const contract: Contract = {
    id: snapshot.contractId,
    originCityId: snapshot.originCityId,
    destinationCityId: snapshot.destinationCityId,
    productId: snapshot.productId as ProductId,
    amount: snapshot.amount,
    cargoWeight: snapshot.cargoWeight,
    payment: snapshot.payment,
    deadlineHours: snapshot.deadlineHours,
    distanceKm: snapshot.distanceKm,
    urgency: snapshot.urgency,
    status: 'available',
    createdAt,
    expiresAt: createdAt + snapshot.deadlineHours,
    requiredLevel: snapshot.requiredLevel,
    contractType: 'standard',
    riskLevel: 'low',
  };
  return {
    authority: 'SERVER_CANONICAL',
    contract,
    sourceCanonicalContractId: snapshot.contractId,
  };
}

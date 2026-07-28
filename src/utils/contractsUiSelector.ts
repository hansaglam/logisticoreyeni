/**
 * Shared contracts-list membership logic used by ContractsScreen and debug inspect.
 * Membership = available + dedupe. Does not filter by destination city.
 */

import { dedupeAvailableContracts } from '../simulation/contracts';
import { normalizeCityId } from '../data/networkPositions';
import type { Contract } from '../types/game';

export interface ContractsUiSelectorSnapshot {
  totalStoreContracts: number;
  currentCityId: string | null;
  afterOriginFilter: number;
  afterStatusFilter: number;
  afterUnlockFilter: number;
  afterOtherFilters: number;
  visibleContractIds: string[];
  adanaContractIds: string[];
  matchesForPair: string[];
}

/**
 * Same membership as ContractsScreen available list (status + dedupe).
 * Origin/currentCity is NOT a membership filter — only reported for diagnostics.
 */
export function selectAvailableContractsForUi(contracts: Contract[]): Contract[] {
  return dedupeAvailableContracts(
    (contracts ?? []).filter((contract) => contract.status === 'available'),
  );
}

export function inspectContractsUiSelector(params: {
  contracts: Contract[];
  currentCityId?: string | null;
  originCityId?: string | null;
  destinationCityId?: string | null;
}): ContractsUiSelectorSnapshot {
  const totalStoreContracts = (params.contracts ?? []).length;
  const currentCityId = params.currentCityId
    ? normalizeCityId(params.currentCityId)
    : null;

  const available = (params.contracts ?? []).filter((c) => c.status === 'available');
  const afterStatusFilter = available.length;

  // UI does not filter by origin; report how many match current city for diagnostics.
  const afterOriginFilter = currentCityId
    ? available.filter((c) => normalizeCityId(c.originCityId) === currentCityId).length
    : afterStatusFilter;

  const visible = selectAvailableContractsForUi(params.contracts);
  const afterOtherFilters = visible.length;
  const afterUnlockFilter = afterOtherFilters;

  const adanaContractIds = visible
    .filter((c) => normalizeCityId(c.destinationCityId) === 'adana')
    .map((c) => c.id);

  const origin = params.originCityId ? normalizeCityId(params.originCityId) : null;
  const destination = params.destinationCityId
    ? normalizeCityId(params.destinationCityId)
    : null;

  const matchesForPair =
    origin && destination
      ? visible
          .filter(
            (c) =>
              normalizeCityId(c.originCityId) === origin &&
              normalizeCityId(c.destinationCityId) === destination,
          )
          .map((c) => c.id)
      : [];

  return {
    totalStoreContracts,
    currentCityId,
    afterOriginFilter,
    afterStatusFilter,
    afterUnlockFilter,
    afterOtherFilters,
    visibleContractIds: visible.map((c) => c.id),
    adanaContractIds,
    matchesForPair,
  };
}

export function logContractsUiSelector(snapshot: ContractsUiSelectorSnapshot): void {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.log('[contracts-ui-selector]', snapshot);
  }
}

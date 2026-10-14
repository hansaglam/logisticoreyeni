/**
 * Session-only fleet map UI. Not written to the player save.
 * Account reset clears it through clearMapFleetSession.
 */
import { useSyncExternalStore } from 'react';

export type FleetMapFilter = 'all' | 'available' | 'enroute' | 'problem';

export type MapFleetSessionSnapshot = {
  selectedTruckId: string | null;
  clusterCityId: string | null;
  filter: FleetMapFilter;
  selectionNonce: number;
};

const listeners = new Set<() => void>();

let snapshot: MapFleetSessionSnapshot = {
  selectedTruckId: null,
  clusterCityId: null,
  filter: 'all',
  selectionNonce: 0,
};

function emit(next: MapFleetSessionSnapshot): void {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): MapFleetSessionSnapshot {
  return snapshot;
}

export function readMapFleetSession(): MapFleetSessionSnapshot {
  return snapshot;
}

export function useMapFleetSession(): MapFleetSessionSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function selectMapFleetTruck(truckId: string): void {
  emit({
    ...snapshot,
    selectedTruckId: truckId,
    clusterCityId: null,
    selectionNonce: snapshot.selectionNonce + 1,
  });
}

export function selectMapFleetCluster(cityId: string | null): void {
  emit({
    ...snapshot,
    selectedTruckId: null,
    clusterCityId: cityId,
    selectionNonce: snapshot.selectionNonce + 1,
  });
}

export function openMapFleetSummary(): void {
  emit({
    ...snapshot,
    selectedTruckId: null,
    clusterCityId: null,
    selectionNonce: snapshot.selectionNonce + 1,
  });
}

/** Clears the selected truck and cluster. Keeps the filter. */
export function clearMapFleetVehicleContext(): void {
  if (snapshot.selectedTruckId == null && snapshot.clusterCityId == null) return;
  emit({
    ...snapshot,
    selectedTruckId: null,
    clusterCityId: null,
  });
}

export function setMapFleetFilter(filter: FleetMapFilter): void {
  if (snapshot.filter === filter) return;
  emit({ ...snapshot, filter });
}

/** Account and save reset. Drops the previous player's truck selection. */
export function clearMapFleetSession(): void {
  emit({
    selectedTruckId: null,
    clusterCityId: null,
    filter: 'all',
    selectionNonce: 0,
  });
}

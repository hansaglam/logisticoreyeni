/**
 * Attached-trailer lookup — tiny module to avoid circular import issues
 * with capacity.ts / delivery.ts / fleet UI.
 */

import type { Trailer } from '../types/game';

/**
 * Single source of truth for attached trailer lookup (fleet UI + validation).
 * Prefer attached/in_use status; fall back to attachedTruckId link (UI parity).
 */
export function getAttachedTrailerForTruck(
  truckId: string | undefined,
  trailers: Trailer[] | undefined,
): Trailer | undefined {
  if (!truckId) {
    return undefined;
  }
  const list = trailers ?? [];
  return (
    list.find(
      (trailer) =>
        trailer.attachedTruckId === truckId &&
        (trailer.status === 'attached' || trailer.status === 'in_use'),
    ) ?? list.find((trailer) => trailer.attachedTruckId === truckId)
  );
}

import type { StoreGameState } from '../../types/game';

export function selectHasPendingDeliveryIncident(state: StoreGameState): boolean {
  const deliveries = state.activeDeliveries;
  if (!Array.isArray(deliveries) || deliveries.length === 0) {
    return false;
  }
  return deliveries.some(
    (delivery) =>
      delivery.incident?.status === 'pending' && delivery.incidentResolved !== true,
  );
}

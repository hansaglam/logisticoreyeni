import type { TruckStatus } from '../../types/game';

export type TruckStatusSemantic =
  | 'available'
  | 'on_route'
  | 'maintenance'
  | 'out_of_fuel'
  | 'transferring'
  | 'marketplace_locked';

export type TruckStatusPresentation = {
  label: string;
  semanticState: TruckStatusSemantic;
  accessibilityLabel: string;
};

const PRESENTATION: Record<TruckStatus, TruckStatusPresentation> = {
  idle: { label: 'Müsait', semanticState: 'available', accessibilityLabel: 'Müsait' },
  on_route: { label: 'Yolda', semanticState: 'on_route', accessibilityLabel: 'Yolda' },
  maintenance: { label: 'Bakımda', semanticState: 'maintenance', accessibilityLabel: 'Bakımda' },
  out_of_fuel: { label: 'Yakıt yok', semanticState: 'out_of_fuel', accessibilityLabel: 'Yakıt yok' },
  transferring: { label: 'Transferde', semanticState: 'transferring', accessibilityLabel: 'Transferde' },
  marketplace_locked: {
    label: 'Pazarda kilitli',
    semanticState: 'marketplace_locked',
    accessibilityLabel: 'Pazarda kilitli',
  },
};

/** One status label for the map. Callers do not switch on truck status in JSX. */
export function resolveTruckStatusPresentation(status: TruckStatus): TruckStatusPresentation {
  return PRESENTATION[status] ?? PRESENTATION.idle;
}

/**
 * Remaining time already stored on the delivery or transfer.
 * This subtracts the current game clock from that stored arrival.
 * It does not derive a new ETA from distance or speed.
 */
export function formatStoredArrivalRemaining(currentTime: number, storedArrival: number | null | undefined): string | null {
  if (storedArrival == null || !Number.isFinite(storedArrival) || !Number.isFinite(currentTime)) return null;
  const remaining = Math.max(0, storedArrival - currentTime);
  const hrs = Math.floor(remaining);
  const mins = Math.round((remaining - hrs) * 60);
  if (hrs > 0) return `${hrs}s ${mins}dk`;
  return `${mins}dk`;
}

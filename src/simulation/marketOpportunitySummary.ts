import type { GlobalEconomySnapshot } from '../types/game';

/** Üst kart ve Dünya Durumu için tek canonical fırsat sayısı. */
export function selectActiveMarketOpportunityCount(
  snapshot: GlobalEconomySnapshot | null | undefined,
): number {
  if (!snapshot) return 0;
  if (
    typeof snapshot.globalOpportunityCount === 'number' &&
    Number.isFinite(snapshot.globalOpportunityCount)
  ) {
    return Math.max(0, Math.floor(snapshot.globalOpportunityCount));
  }
  return Array.isArray(snapshot.opportunities) ? snapshot.opportunities.length : 0;
}

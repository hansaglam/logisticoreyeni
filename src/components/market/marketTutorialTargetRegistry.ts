import type { TutorialLayoutRect } from '../../tutorial/types';

export type MarketTutorialTargetId =
  | 'city-chips'
  | 'stock-badge'
  | 'price-trend'
  | 'buy-button'
  | 'warehouse-transfer'
  | 'profit-summary'
  | 'refresh-button'
  | 'products-section';

type MeasureFn = () => Promise<TutorialLayoutRect | null>;
type ScrollIntoViewFn = () => Promise<void>;

interface MarketTutorialTargetEntry {
  measure: MeasureFn;
  scrollIntoView?: ScrollIntoViewFn;
}

const targets = new Map<MarketTutorialTargetId, MarketTutorialTargetEntry>();

export function registerMarketTutorialTarget(
  id: MarketTutorialTargetId,
  entry: MarketTutorialTargetEntry,
): () => void {
  targets.set(id, entry);
  return () => {
    const current = targets.get(id);
    if (current === entry) {
      targets.delete(id);
    }
  };
}

export async function measureMarketTutorialTarget(
  id: MarketTutorialTargetId,
): Promise<TutorialLayoutRect | null> {
  const entry = targets.get(id);
  if (!entry) {
    return null;
  }
  return entry.measure();
}

export async function scrollMarketTutorialTargetIntoView(
  id: MarketTutorialTargetId,
): Promise<void> {
  const entry = targets.get(id);
  if (!entry?.scrollIntoView) {
    return;
  }
  await entry.scrollIntoView();
}

export function hasMarketTutorialTarget(id: MarketTutorialTargetId): boolean {
  return targets.has(id);
}

export function clearMarketTutorialTargets(): void {
  targets.clear();
}

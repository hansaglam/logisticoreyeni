import type { TutorialLayoutRect } from '../../tutorial/types';
import {
  clearAppTutorialTargets,
  hasAppTutorialTarget,
  measureAppTutorialTarget,
  registerAppTutorialTarget,
  scrollAppTutorialTargetIntoView,
} from '../../tutorial/app/targetRegistry';

export type MarketTutorialTargetId =
  | 'city-chips'
  | 'stock-badge'
  | 'price-trend'
  | 'buy-button'
  | 'warehouse-transfer'
  | 'profit-summary'
  | 'refresh-button'
  | 'products-section';

const MARKET_TUTORIAL_ID = 'market' as const;

type MarketTutorialTargetEntry = {
  measure: () => Promise<TutorialLayoutRect | null>;
  scrollIntoView?: () => Promise<void>;
};

export function registerMarketTutorialTarget(
  id: MarketTutorialTargetId,
  entry: MarketTutorialTargetEntry,
): () => void {
  return registerAppTutorialTarget(MARKET_TUTORIAL_ID, id, entry);
}

export async function measureMarketTutorialTarget(
  id: MarketTutorialTargetId,
): Promise<TutorialLayoutRect | null> {
  return measureAppTutorialTarget(MARKET_TUTORIAL_ID, id);
}

export async function scrollMarketTutorialTargetIntoView(
  id: MarketTutorialTargetId,
): Promise<void> {
  return scrollAppTutorialTargetIntoView(MARKET_TUTORIAL_ID, id);
}

export function hasMarketTutorialTarget(id: MarketTutorialTargetId): boolean {
  return hasAppTutorialTarget(MARKET_TUTORIAL_ID, id);
}

export function clearMarketTutorialTargets(): void {
  clearAppTutorialTargets(MARKET_TUTORIAL_ID);
}

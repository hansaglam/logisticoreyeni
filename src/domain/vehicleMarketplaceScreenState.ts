import type { MarketplaceErrorKind } from './marketplaceErrorModel';
import type { VehicleMarketplaceListing } from '../types/vehicleMarketplace';

export type MarketplaceScreenState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; listings: VehicleMarketplaceListing[] }
  | { status: 'empty' }
  | { status: 'error'; error: MarketplaceErrorKind }
  | { status: 'refreshing'; listings: VehicleMarketplaceListing[] };

export function marketplaceStateFromListings(
  listings: VehicleMarketplaceListing[],
): Extract<MarketplaceScreenState, { status: 'ready' } | { status: 'empty' }> {
  return listings.length > 0
    ? { status: 'ready', listings }
    : { status: 'empty' };
}

export function beginMarketplaceRefresh(
  current: MarketplaceScreenState,
): MarketplaceScreenState {
  if (current.status === 'ready' || current.status === 'refreshing') {
    return { status: 'refreshing', listings: current.listings };
  }
  if (current.status === 'empty') {
    return { status: 'loading' };
  }
  return { status: 'loading' };
}

export function applyMarketplaceFetchSuccess(
  listings: VehicleMarketplaceListing[],
): MarketplaceScreenState {
  return marketplaceStateFromListings(listings);
}

export function applyMarketplaceFetchError(
  error: MarketplaceErrorKind,
): MarketplaceScreenState {
  return { status: 'error', error };
}

export function isMarketplaceListVisible(state: MarketplaceScreenState): boolean {
  return state.status === 'ready' || state.status === 'refreshing' || state.status === 'empty';
}

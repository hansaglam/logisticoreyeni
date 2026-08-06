import type { QuickAccessAction } from './quickAccessTypes';
import type { TabKey } from './tabTypes';

export type ManagementModule = 'Fleet' | 'Store' | 'Warehouses' | 'Finance' | 'Missions' | 'Account';

export type PendingMoreSubRoute =
  | 'menu'
  | 'account'
  | 'finance'
  | 'warehouse'
  | 'debug'
  | 'missions'
  | 'leaderboard'
  | 'upgrades';

export type ManagementNavigationTarget = {
  tab: TabKey;
  moreSubRoute?: PendingMoreSubRoute | null;
};

export const CANONICAL_ACCOUNT_TAB: TabKey = 'more';
export const CANONICAL_ACCOUNT_MORE_ROUTE: PendingMoreSubRoute = 'account';

export const MANAGEMENT_MODULE_ROUTES: Record<ManagementModule, ManagementNavigationTarget> = {
  Fleet: { tab: 'fleet' },
  Store: { tab: 'shop' },
  Warehouses: { tab: 'more', moreSubRoute: 'warehouse' },
  Finance: { tab: 'more', moreSubRoute: 'finance' },
  Missions: { tab: 'more', moreSubRoute: 'missions' },
  Account: { tab: CANONICAL_ACCOUNT_TAB, moreSubRoute: CANONICAL_ACCOUNT_MORE_ROUTE },
};

export const QUICK_ACCESS_TO_MANAGEMENT_MODULE: Partial<
  Record<QuickAccessAction, ManagementModule>
> = {
  fleet: 'Fleet',
  shop: 'Store',
  warehouse: 'Warehouses',
  finance: 'Finance',
  missions: 'Missions',
  account: 'Account',
};

export function getManagementNavigationTarget(
  module: ManagementModule,
): ManagementNavigationTarget {
  return MANAGEMENT_MODULE_ROUTES[module];
}

export function resolveManagementModule(
  action: QuickAccessAction,
): ManagementModule | null {
  return QUICK_ACCESS_TO_MANAGEMENT_MODULE[action] ?? null;
}

export function resolveMoreScreenRoute(
  pending: PendingMoreSubRoute | null | undefined,
): Exclude<PendingMoreSubRoute, 'account'> | null {
  if (!pending) {
    return null;
  }
  if (pending === 'account' || pending === 'menu') {
    return 'menu';
  }
  return pending;
}

export function shouldFocusAccountSection(
  pending: PendingMoreSubRoute | null | undefined,
): boolean {
  return pending === 'account';
}

/**
 * In-memory hold so cold-start cloud upload cannot run before
 * post-startup marketplace reconcile patches local state.
 */

let startupMarketplaceCloudHold = false;

export function beginPostStartupMarketplaceCloudHold(): void {
  startupMarketplaceCloudHold = true;
}

export function endPostStartupMarketplaceCloudHold(): void {
  startupMarketplaceCloudHold = false;
}

export function isPostStartupMarketplaceCloudHoldActive(): boolean {
  return startupMarketplaceCloudHold;
}

export function __resetPostStartupMarketplaceCloudHoldForTests(): void {
  startupMarketplaceCloudHold = false;
}

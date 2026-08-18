/**
 * Lightweight lock so cloud save / test money sync can skip writes
 * while a marketplace mutation is in flight — no service imports.
 */

let marketplaceOperationCount = 0;

export function isVehicleMarketplaceOperationActive(): boolean {
  return marketplaceOperationCount > 0;
}

export function beginVehicleMarketplaceOperation(): void {
  marketplaceOperationCount += 1;
}

export function endVehicleMarketplaceOperation(): void {
  marketplaceOperationCount = Math.max(0, marketplaceOperationCount - 1);
}

export async function withVehicleMarketplaceOperationLock<T>(
  work: () => Promise<T>,
): Promise<T> {
  beginVehicleMarketplaceOperation();
  try {
    return await work();
  } finally {
    endVehicleMarketplaceOperation();
  }
}

export function __resetMarketplaceOperationLockForTests(): void {
  marketplaceOperationCount = 0;
}

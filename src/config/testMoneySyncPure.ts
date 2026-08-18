/**
 * Pure helpers for TEST-ONLY remote money validation (no RN/Expo imports).
 */

export function parseRemoteTestMoney(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return value;
}

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-9;
}

/**
 * Keep a just-injected console cash override when marketplace reconcile
 * would snap HUD cash back to stale canonicalCash.
 *
 * After a real purchase local cash no longer equals the accepted override,
 * so authoritative server cash still wins.
 */
export function resolveCashAfterMarketplaceReconcile(input: {
  localCash: number;
  authoritativeCash: number | undefined;
  acceptedTestRemoteMoney: number | null;
  testMoneySyncEnabled: boolean;
}): number {
  const next = input.authoritativeCash ?? input.localCash;
  if (
    input.testMoneySyncEnabled &&
    input.acceptedTestRemoteMoney != null &&
    nearlyEqual(input.localCash, input.acceptedTestRemoteMoney) &&
    next + 1e-9 < input.acceptedTestRemoteMoney
  ) {
    return input.localCash;
  }
  return next;
}

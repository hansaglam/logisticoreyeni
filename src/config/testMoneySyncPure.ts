/**
 * Pure helpers for TEST-ONLY remote money validation (no RN/Expo imports).
 */

export function parseRemoteTestMoney(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return value;
}

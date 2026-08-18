/**
 * Isolated join/timeout helpers for the cloud-save mutex.
 * Joiners must not leave a hung promise as the only future sync path.
 */

export const CLOUD_SAVE_JOIN_TIMEOUT_MS = 12_000;

export async function joinCloudSaveInFlight(
  inFlight: Promise<boolean>,
  timeoutMs = CLOUD_SAVE_JOIN_TIMEOUT_MS,
): Promise<{ timedOut: boolean; value: boolean }> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  try {
    const value = await Promise.race([
      inFlight,
      new Promise<boolean>((resolve) => {
        timeoutId = setTimeout(() => {
          timedOut = true;
          resolve(false);
        }, timeoutMs);
      }),
    ]);
    return { timedOut, value };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export function abandonHungCloudSaveInFlight<T>(
  current: T | null,
  hung: T,
): T | null {
  return current === hung ? null : current;
}

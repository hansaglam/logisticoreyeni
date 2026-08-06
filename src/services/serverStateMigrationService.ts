import { httpsCallable } from 'firebase/functions';

import {
  getAuthUidSnapshot,
  isAuthContextStale,
  withCallableTimeout,
} from './callableServiceUtils';
import { isAuthSessionReady, waitForInitialAuthState } from './authService';
import { FIREBASE_FUNCTIONS_REGION, getFirebaseFunctionsSafe } from './firebase';

const MIGRATE_CALLABLE = 'migrateLegacyServerState';

export async function ensureServerStateMigrated(): Promise<{
  ok: boolean;
  reason?: string;
}> {
  if (!isAuthSessionReady()) {
    await waitForInitialAuthState();
  }
  const functions = getFirebaseFunctionsSafe(FIREBASE_FUNCTIONS_REGION);
  if (!functions) {
    return { ok: false, reason: 'firebase-disabled' };
  }
  const uidAtStart = getAuthUidSnapshot();
  const action = httpsCallable<{ dryRun?: boolean }, {
    ok: boolean;
    reason?: string;
  }>(functions, MIGRATE_CALLABLE);
  try {
    const response = await withCallableTimeout(action({ dryRun: false }));
    if (isAuthContextStale(uidAtStart)) {
      return { ok: false, reason: 'auth-required' };
    }
    const data = response.data;
    if (data.ok) {
      return { ok: true };
    }
    if (data.reason === 'migration-already-completed') {
      return { ok: true };
    }
    return { ok: false, reason: data.reason ?? 'service-unavailable' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'migration-failed';
    if (message.includes('not-found')) {
      return { ok: true };
    }
    return { ok: false, reason: message };
  }
}

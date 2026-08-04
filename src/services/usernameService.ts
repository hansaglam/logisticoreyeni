/**
 * Backend-authoritative username callables.
 */

import { httpsCallable } from 'firebase/functions';

import {
  validateUsernameFormat,
  type UsernameClientReason,
} from '../domain/usernameValidation';
import { getFirebaseFunctionsSafe } from './firebase';

const CALLABLES = {
  setUsername: 'setUsername',
  checkUsernameAvailability: 'checkUsernameAvailability',
  getUsernameProfile: 'getUsernameProfile',
} as const;

export type UsernameProfile = {
  username: string | null;
  usernameSetupCompleted: boolean;
  usernameChangeCount: number;
  usernameUpdatedAtMs: number | null;
  suggestedUsername: string;
  nextChangeAvailableAtMs: number | null;
};

export type SetUsernameClientResult =
  | {
      ok: true;
      username: string;
      usernameNormalized: string;
      setupCompleted: boolean;
      changeCount: number;
      nextChangeAvailableAtMs: number | null;
    }
  | { ok: false; reason: UsernameClientReason; nextChangeAvailableAtMs?: number | null };

export type CheckUsernameClientResult =
  | {
      ok: true;
      available: boolean;
      usernameNormalized: string;
      reason?: UsernameClientReason;
    }
  | { ok: false; reason: UsernameClientReason };

function mapReason(raw: unknown): UsernameClientReason {
  if (typeof raw === 'string' && raw.length > 0) {
    return raw as UsernameClientReason;
  }
  return 'service-unavailable';
}

export async function fetchUsernameProfile(): Promise<
  | { ok: true; profile: UsernameProfile }
  | { ok: false; reason: UsernameClientReason }
> {
  const functions = getFirebaseFunctionsSafe();
  if (!functions) {
    return { ok: false, reason: 'service-unavailable' };
  }
  try {
    const callable = httpsCallable(functions, CALLABLES.getUsernameProfile);
    const response = await callable({});
    const data = response.data as Record<string, unknown>;
    if (data?.ok !== true) {
      return { ok: false, reason: mapReason(data?.reason) };
    }
    return {
      ok: true,
      profile: {
        username: typeof data.username === 'string' ? data.username : null,
        usernameSetupCompleted: data.usernameSetupCompleted === true,
        usernameChangeCount: Math.max(0, Math.floor(Number(data.usernameChangeCount) || 0)),
        usernameUpdatedAtMs:
          typeof data.usernameUpdatedAtMs === 'number' ? data.usernameUpdatedAtMs : null,
        suggestedUsername:
          typeof data.suggestedUsername === 'string' ? data.suggestedUsername : '',
        nextChangeAvailableAtMs:
          typeof data.nextChangeAvailableAtMs === 'number'
            ? data.nextChangeAvailableAtMs
            : null,
      },
    };
  } catch {
    return { ok: false, reason: 'service-unavailable' };
  }
}

export async function checkUsernameAvailability(
  username: string,
): Promise<CheckUsernameClientResult> {
  const local = validateUsernameFormat(username);
  if (!local.ok) {
    return {
      ok: true,
      available: false,
      usernameNormalized: '',
      reason: local.reason,
    };
  }
  const functions = getFirebaseFunctionsSafe();
  if (!functions) {
    return { ok: false, reason: 'service-unavailable' };
  }
  try {
    const callable = httpsCallable(functions, CALLABLES.checkUsernameAvailability);
    const response = await callable({ username: local.username });
    const data = response.data as Record<string, unknown>;
    if (data?.ok !== true) {
      return { ok: false, reason: mapReason(data?.reason) };
    }
    return {
      ok: true,
      available: data.available === true,
      usernameNormalized:
        typeof data.usernameNormalized === 'string'
          ? data.usernameNormalized
          : local.usernameNormalized,
      reason: data.reason ? mapReason(data.reason) : undefined,
    };
  } catch {
    return { ok: false, reason: 'service-unavailable' };
  }
}

export async function setUsername(username: string): Promise<SetUsernameClientResult> {
  const local = validateUsernameFormat(username);
  if (!local.ok) {
    return { ok: false, reason: local.reason };
  }
  const functions = getFirebaseFunctionsSafe();
  if (!functions) {
    return { ok: false, reason: 'service-unavailable' };
  }
  try {
    const callable = httpsCallable(functions, CALLABLES.setUsername);
    const response = await callable({ username: local.username });
    const data = response.data as Record<string, unknown>;
    if (data?.ok !== true) {
      return {
        ok: false,
        reason: mapReason(data?.reason),
        nextChangeAvailableAtMs:
          typeof data?.nextChangeAvailableAtMs === 'number'
            ? data.nextChangeAvailableAtMs
            : null,
      };
    }
    return {
      ok: true,
      username: String(data.username ?? local.username),
      usernameNormalized: String(data.usernameNormalized ?? local.usernameNormalized),
      setupCompleted: data.setupCompleted === true,
      changeCount: Math.max(0, Math.floor(Number(data.changeCount) || 0)),
      nextChangeAvailableAtMs:
        typeof data.nextChangeAvailableAtMs === 'number'
          ? data.nextChangeAvailableAtMs
          : null,
    };
  } catch {
    return { ok: false, reason: 'service-unavailable' };
  }
}

import type { CloudSaveConflictReason } from '../utils/cloudSaveConflict';
import { isRetryableCloudSaveConflictReason } from '../utils/cloudSaveConflict';
import { setCloudSaveAccountConflictPending } from './cloudSaveConflictState';

export type AccountSaveConflictChoice = 'cloud' | 'local';

export type AccountSaveConflictStatus =
  | 'active'
  | 'resolving'
  | 'resolved'
  | 'invalid';

export type AccountSaveConflictSession = {
  conflictId: string;
  provider: 'google' | 'apple';
  authenticatedUid: string;
  createdAtMs: number;
  status: AccountSaveConflictStatus;
  fromAccountSwitch: boolean;
  requestToken: number;
  lastErrorCode?: CloudSaveConflictReason;
  lastErrorRetryable?: boolean;
};

export type AccountConflictResolveStage =
  | 'press'
  | 'sign-in'
  | 'cloud-meta-fetch'
  | 'cloud-body-fetch'
  | 'owner-check'
  | 'checksum-check'
  | 'migration'
  | 'restore'
  | 'finalize'
  | 'success'
  | 'error';

let session: AccountSaveConflictSession | null = null;
let nextRequestToken = 0;

function createConflictId(): string {
  nextRequestToken += 1;
  return `account-save-conflict:${Date.now()}:${nextRequestToken}`;
}

export function beginAccountSaveConflictSession(input: {
  provider: 'google' | 'apple';
  authenticatedUid: string;
  fromAccountSwitch?: boolean;
}): AccountSaveConflictSession {
  session = {
    conflictId: createConflictId(),
    provider: input.provider,
    authenticatedUid: input.authenticatedUid,
    createdAtMs: Date.now(),
    status: 'active',
    fromAccountSwitch: input.fromAccountSwitch === true,
    requestToken: 0,
  };
  setCloudSaveAccountConflictPending(true);
  return session;
}

export function getAccountSaveConflictSession(): AccountSaveConflictSession | null {
  return session;
}

export function ensureAccountSaveConflictSession(input: {
  provider: 'google' | 'apple';
  authenticatedUid: string;
  fromAccountSwitch?: boolean;
}): AccountSaveConflictSession {
  if (
    session &&
    session.status !== 'invalid' &&
    session.status !== 'resolved' &&
    session.provider === input.provider &&
    session.authenticatedUid === input.authenticatedUid
  ) {
    return session;
  }
  return beginAccountSaveConflictSession(input);
}

export function setAccountSaveConflictError(
  errorCode: CloudSaveConflictReason,
): void {
  if (!session) {
    return;
  }
  session = {
    ...session,
    lastErrorCode: errorCode,
    lastErrorRetryable: isRetryableCloudSaveConflictReason(errorCode),
    status: isRetryableCloudSaveConflictReason(errorCode) ? 'active' : 'invalid',
  };
}

export function beginConflictResolveRequest(
  conflictId: string,
): { ok: true; token: number; session: AccountSaveConflictSession } | { ok: false } {
  if (!session || session.conflictId !== conflictId) {
    return { ok: false };
  }
  if (session.status === 'resolving') {
    return { ok: false };
  }
  if (session.status === 'resolved' || session.status === 'invalid') {
    return { ok: false };
  }
  session = {
    ...session,
    status: 'resolving',
    requestToken: session.requestToken + 1,
  };
  setCloudSaveAccountConflictPending(true);
  return { ok: true, token: session.requestToken, session };
}

export function isConflictResolveRequestCurrent(token: number): boolean {
  return session != null && session.requestToken === token && session.status === 'resolving';
}

export function releaseConflictResolveRequest(token: number): void {
  if (!session || session.requestToken !== token) {
    return;
  }
  if (session.status === 'resolving') {
    session = {
      ...session,
      status: session.lastErrorCode && !session.lastErrorRetryable ? 'invalid' : 'active',
    };
  }
  setCloudSaveAccountConflictPending(true);
}

export function completeAccountSaveConflictSession(token?: number): void {
  if (token != null && session && session.requestToken !== token) {
    return;
  }
  if (session) {
    session = {
      ...session,
      status: 'resolved',
    };
  }
  setCloudSaveAccountConflictPending(false);
}

export function clearAccountSaveConflictSession(): void {
  session = null;
  setCloudSaveAccountConflictPending(false);
}

export function resetAccountSaveConflictGuards(): void {
  session = null;
}

export function logAccountConflictResolve(entry: {
  stage: AccountConflictResolveStage | string;
  conflictId?: string;
  provider?: 'google' | 'apple';
  authUidPresent?: boolean;
  localOwnerUidPresent?: boolean;
  cloudOwnerUidPresent?: boolean;
  cloudMetaPresent?: boolean;
  cloudBodyPresent?: boolean;
  cloudSavePresent?: boolean;
  ownerUidPresent?: boolean;
  ownerMatches?: boolean;
  checksumValid?: boolean;
  saveVersion?: number;
  selectedSource?: AccountSaveConflictChoice;
  candidateIdPresent?: boolean;
  candidateStillValid?: boolean;
  retryable?: boolean;
  errorCode?: string;
}): void {
  const payload = {
    ...entry,
    conflictId: entry.conflictId ?? session?.conflictId,
    provider: entry.provider ?? session?.provider,
  };
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    if (entry.stage === 'error' || entry.stage === 'success') {
      console.info('[account-conflict-resolve]', payload);
    }
    return;
  }
  console.info('[account-conflict-resolve]', payload);
}

import type { AuthCredential } from 'firebase/auth';

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
  credential: AuthCredential;
  createdAtMs: number;
  status: AccountSaveConflictStatus;
  fromAccountSwitch: boolean;
  requestToken: number;
};

let session: AccountSaveConflictSession | null = null;
let nextRequestToken = 0;

function createConflictId(): string {
  nextRequestToken += 1;
  return `account-save-conflict:${Date.now()}:${nextRequestToken}`;
}

export function beginAccountSaveConflictSession(input: {
  provider: 'google' | 'apple';
  credential: AuthCredential;
  fromAccountSwitch?: boolean;
}): AccountSaveConflictSession {
  session = {
    conflictId: createConflictId(),
    provider: input.provider,
    credential: input.credential,
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
  credential: AuthCredential;
  fromAccountSwitch?: boolean;
}): AccountSaveConflictSession {
  if (
    session &&
    session.status !== 'invalid' &&
    session.status !== 'resolved' &&
    session.provider === input.provider &&
    session.credential === input.credential
  ) {
    return session;
  }
  return beginAccountSaveConflictSession(input);
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
      status: 'active',
    };
  }
  setCloudSaveAccountConflictPending(true);
}

export function completeAccountSaveConflictSession(token?: number): void {
  if (token != null && session && session.requestToken !== token) {
    return;
  }
  session = session
    ? {
        ...session,
        status: 'resolved',
      }
    : null;
  setCloudSaveAccountConflictPending(false);
}

export function clearAccountSaveConflictSession(): void {
  session = null;
  setCloudSaveAccountConflictPending(false);
}

export function logAccountConflictResolve(entry: {
  stage: string;
  authUidPresent?: boolean;
  localOwnerUidPresent?: boolean;
  cloudOwnerUidPresent?: boolean;
  cloudMetaPresent?: boolean;
  cloudSavePresent?: boolean;
  selectedSource?: AccountSaveConflictChoice;
  candidateIdPresent?: boolean;
  candidateStillValid?: boolean;
  checksumValid?: boolean;
  saveVersion?: number;
  errorCode?: string;
}): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    return;
  }
  console.info('[account-conflict-resolve]', entry);
}

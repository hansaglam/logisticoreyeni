/**
 * Structured account lifecycle logs (dev + production-safe diagnostics).
 */

import { Platform } from 'react-native';

export const ACCOUNT_DELETE_STAGE = {
  STARTED: 'ACCOUNT_DELETE_STAGE_STARTED',
  APPLE_REVOKE: 'ACCOUNT_DELETE_STAGE_APPLE_REVOKE',
  MARKETPLACE: 'ACCOUNT_DELETE_STAGE_MARKETPLACE',
  USERNAME: 'ACCOUNT_DELETE_STAGE_USERNAME',
  LEADERBOARD: 'ACCOUNT_DELETE_STAGE_LEADERBOARD',
  RECURSIVE_DATA: 'ACCOUNT_DELETE_STAGE_RECURSIVE_DATA',
  FIREBASE_AUTH: 'ACCOUNT_DELETE_STAGE_FIREBASE_AUTH',
  LOCAL_RESET: 'ACCOUNT_DELETE_STAGE_LOCAL_RESET',
  COMPLETED: 'ACCOUNT_DELETE_STAGE_COMPLETED',
} as const;

export type AccountDeleteStageName =
  (typeof ACCOUNT_DELETE_STAGE)[keyof typeof ACCOUNT_DELETE_STAGE];

export type AccountSignOutLog = {
  stage: string;
  authUidPresent: boolean;
  linked: boolean;
  syncResult?: 'synced' | 'skipped' | 'failed';
  success?: boolean;
  errorCode?: string;
};

export type AccountDeleteLog = {
  stage: AccountDeleteStageName | string;
  authUidPresent: boolean;
  provider?: string;
  platform?: string;
  reauthRequired?: boolean;
  skipCloudDelete?: boolean;
  profileDeleted?: boolean;
  saveDeleted?: boolean;
  usernameReleased?: boolean;
  leaderboardDeleted?: boolean;
  marketplaceCleaned?: boolean;
  authDeleted?: boolean;
  authDeletedByServer?: boolean;
  localCleanupDone?: boolean;
  success?: boolean;
  errorCode?: string;
  diagnosticId?: string;
  timestamp?: string;
};

function productionSafeDeletePayload(
  payload: AccountDeleteLog,
): Record<string, unknown> {
  return {
    stage: payload.stage,
    diagnosticId: payload.diagnosticId,
    provider: payload.provider,
    platform: payload.platform,
    success: payload.success,
    errorCode: payload.errorCode,
    reauthRequired: payload.reauthRequired,
    skipCloudDelete: payload.skipCloudDelete,
    authDeletedByServer: payload.authDeletedByServer,
    timestamp: payload.timestamp,
  };
}

export function logAccountSignOut(payload: AccountSignOutLog): void {
  if (!__DEV__) return;
  // eslint-disable-next-line no-console
  console.info('[account-signout]', payload);
}

export function logAccountDelete(payload: AccountDeleteLog): void {
  const entry: AccountDeleteLog = {
    ...payload,
    platform: payload.platform ?? Platform.OS,
    timestamp: payload.timestamp ?? new Date().toISOString(),
  };
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.info('[account-delete]', entry);
    return;
  }
  // eslint-disable-next-line no-console
  console.info('[account-delete]', productionSafeDeletePayload(entry));
}

export function createAccountDeleteDiagnosticId(): string {
  return `del-${Date.now().toString(36)}`;
}

/**
 * Structured account lifecycle logs (dev/internal only).
 */

export type AccountSignOutLog = {
  stage: string;
  authUidPresent: boolean;
  linked: boolean;
  syncResult?: 'synced' | 'skipped' | 'failed';
  success?: boolean;
  errorCode?: string;
};

export type AccountDeleteLog = {
  stage: string;
  authUidPresent: boolean;
  reauthRequired?: boolean;
  skipCloudDelete?: boolean;
  profileDeleted?: boolean;
  saveDeleted?: boolean;
  usernameReleased?: boolean;
  leaderboardDeleted?: boolean;
  marketplaceCleaned?: boolean;
  authDeleted?: boolean;
  localCleanupDone?: boolean;
  success?: boolean;
  errorCode?: string;
  diagnosticId?: string;
};

function safeLog(tag: string, payload: Record<string, unknown>): void {
  if (!__DEV__) return;
  // eslint-disable-next-line no-console
  console.info(tag, payload);
}

export function logAccountSignOut(payload: AccountSignOutLog): void {
  safeLog('[account-signout]', payload as unknown as Record<string, unknown>);
}

export function logAccountDelete(payload: AccountDeleteLog): void {
  safeLog('[account-delete]', payload as unknown as Record<string, unknown>);
}

export function createAccountDeleteDiagnosticId(): string {
  return `del-${Date.now().toString(36)}`;
}

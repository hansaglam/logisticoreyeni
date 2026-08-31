/**
 * Hesap ve bulut verisi silme — App Store / Play Store yayın gereksinimi.
 *
 * Sıra (linked account):
 * 1. UID al, cloud sync durdur
 * 2. Trusted callable: marketplace → username → leaderboard → recursive delete → Apple revoke → Admin auth delete
 * 3. Local save + game reset
 * 4. Yeni anonymous oturum
 */

import {
  ACCOUNT_DELETE_STAGE,
  createAccountDeleteDiagnosticId,
  logAccountDelete,
} from './accountLifecycleLog';
import {
  deleteCurrentFirebaseUser,
  getAccountStatus,
  getAuthDeleteErrorCode,
  getCurrentUserId,
  initAnonymousAuth,
  reauthenticateCurrentUser,
  signOutAfterServerAccountDeletion,
} from '../services/authService';
import {
  deleteUserCloudData,
  resetCloudFirestoreCache,
} from '../services/cloudSaveService';
import { isFirebaseEnabled } from '../services/firebase';
import {
  consumePendingAppleAuthorizationCode,
  obtainAppleAuthorizationCodeForRevocation,
} from '../services/appleAuthService';
import {
  beginAccountDeletion,
  endAccountDeletion,
  resetCloudSaveSyncState,
} from '../storage/cloudSaveSync';

export type AccountDeletionErrorCode =
  | 'requires-recent-login'
  | 'permission-denied'
  | 'network-error'
  | 'cloud-delete-failed'
  | 'auth-delete-failed'
  | 'local-clear-failed'
  | 'cancelled';

export interface AccountDeletionResult {
  ok: boolean;
  error?: string;
  errorCode?: AccountDeletionErrorCode;
  /** Cloud data already removed; retry may skip cloud delete after reauth. */
  cloudAlreadyDeleted?: boolean;
  diagnosticId?: string;
}

const GENERIC_DELETE_FAILURE_MESSAGE =
  'Hesap silinemedi. Lütfen tekrar deneyin.';

export function getAccountDeletionErrorMessage(
  errorCode?: AccountDeletionErrorCode,
  fallback?: string,
): string {
  switch (errorCode) {
    case 'requires-recent-login':
      return 'Hesabı silmek için tekrar giriş yapman gerekiyor.';
    case 'cancelled':
      return 'Hesap silme iptal edildi.';
    default:
      return fallback ?? GENERIC_DELETE_FAILURE_MESSAGE;
  }
}

async function resolveAppleAuthorizationCodeForDeletion(): Promise<string | undefined> {
  const status = getAccountStatus();
  if (status?.provider !== 'apple') {
    return undefined;
  }
  return (
    consumePendingAppleAuthorizationCode() ??
    (await obtainAppleAuthorizationCodeForRevocation()) ??
    undefined
  );
}

export async function deleteAccountAndCloudData(options: {
  clearLocalSave: () => Promise<void>;
  skipCloudDelete?: boolean;
  diagnosticId?: string;
}): Promise<AccountDeletionResult> {
  const diagnosticId = options.diagnosticId ?? createAccountDeleteDiagnosticId();
  const uid = getCurrentUserId();
  const accountStatus = getAccountStatus();
  const provider = accountStatus?.provider ?? 'unknown';

  logAccountDelete({
    stage: ACCOUNT_DELETE_STAGE.STARTED,
    authUidPresent: Boolean(uid),
    provider,
    diagnosticId,
    skipCloudDelete: Boolean(options.skipCloudDelete),
  });

  beginAccountDeletion();

  try {
    let cloudAlreadyDeleted = Boolean(options.skipCloudDelete);
    const isGuest =
      Boolean(accountStatus?.isAnonymous) || accountStatus?.provider === 'guest';

    let authDeletedByServer = false;

    if (uid && isFirebaseEnabled() && !options.skipCloudDelete && !isGuest) {
      const authorizationCode = await resolveAppleAuthorizationCodeForDeletion();
      logAccountDelete({
        stage: ACCOUNT_DELETE_STAGE.APPLE_REVOKE,
        authUidPresent: true,
        provider,
        diagnosticId,
        success: accountStatus?.provider !== 'apple' || Boolean(authorizationCode),
        errorCode:
          accountStatus?.provider === 'apple' && !authorizationCode
            ? 'no-authorization-code'
            : undefined,
      });

      const cloudResult = await deleteUserCloudData(uid, { authorizationCode });
      logAccountDelete({
        stage: ACCOUNT_DELETE_STAGE.MARKETPLACE,
        authUidPresent: true,
        provider,
        saveDeleted: cloudResult.ok,
        marketplaceCleaned: cloudResult.ok,
        usernameReleased: cloudResult.ok,
        leaderboardDeleted: cloudResult.ok,
        authDeletedByServer: cloudResult.authDeletedByServer,
        diagnosticId,
        success: cloudResult.ok,
        errorCode: cloudResult.stage ?? cloudResult.errorCode,
      });

      if (!cloudResult.ok) {
        const errorCode =
          cloudResult.errorCode === 'permission-denied'
            ? 'permission-denied'
            : cloudResult.errorCode === 'network-error' ||
                cloudResult.errorCode === 'unavailable'
              ? 'network-error'
              : 'cloud-delete-failed';

        return {
          ok: false,
          error: getAccountDeletionErrorMessage(errorCode),
          errorCode,
          diagnosticId,
        };
      }
      cloudAlreadyDeleted = true;
      authDeletedByServer = Boolean(cloudResult.authDeletedByServer);
    }

    if (uid && isFirebaseEnabled()) {
      if (authDeletedByServer) {
        await signOutAfterServerAccountDeletion();
        logAccountDelete({
          stage: ACCOUNT_DELETE_STAGE.FIREBASE_AUTH,
          authUidPresent: false,
          provider,
          authDeleted: true,
          authDeletedByServer: true,
          diagnosticId,
          success: true,
        });
      } else {
        try {
          await deleteCurrentFirebaseUser();
          logAccountDelete({
            stage: ACCOUNT_DELETE_STAGE.FIREBASE_AUTH,
            authUidPresent: true,
            provider,
            authDeleted: true,
            diagnosticId,
            success: true,
          });
        } catch (error) {
          const authCode = getAuthDeleteErrorCode(error);
          logAccountDelete({
            stage: ACCOUNT_DELETE_STAGE.FIREBASE_AUTH,
            authUidPresent: true,
            provider,
            authDeleted: false,
            reauthRequired: authCode === 'requires-recent-login',
            diagnosticId,
            success: false,
            errorCode: authCode ?? 'auth-delete-failed',
          });

          if (authCode === 'requires-recent-login') {
            return {
              ok: false,
              error: getAccountDeletionErrorMessage('requires-recent-login'),
              errorCode: 'requires-recent-login',
              cloudAlreadyDeleted,
              diagnosticId,
            };
          }

          return {
            ok: false,
            error: getAccountDeletionErrorMessage('auth-delete-failed'),
            errorCode: 'auth-delete-failed',
            cloudAlreadyDeleted,
            diagnosticId,
          };
        }
      }
    }

    try {
      await options.clearLocalSave();
      logAccountDelete({
        stage: ACCOUNT_DELETE_STAGE.LOCAL_RESET,
        authUidPresent: Boolean(getCurrentUserId()),
        provider,
        localCleanupDone: true,
        diagnosticId,
        success: true,
      });
    } catch {
      return {
        ok: false,
        error: getAccountDeletionErrorMessage('local-clear-failed'),
        errorCode: 'local-clear-failed',
        cloudAlreadyDeleted,
        diagnosticId,
      };
    }

    resetCloudSaveSyncState();
    resetCloudFirestoreCache();

    if (isFirebaseEnabled()) {
      const newUser = await initAnonymousAuth();
      logAccountDelete({
        stage: ACCOUNT_DELETE_STAGE.COMPLETED,
        authUidPresent: Boolean(newUser?.uid),
        provider: 'guest',
        diagnosticId,
        success: Boolean(newUser),
      });
    } else {
      logAccountDelete({
        stage: ACCOUNT_DELETE_STAGE.COMPLETED,
        authUidPresent: false,
        provider,
        diagnosticId,
        success: true,
      });
    }

    return { ok: true, diagnosticId };
  } finally {
    endAccountDeletion();
  }
}

/**
 * Retry auth deletion after successful reauthentication (cloud may already be gone).
 */
export async function completeAccountDeletionAfterReauth(options: {
  clearLocalSave: () => Promise<void>;
  diagnosticId?: string;
}): Promise<AccountDeletionResult> {
  const reauth = await reauthenticateCurrentUser();
  if (!reauth.ok) {
    return {
      ok: false,
      error: getAccountDeletionErrorMessage(
        reauth.cancelled ? 'cancelled' : 'requires-recent-login',
      ),
      errorCode: reauth.cancelled ? 'cancelled' : 'requires-recent-login',
      diagnosticId: options.diagnosticId,
    };
  }

  return deleteAccountAndCloudData({
    clearLocalSave: options.clearLocalSave,
    skipCloudDelete: true,
    diagnosticId: options.diagnosticId,
  });
}

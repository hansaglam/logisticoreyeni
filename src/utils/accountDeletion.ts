/**
 * Hesap ve bulut verisi silme — App Store / Play Store yayın gereksinimi.
 *
 * Sıra:
 * 1. UID al, cloud sync durdur
 * 2. Firestore sil (trusted callable + client guard)
 * 3. Firebase Auth deleteUser (local silmeden önce — requires-recent-login koruması)
 * 4. Local save + game reset
 * 5. Yeni anonymous oturum
 */

import {
  createAccountDeleteDiagnosticId,
  logAccountDelete,
} from './accountLifecycleLog';
import {
  deleteCurrentFirebaseUser,
  getAuthDeleteErrorCode,
  getCurrentUserId,
  initAnonymousAuth,
  reauthenticateCurrentUser,
} from '../services/authService';
import {
  deleteUserCloudData,
  resetCloudFirestoreCache,
} from '../services/cloudSaveService';
import { isFirebaseEnabled } from '../services/firebase';
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

export function getAccountDeletionErrorMessage(
  errorCode?: AccountDeletionErrorCode,
  fallback?: string,
): string {
  switch (errorCode) {
    case 'requires-recent-login':
      return 'Hesabı silmek için tekrar giriş yapman gerekiyor.';
    case 'cancelled':
      return 'Hesap silme iptal edildi.';
    case 'permission-denied':
      return 'Bulut verileri silinemedi. İzin hatası — daha sonra tekrar dene.';
    case 'network-error':
      return 'Ağ hatası nedeniyle bulut verileri silinemedi. İnternet bağlantını kontrol et.';
    case 'cloud-delete-failed':
      return fallback ?? 'Bulut verileri silinemedi.';
    case 'auth-delete-failed':
      return fallback ?? 'Hesap silinemedi.';
    case 'local-clear-failed':
      return fallback ?? 'Yerel kayıt temizlenemedi.';
    default:
      return fallback ?? 'Hesap silinemedi. Tekrar dene.';
  }
}

export async function deleteAccountAndCloudData(options: {
  clearLocalSave: () => Promise<void>;
  skipCloudDelete?: boolean;
  diagnosticId?: string;
}): Promise<AccountDeletionResult> {
  const diagnosticId = options.diagnosticId ?? createAccountDeleteDiagnosticId();
  const uid = getCurrentUserId();

  logAccountDelete({
    stage: 'started',
    authUidPresent: Boolean(uid),
    diagnosticId,
    skipCloudDelete: Boolean(options.skipCloudDelete),
  });

  beginAccountDeletion();

  try {
    let cloudAlreadyDeleted = Boolean(options.skipCloudDelete);

    if (uid && isFirebaseEnabled() && !options.skipCloudDelete) {
      const cloudResult = await deleteUserCloudData(uid);
      logAccountDelete({
        stage: 'cloud-delete',
        authUidPresent: true,
        saveDeleted: cloudResult.ok,
        marketplaceCleaned: cloudResult.ok,
        usernameReleased: cloudResult.ok,
        leaderboardDeleted: cloudResult.ok,
        diagnosticId,
        success: cloudResult.ok,
        errorCode: cloudResult.errorCode,
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
          error: getAccountDeletionErrorMessage(errorCode, cloudResult.error),
          errorCode,
          diagnosticId,
        };
      }
      cloudAlreadyDeleted = true;
    }

    if (uid && isFirebaseEnabled()) {
      try {
        await deleteCurrentFirebaseUser();
        logAccountDelete({
          stage: 'auth-delete',
          authUidPresent: true,
          authDeleted: true,
          diagnosticId,
          success: true,
        });
      } catch (error) {
        const authCode = getAuthDeleteErrorCode(error);
        logAccountDelete({
          stage: 'auth-delete',
          authUidPresent: true,
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

        const message = error instanceof Error ? error.message : 'Firebase kullanıcısı silinemedi.';
        return {
          ok: false,
          error: getAccountDeletionErrorMessage('auth-delete-failed', message),
          errorCode: 'auth-delete-failed',
          cloudAlreadyDeleted,
          diagnosticId,
        };
      }
    }

    try {
      await options.clearLocalSave();
      logAccountDelete({
        stage: 'local-cleanup',
        authUidPresent: Boolean(getCurrentUserId()),
        localCleanupDone: true,
        diagnosticId,
        success: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Local save temizlenemedi.';
      return {
        ok: false,
        error: getAccountDeletionErrorMessage('local-clear-failed', message),
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
        stage: 'anonymous-bootstrap',
        authUidPresent: Boolean(newUser?.uid),
        diagnosticId,
        success: Boolean(newUser),
      });
    }

    logAccountDelete({
      stage: 'completed',
      authUidPresent: Boolean(getCurrentUserId()),
      diagnosticId,
      success: true,
    });
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

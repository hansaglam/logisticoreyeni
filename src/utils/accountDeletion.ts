/**
 * Hesap ve bulut verisi silme — App Store / Play Store yayın gereksinimi.
 *
 * Sıra:
 * 1. UID al, cloud sync durdur
 * 2. Firestore sil
 * 3. Firebase Auth deleteUser (local silmeden önce — requires-recent-login koruması)
 * 4. Local save + game reset
 * 5. Yeni anonymous oturum
 */

import {
  deleteCurrentFirebaseUser,
  getAuthDeleteErrorCode,
  getCurrentUserId,
  initAnonymousAuth,
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
  | 'local-clear-failed';

export interface AccountDeletionResult {
  ok: boolean;
  error?: string;
  errorCode?: AccountDeletionErrorCode;
}

export function getAccountDeletionErrorMessage(
  errorCode?: AccountDeletionErrorCode,
  fallback?: string,
): string {
  switch (errorCode) {
    case 'requires-recent-login':
      return 'Hesabı silmek için tekrar giriş yapman gerekiyor.';
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
      return fallback ?? 'İşlem tamamlanamadı. Lütfen tekrar deneyin.';
  }
}

export async function deleteAccountAndCloudData(options: {
  clearLocalSave: () => Promise<void>;
}): Promise<AccountDeletionResult> {
  const uid = getCurrentUserId();
  console.log('[account-delete] started', { uid: uid ?? null });

  beginAccountDeletion();

  try {
    if (uid && isFirebaseEnabled()) {
      const cloudResult = await deleteUserCloudData(uid);
      if (!cloudResult.ok) {
        const errorCode =
          cloudResult.errorCode === 'permission-denied'
            ? 'permission-denied'
            : cloudResult.errorCode === 'network-error' ||
                cloudResult.errorCode === 'unavailable'
              ? 'network-error'
              : 'cloud-delete-failed';

        console.warn('[account-delete] cloud delete failed', cloudResult.error);
        return {
          ok: false,
          error: getAccountDeletionErrorMessage(errorCode, cloudResult.error),
          errorCode,
        };
      }
    }

    if (uid && isFirebaseEnabled()) {
      try {
        await deleteCurrentFirebaseUser();
        console.log('[account-delete] firebase user deleted');
      } catch (error) {
        const authCode = getAuthDeleteErrorCode(error);
        if (authCode === 'requires-recent-login') {
          return {
            ok: false,
            error: getAccountDeletionErrorMessage('requires-recent-login'),
            errorCode: 'requires-recent-login',
          };
        }

        const message = error instanceof Error ? error.message : 'Firebase kullanıcısı silinemedi.';
        console.warn('[account-delete] auth delete failed', error);
        return {
          ok: false,
          error: getAccountDeletionErrorMessage('auth-delete-failed', message),
          errorCode: 'auth-delete-failed',
        };
      }
    }

    try {
      await options.clearLocalSave();
      console.log('[account-delete] local save cleared');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Local save temizlenemedi.';
      console.warn('[account-delete] local clear failed', error);
      return {
        ok: false,
        error: getAccountDeletionErrorMessage('local-clear-failed', message),
        errorCode: 'local-clear-failed',
      };
    }

    resetCloudSaveSyncState();
    resetCloudFirestoreCache();

    if (isFirebaseEnabled()) {
      const newUser = await initAnonymousAuth();
      console.log('[account-delete] new session ready', newUser?.uid ?? null);
    }

    console.log('[account-delete] success');
    return { ok: true };
  } finally {
    endAccountDeletion();
  }
}

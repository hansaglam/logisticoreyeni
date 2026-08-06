/**
 * Apple/Google link sonrası local save ownership reconcile.
 * Otomatik overwrite yok — conflict açıkça döner.
 */

export type SaveOwnershipReconcileResult =
  | 'already-owned'
  | 'safe-legacy-claim'
  | 'uid-preserved'
  | 'conflict'
  | 'rejected';

export interface ReconcileLocalSaveOwnershipInput {
  previousUid: string | null | undefined;
  currentUid: string | null | undefined;
  localOwnerUid: string | null | undefined;
  providerId: 'apple.com' | 'google.com';
}

export interface ReconcileLocalSaveOwnershipOutput {
  result: SaveOwnershipReconcileResult;
  resolvedOwnerUid: string | null;
  shouldClaimLocalOwner: boolean;
}

export function reconcileLocalSaveOwnershipAfterAccountLink(
  input: ReconcileLocalSaveOwnershipInput,
): ReconcileLocalSaveOwnershipOutput {
  const currentUid =
    typeof input.currentUid === 'string' && input.currentUid.trim().length > 0
      ? input.currentUid.trim()
      : null;
  const previousUid =
    typeof input.previousUid === 'string' && input.previousUid.trim().length > 0
      ? input.previousUid.trim()
      : null;
  const localOwnerUid =
    typeof input.localOwnerUid === 'string' && input.localOwnerUid.trim().length > 0
      ? input.localOwnerUid.trim()
      : null;

  if (!currentUid) {
    return {
      result: 'rejected',
      resolvedOwnerUid: null,
      shouldClaimLocalOwner: false,
    };
  }

  if (!localOwnerUid) {
    return {
      result: 'safe-legacy-claim',
      resolvedOwnerUid: currentUid,
      shouldClaimLocalOwner: true,
    };
  }

  if (localOwnerUid === currentUid) {
    if (previousUid && previousUid === currentUid) {
      return {
        result: 'uid-preserved',
        resolvedOwnerUid: currentUid,
        shouldClaimLocalOwner: false,
      };
    }
    return {
      result: 'already-owned',
      resolvedOwnerUid: currentUid,
      shouldClaimLocalOwner: false,
    };
  }

  // Local save başka doğrulanmış UID'ye ait — otomatik claim yok
  return {
    result: 'conflict',
    resolvedOwnerUid: null,
    shouldClaimLocalOwner: false,
  };
}

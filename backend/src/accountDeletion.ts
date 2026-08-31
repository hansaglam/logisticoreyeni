import { createHash } from 'node:crypto';

import { getAuth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';

import { revokeAppleAuthorizationCode } from './appleTokenRevocation';
import { readAppleSignInSecretValuesFromBinding } from './appleSignInSecrets';
import { deleteLeaderboardEntriesForUid } from './leaderboard';
import { releaseUsernameForUid } from './username';
import { prepareMarketplaceAccountDeletion } from './vehicleMarketplace';

export const ACCOUNT_DELETE_STAGE = {
  MARKETPLACE: 'ACCOUNT_DELETE_STAGE_MARKETPLACE',
  USERNAME: 'ACCOUNT_DELETE_STAGE_USERNAME',
  LEADERBOARD: 'ACCOUNT_DELETE_STAGE_LEADERBOARD',
  RECURSIVE_DATA: 'ACCOUNT_DELETE_STAGE_RECURSIVE_DATA',
  APPLE_REVOKE: 'ACCOUNT_DELETE_STAGE_APPLE_REVOKE',
  FIREBASE_AUTH: 'ACCOUNT_DELETE_STAGE_FIREBASE_AUTH',
} as const;

export type AccountDeleteStage =
  (typeof ACCOUNT_DELETE_STAGE)[keyof typeof ACCOUNT_DELETE_STAGE];

export type DeleteLinkedAccountInput = {
  uid: string;
  authorizationCode?: string;
};

export type DeleteLinkedAccountSuccess = {
  ok: true;
  cancelledListings: number;
  anonymizedListings: number;
  usernameReleased: boolean;
  leaderboardEntriesDeleted: number;
  authDeleted: boolean;
  authAlreadyAbsent: boolean;
  appleRevoked: boolean;
};

export type DeleteLinkedAccountFailure = {
  ok: false;
  stage: AccountDeleteStage;
  reason: string;
  code?: string;
};

function uidHash(uid: string): string {
  return createHash('sha256').update(uid).digest('hex').slice(0, 12);
}

function extractErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function logStage(
  stage: AccountDeleteStage,
  uid: string,
  extra: Record<string, unknown> = {},
): void {
  logger.info('[account-delete-stage]', {
    stage,
    uidHash: uidHash(uid),
    timestamp: new Date().toISOString(),
    ...extra,
  });
}

function logStageError(
  stage: AccountDeleteStage,
  uid: string,
  error: unknown,
  extra: Record<string, unknown> = {},
): void {
  logger.error('[account-delete-stage-failed]', {
    stage,
    uidHash: uidHash(uid),
    timestamp: new Date().toISOString(),
    error: error instanceof Error ? error.message : String(error),
    code: extractErrorCode(error),
    ...extra,
  });
}

async function deleteFirebaseAuthUserSafely(uid: string): Promise<{
  authDeleted: boolean;
  authAlreadyAbsent: boolean;
}> {
  const auth = getAuth();
  try {
    await auth.deleteUser(uid);
    return { authDeleted: true, authAlreadyAbsent: false };
  } catch (error) {
    const code = extractErrorCode(error);
    if (code === 'auth/user-not-found') {
      return { authDeleted: false, authAlreadyAbsent: true };
    }
    throw error;
  }
}

/** Trusted server-side linked-account deletion — idempotent, safe to retry. */
export async function deleteLinkedAccount(
  firestore: Firestore,
  input: DeleteLinkedAccountInput,
): Promise<DeleteLinkedAccountSuccess | DeleteLinkedAccountFailure> {
  const { uid, authorizationCode } = input;

  let marketplace: { cancelledListings: number; anonymizedListings: number };
  try {
    logStage(ACCOUNT_DELETE_STAGE.MARKETPLACE, uid);
    marketplace = await prepareMarketplaceAccountDeletion(firestore, uid);
    logStage(ACCOUNT_DELETE_STAGE.MARKETPLACE, uid, {
      success: true,
      ...marketplace,
    });
  } catch (error) {
    logStageError(ACCOUNT_DELETE_STAGE.MARKETPLACE, uid, error);
    return {
      ok: false,
      stage: ACCOUNT_DELETE_STAGE.MARKETPLACE,
      reason: 'marketplace-cleanup-failed',
      code: extractErrorCode(error),
    };
  }

  let usernameReleased = false;
  try {
    logStage(ACCOUNT_DELETE_STAGE.USERNAME, uid);
    const usernameCleanup = await releaseUsernameForUid(firestore, uid);
    usernameReleased = usernameCleanup.usernameReleased;
    logStage(ACCOUNT_DELETE_STAGE.USERNAME, uid, {
      success: true,
      usernameReleased,
    });
  } catch (error) {
    logStageError(ACCOUNT_DELETE_STAGE.USERNAME, uid, error);
    return {
      ok: false,
      stage: ACCOUNT_DELETE_STAGE.USERNAME,
      reason: 'username-cleanup-failed',
      code: extractErrorCode(error),
    };
  }

  let leaderboardEntriesDeleted = 0;
  try {
    logStage(ACCOUNT_DELETE_STAGE.LEADERBOARD, uid);
    leaderboardEntriesDeleted = await deleteLeaderboardEntriesForUid(firestore, uid);
    logStage(ACCOUNT_DELETE_STAGE.LEADERBOARD, uid, {
      success: true,
      leaderboardEntriesDeleted,
    });
  } catch (error) {
    logStageError(ACCOUNT_DELETE_STAGE.LEADERBOARD, uid, error);
    return {
      ok: false,
      stage: ACCOUNT_DELETE_STAGE.LEADERBOARD,
      reason: 'leaderboard-cleanup-failed',
      code: extractErrorCode(error),
    };
  }

  try {
    logStage(ACCOUNT_DELETE_STAGE.RECURSIVE_DATA, uid);
    const userRef = firestore.doc(`users/${uid}`);
    const userSnap = await userRef.get();
    if (userSnap.exists) {
      await firestore.recursiveDelete(userRef);
    }
    logStage(ACCOUNT_DELETE_STAGE.RECURSIVE_DATA, uid, { success: true });
  } catch (error) {
    logStageError(ACCOUNT_DELETE_STAGE.RECURSIVE_DATA, uid, error);
    return {
      ok: false,
      stage: ACCOUNT_DELETE_STAGE.RECURSIVE_DATA,
      reason: 'recursive-delete-failed',
      code: extractErrorCode(error),
    };
  }

  let appleRevoked = false;
  const trimmedCode = authorizationCode?.trim();
  if (trimmedCode) {
    try {
      logStage(ACCOUNT_DELETE_STAGE.APPLE_REVOKE, uid);
      const revokeResult = await revokeAppleAuthorizationCode(
        trimmedCode,
        readAppleSignInSecretValuesFromBinding(),
      );
      appleRevoked = revokeResult.ok;
      logStage(ACCOUNT_DELETE_STAGE.APPLE_REVOKE, uid, {
        success: revokeResult.ok,
        reason: revokeResult.ok ? undefined : revokeResult.reason,
      });
    } catch (error) {
      logStageError(ACCOUNT_DELETE_STAGE.APPLE_REVOKE, uid, error);
    }
  }

  try {
    logStage(ACCOUNT_DELETE_STAGE.FIREBASE_AUTH, uid);
    const authResult = await deleteFirebaseAuthUserSafely(uid);
    logStage(ACCOUNT_DELETE_STAGE.FIREBASE_AUTH, uid, {
      success: true,
      ...authResult,
    });
    return {
      ok: true,
      ...marketplace,
      usernameReleased,
      leaderboardEntriesDeleted,
      ...authResult,
      appleRevoked,
    };
  } catch (error) {
    logStageError(ACCOUNT_DELETE_STAGE.FIREBASE_AUTH, uid, error);
    return {
      ok: false,
      stage: ACCOUNT_DELETE_STAGE.FIREBASE_AUTH,
      reason: 'firebase-auth-delete-failed',
      code: extractErrorCode(error),
    };
  }
}

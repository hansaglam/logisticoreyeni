/**
 * Backend-authoritative username reservation + profile updates.
 */

import {
  Timestamp,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
} from 'firebase-admin/firestore';

import { getLeaderboardSeasonKey } from './leaderboardSeason';
import {
  USERNAME_CHANGE_COOLDOWN_MS,
  validateUsernameFormat,
  type UsernameValidationReason,
} from './usernameValidation';

export type UsernameFailureReason =
  | UsernameValidationReason
  | 'username-taken'
  | 'username-change-cooldown'
  | 'username-required'
  | 'auth-required'
  | 'anonymous-not-supported'
  | 'rate-limited'
  | 'invalid-request'
  | 'service-unavailable';

export interface UsernameActionIdentity {
  uid: string;
  displayName: string | null;
  signInProvider: string;
}

export interface UserUsernameProfile {
  username: string | null;
  usernameNormalized: string | null;
  usernameUpdatedAtMs: number | null;
  usernameChangeCount: number;
  usernameSetupCompleted: boolean;
  displayName: string | null;
}

export type SetUsernameResult =
  | {
      ok: true;
      username: string;
      usernameNormalized: string;
      setupCompleted: boolean;
      changeCount: number;
      nextChangeAvailableAtMs: number | null;
    }
  | {
      ok: false;
      reason: UsernameFailureReason;
      nextChangeAvailableAtMs?: number | null;
    };

export type CheckUsernameAvailabilityResult =
  | { ok: true; available: boolean; usernameNormalized: string; reason?: UsernameFailureReason }
  | { ok: false; reason: UsernameFailureReason; usernameNormalized?: string };

function userRef(firestore: Firestore, uid: string) {
  return firestore.doc(`users/${uid}`);
}

function usernameReservationRef(firestore: Firestore, normalized: string) {
  return firestore.doc(`usernames/${normalized}`);
}

function publicProfileRef(firestore: Firestore, uid: string) {
  return firestore.doc(`publicProfiles/${uid}`);
}

export function readUsernameProfile(
  data: Record<string, unknown> | undefined,
): UserUsernameProfile {
  const username = typeof data?.username === 'string' ? data.username : null;
  const usernameNormalized =
    typeof data?.usernameNormalized === 'string' ? data.usernameNormalized : null;
  const updatedAt = data?.usernameUpdatedAt;
  const usernameUpdatedAtMs =
    updatedAt && typeof (updatedAt as { toMillis?: () => number }).toMillis === 'function'
      ? (updatedAt as { toMillis: () => number }).toMillis()
      : typeof updatedAt === 'number'
        ? updatedAt
        : null;
  return {
    username,
    usernameNormalized,
    usernameUpdatedAtMs,
    usernameChangeCount: Math.max(0, Math.floor(Number(data?.usernameChangeCount) || 0)),
    usernameSetupCompleted: data?.usernameSetupCompleted === true,
    displayName: typeof data?.displayName === 'string' ? data.displayName : null,
  };
}

export async function getUsernameProfileForUid(
  firestore: Firestore,
  uid: string,
): Promise<UserUsernameProfile> {
  const snap = await userRef(firestore, uid).get();
  return readUsernameProfile(snap.data() as Record<string, unknown> | undefined);
}

export async function checkUsernameAvailabilityTransaction(
  firestore: Firestore,
  identity: UsernameActionIdentity,
  rawUsername: unknown,
): Promise<CheckUsernameAvailabilityResult> {
  const validated = validateUsernameFormat(rawUsername);
  if (!validated.ok) {
    return {
      ok: true,
      available: false,
      usernameNormalized: typeof rawUsername === 'string' ? rawUsername.trim().toLowerCase() : '',
      reason: validated.reason,
    };
  }

  try {
    const reservation = await usernameReservationRef(
      firestore,
      validated.usernameNormalized,
    ).get();
    if (!reservation.exists) {
      return {
        ok: true,
        available: true,
        usernameNormalized: validated.usernameNormalized,
      };
    }
    const ownerUid = String(reservation.data()?.uid ?? '');
    if (ownerUid === identity.uid) {
      return {
        ok: true,
        available: true,
        usernameNormalized: validated.usernameNormalized,
      };
    }
    return {
      ok: true,
      available: false,
      usernameNormalized: validated.usernameNormalized,
      reason: 'username-taken',
    };
  } catch {
    return { ok: false, reason: 'service-unavailable' };
  }
}

export async function setUsernameTransaction(
  firestore: Firestore,
  identity: UsernameActionIdentity,
  rawUsername: unknown,
  nowMs = Date.now(),
): Promise<SetUsernameResult> {
  const validated = validateUsernameFormat(rawUsername);
  if (!validated.ok) {
    return { ok: false, reason: validated.reason };
  }

  try {
    return await firestore.runTransaction(async (transaction) => {
      const profileSnap = await transaction.get(userRef(firestore, identity.uid));
      const profile = readUsernameProfile(
        profileSnap.data() as Record<string, unknown> | undefined,
      );

      // Idempotent: same username already owned.
      if (
        profile.usernameNormalized === validated.usernameNormalized &&
        profile.usernameSetupCompleted
      ) {
        return {
          ok: true as const,
          username: profile.username ?? validated.username,
          usernameNormalized: validated.usernameNormalized,
          setupCompleted: true,
          changeCount: profile.usernameChangeCount,
          nextChangeAvailableAtMs:
            profile.usernameUpdatedAtMs != null
              ? profile.usernameUpdatedAtMs + USERNAME_CHANGE_COOLDOWN_MS
              : null,
        };
      }

      const isFirstSetup = !profile.usernameSetupCompleted;
      if (!isFirstSetup && profile.usernameUpdatedAtMs != null) {
        const nextAt = profile.usernameUpdatedAtMs + USERNAME_CHANGE_COOLDOWN_MS;
        if (nowMs < nextAt) {
          return {
            ok: false as const,
            reason: 'username-change-cooldown' as const,
            nextChangeAvailableAtMs: nextAt,
          };
        }
      }

      const newReservationRef = usernameReservationRef(
        firestore,
        validated.usernameNormalized,
      );
      const newReservationSnap = await transaction.get(newReservationRef);
      if (newReservationSnap.exists) {
        const ownerUid = String(newReservationSnap.data()?.uid ?? '');
        if (ownerUid !== identity.uid) {
          return { ok: false as const, reason: 'username-taken' as const };
        }
      }

      const previousNormalized = profile.usernameNormalized;
      let oldReservationSnap: DocumentSnapshot | null = null;
      let oldReservationRef: DocumentReference | null = null;
      if (
        previousNormalized &&
        previousNormalized !== validated.usernameNormalized
      ) {
        oldReservationRef = usernameReservationRef(firestore, previousNormalized);
        oldReservationSnap = await transaction.get(oldReservationRef);
      }

      // Tüm okumalar yazmadan önce (Firestore transaction kuralı).
      const seasonKey = getLeaderboardSeasonKey(nowMs);
      const entryRef = firestore.doc(
        `leaderboards/${seasonKey}/entries/${identity.uid}`,
      );
      const entrySnap = await transaction.get(entryRef);

      const now = Timestamp.fromMillis(nowMs);
      // İlk kurulum değişiklik sayılmaz; sonraki her değişim +1.
      const nextChangeCount = isFirstSetup
        ? profile.usernameChangeCount
        : profile.usernameChangeCount + 1;

      const existingProviders = Array.isArray(profileSnap.data()?.authProviders)
        ? (profileSnap.data()?.authProviders as unknown[]).filter(
            (item): item is string => typeof item === 'string',
          )
        : [];
      const providers = identity.signInProvider
        ? Array.from(new Set([...existingProviders, identity.signInProvider]))
        : existingProviders;

      if (
        oldReservationRef &&
        oldReservationSnap?.exists &&
        String(oldReservationSnap.data()?.uid ?? '') === identity.uid
      ) {
        transaction.delete(oldReservationRef);
      }

      const profileUpdate: Record<string, unknown> = {
        uid: identity.uid,
        username: validated.username,
        usernameNormalized: validated.usernameNormalized,
        usernameUpdatedAt: now,
        usernameChangeCount: nextChangeCount,
        usernameSetupCompleted: true,
        authProviders: providers,
        updatedAt: now,
        createdAt: profileSnap.exists
          ? (profileSnap.data()?.createdAt ?? now)
          : now,
      };
      if (identity.displayName) {
        profileUpdate.displayName = identity.displayName;
      } else if (profile.displayName) {
        profileUpdate.displayName = profile.displayName;
      }

      transaction.set(userRef(firestore, identity.uid), profileUpdate, { merge: true });

      transaction.set(newReservationRef, {
        uid: identity.uid,
        username: validated.username,
        createdAt: newReservationSnap.exists
          ? (newReservationSnap.data()?.createdAt ?? now)
          : now,
        updatedAt: now,
      });

      transaction.set(
        publicProfileRef(firestore, identity.uid),
        {
          uid: identity.uid,
          username: validated.username,
          avatarStyle: 'initial',
          updatedAt: now,
        },
        { merge: true },
      );

      // Mevcut sezon leaderboard entry username'ini hemen yenile.
      if (entrySnap.exists) {
        transaction.set(
          entryRef,
          {
            username: validated.username,
            updatedAt: now,
          },
          { merge: true },
        );
      }

      return {
        ok: true as const,
        username: validated.username,
        usernameNormalized: validated.usernameNormalized,
        setupCompleted: true,
        changeCount: nextChangeCount,
        nextChangeAvailableAtMs: nowMs + USERNAME_CHANGE_COOLDOWN_MS,
      };
    });
  } catch (error) {
    console.error('[username-set-failed]', {
      uidHash: identity.uid.slice(0, 6),
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, reason: 'service-unavailable' };
  }
}

/** Account deletion: release username reservation + public profile. */
export async function releaseUsernameForUid(
  firestore: Firestore,
  uid: string,
): Promise<{ usernameReleased: boolean }> {
  const profile = await getUsernameProfileForUid(firestore, uid);
  let usernameReleased = false;
  if (profile.usernameNormalized) {
    const ref = usernameReservationRef(firestore, profile.usernameNormalized);
    const snap = await ref.get();
    if (snap.exists && String(snap.data()?.uid ?? '') === uid) {
      await ref.delete();
      usernameReleased = true;
    }
  }
  await publicProfileRef(firestore, uid).delete().catch(() => undefined);
  return { usernameReleased };
}

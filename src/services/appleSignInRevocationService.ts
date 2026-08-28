/**
 * Sign in with Apple token revocation during account deletion.
 */

import { httpsCallable } from 'firebase/functions';

import { getAccountStatus } from './authService';
import {
  consumePendingAppleAuthorizationCode,
  obtainAppleAuthorizationCodeForRevocation,
} from './appleAuthService';
import { getFirebaseFunctionsSafe, isFirebaseEnabled } from './firebase';

export type AppleRevocationResult =
  | { ok: true; revoked: boolean }
  | { ok: false; reason: 'not-apple' | 'no-code' | 'callable-failed' | 'firebase-disabled' };

export async function revokeAppleSignInIfNeeded(): Promise<AppleRevocationResult> {
  const status = getAccountStatus();
  if (status?.provider !== 'apple') {
    return { ok: true, revoked: false };
  }

  if (!isFirebaseEnabled()) {
    return { ok: false, reason: 'firebase-disabled' };
  }

  const functions = getFirebaseFunctionsSafe();
  if (!functions) {
    return { ok: false, reason: 'callable-failed' };
  }

  const authorizationCode =
    consumePendingAppleAuthorizationCode() ??
    (await obtainAppleAuthorizationCodeForRevocation());

  if (!authorizationCode) {
    return { ok: false, reason: 'no-code' };
  }

  try {
    const callable = httpsCallable<
      { authorizationCode: string },
      { ok: boolean; reason?: string }
    >(functions, 'revokeAppleSignInTokens');
    const result = await callable({ authorizationCode });
    if (result.data?.ok) {
      return { ok: true, revoked: true };
    }
    console.warn('[apple-revoke] server declined', result.data?.reason ?? 'unknown');
    return { ok: true, revoked: false };
  } catch (error) {
    console.warn('[apple-revoke] callable failed', error);
    return { ok: false, reason: 'callable-failed' };
  }
}

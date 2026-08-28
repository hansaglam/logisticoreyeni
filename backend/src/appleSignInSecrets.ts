/**
 * Sign in with Apple revocation secrets — bound only to revokeAppleSignInTokens.
 */

import { defineSecret } from 'firebase-functions/params';

type AppleSignInSecretParam = ReturnType<typeof defineSecret>;

export const appleSignInTeamIdSecret: AppleSignInSecretParam = defineSecret('APPLE_SIGNIN_TEAM_ID');
export const appleSignInClientIdSecret: AppleSignInSecretParam = defineSecret('APPLE_SIGNIN_CLIENT_ID');
export const appleSignInKeyIdSecret: AppleSignInSecretParam = defineSecret('APPLE_SIGNIN_KEY_ID');
export const appleSignInPrivateKeySecret: AppleSignInSecretParam = defineSecret(
  'APPLE_SIGNIN_PRIVATE_KEY',
);

export const APPLE_SIGNIN_SECRETS: readonly AppleSignInSecretParam[] = [
  appleSignInTeamIdSecret,
  appleSignInClientIdSecret,
  appleSignInKeyIdSecret,
  appleSignInPrivateKeySecret,
];

export type AppleSignInSecretValues = {
  teamId: string;
  clientId: string;
  keyId: string;
  privateKey: string;
};

export function readAppleSignInSecretValuesFromBinding(): AppleSignInSecretValues {
  return {
    teamId: appleSignInTeamIdSecret.value(),
    clientId: appleSignInClientIdSecret.value(),
    keyId: appleSignInKeyIdSecret.value(),
    privateKey: appleSignInPrivateKeySecret.value(),
  };
}

import {
  createAppleClientSecret,
  resolveAppleSignInServerConfig,
  type AppleSignInConfigInput,
} from './appleClientSecret';

const APPLE_REVOKE_URL = 'https://appleid.apple.com/auth/revoke';

export type AppleTokenRevocationResult =
  | { ok: true }
  | { ok: false; reason: 'not-configured' | 'invalid-request' | 'apple-rejected' | 'network-error' };

export async function revokeAppleAuthorizationCode(
  authorizationCode: string,
  configInput: AppleSignInConfigInput = {},
): Promise<AppleTokenRevocationResult> {
  const code = authorizationCode.trim();
  if (!code) {
    return { ok: false, reason: 'invalid-request' };
  }

  const config = resolveAppleSignInServerConfig(configInput);
  if (!config) {
    return { ok: false, reason: 'not-configured' };
  }

  let clientSecret: string;
  try {
    clientSecret = createAppleClientSecret(config);
  } catch {
    return { ok: false, reason: 'invalid-request' };
  }

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: clientSecret,
    token: code,
    token_type_hint: 'authorization_code',
  });

  try {
    const response = await fetch(APPLE_REVOKE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (response.ok) {
      return { ok: true };
    }

    return { ok: false, reason: 'apple-rejected' };
  } catch {
    return { ok: false, reason: 'network-error' };
  }
}

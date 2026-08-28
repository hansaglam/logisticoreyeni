/**
 * Apple Sign In client secret (ES256 JWT) for token revocation.
 */

import { createSign } from 'node:crypto';

export type AppleSignInServerConfig = {
  teamId: string;
  clientId: string;
  keyId: string;
  privateKey: string;
};

export type AppleSignInConfigInput = {
  teamId?: string | null;
  clientId?: string | null;
  keyId?: string | null;
  privateKey?: string | null;
};

function base64UrlEncode(value: string | Buffer): string {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function derSignatureToJwt(signature: Buffer): string {
  if (signature.length === 64) {
    return base64UrlEncode(signature);
  }

  let offset = 0;
  if (signature[offset++] !== 0x30) {
    throw new Error('invalid-der-signature');
  }
  const seqLen = signature[offset++];
  if (seqLen + 2 !== signature.length) {
    offset += 1;
  }
  if (signature[offset++] !== 0x02) {
    throw new Error('invalid-der-signature');
  }
  let rLen = signature[offset++];
  let r = signature.subarray(offset, offset + rLen);
  offset += rLen;
  if (signature[offset++] !== 0x02) {
    throw new Error('invalid-der-signature');
  }
  const sLen = signature[offset++];
  let s = signature.subarray(offset, offset + sLen);

  if (r.length > 32 && r[0] === 0x00) {
    r = r.subarray(1);
  }
  if (s.length > 32 && s[0] === 0x00) {
    s = s.subarray(1);
  }

  const raw = Buffer.alloc(64);
  r.copy(raw, 32 - r.length);
  s.copy(raw, 64 - s.length);
  return base64UrlEncode(raw);
}

export function normalizeApplePrivateKey(raw: string): string {
  return raw.trim().replace(/\\n/g, '\n');
}

export function resolveAppleSignInServerConfig(
  input: AppleSignInConfigInput = {},
): AppleSignInServerConfig | null {
  const teamId = input.teamId?.trim() || process.env.APPLE_SIGNIN_TEAM_ID?.trim();
  const clientId = input.clientId?.trim() || process.env.APPLE_SIGNIN_CLIENT_ID?.trim();
  const keyId = input.keyId?.trim() || process.env.APPLE_SIGNIN_KEY_ID?.trim();
  const privateKeyRaw =
    input.privateKey?.trim() || process.env.APPLE_SIGNIN_PRIVATE_KEY?.trim();
  if (!teamId || !clientId || !keyId || !privateKeyRaw) {
    return null;
  }
  return {
    teamId,
    clientId,
    keyId,
    privateKey: normalizeApplePrivateKey(privateKeyRaw),
  };
}

export function createAppleClientSecret(
  config: AppleSignInServerConfig,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  const header = base64UrlEncode(JSON.stringify({ alg: 'ES256', kid: config.keyId }));
  const payload = base64UrlEncode(
    JSON.stringify({
      iss: config.teamId,
      iat: nowSeconds,
      exp: nowSeconds + 60 * 60 * 24 * 150,
      aud: 'https://appleid.apple.com',
      sub: config.clientId,
    }),
  );
  const signingInput = `${header}.${payload}`;
  const signer = createSign('SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(config.privateKey);
  return `${signingInput}.${derSignatureToJwt(signature)}`;
}

/** Emulator/local fallback when secrets are not bound to a function. */
export function readAppleSignInServerConfigFromEnv(): AppleSignInServerConfig | null {
  return resolveAppleSignInServerConfig({});
}

/**
 * Auth nonce helpers — Apple Sign-In + Firebase OAuth için.
 *
 * Cryptographically secure random (expo-crypto). Pseudo-random RNGs are not used.
 * expo-crypto lazy yüklenir; native modül yoksa crash etmez.
 */

const NONCE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export type Sha256Result =
  | { ok: true; hash: string }
  | { ok: false; error: 'crypto-unavailable' };

export type SecureNonceResult =
  | { ok: true; nonce: string }
  | { ok: false; error: 'crypto-unavailable' };

function bytesToNonce(bytes: Uint8Array, length: number): string {
  let result = '';
  for (let i = 0; i < length; i += 1) {
    result += NONCE_CHARS.charAt(bytes[i]! % NONCE_CHARS.length);
  }
  return result;
}

/**
 * Cryptographically secure nonce — tek login attempt için üretilmeli, saklanmamalı.
 */
export async function generateSecureNonceAsync(length = 32): Promise<SecureNonceResult> {
  if (!Number.isFinite(length) || length < 16 || length > 128) {
    return { ok: false, error: 'crypto-unavailable' };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Crypto = require('expo-crypto') as typeof import('expo-crypto');
    const bytes = await Crypto.getRandomBytesAsync(length);
    if (!bytes || bytes.length < length) {
      return { ok: false, error: 'crypto-unavailable' };
    }
    const nonce = bytesToNonce(bytes, length);
    if (!nonce || nonce.length !== length) {
      return { ok: false, error: 'crypto-unavailable' };
    }
    return { ok: true, nonce };
  } catch (error) {
    console.warn('[auth] expo-crypto getRandomBytes unavailable', error);
    return { ok: false, error: 'crypto-unavailable' };
  }
}

/**
 * SHA-256 — expo-crypto yalnızca çağrı anında yüklenir.
 * Apple’a hashed nonce; Firebase credential’a rawNonce verilir.
 */
export async function sha256(nonce: string): Promise<Sha256Result> {
  if (!nonce || typeof nonce !== 'string') {
    return { ok: false, error: 'crypto-unavailable' };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Crypto = require('expo-crypto') as typeof import('expo-crypto');
    const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);
    if (!hash || typeof hash !== 'string') {
      return { ok: false, error: 'crypto-unavailable' };
    }
    return { ok: true, hash };
  } catch (error) {
    console.warn('[auth] expo-crypto unavailable', error);
    return { ok: false, error: 'crypto-unavailable' };
  }
}

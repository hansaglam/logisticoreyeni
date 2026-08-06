/**
 * Auth nonce helpers — Apple Sign-In + Firebase OAuth için.
 *
 * Cryptographically secure random (expo-crypto). Pseudo-random RNGs are not used.
 * expo-crypto lazy yüklenir; native modül yoksa crash etmez.
 */

const NONCE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const NONCE_CHARSET_SIZE = NONCE_CHARS.length;
const MAX_UNBIASED_BYTE = Math.floor(256 / NONCE_CHARSET_SIZE) * NONCE_CHARSET_SIZE;

export type Sha256Result =
  | { ok: true; hash: string }
  | { ok: false; error: 'crypto-unavailable' };

export type SecureNonceResult =
  | { ok: true; nonce: string }
  | { ok: false; error: 'crypto-unavailable' };

function appendUnbiasedNonceChars(bytes: Uint8Array, target: string[], needed: number): void {
  for (let i = 0; i < bytes.length && target.length < needed; i += 1) {
    const value = bytes[i]!;
    if (value < MAX_UNBIASED_BYTE) {
      target.push(NONCE_CHARS.charAt(value % NONCE_CHARSET_SIZE));
    }
  }
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
    const chars: string[] = [];
    let attempts = 0;

    while (chars.length < length && attempts < 8) {
      attempts += 1;
      const byteCount = Math.max(length * 2, 32);
      const bytes = await Crypto.getRandomBytesAsync(byteCount);
      if (!bytes || bytes.length === 0) {
        return { ok: false, error: 'crypto-unavailable' };
      }
      appendUnbiasedNonceChars(bytes, chars, length);
    }

    if (chars.length < length) {
      return { ok: false, error: 'crypto-unavailable' };
    }

    const nonce = chars.slice(0, length).join('');
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
 * SHA-256 lowercase hex — expo-crypto yalnızca çağrı anında yüklenir.
 * Apple’a hashed nonce; Firebase credential’a rawNonce verilir.
 */
export async function sha256(nonce: string): Promise<Sha256Result> {
  if (!nonce || typeof nonce !== 'string') {
    return { ok: false, error: 'crypto-unavailable' };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Crypto = require('expo-crypto') as typeof import('expo-crypto');
    const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce, {
      encoding: Crypto.CryptoEncoding.HEX,
    });
    if (!hash || typeof hash !== 'string') {
      return { ok: false, error: 'crypto-unavailable' };
    }
    return { ok: true, hash: hash.toLowerCase() };
  } catch (error) {
    console.warn('[auth] expo-crypto unavailable', error);
    return { ok: false, error: 'crypto-unavailable' };
  }
}

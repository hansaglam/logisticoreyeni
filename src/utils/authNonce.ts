/**
 * Auth nonce helpers — Apple Sign-In + Firebase OAuth için.
 *
 * expo-crypto lazy yüklenir; native modül yoksa crash etmez.
 */

const NONCE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export type Sha256Result =
  | { ok: true; hash: string }
  | { ok: false; error: 'crypto-unavailable' };

export function generateRandomNonce(length = 32): string {
  let result = '';
  for (let i = 0; i < length; i += 1) {
    result += NONCE_CHARS.charAt(Math.floor(Math.random() * NONCE_CHARS.length));
  }
  return result;
}

/**
 * SHA-256 — expo-crypto yalnızca çağrı anında yüklenir.
 */
export async function sha256(nonce: string): Promise<Sha256Result> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Crypto = require('expo-crypto') as typeof import('expo-crypto');
    const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);
    return { ok: true, hash };
  } catch (error) {
    console.warn('[auth] expo-crypto unavailable', error);
    return { ok: false, error: 'crypto-unavailable' };
  }
}

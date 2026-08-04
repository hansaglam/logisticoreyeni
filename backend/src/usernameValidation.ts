/**
 * Canonical username validation — shared rules for callables.
 * Türkçe harfler desteklenir; uniqueness `tr-TR` lowercase normalize ile sağlanır.
 */

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;
export const USERNAME_CHANGE_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

export type UsernameValidationReason =
  | 'username-too-short'
  | 'username-too-long'
  | 'username-invalid'
  | 'username-reserved'
  | 'username-inappropriate';

const RESERVED = new Set([
  'admin',
  'administrator',
  'moderator',
  'mod',
  'support',
  'help',
  'logisticore',
  'system',
  'official',
  'firebase',
  'google',
  'apple',
  'null',
  'undefined',
  'owner',
  'root',
  'staff',
]);

/** Hafif uygunsuz kelime listesi — aşırı agresif false-positive üretmemek için kısa tutuldu. */
const INAPPROPRIATE = [
  'amk',
  'aq',
  'orospu',
  'siktir',
  'piç',
  'pic',
  'yarrak',
  'fuck',
  'shit',
  'bitch',
  'nazi',
];

const USERNAME_PATTERN = /^[\p{L}\p{N}_]+$/u;

export function normalizeUsername(raw: string): string {
  return raw.trim().normalize('NFKC').toLocaleLowerCase('tr-TR');
}

export function suggestUsernameFromDisplayName(displayName: string | null | undefined): string {
  if (!displayName || typeof displayName !== 'string') return '';
  // Boşluk/ayırıcıları kaldır → "Ethem Sincar" → "ethemsincar"
  const asciiHint = displayName
    .normalize('NFKC')
    .replace(/[@.].*$/, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
  const normalized = normalizeUsername(asciiHint).slice(0, USERNAME_MAX_LENGTH);
  if (normalized.length < USERNAME_MIN_LENGTH) return '';
  const validated = validateUsernameFormat(normalized);
  return validated.ok ? validated.usernameNormalized : '';
}

export function validateUsernameFormat(
  raw: unknown,
):
  | { ok: true; username: string; usernameNormalized: string }
  | { ok: false; reason: UsernameValidationReason } {
  if (typeof raw !== 'string') {
    return { ok: false, reason: 'username-invalid' };
  }

  const trimmed = raw.trim().normalize('NFKC');
  if (trimmed.length < USERNAME_MIN_LENGTH) {
    return { ok: false, reason: 'username-too-short' };
  }
  if (trimmed.length > USERNAME_MAX_LENGTH) {
    return { ok: false, reason: 'username-too-long' };
  }
  if (/\s/.test(trimmed) || trimmed.includes('@') || trimmed.includes('.')) {
    return { ok: false, reason: 'username-invalid' };
  }
  if (!USERNAME_PATTERN.test(trimmed)) {
    return { ok: false, reason: 'username-invalid' };
  }
  if (trimmed.startsWith('_') || trimmed.endsWith('_') || trimmed.includes('__')) {
    return { ok: false, reason: 'username-invalid' };
  }
  if (/^\d+$/.test(trimmed)) {
    return { ok: false, reason: 'username-invalid' };
  }

  const usernameNormalized = normalizeUsername(trimmed);
  if (RESERVED.has(usernameNormalized)) {
    return { ok: false, reason: 'username-reserved' };
  }
  for (const word of INAPPROPRIATE) {
    if (usernameNormalized.includes(word)) {
      return { ok: false, reason: 'username-inappropriate' };
    }
  }

  return { ok: true, username: trimmed, usernameNormalized };
}

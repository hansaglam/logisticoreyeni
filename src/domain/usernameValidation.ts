/**
 * Client-side username format validation (UX).
 * Canonical enforcement is backend `usernameValidation.ts`.
 * Türkçe harfler desteklenir; uniqueness `tr-TR` lowercase ile case-insensitive.
 */

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;

export type UsernameClientReason =
  | 'username-too-short'
  | 'username-too-long'
  | 'username-invalid'
  | 'username-reserved'
  | 'username-inappropriate'
  | 'username-taken'
  | 'username-change-cooldown'
  | 'username-required'
  | 'auth-required'
  | 'anonymous-not-supported'
  | 'rate-limited'
  | 'invalid-request'
  | 'service-unavailable';

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
  if (!displayName) return '';
  // Boşluk/ayırıcıları kaldır → "Ethem Sincar" → "ethemsincar"
  const hint = displayName
    .normalize('NFKC')
    .replace(/[@.].*$/, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
  const normalized = normalizeUsername(hint).slice(0, USERNAME_MAX_LENGTH);
  if (normalized.length < USERNAME_MIN_LENGTH) return '';
  const validated = validateUsernameFormat(normalized);
  return validated.ok ? validated.usernameNormalized : '';
}

export function validateUsernameFormat(
  raw: unknown,
):
  | { ok: true; username: string; usernameNormalized: string }
  | { ok: false; reason: UsernameClientReason } {
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

export function usernameReasonMessage(reason: UsernameClientReason | string): string {
  switch (reason) {
    case 'username-too-short':
      return 'Kullanıcı adı en az 3 karakter olmalı.';
    case 'username-too-long':
      return 'Kullanıcı adı en fazla 20 karakter olabilir.';
    case 'username-invalid':
      return 'Geçersiz karakter. Harf, rakam ve alt çizgi kullan.';
    case 'username-reserved':
      return 'Bu kullanıcı adı ayrılmıştır.';
    case 'username-inappropriate':
      return 'Bu kullanıcı adı kullanılamaz.';
    case 'username-taken':
      return 'Bu kullanıcı adı kullanımda.';
    case 'username-change-cooldown':
      return 'Kullanıcı adını 30 günde bir değiştirebilirsin.';
    case 'username-required':
      return 'Araç Pazarı’nı kullanmadan önce kullanıcı adını belirlemelisin.';
    case 'auth-required':
      return 'Oturum gerekli.';
    case 'anonymous-not-supported':
      return 'Kullanıcı adı için hesabını bağlaman gerekir.';
    case 'rate-limited':
      return 'Çok fazla deneme. Biraz sonra tekrar dene.';
    case 'service-unavailable':
      return 'Servis geçici olarak kullanılamıyor.';
    default:
      return 'İşlem tamamlanamadı. Lütfen tekrar dene.';
  }
}

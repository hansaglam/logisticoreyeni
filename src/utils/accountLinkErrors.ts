export type AccountLinkErrorKind =
  | 'credential-already-in-use'
  | 'account-exists-with-different-credential'
  | 'provider-already-linked'
  | 'cancelled'
  | 'general';

const CONFLICT_ERRORS = new Set<AccountLinkErrorKind>([
  'credential-already-in-use',
  'account-exists-with-different-credential',
]);

export function isAccountLinkConflictError(
  error?: string,
  errorKind?: AccountLinkErrorKind,
): boolean {
  if (errorKind && CONFLICT_ERRORS.has(errorKind)) {
    return true;
  }
  return (
    error === 'credential-already-in-use' ||
    error === 'account-exists-with-different-credential' ||
    error === 'auth/credential-already-in-use' ||
    error === 'auth/email-already-in-use' ||
    error === 'auth/account-exists-with-different-credential'
  );
}

export function getAccountLinkConflictTitle(provider: 'google' | 'apple'): string {
  return provider === 'google'
    ? 'Bu Google hesabında kayıt var'
    : 'Bu Apple hesabında kayıt var';
}

export function getAccountLinkConflictMessage(provider: 'google' | 'apple'): string {
  const providerLabel = provider === 'google' ? 'Google' : 'Apple';
  return `Seçtiğin ${providerLabel} hesabı zaten başka bir oyun kaydına bağlı. Mevcut misafir kaydınla bu hesabı birleştiremiyoruz.`;
}

export function getAccountLinkConflictFooter(provider: 'google' | 'apple'): string {
  const providerLabel = provider === 'google' ? 'Google' : 'Apple';
  return `${providerLabel} hesabındaki kayda geçebilir veya mevcut misafir kaydınla devam edebilirsin. Kayıt birleştirme şu an desteklenmiyor.`;
}

export function getAccountLinkGeneralErrorMessage(): string {
  return 'Hesap bağlanamadı. Lütfen tekrar dene.';
}

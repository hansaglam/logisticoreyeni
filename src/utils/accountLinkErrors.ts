export type AccountLinkErrorKind =
  | 'credential-already-in-use'
  | 'account-exists-with-different-credential'
  | 'provider-already-linked'
  | 'provider-not-enabled'
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

export function getAccountLinkConflictTitle(_provider: 'google' | 'apple'): string {
  return 'İki farklı kayıt bulundu.';
}

export function getAccountLinkConflictMessage(provider: 'google' | 'apple'): string {
  // UID-based post-sign-in save conflict (local vs cloud), not credential-merge messaging.
  const providerLabel = provider === 'google' ? 'Google' : 'Apple';
  return `Bu cihazdaki kayıt ile ${providerLabel} hesabındaki bulut kaydı farklı. Hangisini kullanmak istediğini seç.`;
}

export function getAccountLinkConflictFooter(_provider: 'google' | 'apple'): string {
  return 'Seçim yapmadan buluta otomatik yazım yapılmaz.';
}

export function getEmptyCloudAccountConflictTitle(): string {
  return 'Bu hesapta kayıt yok';
}

export function getEmptyCloudAccountConflictMessage(provider: 'google' | 'apple'): string {
  const providerLabel = provider === 'google' ? 'Google' : 'Apple';
  return `Seçtiğin ${providerLabel} hesabında henüz bulut kaydı yok. Bu cihazda başka bir oturuma ait ilerleme görünüyor. Yeni oyun başlatabilir veya bu cihazdaki kaydı bu hesaba bağlayabilirsin.`;
}

export function getAccountLinkGeneralErrorMessage(): string {
  return 'Hesap bağlanamadı. Lütfen tekrar dene.';
}

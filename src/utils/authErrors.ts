export type StructuredAuthError =
  | 'auth-required'
  | 'network-error'
  | 'popup-cancelled'
  | 'google-signin-cancelled'
  | 'apple-signin-cancelled'
  | 'invalid-credential'
  | 'credential-already-in-use'
  | 'account-exists-with-different-credential'
  | 'provider-already-linked'
  | 'provider-not-enabled'
  | 'apple-token-missing'
  | 'auth-initialization-failed';

export function mapFirebaseAuthError(error: unknown): StructuredAuthError {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code ?? '')
      : String(error ?? '');
  if (code.includes('network-request-failed')) return 'network-error';
  if (code.includes('credential-already-in-use')) return 'credential-already-in-use';
  if (code.includes('account-exists-with-different-credential')) {
    return 'account-exists-with-different-credential';
  }
  if (code.includes('provider-already-linked')) return 'provider-already-linked';
  if (code.includes('operation-not-allowed')) return 'provider-not-enabled';
  if (code.includes('invalid-credential')) return 'invalid-credential';
  if (code.includes('popup-closed') || code.includes('cancelled-popup')) {
    return 'popup-cancelled';
  }
  return 'auth-initialization-failed';
}

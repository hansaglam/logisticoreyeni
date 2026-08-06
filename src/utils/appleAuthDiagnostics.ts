/**
 * Apple Sign-In hata sınıflandırma + güvenli tanı logları.
 * Token / nonce / email / UID asla loglanmaz.
 * JSON.stringify(error) kullanılmaz — non-enumerable alanlar ayrı okunur.
 */

import { INTERNAL_TEST_VERSION } from '../config/backendRoadmap';

export type AppleAuthStage =
  | 'config-validation'
  | 'auth-readiness'
  | 'availability'
  | 'native-request-start'
  | 'native-request-success'
  | 'identity-token-validation'
  | 'firebase-credential-created'
  | 'firebase-credential'
  | 'anonymous-link-start'
  | 'anonymous-link-success'
  | 'anonymous-link-failure'
  | 'existing-account-signin-start'
  | 'existing-account-signin-success'
  | 'firebase-link'
  | 'firebase-signin'
  | 'profile-update'
  | 'cloud-conflict'
  | 'native-request'
  | 'apple-response';

export type AppleAuthFailure = {
  stage: AppleAuthStage;
  code: string;
  name?: string;
  message?: string;
  nativeCode?: string;
  firebaseCode?: string;
  domain?: string;
  recoverable: boolean;
  projectId?: string | null;
  bundleId?: string | null;
};

export type SafeAppleErrorFields = {
  name: string | null;
  code: string | null;
  message: string | null;
  nativeCode: string | null;
  firebaseCode: string | null;
  domain: string | null;
  toStringValue: string | null;
};

export type AppleAuthFlowLog = {
  stage: AppleAuthStage | 'config' | 'config-validation';
  result: 'success' | 'failure' | 'cancel' | 'info';
  name?: string | null;
  code?: string | null;
  message?: string | null;
  normalizedCode?: string;
  nativeCode?: string | null;
  firebaseCode?: string | null;
  domain?: string | null;
  hasIdentityToken?: boolean;
  hasAuthorizationCode?: boolean;
  hasEmail?: boolean;
  hasFullName?: boolean;
  hasAppleUserId?: boolean;
  hasRawNonce?: boolean;
  hasHashedNonce?: boolean;
  isAnonymous?: boolean | null;
  currentUserAnonymous?: boolean | null;
  providerIds?: string[];
  currentProviderIds?: string[];
  bundleId?: string | null;
  firebaseProjectId?: string | null;
  firebaseAppId?: string | null;
};

const SENSITIVE_KEY_PATTERN =
  /(token|nonce|authorizationcode|identitytoken|email|fullname|uid|private.?key|secret|idtoken)/i;

const ALLOWED_SENSITIVE_LOOKALIKE_KEYS = new Set([
  'bundleId',
  'firebaseProjectId',
  'firebaseAppId',
  'hasIdentityToken',
  'hasAuthorizationCode',
  'hasRawNonce',
  'hasHashedNonce',
  'hasEmail',
  'hasFullName',
  'hasAppleUserId',
]);

function readUnknownProp(error: unknown, key: string): unknown {
  if (!error || (typeof error !== 'object' && typeof error !== 'function')) {
    return undefined;
  }
  try {
    return Reflect.get(error as object, key);
  } catch {
    return undefined;
  }
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function readNestedUserInfo(error: unknown): Record<string, unknown> | null {
  const userInfo = readUnknownProp(error, 'userInfo');
  if (userInfo && typeof userInfo === 'object') {
    return userInfo as Record<string, unknown>;
  }
  return null;
}

/**
 * Error alanlarını JSON.stringify olmadan güvenli okur.
 * Non-enumerable `code` / `message` / `name` da yakalanır.
 */
export function extractSafeAppleErrorFields(error: unknown): SafeAppleErrorFields {
  const code =
    asNonEmptyString(readUnknownProp(error, 'code')) ??
    asNonEmptyString(readUnknownProp(error, 'nativeErrorCode')) ??
    null;
  const name = asNonEmptyString(readUnknownProp(error, 'name'));
  const message =
    asNonEmptyString(readUnknownProp(error, 'message')) ??
    (error instanceof Error ? asNonEmptyString(error.message) : null);
  const domain =
    asNonEmptyString(readUnknownProp(error, 'domain')) ??
    asNonEmptyString(readNestedUserInfo(error)?.domain) ??
    null;
  const nativeCode =
    asNonEmptyString(readUnknownProp(error, 'nativeErrorCode')) ??
    asNonEmptyString(readUnknownProp(error, 'nativeCode')) ??
    (domain && code ? `${domain}|${code}` : null) ??
    code;

  let firebaseCode: string | null = null;
  if (code?.startsWith('auth/')) {
    firebaseCode = code;
  } else if (message) {
    const match = message.match(/auth\/[a-z0-9-]+/i);
    if (match) {
      firebaseCode = match[0];
    }
  }

  let toStringValue: string | null = null;
  try {
    if (error && typeof (error as { toString?: unknown }).toString === 'function') {
      const rendered = String((error as { toString: () => unknown }).toString());
      if (rendered && rendered !== '[object Object]') {
        toStringValue = rendered.slice(0, 240);
      }
    }
  } catch {
    toStringValue = null;
  }

  return {
    name,
    code,
    message,
    nativeCode,
    firebaseCode,
    domain,
    toStringValue,
  };
}

export function shouldShowInternalAuthDiagnostics(): boolean {
  const flag = process.env.EXPO_PUBLIC_INTERNAL_DIAGNOSTICS?.trim().toLowerCase();
  if (flag === '0' || flag === 'false') {
    return false;
  }
  if (flag === '1' || flag === 'true') {
    return true;
  }
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    return true;
  }
  // Internal / TestFlight builds keep diagnosis visible until App Store production cutover.
  return Boolean(INTERNAL_TEST_VERSION);
}

export function isAppleAuthCancelFailure(failure?: AppleAuthFailure | null): boolean {
  if (!failure) {
    return false;
  }
  return (
    failure.code === 'cancelled' ||
    failure.code === 'ERR_REQUEST_CANCELED' ||
    failure.nativeCode === 'ERR_REQUEST_CANCELED' ||
    failure.firebaseCode === 'auth/cancelled-popup-request' ||
    failure.firebaseCode === 'auth/popup-closed-by-user'
  );
}

export function getErrorCode(error: unknown): string | null {
  return extractSafeAppleErrorFields(error).code;
}

export function getErrorMessage(error: unknown): string {
  return extractSafeAppleErrorFields(error).message ?? '';
}

export function normalizeAppleAuthFailure(
  error: unknown,
  stage: AppleAuthStage,
  extras?: {
    code?: string;
    nativeCode?: string | null;
    firebaseCode?: string | null;
    recoverable?: boolean;
  },
): AppleAuthFailure {
  const extracted = extractSafeAppleErrorFields(error);
  const nativeCode = extras?.nativeCode ?? extracted.nativeCode ?? undefined;
  const firebaseCode = extras?.firebaseCode ?? extracted.firebaseCode ?? undefined;
  const message = extracted.message ?? undefined;
  const name = extracted.name ?? undefined;
  const domain = extracted.domain ?? undefined;
  const errorCode = extras?.code ?? extracted.code ?? undefined;

  const withMeta = (failure: AppleAuthFailure): AppleAuthFailure => ({
    ...failure,
    name: failure.name ?? name,
    message: failure.message ?? message,
    domain: failure.domain ?? domain,
  });

  if (
    errorCode === 'ERR_REQUEST_CANCELED' ||
    nativeCode?.includes('ERR_REQUEST_CANCELED') ||
    errorCode === 'cancelled' ||
    errorCode === 'auth/cancelled-popup-request' ||
    errorCode === 'auth/popup-closed-by-user'
  ) {
    return withMeta({
      stage,
      code: 'ERR_REQUEST_CANCELED',
      nativeCode,
      firebaseCode,
      recoverable: true,
    });
  }

  const resolvedFirebase =
    firebaseCode ??
    (typeof errorCode === 'string' && errorCode.startsWith('auth/') ? errorCode : null) ??
    null;

  if (resolvedFirebase === 'auth/missing-or-invalid-nonce' || resolvedFirebase === 'auth/invalid-nonce') {
    return withMeta({
      stage,
      code: resolvedFirebase,
      nativeCode,
      firebaseCode: resolvedFirebase,
      recoverable: false,
    });
  }

  if (resolvedFirebase === 'auth/invalid-credential') {
    return withMeta({
      stage,
      code: 'auth/invalid-credential',
      nativeCode,
      firebaseCode: resolvedFirebase,
      recoverable: true,
    });
  }

  if (resolvedFirebase === 'auth/operation-not-allowed') {
    return withMeta({
      stage,
      code: 'auth/operation-not-allowed',
      nativeCode,
      firebaseCode: resolvedFirebase,
      recoverable: false,
    });
  }

  if (
    resolvedFirebase === 'auth/credential-already-in-use' ||
    resolvedFirebase === 'auth/email-already-in-use' ||
    resolvedFirebase === 'auth/account-exists-with-different-credential'
  ) {
    return withMeta({
      stage: stage === 'anonymous-link-failure' || stage === 'firebase-link' ? 'cloud-conflict' : stage,
      code: resolvedFirebase,
      nativeCode,
      firebaseCode: resolvedFirebase,
      recoverable: true,
    });
  }

  if (resolvedFirebase === 'auth/provider-already-linked') {
    return withMeta({
      stage,
      code: 'auth/provider-already-linked',
      nativeCode,
      firebaseCode: resolvedFirebase,
      recoverable: true,
    });
  }

  if (resolvedFirebase === 'auth/network-request-failed') {
    return withMeta({
      stage,
      code: 'auth/network-request-failed',
      nativeCode,
      firebaseCode: resolvedFirebase,
      recoverable: true,
    });
  }

  if (resolvedFirebase === 'auth/internal-error') {
    return withMeta({
      stage,
      code: 'auth/internal-error',
      nativeCode,
      firebaseCode: resolvedFirebase,
      recoverable: true,
    });
  }

  if (
    errorCode === 'ERR_REQUEST_FAILED' ||
    errorCode === 'ERR_REQUEST_NOT_HANDLED' ||
    errorCode === 'ERR_REQUEST_NOT_INTERACTIVE' ||
    errorCode === 'ERR_INVALID_RESPONSE' ||
    nativeCode?.includes('ERR_REQUEST_')
  ) {
    return withMeta({
      stage,
      code: errorCode ?? nativeCode ?? 'ERR_REQUEST_FAILED',
      nativeCode,
      firebaseCode: resolvedFirebase ?? undefined,
      recoverable: true,
    });
  }

  if (errorCode === 'APPLE_IDENTITY_TOKEN_MISSING' || extras?.code === 'APPLE_IDENTITY_TOKEN_MISSING') {
    return withMeta({
      stage,
      code: 'APPLE_IDENTITY_TOKEN_MISSING',
      nativeCode,
      firebaseCode: resolvedFirebase ?? undefined,
      recoverable: true,
    });
  }

  if (errorCode === 'crypto-unavailable' || extras?.code === 'crypto-unavailable') {
    return withMeta({
      stage,
      code: 'crypto-unavailable',
      nativeCode,
      firebaseCode: resolvedFirebase ?? undefined,
      recoverable: false,
    });
  }

  if (
    errorCode === 'apple-not-available' ||
    errorCode === 'apple-not-supported' ||
    extras?.code === 'apple-not-available' ||
    extras?.code === 'apple-not-supported'
  ) {
    return withMeta({
      stage,
      code: errorCode ?? extras?.code ?? 'apple-not-available',
      nativeCode,
      firebaseCode: resolvedFirebase ?? undefined,
      recoverable: false,
    });
  }

  const fallbackCode =
    extras?.code ||
    resolvedFirebase ||
    errorCode ||
    nativeCode ||
    extracted.toStringValue ||
    (message && message.trim().length > 0 ? message.trim() : 'apple-sign-in-failed');

  return withMeta({
    stage,
    code: fallbackCode,
    nativeCode,
    firebaseCode: resolvedFirebase ?? undefined,
    recoverable: extras?.recoverable ?? true,
  });
}

export function getAppleAuthDiagnosticCode(failure: AppleAuthFailure): string {
  if (failure.code === 'ERR_REQUEST_CANCELED') {
    return 'APPLE_REQUEST_CANCELED';
  }
  if (failure.code === 'APPLE_IDENTITY_TOKEN_MISSING') {
    return 'APPLE_IDENTITY_TOKEN_MISSING';
  }
  if (
    failure.stage === 'config-validation' ||
    failure.code === 'FIREBASE_RUNTIME_CONFIG_MISMATCH'
  ) {
    return 'FIREBASE_RUNTIME_CONFIG_MISMATCH';
  }
  if (
    failure.stage === 'auth-readiness' ||
    failure.code === 'AUTH_NOT_READY' ||
    failure.code === 'AUTH_INSTANCE_UNAVAILABLE' ||
    failure.code === 'FIREBASE_CONFIG_MISSING' ||
    failure.code === 'auth-unavailable'
  ) {
    if (failure.firebaseCode?.startsWith('auth/')) {
      return failure.firebaseCode;
    }
    if (failure.code.startsWith('auth/')) {
      return failure.code;
    }
    return failure.code === 'auth-unavailable'
      ? 'AUTH_INSTANCE_UNAVAILABLE'
      : failure.code;
  }
  if (failure.code === 'MIXED_FIREBASE_SDK_CREDENTIAL') {
    return 'MIXED_FIREBASE_SDK_CREDENTIAL';
  }
  if (
    failure.firebaseCode === 'auth/missing-or-invalid-nonce' ||
    failure.firebaseCode === 'auth/invalid-nonce' ||
    failure.code === 'auth/missing-or-invalid-nonce' ||
    failure.code === 'auth/invalid-nonce'
  ) {
    return 'APPLE_INVALID_NONCE';
  }
  if (failure.firebaseCode === 'auth/invalid-credential' || failure.code === 'auth/invalid-credential') {
    return 'APPLE_INVALID_CREDENTIAL';
  }
  if (
    failure.firebaseCode === 'auth/operation-not-allowed' ||
    failure.code === 'auth/operation-not-allowed' ||
    failure.code === 'provider-not-enabled'
  ) {
    return 'APPLE_PROVIDER_DISABLED';
  }
  if (
    failure.firebaseCode === 'auth/credential-already-in-use' ||
    failure.firebaseCode === 'auth/email-already-in-use' ||
    failure.firebaseCode === 'auth/account-exists-with-different-credential' ||
    failure.code === 'credential-already-in-use' ||
    failure.code === 'auth/credential-already-in-use' ||
    failure.code === 'auth/email-already-in-use' ||
    failure.code === 'account-exists-with-different-credential' ||
    failure.code === 'auth/account-exists-with-different-credential'
  ) {
    return 'APPLE_ACCOUNT_ALREADY_LINKED';
  }
  if (
    failure.firebaseCode === 'auth/network-request-failed' ||
    failure.code === 'auth/network-request-failed'
  ) {
    return 'APPLE_NETWORK_ERROR';
  }
  if (failure.code === 'crypto-unavailable') {
    return 'APPLE_CRYPTO_UNAVAILABLE';
  }
  if (failure.code === 'apple-not-available' || failure.code === 'apple-not-supported') {
    return 'APPLE_NOT_AVAILABLE';
  }
  if (
    failure.firebaseCode === 'auth/provider-already-linked' ||
    failure.code === 'auth/provider-already-linked' ||
    failure.code === 'provider-already-linked'
  ) {
    return 'APPLE_PROVIDER_ALREADY_LINKED';
  }
  if (failure.firebaseCode === 'auth/internal-error' || failure.code === 'auth/internal-error') {
    return 'APPLE_FIREBASE_INTERNAL';
  }
  return getAppleAuthDiagnosticCodeFallback(failure);
}

function getAppleAuthDiagnosticCodeFallback(failure: AppleAuthFailure): string {
  if (failure.nativeCode?.includes('NSCocoaErrorDomain') || failure.nativeCode?.includes('AuthenticationServices')) {
    return `APPLE_NATIVE_${(failure.nativeCode ?? failure.code).replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()}`;
  }
  if (failure.code.startsWith('ERR_REQUEST_')) {
    return `APPLE_${failure.code}`;
  }
  return 'APPLE_SIGN_IN_FAILED';
}

export function getAppleAuthUserMessage(failure: AppleAuthFailure): string {
  const diagnosticCode = getAppleAuthDiagnosticCode(failure);

  if (isAppleAuthCancelFailure(failure)) {
    return '';
  }

  if (diagnosticCode === 'APPLE_NETWORK_ERROR') {
    return 'İnternet bağlantısı kurulamadı. Tekrar deneyin.';
  }
  if (diagnosticCode === 'FIREBASE_RUNTIME_CONFIG_MISMATCH') {
    return 'Firebase yapılandırması eşleşmiyor.';
  }
  if (
    diagnosticCode === 'AUTH_NOT_READY' ||
    diagnosticCode === 'AUTH_INSTANCE_UNAVAILABLE' ||
    diagnosticCode === 'FIREBASE_CONFIG_MISSING'
  ) {
    return 'Firebase oturumu hazır değil. Lütfen tekrar dene.';
  }
  if (diagnosticCode === 'MIXED_FIREBASE_SDK_CREDENTIAL') {
    return 'Hesap bağlama yapılandırması uyumsuz.';
  }
  if (diagnosticCode === 'APPLE_PROVIDER_DISABLED') {
    return 'Apple ile giriş şu anda yapılandırılamadı.';
  }
  if (diagnosticCode === 'APPLE_ACCOUNT_ALREADY_LINKED') {
    return 'Bu Apple hesabı daha önce başka bir oyun hesabına bağlanmış.';
  }
  if (diagnosticCode === 'APPLE_INVALID_NONCE' || diagnosticCode === 'APPLE_INVALID_CREDENTIAL') {
    return 'Apple kimliği doğrulanamadı.';
  }
  if (diagnosticCode === 'APPLE_IDENTITY_TOKEN_MISSING') {
    return "Apple'dan geçerli kimlik bilgisi alınamadı.";
  }
  if (diagnosticCode === 'APPLE_NOT_AVAILABLE') {
    return 'Apple ile giriş bu cihazda kullanılamıyor.';
  }
  if (diagnosticCode === 'APPLE_CRYPTO_UNAVAILABLE') {
    return 'Apple ile giriş için gerekli güvenlik modülü hazırlanamadı. Lütfen uygulamayı yeniden başlat.';
  }
  if (diagnosticCode === 'APPLE_PROVIDER_ALREADY_LINKED') {
    return 'Bu hesaba zaten bir giriş yöntemi bağlı.';
  }
  return 'Hesap bağlanamadı. Lütfen tekrar dene.';
}

/** Modal body — Internal/TestFlight keeps stage/code; production hides technical details. */
export function formatAppleAuthDiagnosticDisplay(failure: AppleAuthFailure): string {
  const userMessage =
    getAppleAuthUserMessage(failure) || 'Hesap bağlanamadı. Lütfen tekrar dene.';
  if (!shouldShowInternalAuthDiagnostics()) {
    return userMessage;
  }

  const code = failure.firebaseCode || failure.code;
  const lines = [
    userMessage,
    '',
    'Tanı:',
    `stage=${failure.stage}`,
    `code=${code}`,
  ];
  if (failure.nativeCode && failure.nativeCode !== code) {
    lines.push(`nativeCode=${failure.nativeCode}`);
  }
  if (failure.firebaseCode && failure.firebaseCode !== code) {
    lines.push(`firebaseCode=${failure.firebaseCode}`);
  }
  if (failure.stage === 'config-validation' || failure.code === 'FIREBASE_RUNTIME_CONFIG_MISMATCH') {
    lines.push(`project=${failure.projectId ?? '<empty>'}`);
    lines.push(`bundle=${failure.bundleId ?? '<empty>'}`);
  }
  lines.push(`diag=${getAppleAuthDiagnosticCode(failure)}`);
  return lines.join('\n');
}

export function getAppleAuthDiagnosticFooter(failure: AppleAuthFailure): string | undefined {
  if (!shouldShowInternalAuthDiagnostics() || isAppleAuthCancelFailure(failure)) {
    return undefined;
  }
  return `Tanı:\nstage=${failure.stage}\ncode=${failure.firebaseCode || failure.code}`;
}

export function assertSafeAppleAuthLogPayload(payload: Record<string, unknown>): void {
  for (const key of Object.keys(payload)) {
    if (ALLOWED_SENSITIVE_LOOKALIKE_KEYS.has(key)) {
      continue;
    }
    if (SENSITIVE_KEY_PATTERN.test(key) && !/^has[A-Z]/.test(key)) {
      throw new Error(`Refusing to log sensitive apple-auth key: ${key}`);
    }
  }
}

export function logAppleAuthFlow(fields: AppleAuthFlowLog): void {
  const payload: Record<string, unknown> = {
    stage: fields.stage,
    result: fields.result,
    name: fields.name ?? null,
    code: fields.code ?? fields.normalizedCode ?? null,
    message: fields.message ?? null,
    normalizedCode: fields.normalizedCode ?? null,
    nativeCode: fields.nativeCode ?? null,
    firebaseCode: fields.firebaseCode ?? null,
    domain: fields.domain ?? null,
    hasIdentityToken: fields.hasIdentityToken ?? null,
    hasAuthorizationCode: fields.hasAuthorizationCode ?? null,
    hasEmail: fields.hasEmail ?? null,
    hasFullName: fields.hasFullName ?? null,
    hasAppleUserId: fields.hasAppleUserId ?? null,
    hasRawNonce: fields.hasRawNonce ?? null,
    hasHashedNonce: fields.hasHashedNonce ?? null,
    isAnonymous: fields.isAnonymous ?? fields.currentUserAnonymous ?? null,
    providerIds: fields.providerIds ?? fields.currentProviderIds ?? null,
    bundleId: fields.bundleId ?? null,
    firebaseProjectId: fields.firebaseProjectId ?? null,
    firebaseAppId: fields.firebaseAppId ?? null,
  };

  assertSafeAppleAuthLogPayload(payload);
  console.warn('[apple-auth-flow]', payload);
}

export function sanitizeAppleFullName(fullName: string | null | undefined): string | null {
  if (typeof fullName !== 'string') {
    return null;
  }
  const cleaned = fullName.replace(/\s+/g, ' ').trim();
  return cleaned.length > 0 ? cleaned : null;
}

export function createAppleOAuthCredentialParams(
  identityToken: string,
  rawNonce: string,
): { idToken: string; rawNonce: string } {
  return {
    idToken: identityToken,
    rawNonce,
  };
}

export function resolveAppleLinkPlan(input: {
  isAnonymous: boolean;
  providerIds: string[];
}): 'link' | 'already-linked-success' | 'link-additional-provider' {
  const hasApple = input.providerIds.some((id) => id === 'apple.com' || id.includes('apple'));
  if (!input.isAnonymous && hasApple) {
    return 'already-linked-success';
  }
  if (input.isAnonymous) {
    return 'link';
  }
  return 'link-additional-provider';
}

export function isAppleExistingAccountConflictCode(code: string | null | undefined): boolean {
  return (
    code === 'auth/credential-already-in-use' ||
    code === 'auth/email-already-in-use' ||
    code === 'auth/account-exists-with-different-credential' ||
    code === 'credential-already-in-use' ||
    code === 'account-exists-with-different-credential'
  );
}

export function isAppleProviderAlreadyLinkedCode(code: string | null | undefined): boolean {
  return code === 'auth/provider-already-linked' || code === 'provider-already-linked';
}

export function shouldRequestFreshAppleCredential(code: string | null | undefined): boolean {
  return (
    isAppleExistingAccountConflictCode(code) ||
    code === 'auth/invalid-credential' ||
    code === 'auth/user-token-expired' ||
    code === 'auth/invalid-custom-token'
  );
}

export function createSingleFlightController(): {
  tryStart: () => boolean;
  finish: () => void;
  isActive: () => boolean;
} {
  let active = false;
  return {
    tryStart: () => {
      if (active) {
        return false;
      }
      active = true;
      return true;
    },
    finish: () => {
      active = false;
    },
    isActive: () => active,
  };
}

export function failureFromLinkError(
  error: string | undefined,
  stage: AppleAuthStage = 'firebase-link',
): AppleAuthFailure {
  return normalizeAppleAuthFailure(
    { code: error, message: error },
    stage,
    {
      code: error,
      firebaseCode: error?.startsWith('auth/') ? error : null,
    },
  );
}
